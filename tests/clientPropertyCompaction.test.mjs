import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
  COMPACT_CLIENT_PROPERTY_PATTERN,
  compactClientPropertyCache,
} from "../scripts/client-property-compaction.mjs";
import {
  lakebedCompilerVersionSatisfiesRange,
  loadLakebedCompilerRuntime,
  resolveLakebedCompilerRuntime,
} from "../scripts/lakebed-compiler-runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const analysis = JSON.parse(execFileSync(
  process.execPath,
  [join(repositoryRoot, "scripts/analyze-client-properties.mjs")],
  { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
));
const manifestNames = Object.keys(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE);
const compactNames = Object.values(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE);

assert.deepEqual(manifestNames, [...manifestNames].sort(), "reviewed property manifest stays sorted");
assert.equal(manifestNames.length, 436, "reviewed compatibility boundary changes only intentionally");
assert.equal(new Set(manifestNames).size, manifestNames.length, "source property names stay unique");
assert.equal(new Set(compactNames).size, compactNames.length, "compact property names stay unique");
assert.ok(manifestNames.every((name) => /^[A-Za-z_$][\w$]*$/.test(name)), "source names are identifiers");
assert.ok(compactNames.every((name) => /^[A-Za-z_$][\w$]*$/.test(name)), "compact names are identifiers");
assert.ok(manifestNames.every((name) => COMPACT_CLIENT_PROPERTY_PATTERN.test(name)), "pattern covers every manifest name");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("soundMuted"), false, "settings key stays reserved");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("worldId"), false, "save identity stays reserved");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("onClick"), false, "Preact event prop stays reserved");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("requestPointerLock"), false, "browser API stays reserved");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("webkitAudioContext"), false, "browser compatibility API stays reserved");
assert.ok(COMPACT_CLIENT_PROPERTY_PATTERN.test("firstPersonTotalUploadBytes"), "internal performance fields compact");
assert.ok(COMPACT_CLIENT_PROPERTY_PATTERN.test("onInventoryWorkspaceChange"), "bundle-internal component props compact");
assert.ok(COMPACT_CLIENT_PROPERTY_PATTERN.test("transparentDistanceSquared"), "renderer-only fields compact");
assert.deepEqual(
  Object.fromEntries(["emissive", "exposureLevel", "faceShade", "onExit", "pointerLockHandoff"].map(
    (name) => [name, COMPACT_CLIENT_PROPERTY_MANGLE_CACHE[name]],
  )),
  {
    emissive: "aL",
    exposureLevel: "aM",
    faceShade: "aN",
    onExit: "aO",
    pointerLockHandoff: "aP",
  },
  "new client-internal records use fixed collision-reviewed mappings",
);

const expectedCandidateNames = [
  ...manifestNames,
  // These remain source-live but are tree-shaken from the final client entry.
  "onDismissControls",
  "onOpenHelp",
  "showControls",
].sort();
assert.deepEqual(
  analysis.candidates,
  expectedCandidateNames,
  "AST audit and fixed manifest have exact set equality apart from reviewed dead exports",
);

const manifestSet = new Set(manifestNames);
const forbiddenCompactNames = new Set([
  ...analysis.allPropertyNames.filter((name) => !manifestSet.has(name)),
  ...analysis.externalPropertyNames,
]);
assert.deepEqual(
  compactNames.filter((name) => forbiddenCompactNames.has(name)),
  [],
  "compact names cannot collide with unmangled app, DOM, WebGL, JavaScript, or Preact properties",
);
assert.deepEqual(
  manifestNames.filter((name) => analysis.jsonStringifyPropertyNames.includes(name)),
  [],
  "no compact property is a literal runtime JSON payload key",
);
assert.deepEqual(
  compactClientPropertyCache(),
  COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
  "each build receives an exact mutable copy of the fixed cache",
);

