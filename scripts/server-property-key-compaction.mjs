import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Fixed compatibility manifest for the closed compact server bundle. Values
// are [property-access count, object-key count] in the reviewed first-stage
// minified output. Any drift fails before staging instead of broadening scope.
export const COMPACT_SERVER_RETIRED_KEY_COUNTS = Object.freeze({
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
  count: [146, 168],
  craftingContext: [10, 57],
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
  expectedHeldItem: [14, 2],
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
  ingredients: [2, 55],
  inputJson: [12, 5],
  inventories: [48, 1],
  inventory: [80, 90],
  inventoryJson: [29, 23],
  inventoryRevision: [10, 8],
  inventorySlot: [9, 1],
  itemId: [113, 178],
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
  output: [21, 69],
  ownerUserId: [13, 10],
  parentEventId: [9, 5],
  playerCombat: [25, 1],
  playerCombatReceipts: [9, 1],
  playerPresence: [45, 1],
  playerState: [8, 4],
  playerStateJson: [20, 14],
  poseSequence: [5, 9],
  previousBlock: [13, 6],
  radius: [24, 5],
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

// The production Lakebed surface now contains only identity, server-directory,
// join-ticket, and local single-player inventory handlers. The old hand-picked
// gameplay key list above remains as migration provenance, but applying it to
// the pruned bundle would emit unused declarations. Production therefore uses
// only the deterministic positive-gain extended boundary below.
export const COMPACT_SERVER_KEY_COUNTS = Object.freeze({});

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
export const COMPACT_SERVER_KEY_SOURCE_FINGERPRINT = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
export const COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
export const COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
export const COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT = "2601aa554734c0a12761c3ea01b4270a494cc9b5ebf9c20c91609c8cb78c07d2";
// Beyond the original hand-curated record-key manifest, the closed server
// bundle contains a larger set of ordinary property spellings that can be
// interned without renaming any JavaScript, Lakebed, database, or wire key.
// Derivation is deterministic, but the exact reviewed live set is hash-pinned
// so source drift fails closed instead of silently broadening the transform.
export const COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN = 10;
export const COMPACT_SERVER_EXTENDED_KEY_COUNT = 99;
// The wood-family registry adds the internal plank and charcoal recipe-id
// capabilities. Neither property crosses a Lakebed, database, or wire boundary.
export const COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT = "2ae1991a0afed71b0b2c84d0934de49183ce114cbeb3c2149655560fbd21dd4e";
// Keep the post-shared-gameplay checkpoint reconstructable. The only reviewed
// source drift here removes owner-specific pickup filtering while leaving the
// serialized Railway/Lakebed property spellings unchanged.
export const COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA = Object.freeze({
  count: Object.freeze({
    counts: Object.freeze({ "shared/game.ts": Object.freeze([109, 161]) }),
    kinds: Object.freeze({ "shared/game.ts:PropertyAssignment": Object.freeze([84, 136]) }),
    previousEntryFingerprint: "e262b95b429c35200b7ad9b5c490382312f56c59f961430eb3bb8a04489673cd",
    source: "twenty-six additional shaped-building recipes add one ingredient and one output count each",
  }),
  craftingContext: Object.freeze({
    counts: Object.freeze({ "shared/game.ts": Object.freeze([31, 57]) }),
    kinds: Object.freeze({ "shared/game.ts:PropertyAssignment": Object.freeze([29, 55]) }),
    previousEntryFingerprint: "96c885cf27cbc964a276eb69722cfbb280d94e65432e708c00e8b59aff9d0531",
    source: "twenty-six additional shaped-building recipes retain exact crafting contexts",
  }),
  health: Object.freeze({
    declarations: Object.freeze(["client/components/generated/survivalHudSprites.ts"]),
    uses: Object.freeze(["client/components/generated/survivalHudSprites.ts"]),
    counts: Object.freeze({
      "client/components/StatusStrip.tsx": Object.freeze([2, 1]),
      "client/components/generated/survivalHudSprites.ts": Object.freeze([null, 1]),
    }),
    kinds: Object.freeze({
      "client/components/StatusStrip.tsx:PropertyAssignment": Object.freeze([1, null]),
      "client/components/generated/survivalHudSprites.ts:PropertyAssignment": Object.freeze([null, 1]),
    }),
    previousEntryFingerprint: "27779287a7c06990bf0fb7a9c879daec1bbbfb00f9866403a193869078d8546b",
    source: "canonical HUD health sprites replace the former inline status-strip assignment",
  }),
  hunger: Object.freeze({
    declarations: Object.freeze(["client/components/generated/survivalHudSprites.ts"]),
    uses: Object.freeze(["client/components/generated/survivalHudSprites.ts"]),
    counts: Object.freeze({
      "client/components/StatusStrip.tsx": Object.freeze([2, 1]),
      "client/components/generated/survivalHudSprites.ts": Object.freeze([null, 1]),
    }),
    kinds: Object.freeze({
      "client/components/StatusStrip.tsx:PropertyAssignment": Object.freeze([1, null]),
      "client/components/generated/survivalHudSprites.ts:PropertyAssignment": Object.freeze([null, 1]),
    }),
    previousEntryFingerprint: "d10ad881edb8e0a84c775f62eafebe1443f8e2370f1edfcc19b8ef6fa3c302d7",
    source: "canonical HUD hunger sprites replace the former inline status-strip assignment",
  }),
  expectedHeldItem: Object.freeze({
    counts: Object.freeze({ "shared/worldBlockOperations.ts": Object.freeze([16, 17]) }),
    previousEntryFingerprint: "3960859fe44952db05344872e54d4c6b1cfccdda248b8da1d98cc89faa21b025",
    source: "canonical shaped-block placement validates the held item",
  }),
  ingredients: Object.freeze({
    counts: Object.freeze({ "shared/game.ts": Object.freeze([34, 60]) }),
    kinds: Object.freeze({ "shared/game.ts:PropertyAssignment": Object.freeze([29, 55]) }),
    previousEntryFingerprint: "18498da53ec9eca3475e00f53bc6590ebd29dacb3e314ef0a4f4edc005fafdae",
    source: "twenty-six additional shaped-building recipes add explicit ingredient lists",
  }),
  inventory: Object.freeze({
    declarations: Object.freeze(["client/gameplay/controlBindings.ts"]),
    uses: Object.freeze(["client/gameplay/controlBindings.ts"]),
    counts: Object.freeze({
      "client/components/GameHud.tsx": Object.freeze([1, 2]),
      "client/gameplay/controlBindings.ts": Object.freeze([null, 2]),
    }),
    kinds: Object.freeze({
      "client/gameplay/controlBindings.ts:PropertyAssignment": Object.freeze([null, 2]),
    }),
    previousEntryFingerprint: "0eabd22dd5f232359140d6ece7296e2b20c7b999d92ad65d91711824aaddd8ef",
    source: "the shared inventory key binding and options callback add reviewed internal inventory properties",
  }),
  itemId: Object.freeze({
    counts: Object.freeze({ "shared/game.ts": Object.freeze([132, 184]) }),
    kinds: Object.freeze({ "shared/game.ts:PropertyAssignment": Object.freeze([88, 140]) }),
    previousEntryFingerprint: "6ef9241670e8e15799a0f6218fbdf179e6c450f45b83efd6dea3a57a80d775d7",
    source: "twenty-six additional shaped-building recipes add ingredient and output item IDs",
  }),
  mobId: Object.freeze({
    counts: Object.freeze({ "server/mobWorldAuthority.ts": Object.freeze([18, 17]) }),
    kinds: Object.freeze({ "server/mobWorldAuthority.ts:PropertySignature": Object.freeze([3, 2]) }),
    previousEntryFingerprint: "3d6a8c1c672052cdfb7c57801fc47b72bd7723301fd44130f3695bec6e3812e3",
    source: "shared deterministic spawn layout removes the duplicate Lakebed-only mob-id option",
  }),
  operationId: Object.freeze({
    counts: Object.freeze({ "client/realtimeChat.ts": Object.freeze([10, 12]) }),
    previousEntryFingerprint: "364366cd8d637dfcf25436a7722d860ab3a0bd4ed7e326b2f3d62c94ab93b55f",
    source: "ordered chat replay tracks operation identity through both normalized message branches",
  }),
  output: Object.freeze({
    counts: Object.freeze({ "shared/game.ts": Object.freeze([48, 74]) }),
    kinds: Object.freeze({ "shared/game.ts:PropertyAssignment": Object.freeze([39, 65]) }),
    previousEntryFingerprint: "526618e2d3f168950e8891681e4e452a655765d1a5ef1eb0bb6d083fded805a9",
    source: "twenty-six additional shaped-building recipes add exact outputs",
  }),
  radius: Object.freeze({
    declarations: Object.freeze(["server/mobWorldAuthority.ts", "shared/mobSpawnLayout.ts"]),
    uses: Object.freeze(["server/mobWorldAuthority.ts", "shared/mobSpawnLayout.ts"]),
    counts: Object.freeze({
      "client/game/mobs.ts": Object.freeze([2, 3]),
      "server/mobWorldAuthority.ts": Object.freeze([null, 1]),
      "shared/mobSpawnLayout.ts": Object.freeze([null, 2]),
    }),
    kinds: Object.freeze({
      "client/game/mobs.ts:PropertyAssignment": Object.freeze([null, 1]),
      "server/mobWorldAuthority.ts:PropertyAssignment": Object.freeze([null, 1]),
      "shared/mobSpawnLayout.ts:PropertySignature": Object.freeze([null, 1]),
    }),
    previousEntryFingerprint: "5c10798ce822b64cda7ec824663ec59563b6907ec1952e89bb333bb521bab23f",
    source: "the shared deterministic spawn-layout radius is supplied by both local and Lakebed authority",
  }),
  revision: Object.freeze({
    counts:Object.freeze({"client/realtimeMultiplayer.ts":Object.freeze([5,6])}),
    previousEntryFingerprint:"cf77f3d1a832c7956add3ae3ee38fc6c93d3786ebd22b217423f9353b0537d07",
    source:"internal coordinate chunk revision cache with literal compact-wire boundaries",
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
  previousBlock: Object.freeze({
    counts: Object.freeze({ "client/index.tsx": Object.freeze([8, 11]) }),
    kinds: Object.freeze({
      "client/index.tsx:PropertySignature": Object.freeze([1, 2]),
      "client/index.tsx:PropertyAssignment": Object.freeze([null, 1]),
    }),
    previousEntryFingerprint: "e04e3f12c1c9e7a6689665b7b2747172cdfb11d66b21f0f8d229b0c3bce6293c",
    source: "paired-door follow-up edits retain each neighbor's authoritative rollback block",
  }),
  userId: Object.freeze({
    counts: Object.freeze({
      "client/index.tsx": Object.freeze([30, 28]),
      "client/realtimeMultiplayer.ts": Object.freeze([14, 15]),
    }),
    kinds: Object.freeze({
      "client/realtimeMultiplayer.ts:PropertyAssignment": Object.freeze([2, 3]),
    }),
    previousEntryFingerprint: "60f7dfbdd9303930143947bbb8731d690ee46b189e8d6af18405adfe55a77259",
    source: "remove owner-specific local pickup filtering",
  }),
});

// Final frozen-tree provenance. Each tuple is [checkpoint entry hash, frozen
// entry hash, reviewed feature source]. Entry hashes cover declaration/use
// paths plus every per-file use and declaration-kind count, while the separate
// unchanged fingerprint above proves that no other compact server key moved.
export const COMPACT_SERVER_KEY_FINAL_SOURCE_PROVENANCE = Object.freeze({
  count: ["e262b95b429c35200b7ad9b5c490382312f56c59f961430eb3bb8a04489673cd", "49aaddb7b3951775734f6984fe39ee4036203401051f8f725ee1ab04094a3c1b", "expanded shaped-building recipes"],
  craftingContext: ["96c885cf27cbc964a276eb69722cfbb280d94e65432e708c00e8b59aff9d0531", "029d5ed8bed75e9942a7bfe828a3e6f16dd7133c562944238654d32f88545b45", "expanded shaped-building recipes"],
  damage: ["ce9a859426ac0f6b339618fc90c1213dc863b1707be005d8cf43550dc1f211e6", "84c1fb6c3d502df6eaabb366d54c7b1d75067e2418c75a41451832c892ac60d3", "Railway mob combat streaming"],
  deadUntil: ["f9eb1f09b59b2c84d85351623938505baa57a2b30fd7168974871970ceb1d429", "101acdb87cabff6ccbbe52a201dbba1a84dfd76292752b8c46e91cbff456a1b4", "Railway mob death presentation"],
  fuseStartedTick: ["81ae5dc5db3e0d5d122b3feb37e00b07bc622bd3498fb5e2f3fa0706213b8951", "53cb0b933dad210a610294815561aafe4bbfa175089b9a33469c82b435cf20b3", "Railway creeper fuse streaming"],
  fuseUntilTick: ["14baababcbe995efcaddbeb58db83a62ff0ac5dfda0d0e28d07e0306d9b29692", "ccf332300456d3b71f70e026679dfa0b5136e7e2e079f29638c0b280ed85ddd7", "Railway creeper fuse streaming"],
  health: ["27779287a7c06990bf0fb7a9c879daec1bbbfb00f9866403a193869078d8546b", "7fe0d2a9090ca6b1913d5a8806ade879eb083d54f5d1b124cba042bec91f5390", "canonical HUD sprites and Railway mob health"],
  hunger: ["d10ad881edb8e0a84c775f62eafebe1443f8e2370f1edfcc19b8ef6fa3c302d7", "02884cb1150a7d70bdaae9dd9163fcc22db4ba4bdca72e63317ef7ac4bd819bf", "canonical HUD sprites"],
  ingredients: ["18498da53ec9eca3475e00f53bc6590ebd29dacb3e314ef0a4f4edc005fafdae", "bbbb5ef85c58481a3938c687629c55b92004d27b8a3ebd6beed835537d08ff40", "expanded shaped-building recipes"],
  inventory: ["0eabd22dd5f232359140d6ece7296e2b20c7b999d92ad65d91711824aaddd8ef", "1a2523f31f50e2dabf034a43cdb160af46146b739dc23463b65b9b4679f1ff0c", "shared configurable controls"],
  itemId: ["6ef9241670e8e15799a0f6218fbdf179e6c450f45b83efd6dea3a57a80d775d7", "41531bf68d7f7e0e7df053f3af4cdae2180cb0bad5b2993eaa0e05da884efc47", "expanded shaped-building recipes"],
  killed: ["0335c007a2f8bc5d9cbb9730f96c67241ab9459a2dcad3a78695797247372425", "4d0f03d26d45d42582c7a90e8d426eab473b40284a2ee37f37c19fbf9aa7a019", "Railway mob combat receipts"],
  lastAttackAt: ["8e8e1d2bc289997f0f03d82bb0749a0a2cdde7c1a6e40a6153bfc87d435871ab", "57fc85817cb1b03abc6204957fa19f51045e339b4747a574107d5c1ea14c2d00", "Railway mob combat streaming"],
  lastAttackerId: ["c65862a77d0ceaf8e884a4d80e3bc52fcc63f3283479994e890a724184cdde90", "a1b58377d362fa45c24a6434c2e88ffa60950f4f34e81dcac30902c16606d9a0", "Railway mob combat streaming"],
  maxHealth: ["af1ee6eed60f95d51e4f2bf2b6f909c9143d780d6db82e5f91835458f46fba22", "71e5d6f73e9c876e28c3f533802c83ac297e37c0e8d51def841b282d88390a9b", "Railway mob health streaming"],
  mobId: ["3d6a8c1c672052cdfb7c57801fc47b72bd7723301fd44130f3695bec6e3812e3", "1456328031a2124b727fca1e5f3ce5f100af5ada066d646153955d4faab699c8", "shared deterministic mob ecology and Railway streaming"],
  operationId: ["364366cd8d637dfcf25436a7722d860ab3a0bd4ed7e326b2f3d62c94ab93b55f", "adce21cf957ba7229d9439f94f90c613795ee302f73674f247496dd0c71000f7", "ordered chat and Railway mob operations"],
  output: ["526618e2d3f168950e8891681e4e452a655765d1a5ef1eb0bb6d083fded805a9", "22e91015f42ecda5be5c9c7c006f150d9e0fe9fe5ec12e25a2b4520ec9c261ca", "expanded shaped-building recipes"],
  radius: ["5c10798ce822b64cda7ec824663ec59563b6907ec1952e89bb333bb521bab23f", "6fd3340c43ad93d3cdc03d0322312c87e34e2a59651e5bcc4956085c68deaf65", "shared deterministic mob spawn layout"],
  replayed: ["747f56e60166fbb7b1afb8acf0536ae5333652347856c46cce84107ee0b12ed1", "115656e73fe3d3b93eae03b4ada17152c0f063dc426c526f65c738e9ec40d096", "Railway mob operation receipts"],
  revision: ["8cbff85b3d8a9248b15e6ffdbd6ec25df1cbe976df7e9e5c38191af4fa52652c", "bdf0fa06e91396bfb105b8466d07b16cc284c6b81d5aec89651e5bf80dc3a7e7", "Railway mob and chunk revision streaming"],
  serverNow: ["89187c61ee37b5febcc4d6b51b15a110d706afba6a1925a7e220b51fff448959", "4d0e3f84e7a8d247e884dba9c7e177c83988b58847529e4b90209470daeac3a6", "Railway-authoritative mob presentation time"],
  state: ["98b59b2420b2bede862678a2bd863c1c70cfa718496a91d016e31d38994ee246", "589c12f06c82c9148040cbb1d3a38a5996b073c058761fabe2d5cd3e0df700c6", "Railway mob stream state"],
  targetUserId: ["5d7126f4e6acae78173434c644eb1ea11f5290a4ba3560632b8b05e1c95361b3", "961baa429850837a86208bf587ae0369d6873c989a563aa52dd861baf6d7b7ef", "Railway mob attack targeting"],
  userId: ["65d4ef3708d2bdb73e88c162cbe203229c991a20b842dd3020bf48d8ff2ce6ec", "3249dd904e2d61aadde4eb8d9b15ed2ae3aba5b6accb09e2fd8cc981d20565bb", "authenticated Railway mob targeting"],
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
