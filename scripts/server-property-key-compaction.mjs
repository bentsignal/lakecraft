import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Fixed compatibility manifest for the closed compact server bundle. Values
// are [property-access count, object-key count] in the reviewed first-stage
// minified output. Any drift fails before staging instead of broadening scope.
export const COMPACT_SERVER_KEY_COUNTS = Object.freeze({
  acceptedAt: [5, 7],
  acceptedThrough: [2, 8],
  authoritativeCells: [7, 2],
  beginOperationId: [8, 6],
  behaviorUntilTick: [9, 1],
  blockInstanceToken: [33, 19],
  blockType: [23, 9],
  burnRemainingMs: [13, 4],
  canonicalPlayerStateJson: [3, 3],
  cascadeDepth: [17, 6],
  charge: [25, 6],
  checkpointAt: [8, 12],
  checkpointRevision: [15, 19],
  chunkKey: [15, 14],
  chunkRevision: [7, 5],
  consumed: [8, 10],
  cookProgressMs: [13, 4],
  // Interning keeps the serialized key spelling exact; it only avoids repeating
  // the same source literal throughout the closed server bundle.
  coordKey: [97, 42],
  count: [146, 102],
  craftingContext: [10, 24],
  damage: [11, 15],
  deadUntil: [23, 20],
  direction: [14, 3],
  dropId: [13, 7],
  droppedItems: [18, 2],
  durability: [55, 15],
  durationTicks: [6, 1],
  elapsedSeconds: [3, 4],
  equipment: [17, 11],
  eventId: [42, 23],
  expectedBlock: [13, 3],
  expectedChestUpdatedAt: [4, 1],
  expectedChunkRevision: [7, 3],
  expectedHeldItem: [13, 2],
  expectedInventoryRevision: [15, 5],
  expectedInventoryUpdatedAt: [14, 4],
  expectedRevision: [11, 2],
  expiresAt: [12, 12],
  fingerprint: [41, 42],
  firstSequence: [16, 3],
  furnaces: [7, 1],
  fuseStartedTick: [25, 6],
  fuseUntilTick: [14, 2],
  health: [61, 39],
  heartbeatAt: [36, 13],
  heldBowDurability: [7, 2],
  hunger: [21, 24],
  ignitedAt: [11, 8],
  igniterUserId: [15, 8],
  ignitionId: [19, 10],
  ingredients: [2, 22],
  inputJson: [12, 5],
  inventories: [48, 1],
  inventory: [80, 90],
  inventoryJson: [29, 23],
  inventoryRevision: [10, 8],
  inventorySlot: [9, 1],
  itemId: [113, 112],
  keyframes: [15, 1],
  killed: [10, 14],
  lastAttackAt: [14, 18],
  lastAttackerId: [15, 22],
  lastMaterializedAtMs: [7, 4],
  lastReleasedAt: [14, 8],
  lastSequence: [15, 3],
  leaseExpiresAt: [5, 11],
  leaseId: [10, 5],
  maxDurability: [13, 4],
  maxHealth: [7, 12],
  missReason: [4, 7],
  mobAuthority: [16, 2],
  mobId: [86, 19],
  mobWorldAuthority: [11, 2],
  moveUnitsPerTick: [2, 8],
  nearbyPlayers: [0, 8],
  online: [20, 12],
  operationId: [90, 43],
  output: [21, 36],
  ownerUserId: [13, 10],
  parentEventId: [9, 5],
  playerCombat: [25, 1],
  playerCombatReceipts: [9, 1],
  playerPresence: [45, 1],
  playerState: [8, 4],
  playerStateJson: [20, 14],
  poseSequence: [5, 9],
  previousBlock: [13, 6],
  radius: [23, 4],
  reason: [60, 772],
  receiptCreatedAt: [0, 26],
  remainingDurability: [3, 13],
  replayed: [5, 35],
  request: [22, 12],
  resultJson: [15, 26],
  retryAfterMs: [2, 24],
  revision: [129, 83],
  selectedHotbar: [63, 12],
  serverNow: [48, 272],
  sessionId: [32, 14],
  snapshot: [3, 2],
  snapshotJson: [19, 9],
  sourceSlot: [39, 5],
  state: [111, 34],
  targetCombat: [10, 1],
  targetId: [20, 2],
  targetKind: [20, 2],
  targetUserId: [20, 3],
  updatedAt: [12, 1],
  userId: [299, 90],
  username: [14, 8],
  version: [9, 11],
  weaponItemId: [7, 2],
  workstationCoordKey: [6, 2],
  worldChunks: [16, 2],
  worldEdits: [20, 2],
});

