import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND,
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES,
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_PATH,
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES,
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_VALUES,
  COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES,
  COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND,
  COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES,
  COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_COUNTS,
  COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES,
  COMPACT_CLIENT_FIXED_IDENTITY_VALUES,
  COMPACT_CLIENT_FIXED_IDENTITY_SHARED_GAMEPLAY_DELTA,
  COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES,
  COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES,
  COMPACT_CLIENT_HUMAN_VERTICAL_COORDINATE_DELTA,
  COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA,
  COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA,
  COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA,
  COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA,
  COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA,
  COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES,
  COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES,
  COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_BEDROCK_WORLD_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_SOUND_RUNTIME_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_LIFECYCLE_DELTA,
  COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA,
  COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES,
  COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES,
  COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA,
  COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA,
  COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA,
  COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA,
  COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA,
  COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA,
  COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA,
  COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA,
  COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA,
  COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA,
  COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA,
  COMPACT_CLIENT_REPEATED_DAYLIGHT_CONFIRMATION_DELTA,
  COMPACT_CLIENT_REPEATED_SOUND_RUNTIME_DELTA,
  COMPACT_CLIENT_REPEATED_MOB_TEXTURE_DELTA,
  COMPACT_CLIENT_REPEATED_MOB_TEXTURE_LIFECYCLE_DELTA,
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA,
  COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA,
  COMPACT_CLIENT_STRING_OCCURRENCES,
  COMPACT_CLIENT_STRING_UNIQUE_VALUES,
  COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND,
  COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_COUNTS,
  COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES,
  COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS,
  COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT,
  COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES,
  COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES,
  COMPACT_CLIENT_WEBGL_UNIFORM_VALUES,
  analyzeClientStringPool,
  compactClientStringPool,
} from "../scripts/client-string-pool-compaction.mjs";

const localWorldBrowserSource = await readFile(
  new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8",
);
assert.equal(localWorldBrowserSource.includes("Incompatible pre-release world-list data was cleared."), false,
  "successful pre-release cleanup needs no alert");
assert.equal(localWorldBrowserSource.includes("!Corrupt/newer list; no data changed."), false,
  "the obsolete corrupt/newer copy stays removed");
assert.equal(localWorldBrowserSource.split(JSON.stringify(
  "!World list storage unavailable; no data changed.",
)).length - 1, 1, "the unavailable-storage fail-closed copy remains exact");

const webglUniformValues = [...COMPACT_CLIENT_WEBGL_UNIFORM_VALUES];
assert.equal(new Set(webglUniformValues).size, COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES);
assert.equal(COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES,
  Object.values(COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS).reduce((sum, count) => sum + count, 0));
assert.equal(COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES,
  Object.values(COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_COUNTS).reduce((sum, count) => sum + count, 0));
assert.equal(COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND, "StringLiteral");
assert.equal(
  COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT,
  "3ecfd0ea9ca3887fbd141fb623876c2205be8e47280ad069caba81427c951d0e",
  "the exact retained uniform lookup order and kinds change only intentionally",
);

const gameDirectory = new URL("../client/game/", import.meta.url);
const gameSourcePaths = (await readdir(gameDirectory, { recursive: true }))
  .filter((path) => /\.tsx?$/.test(path));
const gameSources = await Promise.all(gameSourcePaths.map(async (path) => ({
  path,
  source: await readFile(new URL(path, gameDirectory), "utf8"),
})));
const authoredUniformCalls = new Map();
for (const { path, source } of gameSources) {
  for (const match of source.matchAll(/\.getUniformLocation\([^,\n]+,\s*"([^"]+)"\s*\)/g)) {
    const records = authoredUniformCalls.get(match[1]) ?? [];
    records.push({ path, text: match[0] });
    authoredUniformCalls.set(match[1], records);
  }
}
const authoredRepeatedUniforms = [...authoredUniformCalls]
  .filter(([, records]) => records.length >= 2)
  .map(([value]) => value);
assert.deepEqual(authoredRepeatedUniforms.sort(), [...webglUniformValues].sort(),
  "the category is the exact closed repeated getUniformLocation allowlist; it cannot expand to new uniforms");
for (const value of webglUniformValues) {
  const expectedCount = COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS[value];
  assert.equal(authoredUniformCalls.get(value)?.length, expectedCount,
    `${value} retains its exact authored getUniformLocation count`);
  const literalCount = gameSources.reduce(
    (count, { source }) => count + source.split(JSON.stringify(value)).length - 1,
    0,
  );
  assert.equal(literalCount, expectedCount,
    `${value} is authored only as a getUniformLocation name, never as an attribute, DOM/wire value, or UI copy`);
}
const glslCorpus = gameSources.flatMap(({ source }) => [...source.matchAll(/`([\s\S]*?)`/g)].map((match) => match[1])).join("\n");
for (const lookupName of webglUniformValues) {
  const identifier = lookupName.replace(/\[0\]$/, "");
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(glslCorpus, new RegExp(`uniform[^;]*\\b${escaped}\\b`),
    `${lookupName} has a matching exact GLSL uniform declaration`);
  assert.ok((glslCorpus.match(new RegExp(`\\b${escaped}\\b`, "g")) ?? []).length >= 2,
    `${lookupName} is both declared and used by authored GLSL`);
}

const fixedFrequencyTwoValues = [...COMPACT_CLIENT_FIXED_FREQUENCY_TWO_VALUES];
assert.equal(fixedFrequencyTwoValues.length, 70, "the reviewed long frequency-two pool stays exact");
assert.equal(new Set(fixedFrequencyTwoValues).size, COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES);
assert.equal(COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES, fixedFrequencyTwoValues.length * 2);
assert.equal(COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND, "StringLiteral");
assert.equal(COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_PATH, "closed compact client bundle");
assert.equal(
  COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT,
  "9589bee90a9ec4eb168fac5d95d1ad920f349612250851c9181d34aef4604d12",
  "the exact reviewed occurrence order and kinds change only intentionally",
);

const fixedIdentityValues = [...COMPACT_CLIENT_FIXED_IDENTITY_VALUES];
assert.deepEqual(fixedIdentityValues,
  ["creative", "survival", "loaded", "recovered", "corrupt", "unsupported", "empty"],
  "the identity pool is one exact gameplay-mode and persistence-status allowlist");
