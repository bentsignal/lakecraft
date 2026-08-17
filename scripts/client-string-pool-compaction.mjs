import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeStaticBytes, STATIC_BYTE_ALPHABET } from "./static-byte-encoding.mjs";

// This transform runs only on the closed, already-bundled production client.
// The counts and fingerprint are an explicit compatibility boundary: changing
// application copy or making a new literal eligible requires human review.
export const COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES = 540;
export const COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES = 476;
export const COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT = "f9febcf89744dfa3db52e32878d02bff39d98cd725bac142efd10fb463a5b42c";
export const COMPACT_CLIENT_HUMAN_TITLE_HOTBAR_DELTA = Object.freeze({
  previousOccurrences: 541,
  previousUniqueValues: 475,
  previousSourceFingerprint: "568c542a93c4f7e4fbc7c62ae7996492001ef252a4e7aa539bb8e191747ac300",
  occurrenceDelta: -1,
  uniqueValueDelta: 1,
  sources: Object.freeze([
    "client/components/StatusStrip.tsx",
    "client/lobby/LobbyScreen.tsx",
    "client/lobby/TitleLogo.tsx",
    "client/singleplayer/LocalWorldBrowser.tsx",
  ]),
  source: "generated Lake Bed Edition title, relocated auth controls, and compact status placement",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_MINECRAFT_PARITY_DELTA = Object.freeze({
  previousOccurrences: 502,
  previousUniqueValues: 442,
  previousSourceFingerprint: "8028359dca9b69aec2a81891d95cadfa3249cb8ee31d1145b7c952303f6cddd8",
  occurrenceDelta: 42,
  uniqueValueDelta: 37,
  sources: Object.freeze([
    "client/components/OptionsDialog.tsx",
    "client/components/StatusStrip.tsx",
    "client/gameplay/controlBindings.ts",
    "client/index.tsx",
    "client/lobby/LobbyScreen.tsx",
    "client/realtimeMultiplayer.ts",
  ]),
  source: "Minecraft-parity controls, HUD/title presentation, authoritative loading, and Railway mob feedback",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_RAILWAY_AUTHORITY_DELTA = Object.freeze({
  previousOccurrences: 544,
  previousUniqueValues: 479,
  previousSourceFingerprint: "ebec9ae04665f04366f1a2f5b1b92a6150afdc5e7bce9c5925def7c7a0ae0536",
  occurrenceDelta: -4,
  uniqueValueDelta: -4,
  sources: Object.freeze(["client/index.tsx"]),
  source: "Railway-owned respawn, Creative inventory, and combat authority removed retired local rejection copy",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_EMBEDDED_ATLAS_DELTA = Object.freeze({
  previousOccurrences: 540,
  previousUniqueValues: 475,
  previousSourceFingerprint: "c59e9b79b94c65d0bde35ed72be4ef50a9ad765a5cbb31ccd9bb7823cb19bf89",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  sources: Object.freeze(["client/game/generated/textureAtlas.ts", "client/components/WorldLoadingScreen.tsx"]),
  source: "embedded visual assets and the shared loading screen add one reviewed duplicate loading label",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_CHUNK_ADMIN_DELTA=Object.freeze({
  previousOccurrences:497,previousUniqueValues:438,
  previousSourceFingerprint:"101d5534862451469ee48f47284d4f93ff4de513688b7b9be27c344e9141cb33",
  occurrenceDelta:5,uniqueValueDelta:4,
  addedValues:Object.freeze(["Lakecraft Creative","Lakecraft Survival","Official Lakecraft world · pinned","Enter this server's password in Direct Connect before joining.","This server still requires its private invitation token."]),
  removedValue:"This server is not registered with Lakebed. Add it again with its private invitation token.",
  source:"pinned first-party servers and persistent access-mode join guidance",exclusionChanges:0,
});
export const COMPACT_CLIENT_HUMAN_TERRAIN_PRESET_DELTA = Object.freeze({
  previousOccurrences: 493,
  previousUniqueValues: 434,
  previousSourceFingerprint: "8426149ab49b75f0b1c36a22ddf88b8f7fbe6a5c1622a1cef1e01cb1596c67a2",
  occurrenceDelta: 4,
  uniqueValueDelta: 4,
  addedValues: Object.freeze([
    "Server sent an invalid terrain preset.",
    "Invalid terrain preset",
    "Server terrain changed during join.",
    "Terrain preset mismatch",
  ]),
  source: "client/realtimeMultiplayer.ts#terrain-preset-handshake",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_VERTICAL_COORDINATE_DELTA = Object.freeze({
  previousOccurrences: 592,
  previousUniqueValues: 524,
  previousSourceFingerprint: "dae65329dae063fa8762ffc180ff6c580a576dd2c7a58aa0ecff97026d97b041",
  occurrenceDelta: 1,
  uniqueValueDelta: 1,
  addedValue: "This world uses the retired terrain coordinate system and cannot be loaded. No data was changed; reset it to start fresh.",
  source: "client/singleplayer/localSave.ts#unsupportedSinglePlayerSaveMessage",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_REALISM_STACK_DELTA = Object.freeze({
  previousOccurrences: 593,
  previousUniqueValues: 525,
  previousSourceFingerprint: "c5e00c64ce79e2fcf4f817c84fd8c29c81edabf641c757702e7e97c29f053521",
  occurrenceDelta: 5,
  uniqueValueDelta: 3,
  sources: Object.freeze([
    "client/game/audio.ts",
    "client/game/mobRenderer.ts",
    "client/singleplayer/SinglePlayerApp.tsx",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_GAME_SCREENSHOT_DELTA = Object.freeze({
  previousOccurrences: 598,
  previousUniqueValues: 528,
  previousSourceFingerprint: "b71e72d778294cb8244918a141fb0b61f66e1cf798dc625c2eed21109d12e70f",
  occurrenceDelta: 7,
  uniqueValueDelta: 7,
  sources: Object.freeze([
    "client/game/voxelEngine.ts",
    "client/singleplayer/SinglePlayerApp.tsx",
    "client/singleplayer/gameScreenshot.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_WORLD_LOADING_DELTA = Object.freeze({
  previousOccurrences: 605,
  previousUniqueValues: 535,
  previousSourceFingerprint: "4d723bdd87b365f87b9d5caa980745c9cdfad905170048bf579e9d6ab33ab125",
  occurrenceDelta: 2,
  uniqueValueDelta: 2,
  addedValues: Object.freeze(["Loading world", "Preparing terrain…"]),
  source: "client/singleplayer/SinglePlayerApp.tsx#world-loading-status",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_REALTIME_MULTIPLAYER_DELTA = Object.freeze({
  previousOccurrences: 607,
  previousUniqueValues: 537,
  previousSourceFingerprint: "c819a96e157f34f994940b0dfef19d5a7d5cef5f6e5315fb26feaa6f2ada16de",
  occurrenceDelta: -24,
  uniqueValueDelta: -17,
  sources: Object.freeze([
    "client/index.tsx",
    "client/lobby/LobbyScreen.tsx",
    "client/realtimeMultiplayer.ts",
    "client/singleplayer/SinglePlayerApp.tsx#retired-debug-surface",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
    "client/index.tsx#retired-lakebed-presence-stage",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_REMOTE_APPEARANCE_DELTA = Object.freeze({
  previousOccurrences: 583,
  previousUniqueValues: 520,
  previousSourceFingerprint: "18bd2ab516030b53c08a9b72fdc40cf6e91f43d7fce7d59cfa706d9b275ee190",
  occurrenceDelta: -19,
  uniqueValueDelta: -17,
  source: "client/index.tsx#compact-railway-authority-and-player-skin-wire",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_SHARED_GAMEPLAY_DELTA = Object.freeze({
  previousOccurrences: 564,
  previousUniqueValues: 503,
  previousSourceFingerprint: "fcd03ec0b220a5a656f8f908b68d6efc55e1ff45f8bf1e735d10b27f7746b2cf",
  occurrenceDelta: -77,
  uniqueValueDelta: -69,
  sources: Object.freeze([
    "client/gameplay/GameplaySessionSurface.tsx",
    "client/gameplay/authority.ts",
    "client/gameplay/pointerSession.ts",
    "client/gameplay/presentation.ts",
    "client/gameplayDiagnostics.tsx",
    "client/gameplayScreenshot.ts",
    "client/game/thirdPersonHeldItem.ts",
    "client/index.tsx#retired-lakebed-world-authority",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_SURVIVAL_FEEDBACK_DELTA = Object.freeze({
  previousOccurrences: 487,
  previousUniqueValues: 434,
  previousSourceFingerprint: "ef74d2549b3a40066d28222e5cb2b1ddd4d1eae7c272d3607062ea5ab8956423",
  occurrenceDelta: -1,
  uniqueValueDelta: -1,
  sources: Object.freeze(["client/index.tsx", "client/realtimeMultiplayer.ts"]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_HUMAN_ITEM_CONSERVATION_DELTA = Object.freeze({
  previousOccurrences: 486,
  previousUniqueValues: 433,
  previousSourceFingerprint: "4048b67e45c872c7d61ab81f4434ea9e3f860707d0bcc9581248c0341d809a00",
  occurrenceDelta: 7,
  uniqueValueDelta: 1,
  source: "Railway-authoritative pack routing and durable world-item recovery",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES = 1_349;
export const COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES = 134;
export const COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT = "267c77f9a236e9aa52e52669249d2a20397902bbf34fc9526299cf08b1b5dd51";
export const COMPACT_CLIENT_REPEATED_TITLE_HOTBAR_DELTA = Object.freeze({
  previousOccurrences: 1_339,
  previousUniqueValues: 133,
  previousSourceFingerprint: "e4c23f806aef6627c1689b08785268d0037b89bafa6bd7ae31f2fe6c97aa9384",
  occurrenceDelta: -2,
  uniqueValueDelta: 0,
  source: "home title/footer markup replacement and status-strip simplification",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_INVENTORY_POLISH_DELTA = Object.freeze({
  previousOccurrences: 1_337,
  previousUniqueValues: 133,
  previousSourceFingerprint: "0f2fe4ddcdc7fd928549bf72c3245e705df29b5a1d71fda8a226fee5f3341812",
  occurrenceDelta: -1,
  uniqueValueDelta: 0,
  source: "single visible world-search prompt and inventory HUD polish",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_BIOME_DELTA = Object.freeze({
  previousOccurrences: 1_336, previousUniqueValues: 133,
  previousSourceFingerprint: "9be45a4e4512f0d801da5ee8a8c0427deeae1028a625f5e3003bdd02597c18ac",
  occurrenceDelta: 13, uniqueValueDelta: 1,
  source: "versioned biomes, water, and Creative natural decorations", exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_MINECRAFT_PARITY_DELTA = Object.freeze({
  previousOccurrences: 1_183,
  previousUniqueValues: 112,
  previousSourceFingerprint: "566cfbf94acd2b7cfd4e25ec023793cf8bd3490f4bce1037636b780be34e1747",
  occurrenceDelta: 106,
  uniqueValueDelta: 11,
  sources: Object.freeze([
    "client/components/OptionsDialog.tsx",
    "client/game/audio.ts",
    "client/game/voxelEngine.ts",
    "client/gameplay/controlBindings.ts",
    "client/index.tsx",
    "client/lobby/TitlePanorama.tsx",
    "client/realtimeMultiplayer.ts",
  ]),
  source: "Minecraft-parity controls, sampled-audio categories, title panorama, loading gate, and Railway mob authority",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_CATALOG_AUTHORITY_DELTA = Object.freeze({
  previousOccurrences: 1_289,
  previousUniqueValues: 123,
  previousSourceFingerprint: "0488b36abfaba96823a80022e22b07f7bd9db8ade28c97eec3fe1ca230d79212",
  occurrenceDelta: 50,
  uniqueValueDelta: 10,
  sources: Object.freeze([
    "shared/expandedBuildingCatalog.ts",
    "shared/game.ts",
    "client/index.tsx",
  ]),
  source: "expanded slab/stair catalog plus Railway-owned inventory and combat envelopes",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_EMBEDDED_ATLAS_DELTA = Object.freeze({
  previousOccurrences: 1_339,
  previousUniqueValues: 133,
  previousSourceFingerprint: "59da08cd3085d38c8f4387a77956a4e42774dafd35f1dfa9c8db5f23ca48149c",
  occurrenceDelta: 0,
  uniqueValueDelta: 0,
  sources: Object.freeze(["client/game/generated/textureAtlas.ts", "client/components/WorldLoadingScreen.tsx"]),
  source: "embedded block-atlas fallback removes two loader literals while the shared loading screen adds two reviewed repeats",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_CREATIVE_PARITY_DELTA = Object.freeze({
  previousOccurrences: 1_026,
  previousUniqueValues: 98,
  previousSourceFingerprint: "67bf8f0d596143daf4c811c43460ac12b8534638ab64b808fb45d8534e7a0c4a",
  occurrenceDelta: 51,
  uniqueValueDelta: 3,
  sources: Object.freeze([
    "client/game/specialBlockGeometry.ts#exact-torch-and-wall-mounts",
    "client/game/voxelEngine.ts#shared-slab-stair-geometry",
    "client/realtimeMultiplayer.ts#complete-chunk-loading-gate",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_SHAPED_ICON_RUNTIME_DELTA = Object.freeze({
  previousOccurrences: 1_077,
  previousUniqueValues: 101,
  previousSourceFingerprint: "edc86199579e692cb8ef28087dbb1d96b959374b2eddb162d5f8b48de1358dbb",
  occurrenceDelta: 7,
  uniqueValueDelta: 1,
  source: "client/components/atlasBlockItemIcon.ts#runtime-shaped-icons",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_BUILDING_CATALOG_DELTA = Object.freeze({
  previousOccurrences: 1_084,
  previousUniqueValues: 102,
  previousSourceFingerprint: "98cd802448209645c361ed4226df37e85d7cd7e475509caae2f67d81696bca28",
  occurrenceDelta: 92,
  uniqueValueDelta: 9,
  sources: Object.freeze([
    "shared/expandedBuildingCatalog.ts",
    "client/game/types.ts#directional-stairs-and-doors",
    "client/game/blockTextures.ts#material-families",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_THIN_DOOR_DELTA = Object.freeze({
  previousOccurrences: 1_176,
  previousUniqueValues: 111,
  previousSourceFingerprint: "9fdb7a06abd4334904a69ebe013aec01ce4dc98217503cbc982a3cd9341c079b",
  occurrenceDelta: 5,
  uniqueValueDelta: 1,
  valueDeltas: Object.freeze({ "_door_": 5 }),
  source: "client/game/skyExposure.ts#closed-directional-doors-remain-thin",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_REMOTE_TEXTURE_DELTA = Object.freeze({
  previousOccurrences: 1_181,
  previousUniqueValues: 112,
  previousSourceFingerprint: "b4b19df72189bfa59accb701f1c923bedf8651408408f8a5f16cea477f601095",
  occurrenceDelta: 2,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/game/generated/textureAtlas.ts#immutable-Railway-atlas-loader",
    "client/game/mobRenderer.ts#immutable-Railway-atlas-loader",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_TERRAIN_PRESET_DELTA = Object.freeze({
  previousOccurrences: 1_023,
  previousUniqueValues: 98,
  previousSourceFingerprint: "187bcbf970d8c8c562f25f947ea1a6487772f1184e833b541b28355b09bb607e",
  occurrenceDelta: 3,
  uniqueValueDelta: 0,
  valueDeltas: Object.freeze({ default: 1, error: 2 }),
  source: "client/realtimeMultiplayer.ts#terrain-preset-handshake",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_POINTER_RECAPTURE_DELTA = Object.freeze({
  previousOccurrences: 1_018,
  previousUniqueValues: 97,
  previousSourceFingerprint: "74e17420ec34785cdaabfc9ff7ba30199e8e6442337a495bf3cbef64003ceb1c",
  occurrenceDelta: 0,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/gameplay/pointerSession.ts",
    "client/singleplayer/SinglePlayerApp.tsx",
    "client/index.tsx",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_ITEM_CONSERVATION_DELTA = Object.freeze({
  previousOccurrences: 1_018,
  previousUniqueValues: 97,
  previousSourceFingerprint: "980574898fe7b17c6a949f4c1c30405e96db6276c83bbb49d69fa2bb90057b71",
  occurrenceDelta: 5,
  uniqueValueDelta: 1,
  source: "client/index.tsx#durable-placement-and-world-item-actions",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_SHARED_GAMEPLAY_DELTA = Object.freeze({
  previousOccurrences: 1_166,
  previousUniqueValues: 110,
  previousSourceFingerprint: "7432a311b0f521732a2f61e22fce196c8ba6a591163aec66dc6d8acb2e43db27",
  occurrenceDelta: -148,
  uniqueValueDelta: -13,
  sources: Object.freeze([
    "client/gameplay/GameplaySessionSurface.tsx",
    "client/gameplay/authority.ts",
    "client/gameplay/pointerSession.ts",
    "client/gameplay/presentation.ts",
    "client/index.tsx#retired-lakebed-world-authority",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_REMOTE_APPEARANCE_DELTA = Object.freeze({
  previousOccurrences: 1_189,
  previousUniqueValues: 113,
  previousSourceFingerprint: "83f9ee33ed0e731999c3b2368489f2e972ed5efd673fedf13422d58cb7565e0f",
  occurrenceDelta: -23,
  uniqueValueDelta: -3,
  sources: Object.freeze([
    "client/game/avatar.ts",
    "client/game/playerSkin.ts",
    "client/game/remotePlayerSkinRenderer.ts",
    "client/realtimeMultiplayer.ts",
    "client/index.tsx#realtime-drops-and-pose-parity",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_REALISM_STACK_DELTA = Object.freeze({
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "21d654d522cbbafe7d697733720c2c2abcb4ac0baa31a9255e061c9eb7f97ce9",
  occurrenceDelta: 58,
  uniqueValueDelta: 8,
  sources: Object.freeze(["environment", "official-sounds", "exact-mobs"]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_VIEWMODEL_RIG_DELTA = Object.freeze({
  previousOccurrences: 1_150,
  previousUniqueValues: 107,
  previousSourceFingerprint: "b25a1b70625b28b795219c82c9fa9fc12e50f8ad7290bbc9d6736ecc51d30c15",
  occurrenceDelta: -5,
  uniqueValueDelta: -1,
  source: "client/game/viewmodelRig.ts#socketed-first-person-rig",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_GAME_SCREENSHOT_DELTA = Object.freeze({
  previousOccurrences: 1_145,
  previousUniqueValues: 106,
  previousSourceFingerprint: "a0377d7ee28c815e6f87b80a0bcb914319f1ddb58a57c1ba36aec9a6435a1fc0",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  addedOccurrenceValue: "image/png",
  sources: Object.freeze([
    "client/game/voxelEngine.ts",
    "client/singleplayer/gameScreenshot.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_SCREENSPACE_ITEM_DELTA = Object.freeze({
  previousOccurrences: 1_146,
  previousUniqueValues: 106,
  previousSourceFingerprint: "b6a71e41bdcc2506081ff81506f4398ec8561fa0c6f11887879a81dcb63f13a7",
  occurrenceDelta: 2,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/game/firstPersonRenderer.ts",
    "client/game/viewmodelRig.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_THIRD_PERSON_POSE_DELTA = Object.freeze({
  previousOccurrences: 1_148,
  previousUniqueValues: 106,
  previousSourceFingerprint: "499b0ae5a73c5a0bb2e007d2d05d524716eff3180c5b4b86c415e3ad782de276",
  occurrenceDelta: 12,
  uniqueValueDelta: 1,
  sources: Object.freeze([
    "client/components/FirstPersonPoseLab.tsx",
    "client/game/playerRig.ts",
    "client/game/thirdPersonTuning.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_WORLD_LOADING_DELTA = Object.freeze({
  previousOccurrences: 1_160,
  previousUniqueValues: 107,
  previousSourceFingerprint: "4c1784d760ac6a536450371631649c8789b5414df8cf5aa77b9b2b57fec5bb07",
  occurrenceDelta: 5,
  uniqueValueDelta: 0,
  addedOccurrenceValues: Object.freeze(["lc-pointer-capture", "status"]),
  source: "client/singleplayer/SinglePlayerApp.tsx#world-loading-status",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_KEYBOARD_CAPTURE_DELTA = Object.freeze({
  previousOccurrences: 1_165,
  previousUniqueValues: 107,
  previousSourceFingerprint: "d78c720d484f82126a883216f7ace975aeaf24957c5fca8aa30ff36e69e32cac",
  occurrenceDelta: 6,
  uniqueValueDelta: 1,
  sources: Object.freeze([
    "client/gameplayKeyboardCapture.ts",
    "client/runtimeMode.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_REALTIME_MULTIPLAYER_DELTA = Object.freeze({
  previousOccurrences: 1_171,
  previousUniqueValues: 108,
  previousSourceFingerprint: "86d6cdb7d321ee8fe9f67b1f27dc73c2ce3a7a69e2c19c66c40db057e1ab1b2d",
  occurrenceDelta: 18,
  uniqueValueDelta: 5,
  sources: Object.freeze([
    "client/index.tsx",
    "client/runtimeMode.ts",
    "client/realtimeMultiplayer.ts",
    "client/game/remotePlayerRenderer.ts",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
    "client/index.tsx#retired-lakebed-presence-stage",
  ]),
  exclusionChanges: 0,
});
// The lossless visual descriptor pack replaced repeated panel face arguments
// with numeric face indexes. These four values consequently fell below the
// five-use pool floor; the armor slot decoder's known literal additions are
// included in the exact net occurrence delta. Keep this explicit so a later
// manifest update cannot be mistaken for an unexplained copy/wire change.
export const COMPACT_CLIENT_REPEATED_VISUAL_DESCRIPTOR_DELTA = Object.freeze({
  previousOccurrences: 1_116,
  previousUniqueValues: 101,
  occurrenceDelta: -38,
  uniqueValueDelta: -4,
  removedThresholdValues: Object.freeze(["left", "right", "back", "top"]),
});
// The strict player-skin persistence boundary spells its ordered storage keys
// once in source. `version` was already in the repeated pool, so this adds one
// reviewed occurrence and no new value; the syntax exclusions are unchanged.
export const COMPACT_CLIENT_REPEATED_SKIN_STORAGE_DELTA = Object.freeze({
  previousOccurrences: 1_078,
  previousUniqueValues: 97,
  previousSourceFingerprint: "feb7d603973a269e0cef296a611046e0efed301e1ec2b91ad9c70c10afcd4aa7",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  addedOccurrenceValue: "version",
  source: "client/game/playerSkin.ts#PLAYER_SKIN_STORAGE_KEYS",
  exclusionChanges: 0,
});
// Replacing the six-key array with two computed boundary keys preserves the
// same literal wire schema while removing its extra already-pooled `version`.
export const COMPACT_CLIENT_REPEATED_SKIN_STORAGE_CODEC_DELTA = Object.freeze({
  previousOccurrences: 1_079,
  previousUniqueValues: 97,
  previousSourceFingerprint: "6d79b29dbcec52e56550534dd0a881ffb0b97df240e83ef16cc5734689c09452",
  occurrenceDelta: -1,
  uniqueValueDelta: 0,
  removedOccurrenceValue: "version",
  source: "client/game/playerSkin.ts#PLAYER_SKIN_STORAGE_KEYS",
  exclusionChanges: 0,
});
// Restoring the canonical held-block projection and its isolated legacy arm
// path adds one reviewed repeated value and five eligible occurrences. This is
// pinned separately so the visual regression fix cannot silently broaden the
// production string-pool transform in a later refactor.
export const COMPACT_CLIENT_REPEATED_HELD_BLOCK_RESTORE_DELTA = Object.freeze({
  previousOccurrences: 1_078,
  previousUniqueValues: 97,
  previousSourceFingerprint: "feb7d603973a269e0cef296a611046e0efed301e1ec2b91ad9c70c10afcd4aa7",
  occurrenceDelta: 5,
  uniqueValueDelta: 1,
  promotedThresholdValue: "rightArm",
  source: "client/game/firstPersonSkinRenderer.ts#buildFirstPersonSkinArmGeometry",
  exclusionChanges: 0,
});
// Atlas-backed block icons now rebuild from the production atlas instead of
// carrying redundant serialized runs. The runtime rasterizer promotes `top`
// over the repeated-pool threshold and adds seven reviewed uses.
export const COMPACT_CLIENT_REPEATED_ATLAS_ICON_RUNTIME_DELTA = Object.freeze({
  previousOccurrences: 1_085,
  previousUniqueValues: 98,
  previousSourceFingerprint: "3b7a3dbfcd1bf6ff9dc1c4456f33ddfe9719d69da8c9f2949b574a62cf495699",
  occurrenceDelta: 7,
  uniqueValueDelta: 1,
  promotedThresholdValue: "top",
  source: "client/components/atlasBlockItemIcon.ts#atlasBlockItemIconRuns",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_DAYLIGHT_CONFIRMATION_DELTA = Object.freeze({
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "21d654d522cbbafe7d697733720c2c2abcb4ac0baa31a9255e061c9eb7f97ce9",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  addedOccurrenceValue: "system",
  source: "client/singleplayer/SinglePlayerApp.tsx#submitLocalCommand",
  exclusionChanges: 0,
});
// Retain the independently reviewed sampled-audio delta as provenance. The
// integrated live-set checkpoint below is recomputed after all realism heads.
export const COMPACT_CLIENT_REPEATED_SOUND_RUNTIME_DELTA = Object.freeze({
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "bc6ee9a11b728887fed6d97278975fc3db815d2ad34db6de94b7a48f752fccad",
  occurrenceDelta: -12,
  uniqueValueDelta: 1,
  source: "client/game/audio.ts#official sampled audio",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_MOB_TEXTURE_DELTA = Object.freeze({
  previousOccurrences: 1_092,
  previousUniqueValues: 99,
  previousSourceFingerprint: "bc6ee9a11b728887fed6d97278975fc3db815d2ad34db6de94b7a48f752fccad",
  occurrenceDelta: 56,
  uniqueValueDelta: 7,
  source: "client/game/mobRenderer.ts#exact-textured-model-dispatch",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_REPEATED_MOB_TEXTURE_LIFECYCLE_DELTA = Object.freeze({
  previousOccurrences: 1_148,
  previousUniqueValues: 106,
  previousSourceFingerprint: "ce3b7181b6c75c183e201096398d2c62a4017a56fe092a659bb9fff645dd4c8b",
  occurrenceDelta: 3,
  uniqueValueDelta: 0,
  source: "client/game/mobRenderer.ts#mob-texture-lifecycle",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES = 621;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES = 184;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT = "45aaa964dd621f281ac5b1a7e5db2a1a1497fc126b5031b39a80224155494dbb";
export const COMPACT_CLIENT_LOW_FREQUENCY_TITLE_HOTBAR_DELTA = Object.freeze({
  previousOccurrences: 612,
  previousUniqueValues: 181,
  previousSourceFingerprint: "c2c7aac3b8580f8a09f5839e52e90f64a1bd0dfdf933364317e09a3761498bdd",
  occurrenceDelta: 3,
  uniqueValueDelta: 1,
  source: "generated WebP title and installed Minecraft hotbar data-image integration",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_INVENTORY_POLISH_DELTA = Object.freeze({
  previousOccurrences: 615,
  previousUniqueValues: 182,
  previousSourceFingerprint: "2810fe17fb80b69319ae079c4cd3b31fe4756dc8b1ce864843aea47d972e4e57",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  source: "home production URL placement",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_BIOME_DELTA = Object.freeze({
  previousOccurrences: 616, previousUniqueValues: 182,
  previousSourceFingerprint: "f1b64c7bcfd64461398a37871b2adf58a5ab0170c1e94cc040b7dcc932437143",
  occurrenceDelta: 5, uniqueValueDelta: 2,
  source: "versioned biomes, water, and Creative natural decorations", exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_REMOTE_MOB_ASSET_DELTA = Object.freeze({
  previousOccurrences: 609,
  previousUniqueValues: 180,
  previousSourceFingerprint: "3ae5ecba7416654837202a8e46ceb71d2820795d71ff51c77fa23df5d53e7c7d",
  occurrenceDelta: 3,
  uniqueValueDelta: 1,
  source: "remote mob-atlas fetch and integrity validation",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_MINECRAFT_PARITY_DELTA = Object.freeze({
  previousOccurrences: 548,
  previousUniqueValues: 161,
  previousSourceFingerprint: "d6db9021f609ad28ec947dd4b5f35a3edb74393f7aa3ba2af155aabe42ac5037",
  occurrenceDelta: 21,
  uniqueValueDelta: 6,
  sources: Object.freeze([
    "client/components/OptionsDialog.tsx",
    "client/game/audio.ts",
    "client/game/voxelEngine.ts",
    "client/index.tsx",
    "client/lobby/TitlePanorama.tsx",
    "client/realtimeMultiplayer.ts",
  ]),
  source: "low-frequency Minecraft-parity controls, sound categories, panorama, readiness, and mob feedback",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_CATALOG_AUTHORITY_DELTA = Object.freeze({
  previousOccurrences: 569,
  previousUniqueValues: 167,
  previousSourceFingerprint: "51eb5564c2df42f89f29270f61e81f91de2c34cee42fd9cce7ef57fbca9c0358",
  occurrenceDelta: 40,
  uniqueValueDelta: 13,
  sources: Object.freeze([
    "shared/expandedBuildingCatalog.ts",
    "shared/game.ts",
    "client/index.tsx",
  ]),
  source: "expanded slab/stair catalog plus Railway-owned inventory and combat envelopes",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_CREATIVE_PARITY_DELTA = Object.freeze({
  previousOccurrences: 422,
  previousUniqueValues: 124,
  previousSourceFingerprint: "4d18861dcc8003dd60734bfc1ea1efdc2c67cf3a2f2876c27616582bc1e525e3",
  occurrenceDelta: 21,
  uniqueValueDelta: 6,
  source: "creative building shapes, torch states, and complete chunk handshake",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_SHAPED_ICON_RUNTIME_DELTA = Object.freeze({
  previousOccurrences: 443,
  previousUniqueValues: 130,
  previousSourceFingerprint: "81be82b4bbe147ab11c8bc660502d859376a46e6b66f14a946d155dfaf70c25d",
  occurrenceDelta: -3,
  uniqueValueDelta: -1,
  source: "client/components/atlasBlockItemIcon.ts#runtime-shaped-icons",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_BUILDING_CATALOG_DELTA = Object.freeze({
  previousOccurrences: 440,
  previousUniqueValues: 129,
  previousSourceFingerprint: "7ac4e3324c2c5cb4225acc400eb3391f5601e3e9bd20ae85c69d7dd9e48c0800",
  occurrenceDelta: 109,
  uniqueValueDelta: 32,
  source: "expanded exact-texture woods, masonry, stairs, slabs, doors, and connected glass",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_THIN_DOOR_LEAVES_DELTA = Object.freeze({
  previousOccurrences: 549,
  previousUniqueValues: 161,
  previousSourceFingerprint: "d996e9bb20051d508e1552ccfc60d8ce5e3423879a0be3b87c906ba1cf515ac9",
  occurrenceDelta: -1,
  uniqueValueDelta: 0,
  valueDeltas: Object.freeze({ "_door_": -4, "_leaves": 3 }),
  source: "client/game/skyExposure.ts#expanded-leaf-cache-and-thin-directional-doors",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_POINTER_RECAPTURE_DELTA = Object.freeze({
  previousOccurrences: 418,
  previousUniqueValues: 123,
  previousSourceFingerprint: "6e2c8fac874a078698938db7e00bcaf50db718586401f4a2ef45934b5e6f07e5",
  occurrenceDelta: -1,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/gameplay/pointerSession.ts",
    "client/singleplayer/SinglePlayerApp.tsx",
    "client/index.tsx",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_SURVIVAL_FEEDBACK_DELTA = Object.freeze({
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "618055f119146b1623ea7c6b19db5534cdafcbd7267c13a39788c2608f7e7b92",
  occurrenceDelta: 3,
  uniqueValueDelta: 1,
  sources: Object.freeze(["client/index.tsx", "client/realtimeMultiplayer.ts", "client/game/avatar.ts"]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_ITEM_CONSERVATION_DELTA = Object.freeze({
  previousOccurrences: 420,
  previousUniqueValues: 124,
  previousSourceFingerprint: "40fa344c169840d827d4c54fd88899b811b141464810b4159a488cf9fa495e3f",
  occurrenceDelta: 0,
  uniqueValueDelta: 0,
  source: "client/index.tsx#durable-placement-and-world-item-actions",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_LOCAL_DROP_OWNER_DELTA = Object.freeze({
  previousOccurrences: 420,
  previousUniqueValues: 124,
  previousSourceFingerprint: "6e0048fcf397cb87fe16cda84341df704070cb775b64fa2fc95b5decc779be03",
  occurrenceDelta: 2,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/singleplayer/SinglePlayerApp.tsx",
    "client/singleplayer/localDroppedItems.ts",
    "client/singleplayer/localSave.ts",
    "client/realtimeMultiplayer.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_PVP_DELTA = Object.freeze({
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "f0809d16908c2692d7b076caefccb44f3b34e112015943229a42c2d1a525c894",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  sources: Object.freeze(["client/index.tsx", "client/realtimeMultiplayer.ts"]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_SHARED_GAMEPLAY_DELTA = Object.freeze({
  previousOccurrences: 415,
  previousUniqueValues: 121,
  previousSourceFingerprint: "80507b569cbea80abb96e1c522d53ea7443504e1cddcda5e24b17a30f3c83551",
  occurrenceDelta: 2,
  uniqueValueDelta: 2,
  sources: Object.freeze([
    "client/gameplay/authority.ts",
    "client/gameplay/engine.ts",
    "client/gameplay/pointerSession.ts",
    "client/gameplay/presentation.ts",
    "client/index.tsx#retired-lakebed-world-authority",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_REALISM_STACK_DELTA = Object.freeze({
  previousOccurrences: 378,
  previousUniqueValues: 111,
  previousSourceFingerprint: "1424b040b100812c4fabcc53e85bc57c28bde52eb82017a5033f863f74d40144",
  occurrenceDelta: 39,
  uniqueValueDelta: 12,
  sources: Object.freeze(["official-sounds", "exact-mobs", "mob-texture-lifecycle"]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_VIEWMODEL_RIG_DELTA = Object.freeze({
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "59a53008712a865933bf38cab63513e8e402063969b0a3c3c46a86bbf0f89aea",
  occurrenceDelta: 4,
  uniqueValueDelta: 1,
  source: "client/game/viewmodelRig.ts#socketed-first-person-rig",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_GAME_SCREENSHOT_DELTA = Object.freeze({
  previousOccurrences: 421,
  previousUniqueValues: 124,
  previousSourceFingerprint: "8b9e5a8c413a5adbe3362b19d25050c787a55996d87025c8575a7cb6844cfa33",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  source: "client/singleplayer/gameScreenshot.ts#downloadGameScreenshot",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_SCREENSPACE_ITEM_DELTA = Object.freeze({
  previousOccurrences: 422,
  previousUniqueValues: 124,
  previousSourceFingerprint: "012841fabaab73e046841bb88df3121c46ce64864c181a60be011a3a5065202c",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/game/firstPersonRenderer.ts",
    "client/game/viewmodelRig.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_THIRD_PERSON_POSE_DELTA = Object.freeze({
  previousOccurrences: 423,
  previousUniqueValues: 124,
  previousSourceFingerprint: "3457aabb8418a084469bac754991b36aad16956b126c00a0b1dfb538e5497127",
  occurrenceDelta: -2,
  uniqueValueDelta: 0,
  sources: Object.freeze([
    "client/components/FirstPersonPoseLab.tsx",
    "client/game/playerRig.ts",
    "client/game/thirdPersonFacing.ts",
    "client/game/thirdPersonTuning.ts",
  ]),
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_KEYBOARD_CAPTURE_DELTA = Object.freeze({
  previousOccurrences: 421,
  previousUniqueValues: 124,
  previousSourceFingerprint: "88ddadf7ef0b315a78332300101a18977434e5629352bf7770fe03fbbae837aa",
  occurrenceDelta: -4,
  uniqueValueDelta: -1,
  promotedThresholdValue: "function",
  source: "client/gameplayKeyboardCapture.ts#browser-capability-guards",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_REALTIME_MULTIPLAYER_DELTA = Object.freeze({
  previousOccurrences: 417,
  previousUniqueValues: 123,
  previousSourceFingerprint: "2aeb3e07af4ac865b0ba8beb418788cf7b833879e790cfbbc5d651168d1ff1d5",
  occurrenceDelta: -2,
  uniqueValueDelta: -2,
  sources: Object.freeze([
    "client/index.tsx",
    "client/runtimeMode.ts",
    "client/realtimeMultiplayer.ts",
    "client/game/remotePlayerRenderer.ts",
    "client/singleplayer/SinglePlayerApp.tsx#retired-debug-surface",
    "client/MultiplayerSegmentTransport.tsx#retired-from-production-bundle",
  ]),
  exclusionChanges: 0,
});
// Painting the cached GUI block raster introduces the client's third `2d`
// context request. That existing API literal consequently enters the exact
// three/four-use pool; no UI, wire, storage, or gameplay value is added.
export const COMPACT_CLIENT_LOW_FREQUENCY_BLOCK_CANVAS_DELTA = Object.freeze({
  previousOccurrences: 371,
  previousUniqueValues: 109,
  previousSourceFingerprint: "51c27dce84789a33f5c2530c81b45222714f2c9c518bb54fca9f4b2c5ed9850f",
  occurrenceDelta: 3,
  uniqueValueDelta: 1,
  promotedValue: "2d",
  source: "client/components/ItemGlyph.tsx#paintAtlasBlockIcon",
  exclusionChanges: 0,
});
// The immutable foundation is a world/protocol identity, never an ItemId.
// Its four remaining runtime spellings enter only the low-frequency pool;
// item, icon, held-cube, creative, and placement adapters stay absent.
export const COMPACT_CLIENT_LOW_FREQUENCY_BEDROCK_WORLD_DELTA = Object.freeze({
  previousOccurrences: 374,
  previousUniqueValues: 110,
  previousSourceFingerprint: "922b39a38e005f3013436f6aef0a8d35dfdb942e54f950c8195316922006514e",
  occurrenceDelta: 4,
  uniqueValueDelta: 1,
  promotedValue: "bedrock",
  source: "world-only terrain/protocol adapters",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_SOUND_RUNTIME_DELTA = Object.freeze({
  previousOccurrences: 371,
  previousUniqueValues: 109,
  previousSourceFingerprint: "51c27dce84789a33f5c2530c81b45222714f2c9c518bb54fca9f4b2c5ed9850f",
  occurrenceDelta: 32,
  uniqueValueDelta: 10,
  source: "client/game/audio.ts#official sampled audio",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_DELTA = Object.freeze({
  previousOccurrences: 374,
  previousUniqueValues: 110,
  previousSourceFingerprint: "922b39a38e005f3013436f6aef0a8d35dfdb942e54f950c8195316922006514e",
  occurrenceDelta: 22,
  uniqueValueDelta: 7,
  source: "client/game/mobRenderer.ts#mob-texture-program",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_LOW_FREQUENCY_MOB_TEXTURE_LIFECYCLE_DELTA = Object.freeze({
  previousOccurrences: 396,
  previousUniqueValues: 117,
  previousSourceFingerprint: "7545fcec4903261ac65a6902101edd1da274e70c3740d5194840674bf13d967b",
  occurrenceDelta: 6,
  uniqueValueDelta: 2,
  source: "client/game/mobRenderer.ts#createMobTexture",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_VALUES = Object.freeze([
  "$.world.worldId", "alertdialog", "assertive", "beforeunload",
  "behaviorUntilSeconds", "checksum_mismatch", "chestplate",
  "contextmenu", "crafting_table_front", "crafting_table_side", "crafting_table_top",
  "createdAt", "deathUntil", "duplicate", "equipment", "expectedBlock",
  "expectedChunkRevision", "expectedInventoryRevision", "first_person", "furnace_front",
  "furnace_side", "furnace_top", "fuseStartedAtSeconds", "fuseUntilSeconds",
  "ineligible", "invalid_coordinate", "invalid_count", "invalid_equipment", "invalid_grid",
  "invalid_slot", "invalid_transaction_cleared", "miningHit", "mousemove",
  "multiplayer", "nextContactDamageAtSeconds", "nextRangedAttackAtSeconds",
  "no_recipe", "noncanonical_envelope", "pointerlockerror",
  "raw_chicken", "respawnPoint", "rotten_flesh", "selectedHotbar", "shapeless", "sheep_wool",
  "spiderUntil", "stale_registry", "storage_verify_failed", "storage_write_failed", "sunDamageAt", "targetKind",
  "tnt_bottom", "unsafe_existing_data", "velocityX", "velocityZ", "world-mode", "world-seed", "world-title",
  "world_changed", "world_create_transaction_pending", "world_delete_cleanup_pending",
  "world_delete_transaction_pending",
]);
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES = 124;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES = 62;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_PATH = "closed compact client bundle";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT = "dee0ce7f3ce28c9c9f951c5e1d14fa496b28498c150417914e736165eddb9d00";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_TITLE_DELTA = Object.freeze({
  previousOccurrences: 126,
  previousUniqueValues: 63,
  previousSourceFingerprint: "90c37a81e3829a35c17f402ab15f0ddd0b4d4cd73fee917fd2c2414002c43db1",
  occurrenceDelta: -2,
  uniqueValueDelta: -1,
  removedValue: "craft.lakebed.app",
  source: "requested removal of the title-screen Lakecraft footer",
  exclusionChanges: 0,
});
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_MINECRAFT_PARITY_DELTA = Object.freeze({
  previousOccurrences: 140,
  previousUniqueValues: 70,
  previousSourceFingerprint: "9589bee90a9ec4eb168fac5d95d1ad920f349612250851c9181d34aef4604d12",
  occurrenceDelta: -14,
  uniqueValueDelta: -7,
  removedValues: Object.freeze([
    "ControlLeft", "ControlRight", "crispEdges", "grass_side", "grass_top", "mousedown", "oak_log_end",
  ]),
  source: "remappable control bindings and atlas-backed presentation remove obsolete exact-two literals",
  exclusionChanges: 0,
});
// Gameplay modes and local persistence outcomes form a closed internal
// identity boundary. Only strict comparison operands and switch cases may
// enter this pool: JSX/DOM values, object keys, payload strings, and UI copy
// remain outside it even if they happen to share one of these spellings.
export const COMPACT_CLIENT_FIXED_IDENTITY_VALUES = Object.freeze([
  "creative",
  "survival",
  "loaded",
  "recovered",
  "corrupt",
  "unsupported",
  "empty",
]);
export const COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES = 63;
export const COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES = 7;
export const COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES = 1;
export const COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_COUNTS = Object.freeze({
  creative: 33,
  survival: 10,
  loaded: 3,
  recovered: 3,
  corrupt: 5,
  unsupported: 6,
  empty: 3,
});
export const COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT = "2a5f101f64a96b509af2bee05aa324640d9129039c27630d519848b90f10b26e";
export const COMPACT_CLIENT_FIXED_IDENTITY_SHARED_GAMEPLAY_DELTA = Object.freeze({
  previousOccurrences: 68,
  previousUniqueValues: 7,
  previousSourceFingerprint: "f2833987c112d9130537ed25d21ae7e942d0f7ac3812cefa6c6b2f3d52cfdef6",
  occurrenceDelta: -5,
  uniqueValueDelta: 0,
  source: "shared gameplay authority replacing duplicated multiplayer creative branches",
});
export const COMPACT_CLIENT_FIXED_IDENTITY_SURVIVAL_FEEDBACK_DELTA = Object.freeze({
  previousOccurrences: 63,
  previousUniqueValues: 7,
  previousSourceFingerprint: "358cf0997bf825646abdd7792dbb7a58347210c5925ca1548979416c4456f5c2",
  occurrenceDelta: 0,
  uniqueValueDelta: 0,
  source: "Railway inventory authority removes the Lakebed survival-pack reload branch",
});
export const COMPACT_CLIENT_FIXED_IDENTITY_MINECRAFT_PARITY_DELTA = Object.freeze({
  previousOccurrences: 63,
  previousUniqueValues: 7,
  previousSourceFingerprint: "232b8a8f4fe5784bbe9d910ab52110a277ba42dc0d4feab04dcdfd4062a517f3",
  occurrenceDelta: 1,
  uniqueValueDelta: 0,
  valueDeltas: Object.freeze({ empty: 1 }),
  source: "authoritative multiplayer snapshot validation adds one explicit empty-state identity branch",
});
export const COMPACT_CLIENT_FIXED_IDENTITY_REPLAY_DELTA = Object.freeze({
  previousOccurrences: 64,
  previousUniqueValues: 7,
  previousSourceFingerprint: "19d8ab4b7769370db5ae8aa0140aa805c1dd4558ca753978595c1d153f047a1e",
  occurrenceDelta: -1,
  uniqueValueDelta: 0,
  valueDeltas: Object.freeze({ creative: -1 }),
  source: "monotonic Railway block replay removes one retired local Creative rollback identity branch",
});
// WebGL uniform names are a closed API boundary between authored shader text
// and `getUniformLocation`. Keep this semantic category separate from the
// generic frequency floors: attributes, DOM/UI text, wire values, and newly
// introduced uniforms must never enter it implicitly.
export const COMPACT_CLIENT_WEBGL_UNIFORM_VALUES = Object.freeze([
  "uMvp",
  "uSkin",
  "uAtlas",
  "uLight",
  "uCamera",
  "uFogEnabled",
  "uFogRange",
  "uFogColor",
  "uAmbientColor",
  "uDirectionalColor",
  "uAmbientIntensity",
  "uDirectionalIntensity",
  "uSkyExposure",
  "uTorchLights[0]",
]);
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES = 54;
export const COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES = 46;
export const COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES = 14;
export const COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS = Object.freeze({
  uMvp: 10,
  uSkin: 4,
  uAtlas: 3,
  uLight: 7,
  uCamera: 3,
  uFogEnabled: 3,
  uFogRange: 3,
  uFogColor: 3,
  uAmbientColor: 3,
  uDirectionalColor: 3,
  uAmbientIntensity: 3,
  uDirectionalIntensity: 3,
  uSkyExposure: 3,
  "uTorchLights[0]": 3,
});
export const COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_COUNTS = Object.freeze({
  uMvp: 9,
  uSkin: 2,
  uAtlas: 2,
  uLight: 3,
  uCamera: 3,
  uFogEnabled: 3,
  uFogRange: 3,
  uFogColor: 3,
  uAmbientColor: 3,
  uDirectionalColor: 3,
  uAmbientIntensity: 3,
  uDirectionalIntensity: 3,
  uSkyExposure: 3,
  "uTorchLights[0]": 3,
});
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT = "3ecfd0ea9ca3887fbd141fb623876c2205be8e47280ad069caba81427c951d0e";
// uMvp and uLight already qualify for the generic pools. The category is
// unioned by occurrence, preserving their existing indexes and adding only
// the remaining 22 occurrences / 11 values.
export const COMPACT_CLIENT_WEBGL_UNIFORM_INCREMENTAL_OCCURRENCES = 32;
export const COMPACT_CLIENT_WEBGL_UNIFORM_INCREMENTAL_UNIQUE_VALUES = 11;
export const COMPACT_CLIENT_STRING_OCCURRENCES = COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES
  + COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES + COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES
  + COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES + COMPACT_CLIENT_WEBGL_UNIFORM_INCREMENTAL_OCCURRENCES
  + COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES;
export const COMPACT_CLIENT_STRING_UNIQUE_VALUES = COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES
  + COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES + COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES
  + COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES + COMPACT_CLIENT_WEBGL_UNIFORM_INCREMENTAL_UNIQUE_VALUES
  + COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES;

let typescriptPromise;
async function typescript() {
  if (typescriptPromise) return typescriptPromise;
  typescriptPromise = (async () => {
    const cacheRoot = join(homedir(), ".npm", "_npx");
    const candidates = [];
    for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(cacheRoot, entry.name, "node_modules", "typescript", "lib", "typescript.js");
      try {
        await access(path);
        candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
      } catch {}
    }
    candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
    if (!candidates[0]) throw new Error("Compact client string audit requires Lakebed's cached TypeScript runtime.");
    return import(pathToFileURL(candidates[0].path).href);
  })();
  return typescriptPromise;
}

function fail(message) {
  throw new Error(`Unsafe compact client string transform: ${message}`);
}

function compressStaticBytes(bytes) {
  const packed = [];
  for (let index = 0; index < bytes.length;) {
    const control = packed.length;
    packed.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && index < bytes.length; bit += 1) {
      let length = 0;
      let distance = 0;
      for (let source = Math.max(0, index - 4_095); source < index; source += 1) {
        let candidate = 0;
        while (candidate < 273 && index + candidate < bytes.length
          && bytes[source + candidate] === bytes[index + candidate]) candidate += 1;
        if (candidate > length) {
          length = candidate;
          distance = index - source;
        }
      }
      if (length >= 3) {
        flags |= 1 << bit;
        const value = (Math.min(length, 18) - 3) * 4_096 + distance;
        if (length >= 18) packed.push(value >> 8, value & 255, length - 18);
        else packed.push(value >> 8, value & 255);
        index += length;
      } else packed.push(bytes[index++]);
    }
    packed[control] = flags;
  }
  return new Uint8Array(packed);
}

// Kept self-contained because its source is injected into the production-only
// stage. The same function is used at build time to prove byte-exact decoding.
function decodeClientStringPool(source, size, packedSize) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.-:+=^!/*?&<>()[]{}@%$#_,";
  const packed = new Uint8Array(packedSize);
  let packedOffset = 0;
  for (let offset = 0; offset < source.length && packedOffset < packedSize; offset += 5) {
    let value = 0;
    for (let index = 0; index < 5; index += 1) value = value * 85 + alphabet.indexOf(source[offset + index]);
    for (let shift = 24; shift >= 0 && packedOffset < packedSize; shift -= 8) packed[packedOffset++] = value >>> shift & 255;
  }
  if (packedOffset !== packedSize) throw new Error("Invalid client string pool.");
  const data = new Uint8Array(size);
  let target = 0;
  for (let cursor = 0; cursor < packed.length && target < size;) {
    const flags = packed[cursor++];
    for (let bit = 0; bit < 8 && cursor < packed.length && target < size; bit += 1) {
      if (flags & 1 << bit) {
        const value = packed[cursor++] * 256 + packed[cursor++];
        let length = (value >> 12) + 3;
        if (length === 18) length += packed[cursor++];
        const distance = value & 4_095;
        if (distance < 1 || distance > target || target + length > size) throw new Error("Invalid client string pool.");
        for (let copy = 0; copy < length; copy += 1) data[target] = data[target++ - distance];
      } else data[target++] = packed[cursor++];
    }
  }
  if (target !== size) throw new Error("Invalid client string pool.");
  return data;
}

function isHumanFacing(value) {
  return value.length >= 4 && value.length <= 240 && /[A-Za-z]/.test(value)
    && (/\s/.test(value) || /[!?()'",]/.test(value) || /^[A-Z][a-z]{3,19}$/.test(value));
}

function isSyntaxExcluded(ts, node) {
  const parent = node.parent;
  if (!parent) return true;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if (ts.isExpressionStatement(parent) && parent.expression === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node) return true;
  if ((ts.isElementAccessExpression(parent) || ts.isElementAccessChain(parent)) && parent.argumentExpression === node) return true;
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  return false;
}

function isIdentityOrWireExcluded(ts, node) {
  let parent = node.parent;
  if (!parent) return true;
  if (ts.isCaseClause(parent) || ts.isBinaryExpression(parent) || ts.isSwitchStatement(parent)
      || ts.isComputedPropertyName(parent)) return true;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))) parent = parent.parent;
  if (parent && ts.isCallExpression(parent)) {
    const expression = parent.expression;
    if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isPropertyAccessExpression(expression)) {
      const owner = expression.expression.getText();
      const name = expression.name.text;
      if ((owner === "JSON" && (name === "parse" || name === "stringify"))
        || name === "withIndex" || name === "index" || name === "id") return true;
    }
  }
  return false;
}

function isGetUniformLocationName(ts, node) {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[1] !== node) return false;
  const expression = call.expression;
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "getUniformLocation";
}

function fixedIdentityContext(ts, node) {
  const parent = node.parent;
  if (parent && ts.isBinaryExpression(parent) && (parent.left === node || parent.right === node)) {
    const operator = parent.operatorToken.kind;
    if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken
      || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
      return `BinaryExpression:${ts.SyntaxKind[operator]}:${parent.left === node ? "left" : "right"}`;
    }
  }
  return parent && ts.isCaseClause(parent) && parent.expression === node
    ? "CaseClause:expression"
    : null;
}

export async function analyzeClientStringPool(source) {
  const ts = await typescript();
  const sourceFile = ts.createSourceFile(
    "lakecraft-client-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const literalOccurrences = [];
  const eligibleOccurrences = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const occurrence = {
        context: fixedIdentityContext(ts, node),
        end: node.end,
        kind: ts.SyntaxKind[node.kind],
        node,
        raw: source.slice(node.getStart(sourceFile), node.end),
        start: node.getStart(sourceFile),
        value: node.text,
      };
      literalOccurrences.push(occurrence);
      if (!isSyntaxExcluded(ts, node) && !isIdentityOrWireExcluded(ts, node)) {
        eligibleOccurrences.push(occurrence);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const eligibleCounts = new Map();
  for (const occurrence of eligibleOccurrences) {
    eligibleCounts.set(occurrence.value, (eligibleCounts.get(occurrence.value) ?? 0) + 1);
  }
  const humanOccurrences = eligibleOccurrences.filter(({ value }) => isHumanFacing(value));
  const repeatedOccurrences = eligibleOccurrences.filter(({ value }) => !isHumanFacing(value)
    && value.length >= 3 && (eligibleCounts.get(value) ?? 0) >= 5);
  const lowFrequencyOccurrences = eligibleOccurrences.filter(({ value }) => !isHumanFacing(value)
    && value.length >= 3 && (eligibleCounts.get(value) ?? 0) >= 3 && (eligibleCounts.get(value) ?? 0) < 5);
  const fixedFrequencyTwoSet = new Set(COMPACT_CLIENT_FIXED_FREQUENCY_TWO_VALUES);
  const fixedFrequencyTwoOccurrences = eligibleOccurrences.filter(({ value }) => fixedFrequencyTwoSet.has(value)
    && (eligibleCounts.get(value) ?? 0) === 2);
  const fixedIdentitySet = new Set(COMPACT_CLIENT_FIXED_IDENTITY_VALUES);
  const fixedIdentityOccurrences = literalOccurrences.filter(({ context, value }) => context !== null
    && fixedIdentitySet.has(value));
  const webglUniformSet = new Set(COMPACT_CLIENT_WEBGL_UNIFORM_VALUES);
  const webglUniformOccurrences = eligibleOccurrences.filter((occurrence) => webglUniformSet.has(occurrence.value)
    && isGetUniformLocationName(ts, occurrence.node));
  const selected = new Set([...humanOccurrences, ...repeatedOccurrences, ...lowFrequencyOccurrences]);
  const beforeFixedIdentity = [
    ...eligibleOccurrences.filter((candidate) => selected.has(candidate)),
    ...fixedFrequencyTwoOccurrences,
    ...webglUniformOccurrences,
  ];
  const valuesBeforeFixedIdentity = new Set(beforeFixedIdentity.map(({ value }) => value));
  const fixedIdentityIncrementalUniqueValues = new Set(fixedIdentityOccurrences
    .filter(({ value }) => !valuesBeforeFixedIdentity.has(value)).map(({ value }) => value)).size;
  // Append this closed category so all existing pool indexes remain stable.
  // It is deliberately not a general frequency-two threshold.
  const occurrences = [];
  const included = new Set();
  for (const occurrence of [
    ...beforeFixedIdentity,
    ...fixedIdentityOccurrences,
  ]) {
    if (!included.has(occurrence)) {
      included.add(occurrence);
      occurrences.push(occurrence);
    }
  }

  function category(records, includeContext = false) {
    const values = [];
    const indexes = new Map();
    const counts = [];
    for (const occurrence of records) {
      let index = indexes.get(occurrence.value);
      if (index === undefined) {
        index = values.length;
        indexes.set(occurrence.value, index);
        values.push(occurrence.value);
        counts.push(0);
      }
      counts[index] += 1;
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      values: values.map((value, index) => [value, counts[index]]),
      occurrences: records.map(({ context, kind, value }) => includeContext
        ? [kind, context, value]
        : [kind, value]),
    })).digest("hex");
    return { counts, fingerprint, occurrences: records, values };
  }

  const values = [];
  const indexes = new Map();
  const counts = [];
  for (const occurrence of occurrences) {
    let index = indexes.get(occurrence.value);
    if (index === undefined) {
      index = values.length;
      indexes.set(occurrence.value, index);
      values.push(occurrence.value);
      counts.push(0);
    }
    counts[index] += 1;
    occurrence.index = index;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    values: values.map((value, index) => [value, counts[index]]),
    occurrences: occurrences.map(({ kind, value }) => [kind, value]),
  })).digest("hex");
  return {
    counts,
    fingerprint,
    fixedIdentity: category(fixedIdentityOccurrences, true),
    fixedIdentityIncrementalUniqueValues,
    fixedFrequencyTwo: category(fixedFrequencyTwoOccurrences),
    human: category(humanOccurrences),
    lowFrequency: category(lowFrequencyOccurrences),
    occurrences,
    repeated: category(repeatedOccurrences),
    values,
    webglUniform: category(webglUniformOccurrences),
  };
}

export async function compactClientStringPool(source, expected = {
  human: {
    occurrences: COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT,
  },
  repeated: {
    occurrences: COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT,
  },
  lowFrequency: {
    occurrences: COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT,
  },
  fixedFrequencyTwo: {
    occurrences: COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT,
  },
  fixedIdentity: {
    occurrences: COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES,
    incrementalUniqueValues: COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT,
  },
  webglUniform: {
    occurrences: COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES,
    uniqueValues: COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES,
    fingerprint: COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT,
  },
}) {
  if (source.includes("__lakecraftClientStrings")) fail("runtime identifier collides with source text");
  const analysis = await analyzeClientStringPool(source);
  for (const category of ["human", "repeated", "lowFrequency", "fixedFrequencyTwo", "webglUniform", "fixedIdentity"]) {
    const actual = analysis[category];
    const boundary = expected[category];
    if (actual.occurrences.length !== boundary.occurrences
      || actual.values.length !== boundary.uniqueValues
      || (category === "fixedIdentity"
        && analysis.fixedIdentityIncrementalUniqueValues !== boundary.incrementalUniqueValues)
      || actual.fingerprint !== boundary.fingerprint) {
      fail(`${category} live set changed; expected ${boundary.occurrences}/${boundary.uniqueValues}/${boundary.fingerprint}, received `
        + `${actual.occurrences.length}/${actual.values.length}/${actual.fingerprint}`
        + (category === "fixedIdentity"
          ? `; incremental unique values ${analysis.fixedIdentityIncrementalUniqueValues}; retained counts ${JSON.stringify(Object.fromEntries(actual.values.map((value, index) => [value, actual.counts[index]])))}` : "")
        + (category === "fixedFrequencyTwo"
          ? `; retained values ${JSON.stringify(actual.values)}` : ""));
    }
  }
  const serialized = JSON.stringify(analysis.values);
  const bytes = new TextEncoder().encode(serialized);
  const packed = compressStaticBytes(bytes);
  const payload = encodeStaticBytes(packed);
  if (STATIC_BYTE_ALPHABET.length !== 85) fail("static byte alphabet changed");
  const decoded = decodeClientStringPool(payload, bytes.length, packed.length);
  if (new TextDecoder().decode(decoded) !== serialized) fail("compressed pool did not round-trip byte-for-byte");

  let output = source;
  const replacements = analysis.occurrences.map(({ start, end, index }) => {
    const needsLeadingTokenBoundary = start > 0 && /[A-Za-z0-9_$]/.test(source[start - 1]);
    return {
      start,
      end,
      text: `${needsLeadingTokenBoundary ? " " : ""}__lakecraftClientStrings[${index}]`,
    };
  }).sort((left, right) => right.start - left.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1].start < replacements[index].end) fail("replacement ranges overlap");
  }
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  if (/[A-Za-z0-9_$]__lakecraftClientStrings/.test(output)) {
    fail("pool replacement merged with an adjacent identifier token");
  }
  const runtime = `const __lakecraftDecodeClientStringPool=${decodeClientStringPool.toString()};`
    + `const __lakecraftClientStrings=JSON.parse(new TextDecoder().decode(`
    + `__lakecraftDecodeClientStringPool(${JSON.stringify(payload)},${bytes.length},${packed.length})));`;
  return `${runtime}${output}`;
}