const prepareSource = readFileSync(join(repositoryRoot, "scripts/prepare-lakebed-deploy.mjs"), "utf8");
assert.match(prepareSource, /server \? \{\} : \{\s*mangleCache:/, "property mangling is client-stage-only");
assert.match(prepareSource, /loadLakebedCompilerRuntime\(\)/, "staging uses the shared Lakebed compiler resolver");
assert.equal(prepareSource.includes("findLakebedEsbuild"), false, "staging has no divergent compiler lookup");
assert.match(prepareSource, /mangleQuoted: false/, "quoted keys are never rewritten");
assert.match(prepareSource, /Compact client property live set changed/, "staging fails closed on cache drift");
assert.equal(prepareSource.includes("mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN"), true);
assert.equal(prepareSource.includes("bundle-string-hoisting"), false, "no post-minify JavaScript grammar rewriting returns");
assert.deepEqual(
  [...readFileSync(join(repositoryRoot, "client/index.tsx"), "utf8").matchAll(
    /^\s*export\s+(?:default\s+)?(?:const|class|function|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  )].map((match) => match[1]),
  ["App"],
  "the bundled browser entrypoint exports only its zero-prop Lakebed App component",
);

function writeFixturePackage(cacheEntryRoot, name, version, files = {}, packageFields = {}) {
  const packageRoot = join(cacheEntryRoot, "node_modules", name);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, version, ...packageFields }));
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(packageRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
}

function writeCoupledCompilerFixture(
  cacheEntryRoot,
  { esbuildVersion = "0.27.7", declaredEsbuildRange = "^0.27.1" } = {},
) {
  writeFixturePackage(cacheEntryRoot, "lakebed", "1.2.3", {
    "dist/cli/build.js": "export {};\n",
  }, { dependencies: { esbuild: declaredEsbuildRange } });
  writeFixturePackage(cacheEntryRoot, "esbuild", esbuildVersion, {
    "lib/main.js": `export const version=${JSON.stringify(esbuildVersion)};export async function build(){}\n`,
  });
}

for (const [version, range, expected] of [
  ["0.27.1", "0.27.1", true],
  ["0.27.1+lakebed.1", "=0.27.1+other.2", true],
  ["0.27.2", "0.27.1", false],
  ["0.27.7", "~0.27.1", true],
  ["0.28.0", "~0.27.1", false],
  ["0.27.7", "^0.27.1", true],
  ["0.28.0", "^0.27.1", false],
  ["0.0.6", "^0.0.6", true],
  ["0.0.7", "^0.0.6", false],
  ["1.9.9", "^1.2.3", true],
  ["2.0.0", "^1.2.3", false],
  ["0.27.1-beta.1", "0.27.1-beta.1", true],
  ["0.27.1", "0.27.1-beta.1", false],
  ["0.27.1-1alpha", "~0.27.1-1alpha", true],
  ["0.27.1-beta.2", "^0.27.1-beta.1", true],
  ["0.27.1", "^0.27.1-beta.1", true],
  ["0.27.2-beta.1", "^0.27.1-beta.1", false],
  ["0.27.1-beta.1", "^0.27.1", false],
]) {
  assert.equal(
    lakebedCompilerVersionSatisfiesRange(version, range),
    expected,
    `${version} ${expected ? "satisfies" : "does not satisfy"} ${range}`,
  );
}
for (const unsupportedRange of [
  "",
  "0.27",
  "^0.27",
  ">=0.27.1",
  "^0.27.1 || ^0.28.0",
  "workspace:*",
  "^0.27.1-01",
  "^9007199254740991.0.0",
]) {
  assert.throws(
    () => lakebedCompilerVersionSatisfiesRange("0.27.7", unsupportedRange),
    /complete SemVer|malformed|supported SemVer bounds/,
    `${unsupportedRange || "empty range"} fails closed`,
  );
}

const resolverFixtureRoot = mkdtempSync(join(tmpdir(), "lakecraft-compiler-resolver-"));
try {
  const coupledRoot = join(resolverFixtureRoot, "coupled");
  writeCoupledCompilerFixture(coupledRoot);
  const decoyRoot = join(resolverFixtureRoot, "newer-standalone-decoy");
  writeFixturePackage(decoyRoot, "esbuild", "99.0.0", {
    "lib/main.js": 'export const version="99.0.0";export async function build(){}\n',
  });
  const mismatchedRoot = join(resolverFixtureRoot, "mismatched-coupled");
  writeCoupledCompilerFixture(mismatchedRoot, { esbuildVersion: "99.0.0" });
  const future = new Date(Date.now() + 86_400_000);
  utimesSync(join(decoyRoot, "node_modules/esbuild/lib/main.js"), future, future);
  utimesSync(join(mismatchedRoot, "node_modules/esbuild/lib/main.js"), future, future);
  const resolvedFixture = await resolveLakebedCompilerRuntime({ cacheRoot: resolverFixtureRoot });
  assert.equal(
    resolvedFixture.cacheEntryRoot,
    realpathSync(coupledRoot),
    "newer standalone and range-mismatched cache entries are ineligible",
  );
  assert.equal(resolvedFixture.declaredEsbuildRange, "^0.27.1", "resolver records Lakebed's compiler range");
  assert.equal(resolvedFixture.esbuildVersion, "0.27.7", "resolver selects Lakebed's compiler package");
  for (const [field, relativePath] of [
    ["lakebedPackagePath", "node_modules/lakebed/package.json"],
    ["lakebedBuildPath", "node_modules/lakebed/dist/cli/build.js"],
    ["esbuildPackagePath", "node_modules/esbuild/package.json"],
    ["esbuildPath", "node_modules/esbuild/lib/main.js"],
  ]) {
    assert.equal(
      resolvedFixture[field],
      realpathSync(join(coupledRoot, relativePath)),
      `${field} resolves canonically within Lakebed's install tree`,
    );
  }
} finally {
  rmSync(resolverFixtureRoot, { recursive: true, force: true });
}

