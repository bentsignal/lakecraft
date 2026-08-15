import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMPACT_CLIENT_COMPUTED_STORAGE_PROPERTIES,
  COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
  COMPACT_CLIENT_PROPERTY_PATTERN,
  COMPACT_CLIENT_PRIVATE_PROPERTY_MANGLE_CACHE,
  COMPACT_CLIENT_TEST_QUOTED_PROPERTIES,
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
assert.equal(manifestNames.length, 633, "reviewed compatibility boundary changes only intentionally");
assert.equal(
  createHash("sha256").update(JSON.stringify(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE)).digest("hex"),
  "f9056f4388651ea10a3e1d9de9e9f01a396a59a63f6ff8b143bd6f22994e9bba",
  "the reviewed source-to-alias manifest changes only with an explicit fingerprint update",
);
assert.equal(new Set(manifestNames).size, manifestNames.length, "source property names stay unique");
assert.equal(new Set(compactNames).size, compactNames.length, "compact property names stay unique");
assert.ok(manifestNames.every((name) => /^[A-Za-z_$][\w$]*$/.test(name)), "source names are identifiers");
assert.ok(compactNames.every((name) => /^[A-Za-z_$][\w$]*$/.test(name)), "compact names are identifiers");
assert.ok(manifestNames.every((name) => COMPACT_CLIENT_PROPERTY_PATTERN.test(name)), "pattern covers every manifest name");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("soundMuted"), false, "settings key stays reserved");
assert.equal(COMPACT_CLIENT_PROPERTY_PATTERN.test("terrain"), false, "realtime terrain wire key stays reserved");
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
assert.deepEqual(
  Object.fromEntries(["worldCenterX", "worldCenterZ"].map(
    (name) => [name, COMPACT_CLIENT_PROPERTY_MANGLE_CACHE[name]],
  )),
  { worldCenterX: "aX", worldCenterZ: "aY" },
  "streaming simulation centers use fixed collision-reviewed mappings",
);

