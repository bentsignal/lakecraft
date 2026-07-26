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
      const resolvedEsbuildRelativePath = relative(canonicalCacheEntryRoot, canonicalEsbuildPath);
      if (
        typeof lakebedPackage.dependencies?.esbuild !== "string"
        || !lakebedPackage.dependencies.esbuild
        || isAbsolute(resolvedEsbuildRelativePath)
        || resolvedEsbuildRelativePath === ".."
        || resolvedEsbuildRelativePath.startsWith(`..${sep}`)
      ) {
        throw new Error("Lakebed's compiler must resolve from its declared npx install tree.");
      }
      candidates.push({
        cacheEntryRoot: canonicalCacheEntryRoot,
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