const BUILTIN_EXCLUSIONS = Object.freeze([
  "MAX_SAFE_INTEGER", "POSITIVE_INFINITY", "default", "delete", "filter", "first", "freeze",
  "hasOwnProperty", "includes", "insert", "isArray", "isAuthenticated", "isFinite", "isGuest",
  "isInteger", "isSafeInteger", "length", "map", "order", "prototype", "push", "reduce", "slice",
  "sort", "stringify", "take", "toString", "update", "withIndex",
]);
export const COMPACT_SERVER_KEY_BUILTIN_EXCLUSIONS = BUILTIN_EXCLUSIONS;
// Reviewed through the canonical GUI block raster base plus the Railway chat,
// held-item, remote-skin, bounded appearance-concurrency, acknowledged-pose,
// and persisted Railway item-drop paths. The
// explicit MotionSegmentRecorder and skin-storage deltas remain pinned below;
// compact manifest keys, exclusions,
// runtime strings, and server records stay exact.
export const COMPACT_SERVER_KEY_SOURCE_FINGERPRINT = "ce23a080a677df453ad683f58823cfe9f749838eb1fd1a69e3a70cff287930d6";
export const COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT = "76f73009c767698e99787559776e83c43fdb84a0da87452858531e45d224c00a";
export const COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT = "e2762c40d52c097b0af18afa1b6b8fdbccd009abf2c30d61f8fca460753fe772";
export const COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT = "2601aa554734c0a12761c3ea01b4270a494cc9b5ebf9c20c91609c8cb78c07d2";
// Beyond the original hand-curated record-key manifest, the closed server
// bundle contains a larger set of ordinary property spellings that can be
// interned without renaming any JavaScript, Lakebed, database, or wire key.
// Derivation is deterministic, but the exact reviewed live set is hash-pinned
// so source drift fails closed instead of silently broadening the transform.
export const COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN = 10;
export const COMPACT_SERVER_EXTENDED_KEY_COUNT = 285;
// The positional clientBootstrap query reorders existing high-gain server keys
// without adding a new compact wire property.
export const COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT = "e0ac5e7c4e31b33fcd33aa35020fbaf441e49033092554badcd4728b841add84";
// Keep the post-shared-gameplay checkpoint reconstructable. The only reviewed
// source drift here removes owner-specific pickup filtering while leaving the
// serialized Railway/Lakebed property spellings unchanged.
export const COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA = Object.freeze({
  radius: Object.freeze({
    declarations:Object.freeze(["client/realtimeMultiplayer.ts"]),
    uses:Object.freeze(["client/realtimeMultiplayer.ts"]),
    counts:Object.freeze({"client/realtimeMultiplayer.ts":Object.freeze([null,1])}),
    kinds:Object.freeze({"client/realtimeMultiplayer.ts:ShorthandPropertyAssignment":Object.freeze([null,1])}),
    previousEntryFingerprint:"5c10798ce822b64cda7ec824663ec59563b6907ec1952e89bb333bb521bab23f",
    source:"render-distance coordinate chunk subscription",
  }),
  revision: Object.freeze({
    counts:Object.freeze({"client/realtimeMultiplayer.ts":Object.freeze([5,7])}),
    kinds:Object.freeze({"client/realtimeMultiplayer.ts:ShorthandPropertyAssignment":Object.freeze([2,3])}),
    previousEntryFingerprint:"cf77f3d1a832c7956add3ae3ee38fc6c93d3786ebd22b217423f9353b0537d07",
    source:"known coordinate chunk revisions",
  }),
  ownerUserId: Object.freeze({
    removedUses: Object.freeze(["client/index.tsx"]),
    counts: Object.freeze({
      "client/index.tsx": Object.freeze([1, null]),
      "shared/droppedItems.ts": Object.freeze([8, 7]),
    }),
    previousEntryFingerprint: "3e05d98c2ef86a097b91c8a5ff456142bee42c20b746dd2c893f16acd741c532",
    source: "universal timestamp-only dropped-item pickup eligibility",
  }),
  userId: Object.freeze({
    counts: Object.freeze({
      "client/index.tsx": Object.freeze([30, 28]),
    }),
    previousEntryFingerprint: "60f7dfbdd9303930143947bbb8731d690ee46b189e8d6af18405adfe55a77259",
    source: "remove owner-specific local pickup filtering",
  }),
});

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
    if (!candidates[0]) throw new Error("Compact server key audit requires Lakebed's cached TypeScript runtime.");
    return import(pathToFileURL(candidates[0].path).href);
  })();
  return typescriptPromise;
}

