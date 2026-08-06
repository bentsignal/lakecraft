import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeStaticBytes, STATIC_BYTE_ALPHABET } from "./static-byte-encoding.mjs";

// This transform runs only on the closed, already-bundled production client.
// The counts and fingerprint are an explicit compatibility boundary: changing
// application copy or making a new literal eligible requires human review.
export const COMPACT_CLIENT_HUMAN_STRING_OCCURRENCES = 592;
export const COMPACT_CLIENT_HUMAN_STRING_UNIQUE_VALUES = 524;
export const COMPACT_CLIENT_HUMAN_STRING_SOURCE_FINGERPRINT = "4b95e42effbfeab45644df543a1117fe54b3b058de8d092b5467b72b836079e8";
export const COMPACT_CLIENT_REPEATED_STRING_OCCURRENCES = 1_092;
export const COMPACT_CLIENT_REPEATED_STRING_UNIQUE_VALUES = 99;
export const COMPACT_CLIENT_REPEATED_STRING_SOURCE_FINGERPRINT = "bc6ee9a11b728887fed6d97278975fc3db815d2ad34db6de94b7a48f752fccad";
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
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_OCCURRENCES = 374;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_UNIQUE_VALUES = 110;
export const COMPACT_CLIENT_LOW_FREQUENCY_STRING_SOURCE_FINGERPRINT = "5ab990831e2285f9a25f656f49a082f9568bc162eacdd07f3414e81f92d742b1";
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
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_VALUES = Object.freeze([
  "1.2..21.",
  "2.1..2",
  "2.1.2.",
  "1.....2..1.....2",
  "2......1..2..1..",
  "1....2..2.....1.",
  "2....1...1....2.",
  "1....2..1",
  "2..1....2",
  "121",
]);
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCES = 20;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_UNIQUE_VALUES = 10;
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_PATH = "client/game/mobRenderer.ts";
export const COMPACT_CLIENT_FIXED_FREQUENCY_TWO_SOURCE_FINGERPRINT = "b38c44d8076339edd689f0a89bacdd179deb93977714e287ac89ad215b2653cb";
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
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_OCCURRENCES = 35;
export const COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_OCCURRENCES = 30;
export const COMPACT_CLIENT_WEBGL_UNIFORM_UNIQUE_VALUES = 13;
export const COMPACT_CLIENT_WEBGL_UNIFORM_OCCURRENCE_KIND = "StringLiteral";
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_COUNTS = Object.freeze({
  uMvp: 7,
  uSkin: 3,
  uLight: 5,
  uCamera: 2,
  uFogEnabled: 2,
  uFogRange: 2,
  uFogColor: 2,
  uAmbientColor: 2,
  uDirectionalColor: 2,
  uAmbientIntensity: 2,
  uDirectionalIntensity: 2,
  uSkyExposure: 2,
  "uTorchLights[0]": 2,
});
export const COMPACT_CLIENT_WEBGL_UNIFORM_RETAINED_COUNTS = Object.freeze({
  uMvp: 5,
  uSkin: 2,
  uLight: 3,
  uCamera: 2,
  uFogEnabled: 2,
  uFogRange: 2,
  uFogColor: 2,
  uAmbientColor: 2,
  uDirectionalColor: 2,
  uAmbientIntensity: 2,
  uDirectionalIntensity: 2,
  uSkyExposure: 2,
  "uTorchLights[0]": 2,
});
export const COMPACT_CLIENT_WEBGL_UNIFORM_SOURCE_FINGERPRINT = "4793d6cc11753985a1aa52bbb841ea02da5b5c77f0fc1994101cf85e5bef72fe";
// uMvp and uLight already qualify for the generic pools. The category is
// unioned by occurrence, preserving their existing indexes and adding only
// the remaining 22 occurrences / 11 values.
export const COMPACT_CLIENT_WEBGL_UNIFORM_INCREMENTAL_OCCURRENCES = 22;
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