assert.equal(new Set(fixedIdentityValues).size, COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES);
assert.equal(COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES,
  Object.values(COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_COUNTS).reduce((sum, count) => sum + count, 0));
assert.equal(COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND, "StringLiteral");
assert.equal(COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES, 1,
  "creative is already repeated while survival remains the one incremental pool value");
assert.equal(COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT,
  "358cf0997bf825646abdd7792dbb7a58347210c5925ca1548979416c4456f5c2",
  "the exact identity occurrence order, syntax kinds, contexts, and values change only intentionally");
assert.equal(COMPACT_CLIENT_FIXED_IDENTITY_SHARED_GAMEPLAY_DELTA.previousOccurrences
  + COMPACT_CLIENT_FIXED_IDENTITY_SHARED_GAMEPLAY_DELTA.occurrenceDelta,
COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES);

const identityFixture = [
  'const mode="creative",status="loaded";',
  'const ignored={creative:"creative",survival:"survival"};',
  'const loose=mode=="creative";',
  'const wire=JSON.stringify("survival");',
  'let switched=false;switch(status){case "loaded":switched=true;break}',
  'globalThis.__lakecraftIdentityFixture=[',
  'mode==="creative",mode!=="survival","creative"===mode,status==="loaded",status!=="recovered",',
  'status==="corrupt",status!=="unsupported",status==="empty",switched,ignored,loose,wire];',
].join("");
const identityFixtureAnalysis = await analyzeClientStringPool(identityFixture);
assert.deepEqual([...identityFixtureAnalysis.fixedIdentity.values].sort(), [...fixedIdentityValues].sort(),
  "all and only the fixed identity spellings enter the closed semantic category");
assert.deepEqual(identityFixtureAnalysis.fixedIdentity.occurrences.map(({ context }) => context), [
  "CaseClause:expression",
  "BinaryExpression:EqualsEqualsEqualsToken:right",
  "BinaryExpression:ExclamationEqualsEqualsToken:right",
  "BinaryExpression:EqualsEqualsEqualsToken:left",
  "BinaryExpression:EqualsEqualsEqualsToken:right",
  "BinaryExpression:ExclamationEqualsEqualsToken:right",
  "BinaryExpression:EqualsEqualsEqualsToken:right",
  "BinaryExpression:ExclamationEqualsEqualsToken:right",
  "BinaryExpression:EqualsEqualsEqualsToken:right",
], "only reviewed strict-comparison sides and exact case expressions are eligible");
assert.ok(identityFixtureAnalysis.fixedIdentity.occurrences.every(
  ({ kind }) => kind === COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND,
), "every fixed identity occurrence retains its pinned string-literal syntax kind");
assert.equal(identityFixtureAnalysis.fixedIdentity.occurrences.length, 9,
  "loose comparisons, object payload values, and JSON arguments cannot enter the identity category");

const identityFixtureExpected = Object.fromEntries(
  ["human", "repeated", "lowFrequency", "fixedFrequencyTwo", "webglUniform", "fixedIdentity"].map(
    (category) => [category, {
      occurrences: identityFixtureAnalysis[category].occurrences.length,
      uniqueValues: identityFixtureAnalysis[category].values.length,
      ...(category === "fixedIdentity" ? {
        incrementalUniqueValues: identityFixtureAnalysis.fixedIdentityIncrementalUniqueValues,
      } : {}),
      fingerprint: identityFixtureAnalysis[category].fingerprint,
    }],
  ),
);
const transformedIdentityFixture = await compactClientStringPool(identityFixture, identityFixtureExpected);
new Function(transformedIdentityFixture)();
assert.deepEqual(globalThis.__lakecraftIdentityFixture,
  [true, true, true, true, true, false, true, false, true,
    { creative: "creative", survival: "survival" }, true, '"survival"'],
  "identity pooling preserves strict checks, switch behavior, loose noneligible checks, object data, and JSON bytes");
delete globalThis.__lakecraftIdentityFixture;
await assert.rejects(compactClientStringPool(identityFixture, {
  ...identityFixtureExpected,
  fixedIdentity: {
    ...identityFixtureExpected.fixedIdentity,
    fingerprint: "0".repeat(64),
  },
}), /fixedIdentity live set changed/, "any identity occurrence mutation or context drift fails closed");
await assert.rejects(compactClientStringPool(
  identityFixture.replace('status==="empty"', 'status=="empty"'),
  identityFixtureExpected,
), /fixedIdentity live set changed/,
"changing a reviewed strict identity check to a loose comparison fails closed");
await assert.rejects(compactClientStringPool(
  identityFixture.replace('mode==="creative"', '"creative"===mode'),
  identityFixtureExpected,
), /fixedIdentity live set changed/,
"moving a reviewed identity literal to a different AST comparison side fails closed");

const uniformFixtureNames = webglUniformValues.flatMap(
  (value) => Array.from({ length: COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS[value] }, () => value),
);
const uniformFixture = [
  'const gl={getUniformLocation:(program,name)=>`${program}:${name}`,getAttribLocation:()=>17};',
  'const program="representative-program";',
  `globalThis.__lakecraftUniformLocations=[${uniformFixtureNames.map(
    (value) => `gl.getUniformLocation(program,${JSON.stringify(value)})`,
  ).join(",")}];`,
  'globalThis.__lakecraftRejectedUniformContexts=[gl.getAttribLocation(program,"uMvp"),JSON.stringify("uSkin"),"uLight"];',
  'globalThis.__lakecraftUnknownUniform=gl.getUniformLocation(program,"uNotAudited");',
].join("");
const uniformFixtureAnalysis = await analyzeClientStringPool(uniformFixture);
assert.deepEqual(uniformFixtureAnalysis.webglUniform.values, webglUniformValues,
  "only the explicit uniform allowlist enters the semantic category");
assert.equal(uniformFixtureAnalysis.webglUniform.occurrences.length, COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES);
assert.ok(uniformFixtureAnalysis.webglUniform.occurrences.every(
  ({ kind }) => kind === COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND,
), "every closed uniform occurrence retains its pinned string-literal syntax kind");
assert.ok(!uniformFixtureAnalysis.webglUniform.values.includes("uNotAudited"),
  "a new getUniformLocation name cannot implicitly expand the closed category");
