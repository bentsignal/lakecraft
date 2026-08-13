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
  consumed: [8, 8],
  cookProgressMs: [13, 4],
  // Interning keeps the serialized key spelling exact; it only avoids repeating
  // the same source literal throughout the closed server bundle.
  coordKey: [97, 42],
  count: [135, 99],
  craftingContext: [10, 24],
  damage: [11, 15],
  deadUntil: [23, 20],
  direction: [14, 3],
  dropId: [13, 7],
  droppedItems: [18, 2],
  durability: [54, 14],
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
  inventories: [47, 1],
  inventory: [73, 84],
  inventoryJson: [27, 22],
  inventoryRevision: [10, 8],
  inventorySlot: [9, 1],
  itemId: [108, 111],
  keyframes: [15, 1],
  killed: [10, 14],
  lastAttackAt: [14, 18],
  lastAttackerId: [15, 22],
  lastMaterializedAtMs: [7, 4],
  lastReleasedAt: [14, 8],
  lastSequence: [15, 3],
  leaseExpiresAt: [5, 11],
  leaseId: [10, 5],
  maxDurability: [9, 4],
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
  ownerUserId: [14, 10],
  parentEventId: [9, 5],
  playerCombat: [25, 1],
  playerCombatReceipts: [9, 1],
  playerPresence: [45, 1],
  playerState: [8, 4],
  playerStateJson: [20, 11],
  poseSequence: [5, 9],
  previousBlock: [13, 6],
  radius: [23, 4],
  reason: [60, 766],
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
  sourceSlot: [25, 3],
  state: [111, 31],
  targetCombat: [10, 1],
  targetId: [20, 2],
  targetKind: [20, 2],
  targetUserId: [20, 3],
  updatedAt: [12, 1],
  userId: [298, 90],
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
export const COMPACT_SERVER_KEY_SOURCE_FINGERPRINT = "6ddc300619b28f4a4b5847e188c491bb29a58389e03495e030d2b60978b1c59c";
export const COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT = "49ebf3ffec0a01b7d025737e37791c45f1c11fd1f6f453866327378bd85b84ac";
export const COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT = "da96e3bd6e317b305e5adaf9abead32c2558d13e90f8bdc93df30c4f914ea651";
export const COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT = "2601aa554734c0a12761c3ea01b4270a494cc9b5ebf9c20c91609c8cb78c07d2";
// Beyond the original hand-curated record-key manifest, the closed server
// bundle contains a larger set of ordinary property spellings that can be
// interned without renaming any JavaScript, Lakebed, database, or wire key.
// Derivation is deterministic, but the exact reviewed live set is hash-pinned
// so source drift fails closed instead of silently broadening the transform.
export const COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN = 10;
export const COMPACT_SERVER_EXTENDED_KEY_COUNT = 283;
// The positional clientBootstrap query reorders existing high-gain server keys
// without adding a new compact wire property.
export const COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT = "b059a4a9d9e8ba68c200ff321311f5640eebf7eba185937691e64ffde35ca867";
// The shared-gameplay architecture is a new sealed source checkpoint. Earlier
// additive deltas described the duplicated Lakebed multiplayer paths removed by
// that cut, so the current complete fingerprint is now the canonical boundary.
export const COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA = Object.freeze({
  damage: {
    previousEntryFingerprint: "4363ea06150214c6d81b6f55e153df6569c2ef0b3145daee61334a0869328be6",
    declarations: ["client/realtimeMultiplayer.ts"],
    uses: ["client/index.tsx", "client/realtimeMultiplayer.ts"],
    counts: { "client/index.tsx": [null, 1], "client/realtimeMultiplayer.ts": [null, 3] },
    kinds: {
      "client/realtimeMultiplayer.ts:PropertySignature": [null, 1],
      "client/realtimeMultiplayer.ts:ShorthandPropertyAssignment": [null, 1],
    },
  },
  dropId: {
    previousEntryFingerprint: "75000957aeafcc2b0722a433ae8e80b82555bf8bb57b1869da81afde84feaef4",
    counts: { "client/index.tsx": [6, 9] },
  },
  health: {
    previousEntryFingerprint: "60c9aaebbfc0d3f1ea43b4f6e159ba8ee8ab4c828c570abe4dc32ea3158e887d",
    declarations: ["client/game/avatar.ts", "client/game/remotePlayerTargeting.ts", "client/game/types.ts", "client/realtimeMultiplayer.ts"],
    uses: ["client/game/avatar.ts", "client/game/remotePlayerTargeting.ts", "client/game/types.ts", "client/index.tsx", "client/realtimeMultiplayer.ts"],
    counts: {
      "client/game/avatar.ts": [null, 8],
      "client/game/remotePlayerTargeting.ts": [null, 2],
      "client/game/types.ts": [null, 1],
      "client/index.tsx": [null, 2],
      "client/realtimeMultiplayer.ts": [null, 7],
    },
    kinds: {
      "client/game/avatar.ts:PropertySignature": [null, 1],
      "client/game/avatar.ts:ShorthandPropertyAssignment": [null, 1],
      "client/game/remotePlayerTargeting.ts:PropertySignature": [null, 1],
      "client/game/types.ts:PropertySignature": [null, 1],
      "client/realtimeMultiplayer.ts:PropertySignature": [null, 1],
      "client/realtimeMultiplayer.ts:ShorthandPropertyAssignment": [null, 2],
    },
  },
  itemId: {
    previousEntryFingerprint: "297403a97f82a70186ce155916be3fd2090ee636e6fe00b9997710f512f803f4",
    counts: { "client/index.tsx": [14, 14] },
  },
  killed: {
    previousEntryFingerprint: "3c2643836b6760b2591a2869e1913c5cc1c493952fd773bb9ab2fea9a8b87c15",
    declarations: ["client/realtimeMultiplayer.ts"],
    uses: ["client/index.tsx", "client/realtimeMultiplayer.ts"],
    counts: { "client/index.tsx": [null, 2], "client/realtimeMultiplayer.ts": [null, 4] },
    kinds: {
      "client/realtimeMultiplayer.ts:PropertyAssignment": [null, 1],
      "client/realtimeMultiplayer.ts:PropertySignature": [null, 1],
    },
  },
  operationId: {
    previousEntryFingerprint: "a6e413a797b59cdd0bb1e0fee745b878bbdaf63d8bb85f1f1678b41201418cc5",
    counts: { "client/index.tsx": [9, 13], "client/realtimeMultiplayer.ts": [23, 27] },
    kinds: {
      "client/realtimeMultiplayer.ts:PropertySignature": [1, 2],
      "client/realtimeMultiplayer.ts:ShorthandPropertyAssignment": [9, 11],
    },
  },
  targetId: {
    previousEntryFingerprint: "0f1379462b330c0f2e6b6b42ca1e24f3c53c91aaa4b7aca3c3c74d58b470a1a3",
    declarations: ["client/realtimeMultiplayer.ts"],
    uses: ["client/index.tsx", "client/realtimeMultiplayer.ts"],
    counts: { "client/index.tsx": [null, 1], "client/realtimeMultiplayer.ts": [null, 4] },
    kinds: {
      "client/realtimeMultiplayer.ts:PropertySignature": [null, 1],
      "client/realtimeMultiplayer.ts:ShorthandPropertyAssignment": [null, 2],
    },
  },
  userId: {
    previousEntryFingerprint: "2a449723b6a007fd34ebbf34285969af1d5421ecab3a08edbccc2f6b6b00dd85",
    counts: { "client/index.tsx": [23, 30] },
  },
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