function fail(message) {
  throw new Error(`Unsafe compact server key transform: ${message}`);
}

function estimatedInterningGain(name, [accesses, objectKeys]) {
  return (name.length - 2) * accesses + (name.length - 3) * objectKeys - (name.length + 5);
}

function analyzePropertyCounts(ts, sourceFile) {
  const counts = new Map();
  const methodNames = new Set();
  function increment(name, kind) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
    const count = counts.get(name) ?? [0, 0];
    count[kind] += 1;
    counts.set(name, count);
  }
  function visit(node) {
    if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
      increment(node.name.text, 0);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      increment(node.name.text, 1);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      increment(node.name.text, 1);
    } else if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
        || ts.isPropertyDeclaration(node))
      && node.name && ts.isIdentifier(node.name)
    ) {
      methodNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { counts, methodNames };
}

export async function compactServerPropertyKeys(source, manifest = COMPACT_SERVER_KEY_COUNTS) {
  const ts = await typescript();
  const sourceFile = ts.createSourceFile("lakecraft-server-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const manifestNames = Object.keys(manifest);
  if (manifestNames.some((name) => BUILTIN_EXCLUSIONS.includes(name))) {
    fail("primary manifest includes a reserved JavaScript or Lakebed property");
  }
  const analysis = analyzePropertyCounts(ts, sourceFile);
  const extendedEntries = manifest === COMPACT_SERVER_KEY_COUNTS ? [...analysis.counts]
    .filter(([name, count]) => !Object.hasOwn(manifest, name)
      && !analysis.methodNames.has(name)
      && estimatedInterningGain(name, count) >= COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN)
    .sort(([left], [right]) => left.localeCompare(right)) : [];
  const extendedFingerprint = createHash("sha256").update(JSON.stringify(extendedEntries)).digest("hex");
  if (manifest === COMPACT_SERVER_KEY_COUNTS && (extendedEntries.length !== COMPACT_SERVER_EXTENDED_KEY_COUNT
    || extendedFingerprint !== COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT)) {
    fail(`extended key live set changed; expected ${COMPACT_SERVER_EXTENDED_KEY_COUNT}/${COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT}, received `
      + `${extendedEntries.length}/${extendedFingerprint}`);
  }
  const names = [...manifestNames, ...extendedEntries.map(([name]) => name)];
  const indexes = new Map(names.map((name, index) => [name, index]));
  const counts = Object.fromEntries(names.map((name) => [name, [0, 0]]));
  const replacements = [];

  function keyReference(name) {
    return `__lakecraftServerKey${indexes.get(name)}`;
  }

  function visit(node) {
    if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
      const name = node.name.text;
      if (indexes.has(name)) {
        counts[name][0] += 1;
        replacements.push({
          start: node.expression.end,
          end: node.end,
          text: node.questionDotToken ? `?.[${keyReference(name)}]` : `[${keyReference(name)}]`,
        });
      }
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (indexes.has(name)) {
        counts[name][1] += 1;
        replacements.push({ start: node.name.getStart(sourceFile), end: node.name.end, text: `[${keyReference(name)}]` });
      }
    } else if (ts.isShorthandPropertyAssignment(node) && indexes.has(node.name.text)) {
      const name = node.name.text;
      counts[name][1] += 1;
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.end,
        text: `[${keyReference(name)}]:${name}`,
      });
    } else if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
        || ts.isPropertyDeclaration(node))
      && node.name && ts.isIdentifier(node.name) && indexes.has(node.name.text)
    ) {
      fail(`${node.name.text} unexpectedly became a class or method declaration`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const drifts = [];
  const expectedCounts = Object.fromEntries([...Object.entries(manifest), ...extendedEntries]);
  for (const name of names) {
    const expected = expectedCounts[name];
    const actual = counts[name];
    if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
      drifts.push(`${name} live set changed; expected ${expected.join("/")}, received ${actual.join("/")}`);
    }
  }
  if (drifts.length) fail(drifts.join("; "));
  replacements.sort((left, right) => right.start - left.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1].start < replacements[index].end) fail("replacement ranges overlap");
  }
  let output = source;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  const declarations = names.map((_name, index) => `__lakecraftServerKey${index}`).join(",");
  const values = names.map((name) => JSON.stringify(name)).join(",");
  return `const [${declarations}]=[${values}];${output}`;
}
