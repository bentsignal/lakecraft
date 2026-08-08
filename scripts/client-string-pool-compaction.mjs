import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeStaticBytes, STATIC_BYTE_ALPHABET } from "./static-byte-encoding.mjs";

// This transform runs only on the closed, already-bundled production client.
// The counts and fingerprint are an explicit compatibility boundary: changing
// application copy or making a new literal eligible requires human review.
export const COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES = 605;
export const COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES = 535;
export const COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT = "4d723bdd87b365f87b9d5caa980745c9cdfad905170048bf579e9d6ab33ab125";
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
export const COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES = 1_159;
export const COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES = 107;
export const COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT = "27a4a76bfa1ee2304777777cb541c00f28ea904945dbb92da8e0528a12279d4b";
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
  occurrenceDelta: 11,
  uniqueValueDelta: 1,
  sources: Object.freeze([
    "client/components/FirstPersonPoseLab.tsx",
    "client/game/playerRig.ts",
    "client/game/thirdPersonTuning.ts",
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
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES = 421;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES = 124;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT = "88ddadf7ef0b315a78332300101a18977434e5629352bf7770fe03fbbae837aa";
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
]);
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES = 0;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES = 0;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_PATH = "client/game/mobRenderer.ts";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT = "cfa3e4b33be3208a54931e4f7f35fffc67311b8bfbb872026ecb2eb41642ea9e";
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
export const COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCES = 55;
export const COMPACT_CLIENT_FIXED_IDENTITY_UNIQUE_VALUES = 7;
export const COMPACT_CLIENT_FIXED_IDENTITY_INCREMENTAL_UNIQUE_VALUES = 2;
export const COMPACT_CLIENT_FIXED_IDENTITY_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_COUNTS = Object.freeze({
  creative: 26,
  survival: 10,
  loaded: 3,
  recovered: 3,
  corrupt: 5,
  unsupported: 6,
  empty: 2,
});
export const COMPACT_CLIENT_FIXED_IDENTITY_SOURCE_FINGERPRINT = "61866ec52b9b320d8ca8b23c27f9cdd606541c7593acfd2e05af0e6d815f8bed";
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
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES = 51;
export const COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES = 43;
export const COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES = 14;
export const COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS = Object.freeze({
  uMvp: 9,
  uSkin: 3,
  uAtlas: 3,
  uLight: 6,
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
  uMvp: 6,
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
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT = "ce559ab7f72f92de17c805bcb3415eaed2048d98e203266289ad60836964031b";
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
          ? `; incremental unique values ${analysis.fixedIdentityIncrementalUniqueValues}` : ""));
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
  const replacements = analysis.occurrences.map(({ start, end, index }) => ({
    start, end, text: `__lakecraftClientStrings[${index}]`,
  })).sort((left, right) => right.start - left.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1].start < replacements[index].end) fail("replacement ranges overlap");
  }
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  const runtime = `const __lakecraftDecodeClientStringPool=${decodeClientStringPool.toString()};`
    + `const __lakecraftClientStrings=JSON.parse(new TextDecoder().decode(`
    + `__lakecraftDecodeClientStringPool(${JSON.stringify(payload)},${bytes.length},${packed.length})));`;
  return `${runtime}${output}`;
}
