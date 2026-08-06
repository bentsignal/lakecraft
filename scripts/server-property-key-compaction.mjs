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
  equipment: [17, 10],
  eventId: [39, 22],
  expectedBlock: [13, 3],
  expectedChestUpdatedAt: [4, 1],
  expectedChunkRevision: [7, 3],
  expectedHeldItem: [13, 2],
  expectedInventoryRevision: [15, 5],
  expectedInventoryUpdatedAt: [14, 4],
  expectedRevision: [11, 2],
  expiresAt: [8, 8],
  fingerprint: [41, 42],
  firstSequence: [16, 3],
  furnaces: [7, 1],
  fuseStartedTick: [25, 6],
  fuseUntilTick: [14, 2],
  health: [61, 39],
  heartbeatAt: [36, 13],
  heldBowDurability: [7, 2],
  hunger: [21, 23],
  ignitedAt: [11, 8],
  igniterUserId: [15, 8],
  ignitionId: [19, 10],
  ingredients: [2, 22],
  inputJson: [12, 5],
  inventories: [46, 1],
  inventory: [73, 83],
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
  ownerUserId: [11, 8],
  parentEventId: [9, 5],
  playerCombat: [25, 1],
  playerCombatReceipts: [9, 1],
  playerPresence: [44, 1],
  playerState: [8, 4],
  playerStateJson: [20, 10],
  poseSequence: [5, 9],
  previousBlock: [13, 6],
  radius: [23, 4],
  reason: [61, 735],
  receiptCreatedAt: [0, 26],
  remainingDurability: [3, 13],
  replayed: [5, 35],
  request: [22, 12],
  resultJson: [15, 26],
  retryAfterMs: [2, 25],
  revision: [129, 83],
  selectedHotbar: [63, 12],
  serverNow: [48, 265],
  sessionId: [32, 14],
  snapshot: [3, 2],
  snapshotJson: [19, 9],
  sourceSlot: [25, 3],
  state: [111, 30],
  targetCombat: [10, 1],
  targetId: [20, 2],
  targetKind: [20, 2],
  targetUserId: [20, 3],
  updatedAt: [12, 1],
  userId: [286, 89],
  username: [9, 8],
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
// Reviewed 2026-08-04 after the explicit MotionSegmentRecorder field and the
// canonical skin-storage codec added exactly the two source-shape deltas pinned
// below; compact manifest keys, exclusions, runtime strings, and server records
// stayed exact.
export const COMPACT_SERVER_KEY_SOURCE_FINGERPRINT = "81551499a261fa97f9bae0e45acc825c91865f572f1f645b8ef02363bac9cdc4";
// Shared visual provenance now includes the reviewed mob atlas metadata; it is
// presentation-only and never enters the compact server-key allowlist.
export const COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT = "157d500d0739a4fc7a91f0e088057ba5190a76d63a7dc00fcf7bc639b319c7df";
export const COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT = "b055a528ddd8ba7b903bd5706adaf1ce3b2958079de2b2a9ee79d9ff542b39f6";
export const COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT = "2601aa554734c0a12761c3ea01b4270a494cc9b5ebf9c20c91609c8cb78c07d2";
export const COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA = Object.freeze({
  previousFingerprint: "7f19e58da315369166f6f4cd60b9f08e5802f9f3aa9955a2888632b36ad3a23a",
  sessionId: Object.freeze({
    path: "client/multiplayerSegmentClient.ts",
    previousUses: 11,
    currentUses: 13,
    addedKind: "PropertyDeclaration",
    previousEntryFingerprint: "c431f3bc3c54938c7a25c184054daa7d0525dce0ece4af4ca79543b4dd6d8e6e",
  }),
  version: Object.freeze({
    path: "client/game/playerSkin.ts",
    previousUses: 2,
    currentUses: 3,
    addedKind: "ShorthandPropertyAssignment",
    previousEntryFingerprint: "8018412bf9f94a3a82d031c06610083baa60c0137a1db0301aa7b1debdc85e93",
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

export async function compactServerPropertyKeys(source, manifest = COMPACT_SERVER_KEY_COUNTS) {
  const ts = await typescript();
  const sourceFile = ts.createSourceFile("lakecraft-server-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = Object.keys(manifest);
  if (names.some((name) => BUILTIN_EXCLUSIONS.includes(name))) fail("manifest includes a reserved JavaScript or Lakebed property");
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
  for (const name of names) {
    const expected = manifest[name];
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