for (const occurrence of uniformFixtureAnalysis.webglUniform.occurrences) {
  assert.equal(uniformFixtureAnalysis.occurrences.filter(({ start }) => start === occurrence.start).length, 1,
    `${occurrence.value} is unioned once even when a generic frequency pool already selected it`);
}
const uniformFixtureExpected = Object.fromEntries(
  ["human", "repeated", "lowFrequency", "fixedFrequencyTwo", "webglUniform", "fixedIdentity"].map((category) => [category, {
    occurrences: uniformFixtureAnalysis[category].occurrences.length,
    uniqueValues: uniformFixtureAnalysis[category].values.length,
    ...(category === "fixedIdentity" ? {
      incrementalUniqueValues: uniformFixtureAnalysis.fixedIdentityIncrementalUniqueValues,
    } : {}),
    fingerprint: uniformFixtureAnalysis[category].fingerprint,
  }]),
);
const transformedUniformFixture = await compactClientStringPool(uniformFixture, uniformFixtureExpected);
new Function(transformedUniformFixture)();
assert.deepEqual(
  globalThis.__lakecraftUniformLocations,
  uniformFixtureNames.map((value) => `representative-program:${value}`),
  "decoded pool bytes preserve every exact WebGL location name and representative lookup result",
);
assert.deepEqual(globalThis.__lakecraftRejectedUniformContexts, [17, '"uSkin"', "uLight"],
  "attribute, wire, and UI-like values retain byte-exact behavior outside the uniform category");
assert.equal(globalThis.__lakecraftUnknownUniform, "representative-program:uNotAudited",
  "an unreviewed location lookup retains behavior without entering the closed category");
delete globalThis.__lakecraftUniformLocations;
delete globalThis.__lakecraftRejectedUniformContexts;
delete globalThis.__lakecraftUnknownUniform;

