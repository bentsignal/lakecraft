import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  accessSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
  COMPACT_CLIENT_PROPERTY_PATTERN,
  compactClientPropertyCache,
} from "../scripts/client-property-compaction.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const analysis = JSON.parse(execFileSync(
  process.execPath,
  [join(repositoryRoot, "scripts/analyze-client-properties.mjs")],
  { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
));
const manifestNames = Object.keys(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE);
const compactNames = Object.values(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE);

assert.deepEqual(manifestNames, [...manifestNames].sort(), "reviewed property manifest stays sorted");
assert.equal(manifestNames.length, 430, "reviewed compatibility boundary changes only intentionally");
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

function newestCachedPackagePath(suffix) {
  const cacheRoot = join(homedir(), ".npm", "_npx");
  const paths = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const path = join(cacheRoot, entry.name, "node_modules", suffix);
      try {
        accessSync(path);
        return [{ path, modifiedAt: statSync(path).mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!paths[0]) throw new Error(`Run npx lakebed build once so ${suffix} is cached.`);
  return paths[0].path;
}

const esbuildPath = newestCachedPackagePath(join("esbuild", "lib", "main.js"));
const { build } = await import(pathToFileURL(esbuildPath).href);
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