const reviewedPrivatePropertyPaths = {
  accumulatorSeconds: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/localDropGravity.ts"] },
  activePlayMsSinceSave: { declarations: ["client/singleplayer/saveCadence.ts"], uses: ["client/singleplayer/SinglePlayerApp.tsx", "client/singleplayer/saveCadence.ts"] },
  applyConfirmedMobKnockback: { declarations: ["client/game/types.ts", "client/game/voxelEngine.ts"], uses: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx"] },
  applyConfirmedPlayerHitMobKnockback: { declarations: ["client/game/types.ts", "client/game/voxelEngine.ts"], uses: ["client/game/types.ts", "client/game/voxelEngine.ts"] },
  autosaveDue: { declarations: ["client/singleplayer/saveCadence.ts"], uses: ["client/singleplayer/SinglePlayerApp.tsx", "client/singleplayer/saveCadence.ts"] },
  blockReads: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/localDropGravity.ts"] },
  changeGameMode: { declarations: ["client/singleplayer/localCommands.ts"], uses: ["client/singleplayer/localCommands.ts"] },
  chat: { declarations: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"] },
  closePause: { declarations: ["client/gameplay/pointerSession.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"] },
  creation: { declarations: ["client/singleplayer/localWorldBrowserIssue.ts"], uses: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldBrowserIssue.ts"] },
  death: { declarations: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"] },
  depleted: { declarations: ["client/singleplayer/localPlacement.ts"], uses: ["client/singleplayer/localPlacement.ts"] },
  dirtyRevision: { declarations: ["client/singleplayer/saveCadence.ts"], uses: ["client/singleplayer/SinglePlayerApp.tsx", "client/singleplayer/saveCadence.ts"] },
  foreground: { declarations: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"] },
  getPose: { declarations: ["client/MultiplayerSegmentTransport.tsx", "client/RealtimeMultiplayerTransport.tsx", "client/game/types.ts", "client/game/voxelEngine.ts", "client/realtimeMultiplayer.ts"], uses: ["client/MultiplayerSegmentTransport.tsx", "client/RealtimeMultiplayerTransport.tsx", "client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/realtimeMultiplayer.ts", "client/singleplayer/PerformanceBenchmark.tsx", "client/singleplayer/SinglePlayerApp.tsx"] },
  giveItems: { declarations: ["client/singleplayer/localCommands.ts"], uses: ["client/singleplayer/localCommands.ts"] },
  ignoreEscapeUntil: { declarations: ["client/gameplay/pointerSession.ts"], uses: ["client/gameplay/pointerSession.ts"] },
  inWorld: { declarations: ["client/index.tsx"], uses: ["client/index.tsx"] },
  intentionalReleasePending: { declarations: ["client/gameplay/pointerSession.ts"], uses: ["client/gameplay/pointerSession.ts"] },
  lastSavedAt: { declarations: ["client/singleplayer/localWorldRegistry.ts"], uses: ["client/singleplayer/localWorldRegistry.ts"] },
  listing: { declarations: ["client/singleplayer/localWorldBrowserIssue.ts"], uses: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldBrowserIssue.ts"] },
  movedSteps: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/localDropGravity.ts"] },
  offsetZ: { declarations: ["client/game/mobKnockback.ts"], uses: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"] },
  onJoinSingleplayer: { declarations: ["client/index.tsx", "client/lobby/LobbyScreen.tsx", "client/singleplayer/LocalWorldBrowser.tsx"], uses: ["client/index.tsx", "client/lobby/LobbyScreen.tsx", "client/singleplayer/LocalWorldBrowser.tsx"] },
  onRemotePlayers: { declarations: ["client/MultiplayerSegmentTransport.tsx", "client/RealtimeMultiplayerTransport.tsx", "client/realtimeMultiplayer.ts"], uses: ["client/MultiplayerSegmentTransport.tsx", "client/RealtimeMultiplayerTransport.tsx", "client/realtimeMultiplayer.ts"] },
  openPause: { declarations: ["client/gameplay/pointerSession.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"] },
  optimisticEdit: { declarations: ["client/index.tsx"], uses: ["client/index.tsx"] },
  pauseEpoch: { declarations: ["client/index.tsx", "client/multiplayerGameplay.ts"], uses: ["client/index.tsx", "client/multiplayerGameplay.ts"] },
  plan: { declarations: ["client/MultiplayerSegmentTransport.tsx", "client/game/contactSheetExport.ts"], uses: ["client/MultiplayerSegmentTransport.tsx", "client/game/contactSheetExport.ts"] },
  playable: { declarations: ["client/singleplayer/localWorldBrowserIssue.ts"], uses: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldBrowserIssue.ts"] },
  previousOffsetX: { declarations: ["client/game/mobKnockback.ts"], uses: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"] },
  previousOffsetZ: { declarations: ["client/game/mobKnockback.ts"], uses: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"] },
  processedSteps: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/localDropGravity.ts"] },
  receivedAt: { declarations: ["client/components/FurnaceDrawer.tsx"], uses: ["client/components/FurnaceDrawer.tsx"] },
  registry: { declarations: ["client/singleplayer/localWorldRegistry.ts"], uses: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldRegistry.ts"] },
  registryLoad: { declarations: ["client/singleplayer/localWorldRegistry.ts"], uses: ["client/singleplayer/localWorldRegistry.ts"] },
  removedChest: { declarations: ["client/singleplayer/localContainers.ts"], uses: ["client/singleplayer/localContainers.ts"] },
  removedFurnace: { declarations: ["client/singleplayer/localContainers.ts"], uses: ["client/singleplayer/localContainers.ts"] },
  savedRevision: { declarations: ["client/singleplayer/saveCadence.ts"], uses: ["client/singleplayer/SinglePlayerApp.tsx", "client/singleplayer/saveCadence.ts"] },
  seedText: { declarations: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldBrowserIssue.ts", "client/singleplayer/localWorldRegistry.ts"], uses: ["client/singleplayer/LocalWorldBrowser.tsx", "client/singleplayer/localWorldBrowserIssue.ts", "client/singleplayer/localWorldRegistry.ts"] },
  setInWorld: { declarations: ["client/index.tsx"], uses: ["client/index.tsx"] },
  showCaptureAffordance: { declarations: ["client/gameplay/pointerSession.ts"], uses: ["client/gameplay/pointerSession.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"] },
  substeps: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/localDropGravity.ts"] },
  transportFailures: { declarations: ["client/index.tsx"], uses: ["client/index.tsx"] },
  usedChars: { declarations: ["client/singleplayer/localWorldRegistry.ts"], uses: ["client/singleplayer/localWorldRegistry.ts"] },
  wasActive: { declarations: ["client/singleplayer/saveCadence.ts"], uses: ["client/singleplayer/saveCadence.ts"] },
  woken: { declarations: ["client/singleplayer/localDropGravity.ts"], uses: ["client/singleplayer/SinglePlayerApp.tsx", "client/singleplayer/localDropGravity.ts"] },
};
const privateNames = Object.keys(COMPACT_CLIENT_PRIVATE_PROPERTY_MANGLE_CACHE);
assert.deepEqual(privateNames, [...privateNames].sort(), "private property namespace stays sorted");
assert.deepEqual(privateNames, Object.keys(reviewedPrivatePropertyPaths), "each private property has one path fingerprint");
assert.equal(manifestNames.length, 586 + privateNames.length, "private names cannot shadow the reviewed public candidate manifest");
for (const [name, paths] of Object.entries(reviewedPrivatePropertyPaths)) {
  assert.deepEqual(
    (analysis.declarationPaths[name] ?? []).filter((path) => path.startsWith("client/")),
    paths.declarations,
    `${name} declaration paths cannot drift`,
  );
  assert.deepEqual(
    (analysis.propertyUsePaths[name] ?? []).filter((path) => path.startsWith("client/")),
    paths.uses,
    `${name} use paths cannot drift`,
  );
  assert.deepEqual(
    (analysis.propertyUsePaths[name] ?? []).filter((path) => path.startsWith("server/") || path.startsWith("shared/")),
    [],
    `${name} cannot enter a shared or server contract`,
  );
  assert.deepEqual(
    (analysis.quotedPropertyPaths[name] ?? []).filter((path) => !path.startsWith("tests/")),
    [],
    `${name} cannot enter a quoted, computed-literal, or reflective runtime lookup`,
  );
  assert.equal(
    analysis.jsonStringifyPropertyNames.includes(name),
    false,
    `${name} cannot become an explicit JSON payload property`,
  );
}
const privateAstFingerprint = createHash("sha256").update(JSON.stringify(privateNames.map((name) => ({
  declarationKinds: Object.fromEntries(Object.entries(analysis.declarationKinds[name] ?? {})
    .filter(([key]) => key.startsWith("client/"))),
  name,
  propertyUseCounts: Object.fromEntries(Object.entries(analysis.propertyUseCounts[name] ?? {})
    .filter(([path]) => path.startsWith("client/"))),
})))).digest("hex");
assert.equal(
  privateAstFingerprint,
  "93d216a0187661b20f23760aac42b29191db59491fab5c9a250135c4160235d4",
  "same-file property use counts and declaration kinds cannot drift",
);
for (const name of [
  "actions", "mouseSensitivity", "mutationStarted", "pending", "previousSequence", "samples",
  "settings", "soundMuted", "states", "verticalCoordinate", "worldCoordinate",
]) {
  assert.equal(name in COMPACT_CLIENT_PRIVATE_PROPERTY_MANGLE_CACHE, false, `${name} stays outside the private namespace`);
}
const reservedJavaScriptWords = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true",
  "try", "typeof", "var", "void", "while", "with", "yield",
]);
assert.deepEqual(
  Object.values(COMPACT_CLIENT_PRIVATE_PROPERTY_MANGLE_CACHE).filter((name) => reservedJavaScriptWords.has(name)),
  [],
  "private aliases cannot use JavaScript reserved words",
);

const testQuotedNames = [...COMPACT_CLIENT_TEST_QUOTED_PROPERTIES];
assert.deepEqual(testQuotedNames, [...testQuotedNames].sort(), "test-quoted allowlist stays sorted");
assert.equal(new Set(testQuotedNames).size, testQuotedNames.length, "test-quoted allowlist stays unique");
const testQuotedSet = new Set(testQuotedNames);
const computedStorageNames = [...COMPACT_CLIENT_COMPUTED_STORAGE_PROPERTIES];
const reviewedComputedBoundaryPaths = {
  dataUrl: ["client/game/playerSkin.ts"],
  model: ["client/game/playerSkin.ts"],
  skinId: ["client/realtimeMultiplayer.ts"],
  skinModel: ["client/realtimeMultiplayer.ts"],
  skinPixels: ["client/realtimeMultiplayer.ts"],
};
assert.deepEqual(computedStorageNames, Object.keys(reviewedComputedBoundaryPaths), "only reviewed JSON codecs have computed keys");
const computedStorageSet = new Set(computedStorageNames);
for (const name of computedStorageNames) {
  assert.ok(COMPACT_CLIENT_PROPERTY_PATTERN.test(name), `${name} remains globally compactable`);
  assert.deepEqual(
    (analysis.quotedPropertyPaths[name] ?? []).filter((path) => !path.startsWith("tests/")),
    reviewedComputedBoundaryPaths[name],
    `${name} has exactly one reviewed computed-literal JSON boundary`,
  );
  assert.equal(
    analysis.jsonStringifyPropertyNames.includes(name),
    false,
    `${name} reaches JSON only through the computed storage codec`,
  );
}
const expectedCandidateNames = [
  ...manifestNames.filter((name) => !testQuotedSet.has(name)
    && !computedStorageSet.has(name)
    && !(name in COMPACT_CLIENT_PRIVATE_PROPERTY_MANGLE_CACHE)),
  // These remain source-live but are tree-shaken from the final client entry.
  "applyConfirmedMobKnockback",
  "frameTimeMs",
  "framesOver16_7Ms",
  "framesOver25Ms",
  "framesOver50Ms",
  "maxFrameMs",
  "maxLoadedChunks",
  "maxPendingMeshRebuilds",
  "maxPendingTerrainLoads",
  "maxPendingTerrainUnloads",
  "meanDrawCalls",
  "meanFps",
  "meanMeshRebuildMs",
  "meanRenderMs",
  "meanTerrainStreamingMs",
  "meanUpdateMs",
  "meanVisibleChunks",
  "medianFrameMs",
  "onDismissControls",
  "onOpenHelp",
  "onePercentLowFps",
  "p95FrameMs",
  "p95MeshRebuildMs",
  "p95RenderMs",
  "p95TerrainStreamingMs",
  "p95UpdateMs",
  "p99FrameMs",
  "receivedAt",
  "showControls",
].sort();
assert.deepEqual(
  analysis.candidates,
  expectedCandidateNames,
  "AST audit and fixed manifest have exact set equality apart from reviewed dead exports",
);
assert.deepEqual(
  testQuotedNames.filter((name) => analysis.jsonStringifyPropertyNames.includes(name)),
  [],
  "test-only quoted additions never enter an explicit JSON payload key",
);
assert.deepEqual(
  testQuotedNames.filter((name) => analysis.externalPropertyNames.includes(name)),
  [],
  "test-only quoted additions never collide with platform or Preact properties",
);
for (const name of testQuotedNames) {
  const runtimeQuotedPaths = (analysis.quotedPropertyPaths[name] ?? [])
    .filter((path) => !path.startsWith("tests/"));
  assert.deepEqual(runtimeQuotedPaths, [], `${name} has no runtime quoted or reflective spelling`);
  const quotedTestPaths = (analysis.quotedPropertyPaths[name] ?? [])
    .filter((path) => path.startsWith("tests/"));
  assert.ok(quotedTestPaths.length > 0, `${name} remains allowlisted only for test source assertions`);
}
const reviewedRuntimePaths = {
  acceptWorldEdits: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/gameplay/authority.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  applyConfirmedPlayerHitMobKnockback: ["client/game/types.ts", "client/game/voxelEngine.ts"],
  applyMobCombatStates: ["client/game/types.ts", "client/game/voxelEngine.ts"],
  applyWorldEdits: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  deathScreenOpen: ["client/components/GameHud.tsx", "client/gameplay/pointerSession.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  inventoryOpen: ["client/components/GameHud.tsx", "client/gameplay/pointerSession.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  isRangedWeaponSelected: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  messages: [
    "client/chat/ChatOverlay.tsx",
    "client/components/GameHud.tsx",
    "client/components/ToastSurface.tsx",
    "client/realtimeChat.ts",
    "client/realtimeMultiplayer.ts",
  ],
  mobileUnsupported: ["client/components/GameHud.tsx", "client/gameplay/pointerSession.ts", "client/index.tsx", "client/multiplayerGameplay.ts"],
  normalized: ["client/lobby/LobbyScreen.tsx"],
  offsetZ: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"],
  onLocalCreeperExplosion: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  onLocalMobHit: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  onPoseChange: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  onRangedCancel: ["client/game/types.ts", "client/game/voxelEngine.ts"],
  onSignInWithGoogle: ["client/lobby/LobbyScreen.tsx"],
  onUseSelectedItem: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  pauseOpen: ["client/components/GameHud.tsx", "client/gameplay/pointerSession.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  pointerCaptureNeeded: ["client/gameplay/pointerSession.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  previousOffsetX: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"],
  previousOffsetZ: ["client/game/mobKnockback.ts", "client/game/voxelEngine.ts"],
  returnFocusId: ["client/components/OptionsDialog.tsx"],
  setDayNightClock: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  setRespawnPoint: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  setSelectedBlock: ["client/game/types.ts", "client/game/voxelEngine.ts", "client/index.tsx", "client/singleplayer/SinglePlayerApp.tsx"],
  settleFallingBlocks: ["client/game/types.ts", "client/game/voxelEngine.ts"],
  worldModalOpen: ["client/gameplay/pointerSession.ts", "client/singleplayer/SinglePlayerApp.tsx"],
};
assert.deepEqual(Object.keys(reviewedRuntimePaths), testQuotedNames, "each test-quoted property has an exact path review");
for (const [name, expectedPaths] of Object.entries(reviewedRuntimePaths)) {
  const runtimePaths = (analysis.propertyUsePaths[name] ?? [])
    .filter((path) => !path.startsWith("tests/"));
  assert.deepEqual(runtimePaths, expectedPaths, `${name} cannot drift into persistence, shared, server, or platform code`);
}

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
  "client/game/playerSkin.ts",
  "client/realtimeMultiplayer.ts",
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

const realtimeCompact = boundaryBundles.get("client/realtimeMultiplayer.ts").compact;
for (const [key, exactCount] of [["skinId", 4], ["skinModel", 4], ["skinPixels", 2]]) {
  assert.equal(
    realtimeCompact.split(key).length - 1,
    exactCount,
    `compact realtime input/output codecs retain every literal ${key} wire boundary`,
  );
}
assert.match(realtimeCompact, /skinId/);
assert.match(realtimeCompact, /skinModel/);
assert.match(realtimeCompact, /skinPixels/);
for (const key of ["ownerMustLeave", "ownerPickupBlocked"]) {
  assert.doesNotMatch(realtimeCompact, new RegExp(key), `compact realtime drops no longer carry ${key} latch state`);
  assert.doesNotMatch(boundaryBundles.get("client/realtimeMultiplayer.ts").baseline, new RegExp(key));
}
assert.equal(realtimeCompact.split("requestJson").length - 1, 4,
  "compact realtime inventory keeps every pending-field and literal wire requestJson boundary");

const bundledModuleDirectory = mkdtempSync(join(tmpdir(), "lakecraft-compact-modules-"));
let bundledModuleSequence = 0;
async function importBundled(text) {
  const path = join(bundledModuleDirectory, `module-${bundledModuleSequence++}.mjs`);
  writeFileSync(path, text);
  return import(pathToFileURL(path).href);
}
process.on("exit", () => rmSync(bundledModuleDirectory, { recursive: true, force: true }));

const runtimePropertyProbe = await build({
  ...commonBuildOptions,
  minify: false,
  mangleCache: compactClientPropertyCache(),
  mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN,
  mangleQuoted: false,
  stdin: {
    contents: 'const record={model:"wide",dataUrl:"internal"};export const modelValue=record.model;export const dataUrlValue=record.dataUrl;',
    loader: "js",
    sourcefile: "runtime-property-probe.js",
  },
});
const runtimePropertyProbeText = runtimePropertyProbe.outputFiles[0].text;
assert.match(runtimePropertyProbeText, /\ba9:/, "ordinary model properties use their fixed compact alias");
assert.match(runtimePropertyProbeText, /\bVt:/, "ordinary dataUrl properties use their fixed compact alias");
const runtimePropertyProbeModule = await importBundled(runtimePropertyProbeText);
assert.deepEqual(
  [runtimePropertyProbeModule.modelValue, runtimePropertyProbeModule.dataUrlValue],
  ["wide", "internal"],
  "runtime properties remain usable after compaction",
);

const settingsBase = await importBundled(boundaryBundles.get("client/settings.ts").baseline);
const settingsCompact = await importBundled(boundaryBundles.get("client/settings.ts").compact);
const settingsInput = { soundMuted: true, mouseSensitivity: 137, fovDegrees: 92 };
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

const skinBase = await importBundled(boundaryBundles.get("client/game/playerSkin.ts").baseline);
const skinCompact = await importBundled(boundaryBundles.get("client/game/playerSkin.ts").compact);
const skinInput = {
  version: 1,
  name: "user-owned-skin.png",
  width: 64,
  height: 64,
  model: "slim",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
};
const skinStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
const expectedSkinJson = '{"version":1,"name":"user-owned-skin.png","width":64,"height":64,"model":"slim","dataUrl":"data:image/png;base64,iVBORw0KGgo="}';
for (const [writer, reader, direction] of [
  [skinBase, skinCompact, "baseline save loads in compact"],
  [skinCompact, skinBase, "compact save loads in baseline"],
]) {
  const storage = skinStorage();
  assert.equal(writer.savePersistedPlayerSkin(storage, skinInput), true, direction);
  const raw = storage.values.get(writer.PLAYER_SKIN_STORAGE_KEY);
  assert.equal(raw, expectedSkinJson, `${direction}: JSON stays byte-for-byte canonical`);
  assert.deepEqual(
    Object.keys(JSON.parse(raw)),
    ["version", "name", "width", "height", "model", "dataUrl"],
    `${direction}: literal keys and order survive compaction`,
  );
  assert.deepEqual(
    Object.keys(JSON.parse(raw)).filter((key) => compactNames.includes(key)),
    [],
    `${direction}: no mangle alias is persisted as a JSON key`,
  );
  const loadedSkin = reader.loadPersistedPlayerSkin(storage);
  assert.deepEqual(loadedSkin, skinInput, direction);
  assert.equal(Object.isFrozen(loadedSkin), true, `${direction}: loaded canonical records stay frozen`);
  assert.equal(raw.includes('"a9"'), false, `${direction}: the retired model alias never reaches storage`);
  assert.equal(raw.includes('"Vt"'), false, `${direction}: the retired dataUrl alias never reaches storage`);
}
for (const runtime of [skinBase, skinCompact]) {
  for (const malformed of [
    { ...skinInput, version: 2 },
    { ...skinInput, model: "narrow" },
    { ...skinInput, extra: true },
    JSON.parse('{"version":1,"name":"user-owned-skin.png","width":64,"height":64,"a9":"slim","Vt":"data:image/png;base64,iVBORw0KGgo="}'),
  ]) {
    const storage = skinStorage();
    storage.values.set(runtime.PLAYER_SKIN_STORAGE_KEY, JSON.stringify(malformed));
    assert.equal(runtime.loadPersistedPlayerSkin(storage), null, "malformed, future, and aliased records fail closed");
  }
}

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