assert.deepEqual(COMPACT_CLIENT_HUMAN_VERTICAL_COORDINATE_DELTA, {
  previousOccurrences: 592,
  previousUniqueValues: 524,
  previousSourceFingerprint: "dae65329dae063fa8762ffc180ff6c580a576dd2c7a58aa0ecff97026d97b041",
  occurrenceDelta: 1,
  uniqueValueDelta: 1,
  addedValue: "This world uses the retired terrain coordinate system and cannot be loaded. No data was changed; reset it to start fresh.",
  source: "client/singleplayer/localSave.ts#unsupportedSinglePlayerSaveMessage",
  exclusionChanges: 0,
}, "the positive-coordinate save rejection adds exactly one reviewed user-facing message");
assert.deepEqual(COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA, {
  previousOccurrences: 593,
  previousUniqueValues: 525,
  previousSourceFingerprint: "c5e00c64ce79e2fcf4f817c84fd8c29c81edabf641c757702e7e97c29f053521",
  occurrenceDelta: 5,
  uniqueValueDelta: 3,
  sources: ["client/game/audio.ts", "client/game/mobRenderer.ts", "client/singleplayer/SinglePlayerApp.tsx"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA.occurrenceDelta,
COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA, {
  previousOccurrences: 598,
  previousUniqueValues: 528,
  previousSourceFingerprint: "b71e72d778294cb8244918a141fb0b61f66e1cf798dc625c2eed21109d12e70f",
  occurrenceDelta: 7,
  uniqueValueDelta: 7,
  sources: [
    "client/game/voxelEngine.ts",
    "client/singleplayer/SinglePlayerApp.tsx",
    "client/singleplayer/gameScreenshot.ts",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.occurrenceDelta, COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA.uniqueValueDelta, COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA, {
  previousOccurrences: 605,
  previousUniqueValues: 535,
  previousSourceFingerprint: "4d723bdd87b365f87b9d5caa980745c9cdfad905170048bf579e9d6ab33ab125",
  occurrenceDelta: 2,
  uniqueValueDelta: 2,
  addedValues: ["Loading world", "Preparing terrain…"],
  source: "client/singleplayer/SinglePlayerApp.tsx#world-loading-status",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.occurrenceDelta,
COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA, {
  previousOccurrences: 607,
  previousUniqueValues: 537,
  previousSourceFingerprint: "c819a96e157f34f994940b0dfef19d5a7d5cef5f6e5315fb26feaa6f2ada16de",
  occurrenceDelta: -24,
  uniqueValueDelta: -17,
  sources: [
    "client/index.tsx",
    "client/lobby/LobbyScreen.tsx",
    "client/realtimeMultiplayer.ts",
    "client/singleplayer/SinglePlayerApp.tsx#retired-debug-surface",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
    "client/index.tsx#retired-lakebed-presence-stage",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.occurrenceDelta,
COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA.uniqueValueDelta,
COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA, {
  previousOccurrences: 583,
  previousUniqueValues: 520,
  previousSourceFingerprint: "18bd2ab516030b53c08a9b72fdc40cf6e91f43d7fce7d59cfa706d9b275ee190",
  occurrenceDelta: -19,
  uniqueValueDelta: -17,
  source: "client/index.tsx#compact-railway-authority-and-player-skin-wire",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.occurrenceDelta,
COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.previousUniqueValues);
assert.equal(COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.previousOccurrences
  + COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.occurrenceDelta,
COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES);
assert.equal(COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.previousUniqueValues
  + COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA.uniqueValueDelta,
COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES);

assert.deepEqual(COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA.removedThresholdValues,
  ["left", "right", "back", "top"], "only packed mob face names left the repeated-string boundary");
assert.equal(
  COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA.previousOccurrences
    + COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA.occurrenceDelta,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.previousOccurrences,
  "the visual descriptor refactor's exact repeated-occurrence delta stays accounted for",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA.previousUniqueValues
    + COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.previousUniqueValues,
  "the four face values exactly account for the repeated-pool unique delta",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.previousOccurrences
    + COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.occurrenceDelta,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.previousOccurrences,
  "the explicit versioned skin-storage key accounts for the one repeated occurrence",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.previousUniqueValues
    + COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.previousUniqueValues,
  "the already-pooled version key adds no repeated-pool value",
);
assert.deepEqual(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA,
  {
    previousOccurrences: 1_078,
    previousUniqueValues: 97,
    previousSourceFingerprint: "feb7d603973a269e0cef296a611046e0efed301e1ec2b91ad9c70c10afcd4aa7",
    occurrenceDelta: 1,
    uniqueValueDelta: 0,
    addedOccurrenceValue: "version",
    source: "client/game/playerSkin.ts#PLAYER_SKIN_STORAGE_KEYS",
    exclusionChanges: 0,
  },
  "the skin-storage live-set change stays pinned to one source literal with unchanged exclusions",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.previousOccurrences
    + COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.occurrenceDelta,
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.previousOccurrences,
  "the computed skin-storage codec removes only the redundant version occurrence",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.previousUniqueValues
    + COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.previousUniqueValues,
  "the computed codec preserves the repeated value inventory",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.previousOccurrences
    + COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.occurrenceDelta,
  1_083,
  "the historical held-block restoration retains its exact reviewed occurrence boundary",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.previousUniqueValues
    + COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA.previousUniqueValues,
  "the held-block restoration remains the reviewed base for later visual compaction",
);
assert.deepEqual(
  COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA,
  {
    previousOccurrences: 1_078,
    previousUniqueValues: 97,
    previousSourceFingerprint: "feb7d603973a269e0cef296a611046e0efed301e1ec2b91ad9c70c10afcd4aa7",
    occurrenceDelta: 5,
    uniqueValueDelta: 1,
    promotedThresholdValue: "rightArm",
    source: "client/game/firstPersonSkinRenderer.ts#buildFirstPersonSkinArmGeometry",
    exclusionChanges: 0,
  },
  "the held-block string-pool boundary changes only through the reviewed visual fix",
);
assert.deepEqual(
  COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA,
  {
    previousOccurrences: 1_085,
    previousUniqueValues: 98,
    previousSourceFingerprint: "3b7a3dbfcd1bf6ff9dc1c4456f33ddfe9719d69da8c9f2949b574a62cf495699",
    occurrenceDelta: 7,
    uniqueValueDelta: 1,
    promotedThresholdValue: "top",
    source: "client/components/atlasBlockItemIcon.ts#atlasBlockItemIconRuns",
    exclusionChanges: 0,
  },
  "runtime atlas icon reconstruction stays pinned to one reviewed helper",
);
assert.equal(
  COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA.previousOccurrences
    + COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA.occurrenceDelta,
  COMPACT_CLIENT_REPEATED_DAYLIGHT_CONFIRMATION_DELTA.previousOccurrences,
  "runtime atlas icon reconstruction accounts for the exact repeated occurrence increase",
);
assert.deepEqual(COMPACT_CLIENT_REPEATED_DAYLIGHT_CONFIRMATION_DELTA, {
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "21d654d522cbbafe7d697733720c2c2abcb4ac0baa31a9255e061c9eb7f97ce9",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  addedOccurrenceValue: "system",
  source: "client/singleplayer/SinglePlayerApp.tsx#submitLocalCommand",
  exclusionChanges: 0,
});
assert.deepEqual(
  COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA,
  {
    previousOccurrences: 371,
    previousUniqueValues: 109,
    previousSourceFingerprint: "51c27dce84789a33f5c2530c81b45222714f2c9c518bb54fca9f4b2c5ed9850f",
    occurrenceDelta: 3,
    uniqueValueDelta: 1,
    promotedValue: "2d",
    source: "client/components/ItemGlyph.tsx#paintAtlasBlockIcon",
    exclusionChanges: 0,
  },
  "the GUI block canvas promotes only the reviewed 2d context literal",
);
assert.equal(
  COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA.previousOccurrences
    + COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA.occurrenceDelta,
  COMPACT_CLIENT_LOW_FREQUENCY_BEDROCK_WORLD_DELTA.previousOccurrences,
  "the block canvas accounts for the exact low-frequency occurrence increase",
);
assert.equal(
  COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA.previousUniqueValues
    + COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA.uniqueValueDelta,
  COMPACT_CLIENT_LOW_FREQUENCY_BEDROCK_WORLD_DELTA.previousUniqueValues,
  "the block canvas accounts for the one newly promoted API value",
);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_BEDROCK_WORLD_DELTA, {
  previousOccurrences: 374,
  previousUniqueValues: 110,
  previousSourceFingerprint: "922b39a38e005f3013436f6aef0a8d35dfdb942e54f950c8195316922006514e",
  occurrenceDelta: 4,
  uniqueValueDelta: 1,
  promotedValue: "bedrock",
  source: "world-only terrain/protocol adapters",
  exclusionChanges: 0,
}, "bedrock enters only the world-only low-frequency boundary");
assert.deepEqual(COMPACT_CLIENT_REPEATED_SOUND_RUNTIME_DELTA, {
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "bc6ee9a11b728887fed6d97278975fc3db815d2ad34db6de94b7a48f752fccad",
  occurrenceDelta: -12,
  uniqueValueDelta: 1,
  source: "client/game/audio.ts#official sampled audio",
  exclusionChanges: 0,
});
assert.deepEqual(COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA, {
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "21d654d522cbbafe7d697733720c2c2abcb4ac0baa31a9255e061c9eb7f97ce9",
  occurrenceDelta: 58,
  uniqueValueDelta: 8,
  sources: ["environment", "official-sounds", "exact-mobs"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA, {
  previousOccurrences: 1_150,
  previousUniqueValues: 107,
  previousSourceFingerprint: "b25a1b70625b28b795219c82c9fa9fc12e50f8ad7290bbc9d6736ecc51d30c15",
  occurrenceDelta: -5,
  uniqueValueDelta: -1,
  source: "client/game/viewmodelRig.ts#socketed-first-person-rig",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA, {
  previousOccurrences: 1_145,
  previousUniqueValues: 106,
  previousSourceFingerprint: "a0377d7ee28c815e6f87b80a0bcb914319f1ddb58a57c1ba36aec9a6435a1fc0",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  addedOccurrenceValue: "image/png",
  sources: ["client/game/voxelEngine.ts", "client/singleplayer/gameScreenshot.ts"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA, {
  previousOccurrences: 1_146,
  previousUniqueValues: 106,
  previousSourceFingerprint: "b6a71e41bdcc2506081ff81506f4398ec8561fa0c6f11887879a81dcb63f13a7",
  occurrenceDelta: 2,
  uniqueValueDelta: 0,
  sources: ["client/game/firstPersonRenderer.ts", "client/game/viewmodelRig.ts"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA, {
  previousOccurrences: 1_148,
  previousUniqueValues: 106,
  previousSourceFingerprint: "499b0ae5a73c5a0bb2e007d2d05d524716eff3180c5b4b86c415e3ad782de276",
  occurrenceDelta: 12,
  uniqueValueDelta: 1,
  sources: [
    "client/components/FirstPersonPoseLab.tsx",
    "client/game/playerRig.ts",
    "client/game/thirdPersonTuning.ts",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA, {
  previousOccurrences: 1_160,
  previousUniqueValues: 107,
  previousSourceFingerprint: "4c1784d760ac6a536450371631649c8789b5414df8cf5aa77b9b2b57fec5bb07",
  occurrenceDelta: 5,
  uniqueValueDelta: 0,
  addedOccurrenceValues: ["lc-pointer-capture", "status"],
  source: "client/singleplayer/SinglePlayerApp.tsx#world-loading-status",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA, {
  previousOccurrences: 1_165,
  previousUniqueValues: 107,
  previousSourceFingerprint: "d78c720d484f82126a883216f7ace975aeaf24957c5fca8aa30ff36e69e32cac",
  occurrenceDelta: 6,
  uniqueValueDelta: 1,
  sources: [
    "client/gameplayKeyboardCapture.ts",
    "client/runtimeMode.ts",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA, {
  previousOccurrences: 1_171,
  previousUniqueValues: 108,
  previousSourceFingerprint: "86d6cdb7d321ee8fe9f67b1f27dc73c2ce3a7a69e2c19c66c40db057e1ab1b2d",
  occurrenceDelta: 18,
  uniqueValueDelta: 5,
  sources: [
    "client/index.tsx",
    "client/runtimeMode.ts",
    "client/realtimeMultiplayer.ts",
    "client/game/remotePlayerRenderer.ts",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
    "client/index.tsx#retired-lakebed-presence-stage",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA, {
  previousOccurrences: 1_189,
  previousUniqueValues: 113,
  previousSourceFingerprint: "83f9ee33ed0e731999c3b2368489f2e972ed5efd673fedf13422d58cb7565e0f",
  occurrenceDelta: -23,
  uniqueValueDelta: -3,
  sources: [
    "client/game/avatar.ts",
    "client/game/playerSkin.ts",
    "client/game/remotePlayerSkinRenderer.ts",
    "client/realtimeMultiplayer.ts",
    "client/index.tsx#realtime-drops-and-pose-parity",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.previousUniqueValues);
assert.equal(COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.previousOccurrences
  + COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.occurrenceDelta,
COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES);
assert.equal(COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.previousUniqueValues
  + COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA.uniqueValueDelta,
COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_SOUND_RUNTIME_DELTA, {
  previousOccurrences: 371,
  previousUniqueValues: 109,
  previousSourceFingerprint: "51c27dce84789a33f5c2530c81b45222714f2c9c518bb54fca9f4b2c5ed9850f",
  occurrenceDelta: 32,
  uniqueValueDelta: 10,
  source: "client/game/audio.ts#official sampled audio",
  exclusionChanges: 0,
});
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA, {
  previousOccurrences: 378,
  previousUniqueValues: 111,
  previousSourceFingerprint: "1424b040b100812c4fabcc53e85bc57c28bde52eb82017a5033f863f74d40144",
  occurrenceDelta: 39,
  uniqueValueDelta: 12,
  sources: ["official-sounds", "exact-mobs", "mob-texture-lifecycle"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA, {
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "59a53008712a865933bf38cab63513e8e402063969b0a3c3c46a86bbf0f89aea",
  occurrenceDelta: 4,
  uniqueValueDelta: 1,
  source: "client/game/viewmodelRig.ts#socketed-first-person-rig",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA, {
  previousOccurrences: 421,
  previousUniqueValues: 124,
  previousSourceFingerprint: "8b9e5a8c413a5adbe3362b19d25050c787a55996d87025c8575a7cb6844cfa33",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  source: "client/singleplayer/gameScreenshot.ts#downloadGameScreenshot",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA, {
  previousOccurrences: 422,
  previousUniqueValues: 124,
  previousSourceFingerprint: "012841fabaab73e046841bb88df3121c46ce64864c181a60be011a3a5065202c",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  sources: ["client/game/firstPersonRenderer.ts", "client/game/viewmodelRig.ts"],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA, {
  previousOccurrences: 423,
  previousUniqueValues: 124,
  previousSourceFingerprint: "3457aabb8418a084469bac754991b36aad16956b126c00a0b1dfb538e5497127",
  occurrenceDelta: -2,
  uniqueValueDelta: 0,
  sources: [
    "client/components/FirstPersonPoseLab.tsx",
    "client/game/playerRig.ts",
    "client/game/thirdPersonFacing.ts",
    "client/game/thirdPersonTuning.ts",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA, {
  previousOccurrences: 421,
  previousUniqueValues: 124,
  previousSourceFingerprint: "88ddadf7ef0b315a78332300101a18977434e5629352bf7770fe03fbbae837aa",
  occurrenceDelta: -4,
  uniqueValueDelta: -1,
  promotedThresholdValue: "function",
  source: "client/gameplayKeyboardCapture.ts#browser-capability-guards",
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues);
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA, {
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "2aeb3e07af4ac865b0ba8beb418788cf7b833879e790cfbbc5d651168d1ff1d5",
  occurrenceDelta: -2,
  uniqueValueDelta: -2,
  sources: [
    "client/index.tsx",
    "client/runtimeMode.ts",
    "client/realtimeMultiplayer.ts",
    "client/game/remotePlayerRenderer.ts",
    "client/singleplayer/SinglePlayerApp.tsx#retired-debug-surface",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
  ],
  exclusionChanges: 0,
});
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.previousOccurrences);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.previousUniqueValues);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.previousOccurrences
  + COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.occurrenceDelta,
COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES);
assert.equal(COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.previousUniqueValues
  + COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA.uniqueValueDelta,
COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES);
assert.deepEqual(COMPACT_CLIENT_REPEATED_MOB_TEXTURE_DELTA, {
  previousOccurrences: 1_092, previousUniqueValues: 99,
  previousSourceFingerprint: "bc6ee9a11b728887fed6d97278975fc3db815d2ad34db6de94b7a48f752fccad",
  occurrenceDelta: 56, uniqueValueDelta: 7,
  source: "client/game/mobRenderer.ts#exact-textured-model-dispatch", exclusionChanges: 0,
});
assert.deepEqual(COMPACT_CLIENT_REPEATED_MOB_TEXTURE_LIFECYCLE_DELTA, {
  previousOccurrences: 1_148, previousUniqueValues: 106,
  previousSourceFingerprint: "ce3b7181b6c75c183e201096398d2c62a4017a56fe092a659bb9fff645dd4c8b",
  occurrenceDelta: 3, uniqueValueDelta: 0,
  source: "client/game/mobRenderer.ts#mob-texture-lifecycle", exclusionChanges: 0,
});
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_DELTA, {
  previousOccurrences: 374, previousUniqueValues: 110,
  previousSourceFingerprint: "922b39a38e005f3013436f6aef0a8d35dfdb942e54f950c8195316922006514e",
  occurrenceDelta: 22, uniqueValueDelta: 7,
  source: "client/game/mobRenderer.ts#mob-texture-program", exclusionChanges: 0,
});
assert.deepEqual(COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_LIFECYCLE_DELTA, {
  previousOccurrences: 396, previousUniqueValues: 117,
  previousSourceFingerprint: "7545fcec4903261ac65a6902101edd1da274e70c3740d5194840674bf13d967b",
  occurrenceDelta: 6, uniqueValueDelta: 2,
  source: "client/game/mobRenderer.ts#createMobTexture", exclusionChanges: 0,
});
assert.deepEqual(
  COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA,
  {
    previousOccurrences: 1_079,
    previousUniqueValues: 97,
    previousSourceFingerprint: "6d79b29dbcec52e56550534dd0a881ffb0b97df240e83ef16cc5734689c09452",
    occurrenceDelta: -1,
    uniqueValueDelta: 0,
    removedOccurrenceValue: "version",
    source: "client/game/playerSkin.ts#PLAYER_SKIN_STORAGE_KEYS",
    exclusionChanges: 0,
  },
  "the codec optimization stays chained to the reviewed strict-schema baseline",
);

const fixture = [
  '"use strict";',
  'const object={"Human property name":"Visible human message",label:"Another visible message"};',
  'const imported="Import-like value";',
  'const key=object["Element access key"];',
  'const value="none";',
  'const compared=value==="Wire identity value";',
  'const payload=JSON.stringify("Wire payload value");',
  'switch(value){case "Wire switch value":break}',
  'const repeated=["foo_bar","foo_bar","foo_bar","foo_bar","foo_bar"];',
  'const belowThreshold=["four_only","four_only","four_only","four_only"];',
  'const excludedTwice=["twice_only","twice_only"];',
  `const fixedTwice=${JSON.stringify(fixedFrequencyTwoValues.flatMap((value) => [value, value]))};`,
  'const rejectedIdentityTwice=["world_create_transaction_committed","world_create_transaction_committed"];',
  'const rejectedWireTwice=JSON.stringify({wire_candidate:"wire_candidate"});',
  'const rejectedPropertyTwice={property_candidate:1,other:{property_candidate:2}};',
  'const rejectedDomTwice=["pointerlockchange","pointerlockchange"];',
  'const rejectedUiTwice=["Options…","Options…"];',
  'globalThis.__lakecraftClientStringFixture=[object,object.label,"A readable error happened!","Inventory",repeated,belowThreshold,excludedTwice,fixedTwice];',
].join("");
const fixtureAnalysis = await analyzeClientStringPool(fixture);
assert.deepEqual(
  fixtureAnalysis.values,
  [
    "Visible human message", "Another visible message", "Import-like value", "foo_bar", "four_only",
    "A readable error happened!", "Inventory", ...fixedFrequencyTwoValues,
  ],
  "only human-facing values are selected; directives, keys, element access, identity checks, JSON wire values, and cases are excluded",
);
assert.deepEqual(fixtureAnalysis.repeated.values, ["foo_bar"],
  "only syntax-safe non-human literals at the fixed five-occurrence floor join the repeated pool");
assert.deepEqual(fixtureAnalysis.lowFrequency.values, ["four_only"],
  "three- and four-occurrence values use their separate reviewed boundary");
assert.ok(!fixtureAnalysis.values.includes("twice_only"), "two occurrences stay below the reviewed floor");
assert.deepEqual(fixtureAnalysis.fixedFrequencyTwo.values, fixedFrequencyTwoValues,
  "only the exact mesh descriptor allowlist joins the fixed frequency-two category");
assert.equal(fixtureAnalysis.fixedFrequencyTwo.occurrences.length, COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES);
assert.ok(fixtureAnalysis.fixedFrequencyTwo.occurrences.every(
  ({ kind }) => kind === COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND,
), "every fixed occurrence retains its pinned syntax kind");
for (const rejected of [
  "world_create_transaction_committed", "wire_candidate", "property_candidate", "pointerlockchange", "Options…",
]) {
  assert.ok(!fixtureAnalysis.fixedFrequencyTwo.values.includes(rejected), `${rejected} cannot enter the closed category`);
}

const transformed = await compactClientStringPool(fixture, {
  human: {
    occurrences: fixtureAnalysis.human.occurrences.length,
    uniqueValues: fixtureAnalysis.human.values.length,
    fingerprint: fixtureAnalysis.human.fingerprint,
  },
  repeated: {
    occurrences: fixtureAnalysis.repeated.occurrences.length,
    uniqueValues: fixtureAnalysis.repeated.values.length,
    fingerprint: fixtureAnalysis.repeated.fingerprint,
  },
  lowFrequency: {
    occurrences: fixtureAnalysis.lowFrequency.occurrences.length,
    uniqueValues: fixtureAnalysis.lowFrequency.values.length,
    fingerprint: fixtureAnalysis.lowFrequency.fingerprint,
  },
  fixedFrequencyTwo: {
    occurrences: fixtureAnalysis.fixedFrequencyTwo.occurrences.length,
    uniqueValues: fixtureAnalysis.fixedFrequencyTwo.values.length,
    fingerprint: fixtureAnalysis.fixedFrequencyTwo.fingerprint,
  },
  fixedIdentity: {
    occurrences: fixtureAnalysis.fixedIdentity.occurrences.length,
    uniqueValues: fixtureAnalysis.fixedIdentity.values.length,
    incrementalUniqueValues: fixtureAnalysis.fixedIdentityIncrementalUniqueValues,
    fingerprint: fixtureAnalysis.fixedIdentity.fingerprint,
  },
  webglUniform: {
    occurrences: fixtureAnalysis.webglUniform.occurrences.length,
    uniqueValues: fixtureAnalysis.webglUniform.values.length,
    fingerprint: fixtureAnalysis.webglUniform.fingerprint,
  },
});
new Function(transformed)();
assert.deepEqual(
  globalThis.__lakecraftClientStringFixture,
  [{ "Human property name": "Visible human message", label: "Another visible message" }, "Another visible message",
    "A readable error happened!", "Inventory", ["foo_bar", "foo_bar", "foo_bar", "foo_bar", "foo_bar"],
    ["four_only", "four_only", "four_only", "four_only"], ["twice_only", "twice_only"],
    fixedFrequencyTwoValues.flatMap((value) => [value, value])],
  "decoded UI and error strings preserve their exact values and object-key shape",
);
delete globalThis.__lakecraftClientStringFixture;

const keywordBoundaryFixture = [
  'function pooledDirection(index){',
  'if(index===0)return"north";',
  'if(index===1)return"north";',
  'if(index===2)return"north";',
  'if(index===3)return"north";',
  'return"north"}',
  'globalThis.__lakecraftKeywordBoundaryFixture=[pooledDirection(0),typeof"north"];',
].join("");
const keywordBoundaryAnalysis = await analyzeClientStringPool(keywordBoundaryFixture);
const keywordBoundaryExpected = Object.fromEntries(
  ["human", "repeated", "lowFrequency", "fixedFrequencyTwo", "webglUniform", "fixedIdentity"].map(
    (category) => [category, {
      occurrences: keywordBoundaryAnalysis[category].occurrences.length,
      uniqueValues: keywordBoundaryAnalysis[category].values.length,
      ...(category === "fixedIdentity" ? {
        incrementalUniqueValues: keywordBoundaryAnalysis.fixedIdentityIncrementalUniqueValues,
      } : {}),
      fingerprint: keywordBoundaryAnalysis[category].fingerprint,
    }],
  ),
);
const transformedKeywordBoundaryFixture = await compactClientStringPool(
  keywordBoundaryFixture,
  keywordBoundaryExpected,
);
assert.doesNotMatch(transformedKeywordBoundaryFixture, /(?:return|typeof)__lakecraftClientStrings/,
  "pool replacements preserve lexical boundaries after adjacent keywords");
new Function(transformedKeywordBoundaryFixture)();
assert.deepEqual(globalThis.__lakecraftKeywordBoundaryFixture, ["north", "string"],
  "pooled return values and typeof operands execute with their original semantics");
delete globalThis.__lakecraftKeywordBoundaryFixture;

const importAnalysis = await analyzeClientStringPool(
  'import value from "Human readable module";export * from "Another readable module";import("Dynamic readable module");',
);
assert.deepEqual(importAnalysis.values, [], "import and export module specifiers stay literal");

await assert.rejects(
  compactClientStringPool(fixture, {
    human: {
      occurrences: fixtureAnalysis.human.occurrences.length + 1,
      uniqueValues: fixtureAnalysis.human.values.length,
      fingerprint: fixtureAnalysis.human.fingerprint,
    },
    repeated: {
      occurrences: fixtureAnalysis.repeated.occurrences.length,
      uniqueValues: fixtureAnalysis.repeated.values.length,
      fingerprint: fixtureAnalysis.repeated.fingerprint,
    },
    lowFrequency: {
      occurrences: fixtureAnalysis.lowFrequency.occurrences.length,
      uniqueValues: fixtureAnalysis.lowFrequency.values.length,
      fingerprint: fixtureAnalysis.lowFrequency.fingerprint,
    },
    fixedFrequencyTwo: {
      occurrences: fixtureAnalysis.fixedFrequencyTwo.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedFrequencyTwo.values.length,
      fingerprint: fixtureAnalysis.fixedFrequencyTwo.fingerprint,
    },
    fixedIdentity: {
      occurrences: fixtureAnalysis.fixedIdentity.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedIdentity.values.length,
      incrementalUniqueValues: fixtureAnalysis.fixedIdentityIncrementalUniqueValues,
      fingerprint: fixtureAnalysis.fixedIdentity.fingerprint,
    },
    webglUniform: {
      occurrences: fixtureAnalysis.webglUniform.occurrences.length,
      uniqueValues: fixtureAnalysis.webglUniform.values.length,
      fingerprint: fixtureAnalysis.webglUniform.fingerprint,
    },
  }),
  /human live set changed/,
  "eligible-live-set drift fails closed",
);
await assert.rejects(
  compactClientStringPool(fixture, {
    human: {
      occurrences: fixtureAnalysis.human.occurrences.length,
      uniqueValues: fixtureAnalysis.human.values.length,
      fingerprint: fixtureAnalysis.human.fingerprint,
    },
    repeated: {
      occurrences: fixtureAnalysis.repeated.occurrences.length,
      uniqueValues: fixtureAnalysis.repeated.values.length,
      fingerprint: fixtureAnalysis.repeated.fingerprint,
    },
    lowFrequency: {
      occurrences: fixtureAnalysis.lowFrequency.occurrences.length,
      uniqueValues: fixtureAnalysis.lowFrequency.values.length,
      fingerprint: fixtureAnalysis.lowFrequency.fingerprint,
    },
    fixedFrequencyTwo: {
      occurrences: fixtureAnalysis.fixedFrequencyTwo.occurrences.length + 1,
      uniqueValues: fixtureAnalysis.fixedFrequencyTwo.values.length,
      fingerprint: fixtureAnalysis.fixedFrequencyTwo.fingerprint,
    },
    fixedIdentity: {
      occurrences: fixtureAnalysis.fixedIdentity.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedIdentity.values.length,
      incrementalUniqueValues: fixtureAnalysis.fixedIdentityIncrementalUniqueValues,
      fingerprint: fixtureAnalysis.fixedIdentity.fingerprint,
    },
    webglUniform: {
      occurrences: fixtureAnalysis.webglUniform.occurrences.length,
      uniqueValues: fixtureAnalysis.webglUniform.values.length,
      fingerprint: fixtureAnalysis.webglUniform.fingerprint,
    },
  }),
  /fixedFrequencyTwo live set changed/,
  "the closed frequency-two category fails on any occurrence drift",
);
await assert.rejects(
  compactClientStringPool(fixture, {
    human: {
      occurrences: fixtureAnalysis.human.occurrences.length,
      uniqueValues: fixtureAnalysis.human.values.length,
      fingerprint: fixtureAnalysis.human.fingerprint,
    },
    repeated: {
      occurrences: fixtureAnalysis.repeated.occurrences.length,
      uniqueValues: fixtureAnalysis.repeated.values.length,
      fingerprint: fixtureAnalysis.repeated.fingerprint,
    },
    lowFrequency: {
      occurrences: fixtureAnalysis.lowFrequency.occurrences.length,
      uniqueValues: fixtureAnalysis.lowFrequency.values.length,
      fingerprint: fixtureAnalysis.lowFrequency.fingerprint,
    },
    fixedFrequencyTwo: {
      occurrences: fixtureAnalysis.fixedFrequencyTwo.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedFrequencyTwo.values.length,
      fingerprint: fixtureAnalysis.fixedFrequencyTwo.fingerprint,
    },
    fixedIdentity: {
      occurrences: fixtureAnalysis.fixedIdentity.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedIdentity.values.length,
      incrementalUniqueValues: fixtureAnalysis.fixedIdentityIncrementalUniqueValues,
      fingerprint: fixtureAnalysis.fixedIdentity.fingerprint,
    },
    webglUniform: {
      occurrences: fixtureAnalysis.webglUniform.occurrences.length + 1,
      uniqueValues: fixtureAnalysis.webglUniform.values.length,
      fingerprint: fixtureAnalysis.webglUniform.fingerprint,
    },
  }),
  /webglUniform live set changed/,
  "the closed WebGL uniform category fails on any retained occurrence drift",
);
await assert.rejects(
  compactClientStringPool(fixture, {
    human: {
      occurrences: fixtureAnalysis.human.occurrences.length,
      uniqueValues: fixtureAnalysis.human.values.length,
      fingerprint: fixtureAnalysis.human.fingerprint,
    },
    repeated: {
      occurrences: fixtureAnalysis.repeated.occurrences.length,
      uniqueValues: fixtureAnalysis.repeated.values.length,
      fingerprint: fixtureAnalysis.repeated.fingerprint,
    },
    lowFrequency: {
      occurrences: fixtureAnalysis.lowFrequency.occurrences.length,
      uniqueValues: fixtureAnalysis.lowFrequency.values.length,
      fingerprint: fixtureAnalysis.lowFrequency.fingerprint,
    },
    fixedFrequencyTwo: {
      occurrences: fixtureAnalysis.fixedFrequencyTwo.occurrences.length,
      uniqueValues: fixtureAnalysis.fixedFrequencyTwo.values.length,
      fingerprint: fixtureAnalysis.fixedFrequencyTwo.fingerprint,
    },
    fixedIdentity: {
      occurrences: fixtureAnalysis.fixedIdentity.occurrences.length + 1,
      uniqueValues: fixtureAnalysis.fixedIdentity.values.length,
      incrementalUniqueValues: fixtureAnalysis.fixedIdentityIncrementalUniqueValues,
      fingerprint: fixtureAnalysis.fixedIdentity.fingerprint,
    },
    webglUniform: {
      occurrences: fixtureAnalysis.webglUniform.occurrences.length,
      uniqueValues: fixtureAnalysis.webglUniform.values.length,
      fingerprint: fixtureAnalysis.webglUniform.fingerprint,
    },
  }),
  /fixedIdentity live set changed/,
  "the closed identity category fails on any retained occurrence drift",
);

const stagedPath = process.env.LAKECRAFT_COMPACT_CLIENT_STAGE;
if (stagedPath) {
  const live = await analyzeClientStringPool(await readFile(stagedPath, "utf8"));
  assert.equal(live.occurrences.length, COMPACT_CLIENT_STRING_OCCURRENCES);
  assert.equal(live.values.length, COMPACT_CLIENT_STRING_UNIQUE_VALUES);
  assert.equal(live.human.occurrences.length, COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES);
  assert.equal(live.human.values.length, COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES);
  assert.equal(live.human.fingerprint, COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT);
  assert.equal(live.repeated.occurrences.length, COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES);
  assert.equal(live.repeated.values.length, COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES);
  assert.equal(live.repeated.fingerprint, COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT);
  assert.equal(live.lowFrequency.occurrences.length, COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES);
  assert.equal(live.lowFrequency.values.length, COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES);
  assert.equal(live.lowFrequency.fingerprint, COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT);
  assert.equal(live.fixedFrequencyTwo.occurrences.length, COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES);
  assert.equal(live.fixedFrequencyTwo.values.length, COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES);
  assert.equal(live.fixedFrequencyTwo.fingerprint, COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT);
  assert.deepEqual(live.fixedFrequencyTwo.values, fixedFrequencyTwoValues);
  assert.equal(live.webglUniform.occurrences.length, COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES);
  assert.equal(live.webglUniform.values.length, COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES);
  assert.equal(live.webglUniform.fingerprint, COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT);
  assert.deepEqual(live.webglUniform.values, webglUniformValues);
  assert.deepEqual(
    Object.fromEntries(live.webglUniform.values.map((value, index) => [value, live.webglUniform.counts[index]])),
    COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_COUNTS,
    "the retained per-name uniform counts stay exact",
  );
  assert.ok(live.webglUniform.occurrences.every(
    ({ kind }) => kind === COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND,
  ));
  assert.equal(live.fixedIdentity.occurrences.length, COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES);
  assert.equal(live.fixedIdentity.values.length, COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES);
  assert.equal(live.fixedIdentity.fingerprint, COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT);
  assert.equal(live.fixedIdentityIncrementalUniqueValues,
    COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES);
  assert.deepEqual([...live.fixedIdentity.values].sort(), [...fixedIdentityValues].sort());
  assert.deepEqual(
    Object.fromEntries(live.fixedIdentity.values.map((value, index) => [value, live.fixedIdentity.counts[index]])),
    COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_COUNTS,
    "the retained per-value mode/status identity counts stay exact",
  );
  assert.ok(live.fixedIdentity.occurrences.every(({ context, kind }) =>
    kind === COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND
    && (context === "BinaryExpression:EqualsEqualsEqualsToken:right"
      || context === "BinaryExpression:ExclamationEqualsEqualsToken:right"
      || context === "BinaryExpression:EqualsEqualsEqualsToken:left"
      || context === "BinaryExpression:ExclamationEqualsEqualsToken:left"
      || context === "CaseClause:expression")),
  "fixed identities remain exact strict-comparison operands or switch cases");
  assert.ok(live.values.includes("Inventory"), "representative UI label remains in the reviewed set");
  assert.ok(live.values.includes("Respawn not authorized"), "representative error remains in the reviewed set");
}

console.log("compact client string-pool exclusion, exact-decoding, and drift tests passed");