for (const [escapedField, escapedRelativePath] of [
  ["lakebed package", "node_modules/lakebed/package.json"],
  ["Lakebed build", "node_modules/lakebed/dist/cli/build.js"],
  ["esbuild package", "node_modules/esbuild/package.json"],
  ["esbuild module", "node_modules/esbuild/lib/main.js"],
]) {
  const escapeFixtureRoot = mkdtempSync(join(tmpdir(), "lakecraft-compiler-escape-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "lakecraft-outside-compiler-"));
  try {
    const validRoot = join(escapeFixtureRoot, "valid");
    const escapedRoot = join(escapeFixtureRoot, `escaped-${escapedField.replaceAll(" ", "-")}`);
    writeCoupledCompilerFixture(validRoot);
    writeCoupledCompilerFixture(escapedRoot);
    const escapedPath = join(escapedRoot, escapedRelativePath);
    const outsidePath = join(outsideRoot, escapedField.replaceAll(" ", "-"));
    writeFileSync(outsidePath, readFileSync(escapedPath));
    rmSync(escapedPath);
    symlinkSync(outsidePath, escapedPath);
    const future = new Date(Date.now() + 86_400_000);
    utimesSync(join(escapedRoot, "node_modules/esbuild/lib/main.js"), future, future);
    const resolvedFixture = await resolveLakebedCompilerRuntime({ cacheRoot: escapeFixtureRoot });
    assert.equal(
      resolvedFixture.cacheEntryRoot,
      realpathSync(validRoot),
      `${escapedField} symlink escape is ineligible`,
    );
  } finally {
    rmSync(escapeFixtureRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
}

const resolvedCompiler = await resolveLakebedCompilerRuntime();
const loadedCompiler = await loadLakebedCompilerRuntime();
assert.equal(loadedCompiler.esbuildPath, resolvedCompiler.esbuildPath, "test and staging resolve one compiler path");
assert.equal(loadedCompiler.esbuildVersion, resolvedCompiler.esbuildVersion, "test and staging resolve one package version");
assert.equal(loadedCompiler.compilerVersion, resolvedCompiler.esbuildVersion, "loaded module version matches its package");
const { build } = loadedCompiler;
const commonBuildOptions = {
  absWorkingDir: repositoryRoot,
  bundle: true,
  charset: "utf8",
  external: ["lakebed/client", "lakebed/server", "preact", "preact/hooks", "preact/jsx-runtime"],
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  minify: true,
  platform: "browser",
  sourcemap: false,
  target: "es2022",
  treeShaking: true,
  write: false,
};

async function bundledText(entryPoint, compact) {
  const result = await build({
    ...commonBuildOptions,
    entryPoints: [entryPoint],
    ...(compact ? {
      mangleCache: compactClientPropertyCache(),
      mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN,
      mangleQuoted: false,
    } : {}),
  });
  if (compact) {
    assert.deepEqual(
      result.mangleCache,
      COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
      `${entryPoint} preserves the exact fixed mapping`,
    );
  }
  return result.outputFiles[0].text;
}

const boundaryBundles = new Map();
for (const entryPoint of [
  "client/MultiplayerSegmentTransport.tsx",
  "client/multiplayerSegmentClient.ts",
  "client/settings.ts",
  "client/singleplayer/localSave.ts",
  "client/worldBlockEditClient.ts",
]) {
  const compact = await bundledText(entryPoint, true);
  const baseline = await bundledText(entryPoint, false);
  const exportNames = (text) => [...text.matchAll(/\bas\s+([A-Za-z_$][\w$]*)[,}]/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    exportNames(compact),
    exportNames(baseline),
    `${entryPoint} keeps the exact public export surface`,
  );
  boundaryBundles.set(entryPoint, { compact, baseline });
}

async function importBundled(text) {
  return import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
}

const settingsBase = await importBundled(boundaryBundles.get("client/settings.ts").baseline);
const settingsCompact = await importBundled(boundaryBundles.get("client/settings.ts").compact);
const settingsInput = { soundMuted: true, mouseSensitivity: 137 };
assert.deepEqual(
  settingsCompact.normalizeClientSettings(settingsInput),
  settingsBase.normalizeClientSettings(settingsInput),
  "settings normalization keeps exact keys and values",
);
function settingsStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const settingsBaseStorage = settingsStorage();
const settingsCompactStorage = settingsStorage();
assert.equal(settingsBase.saveClientSettings(settingsBaseStorage, settingsInput), true);
assert.equal(settingsCompact.saveClientSettings(settingsCompactStorage, settingsInput), true);
assert.deepEqual(
  [...settingsCompactStorage.values],
  [...settingsBaseStorage.values],
  "persisted settings JSON stays byte-for-byte identical",
);
assert.deepEqual(
  settingsCompact.loadClientSettings(settingsCompactStorage),
  settingsBase.loadClientSettings(settingsBaseStorage),
  "persisted settings round-trip stays exact",
);

const saveBase = await importBundled(boundaryBundles.get("client/singleplayer/localSave.ts").baseline);
const saveCompact = await importBundled(boundaryBundles.get("client/singleplayer/localSave.ts").compact);
const defaultBase = saveBase.createDefaultSinglePlayerSnapshot(7_319, 123_456, "compat-world");
const defaultCompact = saveCompact.createDefaultSinglePlayerSnapshot(7_319, 123_456, "compat-world");
assert.deepEqual(defaultCompact, defaultBase, "default local save object stays byte-identical");
assert.equal(
  saveCompact.canonicalSinglePlayerJson(defaultCompact),
  saveBase.canonicalSinglePlayerJson(defaultBase),
  "canonical local save JSON stays byte-for-byte identical",
);
assert.deepEqual(
  saveCompact.serializeSinglePlayerSave(defaultCompact, 7, 456_789),
  saveBase.serializeSinglePlayerSave(defaultBase, 7, 456_789),
  "save envelope, checksum, and serialized bytes stay exact",
);

const editBase = await importBundled(boundaryBundles.get("client/worldBlockEditClient.ts").baseline);
const editCompact = await importBundled(boundaryBundles.get("client/worldBlockEditClient.ts").compact);
const editInput = {
  operationId: "compat-operation",
  x: 4,
  y: 5,
  z: 6,
  previousBlock: "air",
  nextBlock: "stone",
  selectedHotbar: 3,
  expectedHeldItem: "stone",
  expectedInventoryRevision: "17",
  expectedChunkRevision: "23",
};
assert.deepEqual(
  editCompact.buildWorldBlockOperationRequest(editInput),
  editBase.buildWorldBlockOperationRequest(editInput),
  "world mutation request keys and values stay exact",
);

const segmentBase = await importBundled(boundaryBundles.get("client/multiplayerSegmentClient.ts").baseline);
const segmentCompact = await importBundled(boundaryBundles.get("client/multiplayerSegmentClient.ts").compact);
assert.equal(
  segmentCompact.createCompositeRequest([{ userId: "peer", sessionId: "session", acceptedThrough: 9 }], 42, ["mob-a"]),
  segmentBase.createCompositeRequest([{ userId: "peer", sessionId: "session", acceptedThrough: 9 }], 42, ["mob-a"]),
  "multiplayer query request JSON stays byte-for-byte identical",
);

const fullCompactA = await bundledText("client/index.tsx", true);
const fullCompactB = await bundledText("client/index.tsx", true);
const fullBaseline = await bundledText("client/index.tsx", false);
const liveSetAudit = await build({
  ...commonBuildOptions,
  entryPoints: ["client/index.tsx"],
  mangleCache: {},
  mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN,
  mangleQuoted: false,
});
assert.deepEqual(
  Object.keys(liveSetAudit.mangleCache ?? {}).sort(),
  [...manifestNames].sort(),
  "compiler-observed live properties exactly match the fixed manifest",
);
assert.equal(fullCompactA, fullCompactB, "fixed property mapping is byte-for-byte deterministic");
assert.ok(
  Buffer.byteLength(fullBaseline) - Buffer.byteLength(fullCompactA) >= 18_500,
  "fixed mapping recovers at least 18.5KB before Lakebed artifact encoding",
);

console.log("client property compaction compatibility boundary: ok");
