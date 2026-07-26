import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

async function packageJson(path, expectedName) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed?.name !== expectedName || typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`${path} is not a valid ${expectedName} package.`);
  }
  return parsed;
}

const COMPLETE_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseCompleteSemver(value, label) {
  const match = COMPLETE_SEMVER_PATTERN.exec(value);
  const prerelease = match?.[4]?.split(".") ?? [];
  if (
    !match
    || [match[1], match[2], match[3]].some((identifier) => !Number.isSafeInteger(Number(identifier)))
    || prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier[0] === "0")
  ) {
    throw new Error(`${label} must be a complete SemVer version.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function compareSemver(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length ? -1 : 1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return leftIdentifier.length === rightIdentifier.length
        ? leftIdentifier < rightIdentifier ? -1 : 1
        : leftIdentifier.length < rightIdentifier.length ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function stableVersion(major, minor, patch) {
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error("Lakebed's esbuild dependency range exceeds supported SemVer bounds.");
  }
  return { major, minor, patch, prerelease: [] };
}

function isCanonicalCacheChild(cacheEntryRoot, path) {
  const relativePath = relative(cacheEntryRoot, path);
  return (
    relativePath !== ""
    && !isAbsolute(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
  );
}

/**
 * Implements only the complete exact, tilde, and caret npm ranges Lakebed may
 * declare. Unsupported range syntax is rejected instead of being approximated.
 */
export function lakebedCompilerVersionSatisfiesRange(version, declaredRange) {
  if (typeof version !== "string" || typeof declaredRange !== "string") {
    throw new Error("Lakebed's compiler version and dependency range must be strings.");
  }
  const rangeMatch = /^(=|~|\^)?(.+)$/.exec(declaredRange);
  if (!rangeMatch) {
    throw new Error("Lakebed's esbuild dependency range is malformed.");
  }
  const operator = rangeMatch[1] ?? "=";
  const minimum = parseCompleteSemver(rangeMatch[2], "Lakebed's esbuild dependency range");
  const candidate = parseCompleteSemver(version, "Lakebed's resolved esbuild version");
  if (operator === "=") return compareSemver(candidate, minimum) === 0;

  let maximum;
  if (operator === "~") {
    maximum = stableVersion(minimum.major, minimum.minor + 1, 0);
  } else if (minimum.major > 0) {
    maximum = stableVersion(minimum.major + 1, 0, 0);
  } else if (minimum.minor > 0) {
    maximum = stableVersion(0, minimum.minor + 1, 0);
  } else {
    maximum = stableVersion(0, 0, minimum.patch + 1);
  }
  const prereleaseAllowed = !candidate.prerelease.length || (
    minimum.prerelease.length > 0
    && candidate.major === minimum.major
    && candidate.minor === minimum.minor
    && candidate.patch === minimum.patch
  );
  return (
    prereleaseAllowed
    && compareSemver(candidate, minimum) >= 0
    && compareSemver(candidate, maximum) < 0
  );
}

/**
 * Resolves esbuild through the same npm install tree as Lakebed. Standalone
 * esbuild cache entries are deliberately ineligible even when they are newer.
 */
export async function resolveLakebedCompilerRuntime({
  cacheRoot = join(homedir(), ".npm", "_npx"),
} = {}) {
  const candidates = [];
  for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cacheEntryRoot = join(cacheRoot, entry.name);
    const lakebedPackagePath = join(cacheEntryRoot, "node_modules", "lakebed", "package.json");
    try {
      await access(lakebedPackagePath);
      const requireFromLakebed = createRequire(lakebedPackagePath);
      const esbuildPackagePath = requireFromLakebed.resolve("esbuild/package.json");
      const esbuildPath = requireFromLakebed.resolve("esbuild/lib/main.js");
      const lakebedBuildPath = join(cacheEntryRoot, "node_modules", "lakebed", "dist", "cli", "build.js");
      await Promise.all([access(esbuildPackagePath), access(esbuildPath), access(lakebedBuildPath)]);
      const [
        canonicalCacheEntryRoot,
        canonicalEsbuildPackagePath,
        canonicalEsbuildPath,
        canonicalLakebedBuildPath,
        canonicalLakebedPackagePath,
      ] = await Promise.all([
        realpath(cacheEntryRoot),
        realpath(esbuildPackagePath),
        realpath(esbuildPath),
        realpath(lakebedBuildPath),
        realpath(lakebedPackagePath),
      ]);
      const [lakebedPackage, esbuildPackage] = await Promise.all([
        packageJson(canonicalLakebedPackagePath, "lakebed"),
        packageJson(canonicalEsbuildPackagePath, "esbuild"),
      ]);
      const declaredEsbuildRange = lakebedPackage.dependencies?.esbuild;
      if (
        typeof declaredEsbuildRange !== "string"
        || !declaredEsbuildRange
        || ![
          canonicalLakebedPackagePath,
          canonicalLakebedBuildPath,
          canonicalEsbuildPackagePath,
          canonicalEsbuildPath,
        ].every((path) => isCanonicalCacheChild(canonicalCacheEntryRoot, path))
      ) {
        throw new Error("Lakebed's compiler paths must resolve within its declared npx install tree.");
      }
      if (!lakebedCompilerVersionSatisfiesRange(esbuildPackage.version, declaredEsbuildRange)) {
        throw new Error(
          `Lakebed declares esbuild ${declaredEsbuildRange}, but resolved ${esbuildPackage.version}.`,
        );
      }
      candidates.push({
        cacheEntryRoot: canonicalCacheEntryRoot,
        declaredEsbuildRange,
        esbuildPackagePath: canonicalEsbuildPackagePath,
        esbuildPath: canonicalEsbuildPath,
        esbuildVersion: esbuildPackage.version,
        lakebedBuildPath: canonicalLakebedBuildPath,
        lakebedPackagePath: canonicalLakebedPackagePath,
        lakebedVersion: lakebedPackage.version,
        modifiedAt: (await stat(canonicalEsbuildPath)).mtimeMs,
      });
    } catch {
      // Ignore standalone, incomplete, or stale npx cache entries.
    }
  }
  candidates.sort((left, right) =>
    right.modifiedAt - left.modifiedAt
    || left.cacheEntryRoot.localeCompare(right.cacheEntryRoot));
  if (!candidates[0]) {
    throw new Error("Run `npx lakebed build` once so Lakebed's bundled compiler is available.");
  }
  return candidates[0];
}

export async function loadLakebedCompilerRuntime(options) {
  const runtime = await resolveLakebedCompilerRuntime(options);
  const compiler = await import(pathToFileURL(runtime.esbuildPath).href);
  if (compiler.version !== runtime.esbuildVersion || typeof compiler.build !== "function") {
    throw new Error(
      `Lakebed compiler identity mismatch: package ${runtime.esbuildVersion}, module ${String(compiler.version)}.`,
    );
  }
  return {
    ...runtime,
    build: compiler.build,
    compilerVersion: compiler.version,
  };
}
