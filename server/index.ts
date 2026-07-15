import { boolean, capsule, endpoint, mutation, query, string, table, text, type WriteDatabase } from "lakebed/server";
import {
  CHAT_RATE_LIMIT_MS,
  RECENT_CHAT_LIMIT,
  validateChatMessage,
  validateUsername
} from "../shared/multiplayer";
import {
  normalizeChestToken,
  validateChestCoordinate,
  validateChestInventoryJson
} from "../shared/chests";
import {
  applyChestTransfer,
  decideChestTransferCas,
  decideChestTransferReplay,
  isValidDurabilitySaveTransition,
  validateChestTransferRequestJson,
  validatePlayerStateJson
} from "../shared/chestTransfers";
import {
  MAX_VISIBLE_DROPPED_ITEMS,
  MAX_VISIBLE_DROPPED_ITEMS_PER_CHUNK,
  applyDropItemToInventory,
  applyPickupDroppedItem,
  normalizeDroppedItemRow,
  validateDropItemRequestJson,
  validatePickupDroppedItemRequestJson,
  validateVisibleDroppedItemChunkKeys
} from "../shared/droppedItems";
import {
  ACTIVE_PLAYER_WINDOW_MS,
  MAX_SLEEP_PARTICIPANTS,
  MORNING_PHASE,
  SLEEP_VOTE_FRESH_MS,
  WORLD_CLOCK_KEY,
  morningClockSnapshot,
  sleepVoteStatus,
  validateSleepCoordinate,
  worldPhaseAt,
  worldClockSnapshot
} from "../shared/sleep";
import {
  applyWorldChunkEdit,
  createWorldChunkSnapshot,
  validateVisibleWorldChunkKeys,
  worldEditChunkKey,
  type WorldChunkEditInput
} from "../shared/worldChunks";
import { naturalWorldBlockAt } from "../shared/worldTerrainAuthority.ts";
import { writeMobMotionPoses } from "../shared/mobMotionAuthority.ts";
import {
  addItem,
  applyConfirmedArmorDamage,
  applyConfirmedToolUse,
  attackDamage,
  equippedArmorProtection,
  type ItemId,
  type ItemStack,
} from "../shared/game.ts";
import {
  applyFurnaceTransfer,
  createEmptyFurnace,
  materializeFurnace,
  serializeFurnaceState,
  validateFurnaceCoordinate,
  validateFurnaceJson,
  type FurnaceState,
} from "../shared/furnaces.ts";
import {
  MAX_WORLD_BLOCK_OPERATION_REQUEST_BYTES,
  nextWorldBlockRevision,
  normalizeWorldBlockRevision,
  parseWorldBlockOperation,
  resolveWorldBlockOperation,
} from "../shared/worldBlockOperations.ts";
import {
  MOB_AUTHORITY_WORLD_SEED_TOKEN,
  materializeMobAuthorityState,
  resolveMobAttack,
  validateMobIdList,
  validateMobIdentity,
  type StoredMobAuthorityState
} from "../shared/mobCombat";
import {
  encodePresenceVelocityFields,
  validatePresenceVelocityFields
} from "../shared/presenceMotion";
import {
  MAX_PLAYER_COMBAT_RECEIPTS_PER_USER,
  PLAYER_COMBAT_RECEIPT_PRUNE_LIMIT,
  PLAYER_COMBAT_RECEIPT_TTL_MS,
  PLAYER_RESPAWN_DELAY_MS,
  authoritativeCombatPose,
  decidePlayerCombatReplay,
  materializePlayerCombatState,
  resolvePlayerAttack,
  selectPlayerCombatReceiptOverflow,
  storedPlayerCombatRow,
  validatePlayerMeleeSpatialAuthority,
  validatePlayerAttackRequestJson,
  validatePlayerCombatUserIds,
  type StoredPlayerCombatState
} from "../shared/playerCombat";
import {
  CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT,
  MAX_CHEST_TRANSFER_RECEIPTS_PER_USER,
  compareStoredPlayerState,
  decodeChestTransferReceipt,
  encodeChestTransferReceipt,
  selectChestTransferReceiptOverflow
} from "./chestTransferReceipts";
import {
  buildPresenceRelocationGrant,
  buildOfflinePresenceValue,
  decidePresenceTrajectory,
  decidePresenceWriteGate,
  validatePresencePoseFields,
  type PresenceRelocationGrant,
} from "./playerPresence";
import {
  DROPPED_ITEM_EXPIRY_PRUNE_LIMIT,
  DROPPED_ITEM_RECEIPT_PRUNE_LIMIT,
  DROPPED_ITEM_RECEIPT_TTL_MS,
  MAX_DROPPED_ITEM_RECEIPTS_PER_USER,
  authoritativeDroppedItemPosition,
  buildDroppedItemRow,
  canCreateDroppedItem,
  compareDroppedItemStoredPlayerState,
  decideDroppedItemInventoryCas,
  decideDroppedItemReplay,
  decodeDroppedItemReceipt,
  encodeDroppedItemReceipt,
  selectDroppedItemReceiptOverflow,
  selectExpiredDroppedItemIds,
  type DroppedItemReceiptResult
} from "./droppedItems";
import { BLOCK_TYPES } from "../shared/protocol";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance";
import {
  decodePlayerCombatReceipt,
  encodePlayerCombatReceipt,
  type PlayerCombatReceiptResult
} from "./playerCombat";
import {
  MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER,
  WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT,
  WORLD_BLOCK_OPERATION_RECEIPT_TTL_MS,
  decodeWorldBlockOperationReceipt,
  encodeWorldBlockOperationReceipt,
  selectWorldBlockOperationReceiptOverflow,
  validateWorldBlockActionPose,
  worldBlockOperationPoseFingerprint,
  type WorldBlockOperationReceiptResult,
} from "./worldBlockOperationReceipts.ts";
import {
  MOB_WORLD_AUTHORITY_KEY,
  MOB_WORLD_CHECKPOINT_MS,
  MOB_WORLD_LEASE_MS,
  advanceMobWorldState,
  createCanonicalMobWorldState,
  encodeMobWorldCheckpoint,
  encodeMobWorldReplayInput,
  mobDamageClaimsForTarget,
  parseMobWorldCheckpointJson,
  parseMobWorldReplayInputJson,
  parseStoredInteger,
  resolveMobDamage,
  validateMobDamageRequestJson,
  validateMobWorldCheckpointRequestJson,
  type StoredMobWorldAuthorityRow,
} from "./mobWorldAuthority.ts";
import {
  FURNACE_RECEIPT_OVERFLOW_PRUNE_LIMIT,
  FURNACE_RECEIPT_TTL_MS,
  MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER,
  decideFurnaceReceiptReplay,
  decideFurnaceTransferCas,
  decodeFurnaceReceipt,
  encodeFurnaceReceipt,
  selectFurnaceReceiptOverflow,
  validateFurnaceTransferRequestJson,
} from "./furnaceReceipts.ts";

const PLACEABLE_BLOCKS = new Set<string>(BLOCK_TYPES.filter((block) => block !== "air"));
const CHEST_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const CHEST_RECEIPT_PRUNE_LIMIT = 8;
/** Legacy name retained for the replay-grant validity bound; death proof replaces request throttling. */
const RESPAWN_AUTHORIZATION_COOLDOWN_MS = 15_000;
function trailheadPoseForUser(userId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash = Math.imul(hash ^ userId.charCodeAt(index), 0x01000193);
  }
  const unsigned = hash >>> 0;
  const x = ((unsigned & 7) - 3) * 3 + 0.5;
  const z = (((unsigned >>> 3) & 7) - 3) * 3 + 0.5;
  return { x, y: serverTerrainHeight(x, z) + 1.02, z, yaw: 0, pitch: 0 };
}

function validPresenceSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{20,64}$/i.test(value);
}

function storedRespawnGrant(row: Record<string, unknown> | null): PresenceRelocationGrant | null {
  if (!row || typeof row.userId !== "string" || typeof row.grantEpoch !== "string" || !row.grantEpoch) return null;
  if (typeof row.grantX !== "string" || typeof row.grantY !== "string" || typeof row.grantZ !== "string"
    || typeof row.grantYaw !== "string" || typeof row.grantPitch !== "string"
    || typeof row.grantIssuedAt !== "string" || typeof row.grantExpiresAt !== "string") return null;
  return {
    userId: row.userId,
    epoch: row.grantEpoch,
    x: row.grantX,
    y: row.grantY,
    z: row.grantZ,
    yaw: row.grantYaw,
    pitch: row.grantPitch,
    issuedAt: row.grantIssuedAt,
    expiresAt: row.grantExpiresAt,
    ...(typeof row.grantConsumedAt === "string" && row.grantConsumedAt
      ? { consumedAt: row.grantConsumedAt }
      : {}),
  };
}

function storedBedRespawnPose(row: Record<string, unknown> | null) {
  if (!row || typeof row.bedCoordKey !== "string" || !row.bedCoordKey) return null;
  const pose = validatePresencePoseFields(row.bedX, row.bedY, row.bedZ, row.bedYaw, row.bedPitch);
  return pose ? { coordKey: row.bedCoordKey, pose } : null;
}

function storedRevision(value: unknown): string | null {
  return normalizeWorldBlockRevision(value ?? "0");
}

function incrementStoredRevision(value: unknown): string {
  const revision = storedRevision(value);
  const next = revision === null ? null : nextWorldBlockRevision(revision);
  if (next === null) throw new Error("Stored revision is invalid or exhausted.");
  return next;
}

async function maintainWorldBlockOperationReceipts(
  db: WriteDatabase,
  userId: string,
  committedReceiptId: string,
  now: number,
): Promise<void> {
  const newestReceipts = await db.worldBlockOperationReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER + WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT);
  const overflowIds = selectWorldBlockOperationReceiptOverflow(newestReceipts, committedReceiptId);
  for (const receiptId of overflowIds) await db.worldBlockOperationReceipts.delete(receiptId);
  const staleBefore = String(now - WORLD_BLOCK_OPERATION_RECEIPT_TTL_MS);
  const staleReceipts = await db.worldBlockOperationReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId).lt("receiptCreatedAt", staleBefore))
    .order("asc")
    .take(WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT);
  for (const receipt of staleReceipts) await db.worldBlockOperationReceipts.delete(receipt.id);
}

async function maintainDroppedItemReceipts(
  db: WriteDatabase,
  userId: string,
  committedReceiptId: string,
  now: number,
): Promise<void> {
  const newestReceipts = await db.droppedItemReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_DROPPED_ITEM_RECEIPTS_PER_USER + DROPPED_ITEM_RECEIPT_PRUNE_LIMIT);
  const overflowIds = selectDroppedItemReceiptOverflow(newestReceipts, committedReceiptId);
  for (const receiptId of overflowIds) await db.droppedItemReceipts.delete(receiptId);

  const staleBefore = String(now - DROPPED_ITEM_RECEIPT_TTL_MS);
  const staleReceipts = await db.droppedItemReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId).lt("receiptCreatedAt", staleBefore))
    .order("asc")
    .take(DROPPED_ITEM_RECEIPT_PRUNE_LIMIT);
  for (const receipt of staleReceipts) await db.droppedItemReceipts.delete(receipt.id);
}

async function pruneExpiredDroppedItems(db: WriteDatabase, now: number): Promise<void> {
  const expiredRows = await db.droppedItems
    .withIndex("by_expiry", (q) => q.lt("expiresAt", String(now)))
    .order("asc")
    .take(DROPPED_ITEM_EXPIRY_PRUNE_LIMIT);
  for (const dropId of selectExpiredDroppedItemIds(expiredRows, now)) await db.droppedItems.delete(dropId);
}

async function maintainPlayerCombatReceipts(
  db: WriteDatabase,
  userId: string,
  committedReceiptId: string,
  now: number,
): Promise<void> {
  const newestReceipts = await db.playerCombatReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_PLAYER_COMBAT_RECEIPTS_PER_USER + PLAYER_COMBAT_RECEIPT_PRUNE_LIMIT);
  const overflowIds = selectPlayerCombatReceiptOverflow(newestReceipts, committedReceiptId);
  for (const receiptId of overflowIds) await db.playerCombatReceipts.delete(receiptId);
  const staleBefore = String(now - PLAYER_COMBAT_RECEIPT_TTL_MS);
  const staleReceipts = await db.playerCombatReceipts
    .withIndex("by_user_created", (q) => q.eq("userId", userId).lt("receiptCreatedAt", staleBefore))
    .order("asc")
    .take(PLAYER_COMBAT_RECEIPT_PRUNE_LIMIT);
  for (const receipt of staleReceipts) await db.playerCombatReceipts.delete(receipt.id);
}

function databaseRowToChunkEdit(row: Record<string, unknown>): WorldChunkEditInput | null {
  if (
    typeof row.x !== "string"
    || typeof row.y !== "string"
    || typeof row.z !== "string"
    || typeof row.blockType !== "string"
  ) return null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    x: row.x,
    y: row.y,
    z: row.z,
    blockType: row.blockType,
    editedAt: typeof row.editedAt === "string"
      ? row.editedAt
      : typeof row.updatedAt === "string" ? row.updatedAt : "0"
  };
}

async function maintainWorldChunkSnapshot(
  db: WriteDatabase,
  worldEditRow: Record<string, unknown>,
): Promise<void> {
  const edit = databaseRowToChunkEdit(worldEditRow);
  if (!edit) throw new Error("Unable to encode the shared world edit.");
  const chunkKey = worldEditChunkKey(Number(edit.x), Number(edit.z));
  const existing = await db.worldChunks
    .withIndex("by_chunk", (q) => q.eq("chunkKey", chunkKey))
    .order("desc")
    .first();
  let snapshot = existing && typeof existing.snapshotJson === "string"
    ? applyWorldChunkEdit(chunkKey, existing.snapshotJson, edit)
    : null;
  if (!snapshot?.ok) {
    // First touch (or corrupt row recovery) safely folds every current legacy row
    // for this chunk. Mutations are serialized, and the just-written row is included.
    const legacyRows = await db.worldEdits.withIndex("by_edited").order("asc").collect();
    const legacyEdits = legacyRows
      .map((row) => databaseRowToChunkEdit(row))
      .filter((row): row is WorldChunkEditInput => row !== null);
    snapshot = createWorldChunkSnapshot(chunkKey, legacyEdits);
  }
  if (!snapshot.ok) throw new Error(`Unable to compact shared world chunk: ${snapshot.reason}`);
  const value = {
    chunkKey,
    snapshotJson: snapshot.snapshotJson,
    revision: incrementStoredRevision(existing?.revision),
  };
  if (existing) await db.worldChunks.update(existing.id, value);
  else await db.worldChunks.insert(value);
}

function databaseRowToStoredMobAuthority(row: Record<string, unknown> | null): StoredMobAuthorityState | null {
  if (!row) return null;
  if (
    typeof row.mobId !== "string"
    || typeof row.kind !== "string"
    || typeof row.health !== "string"
    || typeof row.revision !== "string"
    || typeof row.deadUntil !== "string"
    || typeof row.lastAttackAt !== "string"
    || typeof row.lastAttackerId !== "string"
  ) return null;
  return {
    mobId: row.mobId,
    kind: row.kind,
    health: row.health,
    revision: row.revision,
    deadUntil: row.deadUntil,
    lastAttackAt: row.lastAttackAt,
    lastAttackerId: row.lastAttackerId
  };
}

function databaseRowToStoredPlayerCombat(row: Record<string, unknown> | null): StoredPlayerCombatState | null {
  if (!row || typeof row.userId !== "string" || typeof row.health !== "string"
    || typeof row.revision !== "string" || typeof row.deadUntil !== "string"
    || typeof row.lastAttackAt !== "string" || typeof row.lastAttackerId !== "string") return null;
  return {
    userId: row.userId,
    health: row.health,
    revision: row.revision,
    deadUntil: row.deadUntil,
    lastAttackAt: row.lastAttackAt,
    lastAttackerId: row.lastAttackerId,
  };
}

function databaseRowToStoredMobWorld(row: Record<string, unknown> | null): StoredMobWorldAuthorityRow | null {
  if (!row || typeof row.authorityKey !== "string" || typeof row.ownerUserId !== "string"
    || typeof row.leaseId !== "string" || typeof row.leaseExpiresAt !== "string"
    || typeof row.checkpointJson !== "string" || typeof row.inputJson !== "string"
    || typeof row.checkpointRevision !== "string"
    || typeof row.checkpointAt !== "string") return null;
  return {
    authorityKey: row.authorityKey,
    ownerUserId: row.ownerUserId,
    leaseId: row.leaseId,
    leaseExpiresAt: row.leaseExpiresAt,
    checkpointJson: row.checkpointJson,
    inputJson: row.inputJson,
    checkpointRevision: row.checkpointRevision,
    checkpointAt: row.checkpointAt,
  };
}

function serverTerrainHeight(x: number, z: number): number {
  const blockX = Math.floor(x);
  const blockZ = Math.floor(z);
  for (let y = 20; y >= -24; y -= 1) {
    const block = naturalWorldBlockAt(blockX, y, blockZ);
    if (block === "grass" || block === "sand") return y;
  }
  return 3;
}

type FurnaceAuthorityView = {
  state: FurnaceState;
  revision: string;
  blockInstanceToken: string;
};

function furnaceBlockInstanceToken(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" && typeof row.updatedAt === "string" && row.updatedAt
    ? `${row.id}:${row.updatedAt}`
    : null;
}

function materializedFurnaceView(
  row: Record<string, unknown> | null,
  coordKey: string,
  blockInstanceToken: string,
  serverNow: number,
): FurnaceAuthorityView | null {
  if (!row || row.blockInstanceToken !== blockInstanceToken) {
    const created = createEmptyFurnace(coordKey, serverNow);
    return created.ok ? { state: created.state, revision: "0", blockInstanceToken } : null;
  }
  if (row.coordKey !== coordKey || typeof row.stateJson !== "string"
    || typeof row.revision !== "string" || !/^\d{1,16}$/.test(row.revision)) return null;
  const validated = validateFurnaceJson(row.stateJson, coordKey);
  const revision = Number(row.revision);
  if (!validated.ok || !Number.isSafeInteger(revision)) return null;
  const materialized = materializeFurnace(validated.state, serverNow);
  return materialized.ok
    ? { state: materialized.state, revision: String(revision), blockInstanceToken }
    : null;
}

function furnaceWithinReach(
  presenceRow: Record<string, unknown> | null,
  userId: string,
  coordinate: { x: number; y: number; z: number },
  serverNow: number,
): boolean {
  const pose = authoritativeCombatPose(presenceRow, userId, serverNow);
  return Boolean(pose && Math.hypot(
    coordinate.x + 0.5 - pose.x,
    coordinate.y + 0.5 - (pose.y + 1.62),
    coordinate.z + 0.5 - pose.z,
  ) <= 6);
}

function mobWorldIsNight(clock: { epochMs: string; epochPhase: string } | null, serverNow: number): boolean {
  const snapshot = worldClockSnapshot(clock, serverNow);
  const phase = worldPhaseAt(serverNow, snapshot.epochMs, snapshot.epochPhase, snapshot.cycleLengthMs);
  return phase >= 0.7 || phase < 0.18;
}

export default capsule({
  name: "lakecraft",

  schema: {
    worldEdits: table({
      coordKey: string(),
      x: string(),
      y: string(),
      z: string(),
      blockType: string(),
      actorId: string(),
      editedAt: string().default("0")
    })
      .index("by_coord", ["coordKey"])
      .index("by_edited", ["editedAt"]),

    /** Compact authoritative renderer snapshots, one row per 8x8 x/z column. */
    worldChunks: table({
      chunkKey: string(),
      snapshotJson: string(),
      revision: string().default("0")
    }).index("by_chunk", ["chunkKey"]),

    playerPresence: table({
      userId: string(),
      displayName: string(),
      color: string(),
      x: string(),
      y: string(),
      z: string(),
      yaw: string(),
      pitch: string(),
      /** Defaults retain compatibility with rows written before motion-aware presence. */
      vx: string().default("0"),
      vy: string().default("0"),
      vz: string().default("0"),
      /** Empty defaults retain rows written before equipment-aware avatars. */
      heldItem: string().default(""),
      armorHead: string().default(""),
      armorChest: string().default(""),
      armorLegs: string().default(""),
      armorFeet: string().default(""),
      sessionId: string().default(""),
      heartbeatAt: string(),
      online: boolean().default(true)
    })
      .index("by_user", ["userId"])
      .index("by_heartbeat", ["heartbeatAt"]),

    /** Server-owned bed home plus one active, expiring relocation grant per user. */
    playerRespawns: table({
      userId: string(),
      bedCoordKey: string().default(""),
      bedX: string().default(""),
      bedY: string().default(""),
      bedZ: string().default(""),
      bedYaw: string().default(""),
      bedPitch: string().default(""),
      bedSetAt: string().default("0"),
      grantEpoch: string().default("0"),
      grantX: string().default(""),
      grantY: string().default(""),
      grantZ: string().default(""),
      grantYaw: string().default(""),
      grantPitch: string().default(""),
      grantIssuedAt: string().default("0"),
      grantExpiresAt: string().default("0"),
      grantConsumedAt: string().default(""),
      lastAuthorizedAt: string().default("0")
    }).index("by_user", ["userId"]),

    inventories: table({
      userId: string(),
      inventoryJson: string(),
      revision: string().default("0")
    }).index("by_user", ["userId"]),

    /** Bounded receipts make retried mining, placement, and door toggles exact-once. */
    worldBlockOperationReceipts: table({
      userId: string(),
      operationId: string(),
      fingerprint: string(),
      resultJson: string(),
      receiptCreatedAt: string()
    })
      .index("by_user_operation", ["userId", "operationId"])
      .index("by_user_created", ["userId", "receiptCreatedAt"]),

    /** Shared container state. updatedAt is the optimistic concurrency token. */
    chests: table({
      coordKey: string(),
      inventoryJson: string(),
      lastActorId: string()
    }).index("by_coord", ["coordKey"]),

    /** One deterministic three-slot furnace state per placed block instance. */
    furnaces: table({
      coordKey: string(),
      blockInstanceToken: string(),
      stateJson: string(),
      revision: string().default("1"),
      lastActorId: string()
    }).index("by_coord", ["coordKey"]),

    /** Bounded exact-replay window for atomic player/furnace transfers. */
    furnaceTransferReceipts: table({
      userId: string(),
      operationId: string(),
      fingerprint: string(),
      resultJson: string(),
      receiptCreatedAt: string()
    })
      .index("by_user_operation", ["userId", "operationId"])
      .index("by_user_created", ["userId", "receiptCreatedAt"]),

    /** Idempotency receipts make retried atomic chest transfers replay-safe. */
    chestTransferReceipts: table({
      userId: string(),
      operationId: string(),
      fingerprint: string(),
      resultJson: string(),
      receiptCreatedAt: string()
    })
      .index("by_user_operation", ["userId", "operationId"])
      .index("by_user_created", ["userId", "receiptCreatedAt"]),

    /** Five-minute world entities created only by atomic inventory-removing mutations. */
    droppedItems: table({
      dropId: string(),
      chunkKey: string(),
      ownerUserId: string(),
      sourceUserId: string(),
      itemJson: string(),
      x: string(),
      y: string(),
      z: string(),
      droppedAt: string(),
      ownerPickupAt: string(),
      expiresAt: string()
    })
      .index("by_drop", ["dropId"])
      .index("by_chunk_expiry", ["chunkKey", "expiresAt"])
      .index("by_owner_expiry", ["ownerUserId", "expiresAt"])
      .index("by_expiry", ["expiresAt"]),

    /** User-scoped operation receipts make drop and pickup retries idempotent. */
    droppedItemReceipts: table({
      userId: string(),
      operationId: string(),
      fingerprint: string(),
      resultJson: string(),
      receiptCreatedAt: string()
    })
      .index("by_user_operation", ["userId", "operationId"])
      .index("by_user_created", ["userId", "receiptCreatedAt"]),

    /** Immutable, one-time username claims. Lakebed serializes each mutation transaction. */
    profiles: table({
      userId: string(),
      username: string(),
      normalizedUsername: string(),
      claimedAt: string()
    })
      .index("by_user", ["userId"])
      .index("by_username", ["normalizedUsername"]),

    chatMessages: table({
      userId: string(),
      username: string(),
      message: string(),
      sentAt: string()
    })
      .index("by_sent_at", ["sentAt"])
      .index("by_user_sent_at", ["userId", "sentAt"]),

    /** Singleton-like shared day/night origin, addressed by WORLD_CLOCK_KEY. */
    worldClock: table({
      clockKey: string(),
      epochMs: string(),
      epochPhase: string()
    }).index("by_key", ["clockKey"]),

    /** One current vote per authenticated user; stale rows are pruned on each vote. */
    sleepVotes: table({
      userId: string(),
      coordKey: string(),
      votedAt: string()
    })
      .index("by_user", ["userId"])
      .index("by_voted_at", ["votedAt"]),

    /** Sparse per-mob health/death authority; motion lives in the singleton timeline below. */
    mobAuthority: table({
      mobId: string(),
      kind: string(),
      health: string(),
      revision: string(),
      deadUntil: string(),
      lastAttackAt: string(),
      lastAttackerId: string()
    }).index("by_mob", ["mobId"]),

    /** Exactly one fixed-point mob checkpoint and one renewable writer lease. */
    mobWorldAuthority: table({
      authorityKey: string(),
      ownerUserId: string(),
      leaseId: string(),
      leaseExpiresAt: string(),
      checkpointJson: string(),
      inputJson: string().default('{"version":1,"isNight":false,"targets":[]}'),
      checkpointRevision: string(),
      checkpointAt: string()
    }).index("by_key", ["authorityKey"]),

    /** Event-driven player combat state; movement remains in the sparse presence lease. */
    playerCombat: table({
      userId: string(),
      health: string(),
      revision: string(),
      deadUntil: string(),
      lastAttackAt: string(),
      lastAttackerId: string()
    }).index("by_user", ["userId"]),

    /** Bounded attack receipts make mutation retries safe without an unbounded event log. */
    playerCombatReceipts: table({
      userId: string(),
      operationId: string(),
      fingerprint: string(),
      resultJson: string(),
      receiptCreatedAt: string()
    })
      .index("by_user_operation", ["userId", "operationId"])
      .index("by_user_created", ["userId", "receiptCreatedAt"])
  },

  queries: {
    worldEdits: query(async (ctx) =>
      ctx.db.worldEdits.withIndex("by_edited").order("desc").take(1_000)
    ),

    worldChunks: query(async (ctx, rawChunkKeys: string[]) => {
      const validation = validateVisibleWorldChunkKeys(rawChunkKeys);
      if (!validation.ok) return { ok: false, reason: validation.reason, chunks: [] };
      const chunks: Array<{ chunkKey: string; snapshotJson: string; revision: string; updatedAt: string }> = [];
      const missingChunkKeys: string[] = [];
      for (const chunkKey of validation.chunkKeys) {
        const row = await ctx.db.worldChunks
          .withIndex("by_chunk", (q) => q.eq("chunkKey", chunkKey))
          .order("desc")
          .first();
        if (row) chunks.push({
          chunkKey: row.chunkKey,
          snapshotJson: row.snapshotJson,
          revision: storedRevision(row.revision) ?? "0",
          updatedAt: row.updatedAt,
        });
        else missingChunkKeys.push(chunkKey);
      }
      // Read-only compatibility for untouched pre-chunk data. The first later
      // write persists the same compact snapshot, removing this fallback cost.
      if (missingChunkKeys.length) {
        const legacyRows = await ctx.db.worldEdits.withIndex("by_edited").order("asc").collect();
        const legacyEdits = legacyRows
          .map((row) => databaseRowToChunkEdit(row))
          .filter((row): row is WorldChunkEditInput => row !== null);
        for (const chunkKey of missingChunkKeys) {
          const snapshot = createWorldChunkSnapshot(chunkKey, legacyEdits);
          if (snapshot.ok && snapshot.editCount > 0) {
            chunks.push({ chunkKey, snapshotJson: snapshot.snapshotJson, revision: "0", updatedAt: "0" });
          }
        }
      }
      chunks.sort((a, b) => a.chunkKey.localeCompare(b.chunkKey));
      return { ok: true, chunks };
    }),

    droppedItems: query(async (ctx, rawChunkKeys: string[]) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", items: [], serverNow };
      }
      const validation = validateVisibleDroppedItemChunkKeys(rawChunkKeys);
      if (!validation.ok) return { ok: false, reason: validation.reason, items: [], serverNow };
      const items = [];
      for (const chunkKey of validation.chunkKeys) {
        const rows = await ctx.db.droppedItems
          .withIndex("by_chunk_expiry", (q) => q.eq("chunkKey", chunkKey).gt("expiresAt", String(serverNow)))
          .order("asc")
          .take(MAX_VISIBLE_DROPPED_ITEMS_PER_CHUNK);
        for (const row of rows) {
          const item = normalizeDroppedItemRow(row, serverNow);
          if (item) items.push(item);
          if (items.length >= MAX_VISIBLE_DROPPED_ITEMS) break;
        }
        if (items.length >= MAX_VISIBLE_DROPPED_ITEMS) break;
      }
      return { ok: true, items, serverNow };
    }),

    worldEditsAt: query(async (ctx, coordKey: string) =>
      ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordKey.trim().slice(0, 96)))
        .order("asc")
        .collect()
    ),

    recentPlayers: query(async (ctx, activeSince: string) => ({
      players: await ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", activeSince.trim().slice(0, 32)))
        .order("desc")
        .take(128),
      serverNow: Date.now(),
    })),

    myPresence: query(async (ctx) =>
      (await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    ),

    myInventory: query(async (ctx) =>
      (await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    ),

    chestAt: query(async (ctx, rawCoordKey: string) => {
      const coordinate = validateChestCoordinate(rawCoordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason };
      const chest = await ctx.db.chests
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .first();
      return { ok: true, chest: chest ?? null };
    }),

    furnaceAt: query(async (ctx, request: { coordKey: string; sample: string }) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const coordinate = request && typeof request.coordKey === "string"
        && typeof request.sample === "string" && request.sample.length <= 16
        ? validateFurnaceCoordinate(request.coordKey)
        : { ok: false as const, reason: "invalid_coordinate" as const };
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason, serverNow };
      const worldRows = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .take(2);
      const presenceRows = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      const furnaceRows = await ctx.db.furnaces
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .take(2);
      if (worldRows.length !== 1 || worldRows[0].blockType !== "furnace") {
        return { ok: false, reason: "furnace_required", serverNow };
      }
      if (presenceRows.length !== 1
        || !furnaceWithinReach(presenceRows[0], ctx.auth.userId, coordinate, serverNow)) {
        return { ok: false, reason: "out_of_reach", serverNow };
      }
      if (furnaceRows.length > 1) return { ok: false, reason: "duplicate_state", serverNow };
      const blockInstanceToken = furnaceBlockInstanceToken(worldRows[0]);
      const furnace = blockInstanceToken
        ? materializedFurnaceView(furnaceRows[0] ?? null, coordinate.coordKey, blockInstanceToken, serverNow)
        : null;
      return furnace
        ? { ok: true, furnace, serverNow }
        : { ok: false, reason: "invalid_state", serverNow };
    }),

    myProfile: query(async (ctx) =>
      (await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    ),

    /** Bounded profile event feed; currently one immutable claim exists per user. */
    currentProfiles: query(async (ctx) =>
      ctx.db.profiles.withIndex("by_creation").order("desc").take(512)
    ),

    usernameAvailability: query(async (ctx, requestedUsername: string) => {
      const validation = validateUsername(requestedUsername);
      if (!validation.ok) {
        return { available: false, username: requestedUsername.trim().toLowerCase(), reason: validation.reason };
      }
      const claim = await ctx.db.profiles
        .withIndex("by_username", (q) => q.eq("normalizedUsername", validation.username))
        .order("asc")
        .first();
      if (!claim || claim.userId === ctx.auth.userId) {
        return { available: true, username: validation.username };
      }
      return { available: false, username: validation.username, reason: "taken" };
    }),

    recentChat: query(async (ctx) => {
      const newest = await ctx.db.chatMessages
        .withIndex("by_sent_at")
        .order("desc")
        .take(RECENT_CHAT_LIMIT);
      return newest.reverse();
    }),

    worldClock: query(async (ctx) => {
      const serverNow = Date.now();
      const clock = await ctx.db.worldClock
        .withIndex("by_key", (q) => q.eq("clockKey", WORLD_CLOCK_KEY))
        .order("desc")
        .first();
      return worldClockSnapshot(clock, serverNow);
    }),

    mobAuthority: query(async (ctx, rawMobIds: string[]) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", states: [], serverNow };
      }
      const validation = validateMobIdList(rawMobIds, MOB_AUTHORITY_WORLD_SEED_TOKEN);
      if (!validation.ok) return { ok: false, reason: validation.reason, states: [], serverNow };
      const states = [];
      for (const mobId of validation.mobIds) {
        const identity = validateMobIdentity(mobId, undefined, MOB_AUTHORITY_WORLD_SEED_TOKEN);
        if (!identity.ok) continue;
        const row = await ctx.db.mobAuthority
          .withIndex("by_mob", (q) => q.eq("mobId", mobId))
          .order("desc")
          .first();
        states.push(materializeMobAuthorityState(
          databaseRowToStoredMobAuthority(row),
          identity.mobId,
          identity.kind,
          serverNow,
        ));
      }
      return { ok: true, states, serverNow };
    }),

    mobWorldAuthority: query(async (ctx, request: { mobIds: string[]; sample: string }) => {
      const serverNow = Date.now();
      const empty = {
        checkpointRevision: 0,
        motionTick: 0,
        checkpointAt: 0,
        leaseOwnerUserId: "",
        leaseExpiresAt: 0,
        poses: [],
        states: [],
        damageClaims: [],
        needsCheckpoint: false,
        serverNow,
      };
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", ...empty };
      }
      const rawMobIds = request && Array.isArray(request.mobIds) && typeof request.sample === "string"
        && request.sample.length <= 16
        ? request.mobIds
        : null;
      if (!rawMobIds) return { ok: false, reason: "invalid_request", ...empty };
      const validation = validateMobIdList(rawMobIds, MOB_AUTHORITY_WORLD_SEED_TOKEN);
      if (!validation.ok) return { ok: false, reason: validation.reason, ...empty };
      const rows = await ctx.db.mobWorldAuthority
        .withIndex("by_key", (q) => q.eq("authorityKey", MOB_WORLD_AUTHORITY_KEY))
        .order("desc")
        .take(2);
      if (rows.length > 1) return { ok: false, reason: "duplicate_state", ...empty };
      const stored = databaseRowToStoredMobWorld(rows[0] ?? null);
      if (!stored) {
        // Subscribe the empty-world query to this caller's presence so the first
        // accepted heartbeat retriggers lease initialization without polling.
        await ctx.db.playerPresence
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .first();
        return { ok: true, ...empty, needsCheckpoint: true };
      }

      const replayInput = parseMobWorldReplayInputJson(stored.inputJson);
      if (!replayInput) return { ok: false, reason: "invalid_replay_input", ...empty };
      const advanced = advanceMobWorldState(stored, serverNow, replayInput);
      if (!advanced) return { ok: false, reason: "invalid_checkpoint", ...empty };
      const requested = new Set(validation.mobIds);
      const poses = writeMobMotionPoses(advanced.state).filter((pose) => requested.has(pose.mobId));
      const states = [];
      for (const mobId of validation.mobIds) {
        const identity = validateMobIdentity(mobId, undefined, MOB_AUTHORITY_WORLD_SEED_TOKEN);
        if (!identity.ok) continue;
        const row = await ctx.db.mobAuthority
          .withIndex("by_mob", (q) => q.eq("mobId", mobId))
          .order("desc")
          .first();
        states.push(materializeMobAuthorityState(databaseRowToStoredMobAuthority(row), identity.mobId, identity.kind, serverNow));
      }
      const callerTarget = replayInput.targets.find((target) => target.userId === ctx.auth.userId);
      const aliveMobIds = new Set(states.filter((state) => state.health > 0).map((state) => state.mobId));
      const checkpointAt = advanced.checkpointAt + advanced.ticks * 1_000 / 10;
      return {
        ok: true,
        checkpointRevision: advanced.revision,
        motionTick: advanced.state.tick,
        checkpointAt,
        leaseOwnerUserId: stored.ownerUserId,
        leaseExpiresAt: parseStoredInteger(stored.leaseExpiresAt) ?? 0,
        poses,
        states,
        damageClaims: callerTarget
          ? mobDamageClaimsForTarget(advanced.state, callerTarget, advanced.revision)
            .filter((claim) => aliveMobIds.has(claim.mobId))
          : [],
        needsCheckpoint: serverNow - advanced.checkpointAt >= MOB_WORLD_CHECKPOINT_MS,
        serverNow,
      };
    }),

    playerCombatStates: query(async (ctx, rawUserIds: string[]) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", states: [], serverNow };
      }
      const validation = validatePlayerCombatUserIds(rawUserIds);
      if (!validation.ok) return { ok: false, reason: validation.reason, states: [], serverNow };
      const states = [];
      for (const userId of validation.userIds) {
        const row = await ctx.db.playerCombat
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .order("desc")
          .first();
        states.push(materializePlayerCombatState(databaseRowToStoredPlayerCombat(row), userId, serverNow));
      }
      return { ok: true, states, serverNow };
    })
  },

  mutations: {
    /** The only public world-edit path: atomic, authoritative, and idempotent. */
    editWorldBlock: mutation(async (
      ctx,
      requestJson: string,
      poseX: string,
      poseY: string,
      poseZ: string,
      poseYaw: string,
      posePitch: string,
    ) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      if (typeof requestJson !== "string" || requestJson.length > MAX_WORLD_BLOCK_OPERATION_REQUEST_BYTES) {
        return { ok: false, reason: "invalid_request" };
      }
      let rawRequest: unknown;
      try {
        rawRequest = JSON.parse(requestJson);
      } catch {
        return { ok: false, reason: "invalid_request" };
      }
      const validation = parseWorldBlockOperation(rawRequest);
      if (!validation.ok) return { ok: false, reason: "invalid_request", detail: validation.reason };
      const pose = validatePresencePoseFields(poseX, poseY, poseZ, poseYaw, posePitch);
      if (!pose) return { ok: false, reason: "invalid_pose" };
      const request = validation.request;
      const fingerprint = worldBlockOperationPoseFingerprint(validation.fingerprint, pose);

      // Receipt lookup intentionally precedes every mutable-state read. An exact
      // replay returns before any profile, presence, inventory, chunk, or edit write.
      const existingReceipts = await ctx.db.worldBlockOperationReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .take(2);
      if (existingReceipts.length > 1) return { ok: false, reason: "duplicate_state" };
      const existingReceipt = existingReceipts[0] ?? null;
      if (existingReceipt) {
        if (existingReceipt.fingerprint !== fingerprint) {
          return { ok: false, reason: "operation_id_reused" };
        }
        const replay = decodeWorldBlockOperationReceipt(existingReceipt.resultJson);
        if (!replay) return { ok: false, reason: "conservation_failure" };
        const replayInventories = await ctx.db.inventories
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .take(2);
        const replayChunks = await ctx.db.worldChunks
          .withIndex("by_chunk", (q) => q.eq("chunkKey", replay.chunkKey))
          .order("desc")
          .take(2);
        if (replayInventories.length !== 1 || replayChunks.length !== 1) {
          return { ok: false, reason: "duplicate_or_missing_state" };
        }
        const currentChunkRevision = storedRevision(replayChunks[0].revision);
        if (storedRevision(replayInventories[0].revision) === null || currentChunkRevision === null) {
          return { ok: false, reason: "conservation_failure" };
        }
        return { ...replay, inventory: replayInventories[0], currentChunkRevision };
      }

      const serverNow = Date.now();
      const profile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!profile) return { ok: false, reason: "profile_required" };
      const presence = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const poseAuthority = validateWorldBlockActionPose(
        presence,
        ctx.auth.userId,
        pose,
        { x: request.x, y: request.y, z: request.z },
        serverNow,
      );
      if (!poseAuthority.ok) return { ok: false, reason: poseAuthority.reason };

      const inventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (inventoryRows.length > 1) return { ok: false, reason: "duplicate_state" };
      const inventoryRow = inventoryRows[0] ?? null;
      if (!inventoryRow) return { ok: false, reason: "inventory_required" };
      const playerState = validatePlayerStateJson(inventoryRow.inventoryJson);
      const inventoryRevision = storedRevision(inventoryRow.revision);
      if (!playerState.ok || inventoryRevision === null) {
        return { ok: false, reason: "conservation_failure" };
      }

      const chunkKey = worldEditChunkKey(request.x, request.z);
      const chunkRows = await ctx.db.worldChunks
        .withIndex("by_chunk", (q) => q.eq("chunkKey", chunkKey))
        .order("desc")
        .take(2);
      if (chunkRows.length > 1) return { ok: false, reason: "duplicate_state" };
      const chunkRow = chunkRows[0] ?? null;
      const chunkRevision = storedRevision(chunkRow?.revision);
      if (chunkRevision === null) return { ok: false, reason: "conservation_failure" };

      const coordKey = `${request.x}:${request.y}:${request.z}`;
      const currentEdits = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordKey))
        .order("desc")
        .take(2);
      if (currentEdits.length > 1) return { ok: false, reason: "duplicate_state" };
      const currentEdit = currentEdits[0] ?? null;
      const currentBlock = currentEdit
        ? currentEdit.blockType
        : naturalWorldBlockAt(request.x, request.y, request.z);
      if (currentBlock !== "air" && !PLACEABLE_BLOCKS.has(currentBlock)) {
        return { ok: false, reason: "conservation_failure" };
      }

      const resolution = resolveWorldBlockOperation(request, {
        currentBlock,
        inventory: playerState.state.inventory,
        inventoryRevision,
        chunkRevision,
      });
      if (!resolution.ok) return { ok: false, reason: resolution.reason };
      const effect = resolution.effect;
      let minedFurnaceRow: Record<string, unknown> | null = null;
      const furnaceRecoveryDrops: Array<NonNullable<ReturnType<typeof buildDroppedItemRow>>> = [];
      if (effect.kind === "mine" && effect.previousBlock === "furnace") {
        const furnaceRows = await ctx.db.furnaces
          .withIndex("by_coord", (q) => q.eq("coordKey", coordKey))
          .order("desc")
          .take(2);
        if (furnaceRows.length > 1) return { ok: false, reason: "duplicate_state" };
        minedFurnaceRow = furnaceRows[0] ?? null;
        const blockInstanceToken = currentEdit ? furnaceBlockInstanceToken(currentEdit) : null;
        if (!blockInstanceToken) return { ok: false, reason: "conservation_failure" };
        let recoveryStacks: ItemStack[] = [];
        if (minedFurnaceRow && minedFurnaceRow.blockInstanceToken !== blockInstanceToken) {
          return { ok: false, reason: "invalid_state" };
        }
        if (minedFurnaceRow) {
          const furnace = materializedFurnaceView(
            minedFurnaceRow,
            coordKey,
            blockInstanceToken,
            serverNow,
          );
          if (!furnace) return { ok: false, reason: "conservation_failure" };
          recoveryStacks = [furnace.state.input, furnace.state.fuel, furnace.state.output]
            .filter((stack): stack is ItemStack => stack !== null);
        }
        if (recoveryStacks.length > 0) {
          const activeOwnedDrops = await ctx.db.droppedItems
            .withIndex("by_owner_expiry", (q) => q
              .eq("ownerUserId", ctx.auth.userId)
              .gt("expiresAt", String(serverNow)))
            .order("asc")
            .take(65);
          if (recoveryStacks.some((_, index) => !canCreateDroppedItem(activeOwnedDrops.length + index))) {
            return { ok: false, reason: "drop_limit" };
          }
          for (let index = 0; index < recoveryStacks.length; index += 1) {
            const recoveryOperationId = `${request.operationId.slice(0, 60)}_f${index}`;
            const droppedValue = buildDroppedItemRow(
              ctx.auth.userId,
              recoveryOperationId,
              recoveryStacks[index],
              { x: pose.x, y: pose.y, z: pose.z },
              pose.yaw,
              serverNow,
            );
            if (!droppedValue) return { ok: false, reason: "conservation_failure" };
            const collision = await ctx.db.droppedItems
              .withIndex("by_drop", (q) => q.eq("dropId", droppedValue.dropId))
              .order("desc")
              .first();
            if (collision) return { ok: false, reason: "drop_id_collision" };
            furnaceRecoveryDrops.push(droppedValue);
          }
        }
      }
      const worldEditValue = {
        coordKey,
        x: String(request.x),
        y: String(request.y),
        z: String(request.z),
        blockType: effect.nextBlock,
        actorId: ctx.auth.userId,
        editedAt: String(serverNow),
      };
      const snapshot = chunkRow
        ? applyWorldChunkEdit(chunkKey, chunkRow.snapshotJson, worldEditValue)
        : createWorldChunkSnapshot(chunkKey, [worldEditValue]);
      if (!snapshot.ok) return { ok: false, reason: "conservation_failure", detail: snapshot.reason };

      const worldEdit = currentEdit
        ? await ctx.db.worldEdits.update(currentEdit.id, worldEditValue)
        : await ctx.db.worldEdits.insert(worldEditValue);
      const chunkValue = {
        chunkKey,
        snapshotJson: snapshot.snapshotJson,
        revision: effect.chunkRevision,
      };
      const chunk = chunkRow
        ? await ctx.db.worldChunks.update(chunkRow.id, chunkValue)
        : await ctx.db.worldChunks.insert(chunkValue);
      if (!worldEdit || !chunk) throw new Error("Unable to persist authoritative world edit.");

      let persistedInventory = inventoryRow;
      if (effect.inventoryChanged) {
        const inventoryJson = JSON.stringify({ ...playerState.state, inventory: effect.inventory });
        const inventory = await ctx.db.inventories.update(inventoryRow.id, {
          userId: ctx.auth.userId,
          inventoryJson,
          revision: effect.inventoryRevision,
        });
        if (!inventory) throw new Error("Unable to persist authoritative inventory.");
        persistedInventory = inventory;
      }

      for (const droppedValue of furnaceRecoveryDrops) {
        const recovered = await ctx.db.droppedItems.insert(droppedValue);
        if (!recovered) throw new Error("Unable to recover mined furnace contents.");
      }
      if (minedFurnaceRow) await ctx.db.furnaces.delete(minedFurnaceRow.id as string);

      if (!presence) throw new Error("Active presence disappeared during world edit.");
      const presenceValue = {
        userId: ctx.auth.userId,
        displayName: profile.username,
        color: presence.color,
        x: String(pose.x),
        y: String(pose.y),
        z: String(pose.z),
        yaw: String(pose.yaw),
        pitch: String(pose.pitch),
        vx: presence.vx ?? "0",
        vy: presence.vy ?? "0",
        vz: presence.vz ?? "0",
        heldItem: presence.heldItem ?? "",
        armorHead: presence.armorHead ?? "",
        armorChest: presence.armorChest ?? "",
        armorLegs: presence.armorLegs ?? "",
        armorFeet: presence.armorFeet ?? "",
        heartbeatAt: String(serverNow),
        online: true,
      };
      const updatedPresence = await ctx.db.playerPresence.update(presence.id, presenceValue);
      if (!updatedPresence) throw new Error("Unable to persist authoritative action presence.");

      const result: WorldBlockOperationReceiptResult = {
        ok: true,
        replayed: false,
        operationId: request.operationId,
        kind: effect.kind,
        x: request.x,
        y: request.y,
        z: request.z,
        previousBlock: effect.previousBlock,
        nextBlock: effect.nextBlock,
        inventoryRevision: effect.inventoryRevision,
        chunkKey,
        chunkRevision: effect.chunkRevision,
        inventoryChanged: effect.inventoryChanged,
        drop: effect.drop,
        consumed: effect.consumed,
        toolUse: effect.toolUse ? {
          used: effect.toolUse.used,
          broke: effect.toolUse.broke,
          itemId: effect.toolUse.itemId,
          remainingDurability: effect.toolUse.remainingDurability,
        } : null,
      };
      const receipt = await ctx.db.worldBlockOperationReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint,
        resultJson: encodeWorldBlockOperationReceipt(result),
        receiptCreatedAt: String(serverNow),
      });
      await maintainWorldBlockOperationReceipts(ctx.db, ctx.auth.userId, receipt.id, serverNow);
      return {
        ...result,
        inventory: persistedInventory,
        currentChunkRevision: effect.chunkRevision,
      };
    }),

    startPresenceSession: mutation(async (ctx, rawSessionId: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      if (!validPresenceSessionId(rawSessionId)) return { ok: false, reason: "invalid_session" };
      const rows = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(64);
      const keeper = rows.find((row) => row.userId === ctx.auth.userId && validatePresencePoseFields(
        row.x,
        row.y,
        row.z,
        row.yaw,
        row.pitch,
      )) ?? null;
      for (const row of rows) {
        if (!keeper || row.id !== keeper.id) await ctx.db.playerPresence.delete(row.id);
      }
      if (keeper) await ctx.db.playerPresence.update(keeper.id, { sessionId: rawSessionId });
      return {
        ok: true,
        resetToTrailhead: rows.length > 0 && !keeper,
        spawnPose: keeper ? null : trailheadPoseForUser(ctx.auth.userId),
      };
    }),

    authorizeRespawn: mutation(async (ctx) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const serverNow = Date.now();
      const presenceRows = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      const respawnRows = await ctx.db.playerRespawns
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      const combatRows = await ctx.db.playerCombat
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (presenceRows.length !== 1 || respawnRows.length > 1 || combatRows.length > 1) {
        return { ok: false, reason: "duplicate_or_missing_state" };
      }
      const presence = presenceRows[0];
      const heartbeatAt = /^\d{1,16}$/.test(presence.heartbeatAt) ? Number(presence.heartbeatAt) : Number.NaN;
      if (!presence.online || !Number.isFinite(heartbeatAt) || serverNow - heartbeatAt < 0
        || serverNow - heartbeatAt > ACTIVE_PLAYER_WINDOW_MS) {
        return { ok: false, reason: "active_presence_required" };
      }
      const existingRespawn = respawnRows[0] ?? null;
      const combatRow = combatRows[0] ?? null;
      const activeGrant = storedRespawnGrant(existingRespawn);
      if (activeGrant) {
        const issuedAt = Number(activeGrant.issuedAt);
        const expiresAt = Number(activeGrant.expiresAt);
        if (/^\d{1,16}$/.test(activeGrant.epoch)
          && Number.isSafeInteger(issuedAt)
          && Number.isSafeInteger(expiresAt)
          && issuedAt <= serverNow
          && expiresAt > serverNow
          && expiresAt > issuedAt
          && expiresAt - issuedAt <= RESPAWN_AUTHORIZATION_COOLDOWN_MS) {
          const target = validatePresencePoseFields(
            activeGrant.x,
            activeGrant.y,
            activeGrant.z,
            activeGrant.yaw,
            activeGrant.pitch,
          );
          const currentPose = validatePresencePoseFields(
            presence.x,
            presence.y,
            presence.z,
            presence.yaw,
            presence.pitch,
          );
          if (combatRow && combatRow.health !== "0" && target && activeGrant.consumedAt && currentPose
            && target.x === currentPose.x && target.y === currentPose.y && target.z === currentPose.z
            && target.yaw === currentPose.yaw && target.pitch === currentPose.pitch) {
            return { ok: true, target, epoch: activeGrant.epoch, expiresAt };
          }
        }
      }
      if (!combatRow || combatRow.health !== "0") return { ok: false, reason: "authoritative_death_required" };
      const deadUntil = /^\d{1,16}$/.test(combatRow.deadUntil) ? Number(combatRow.deadUntil) : Number.NaN;
      if (!Number.isSafeInteger(deadUntil) || deadUntil <= 0) return { ok: false, reason: "invalid_combat_state" };
      if (deadUntil > serverNow) {
        return { ok: false, reason: "respawn_not_ready", retryAfterMs: deadUntil - serverNow };
      }
      let destination = trailheadPoseForUser(ctx.auth.userId);
      const bedRespawn = storedBedRespawnPose(existingRespawn);
      if (bedRespawn) {
        const bedRows = await ctx.db.worldEdits
          .withIndex("by_coord", (q) => q.eq("coordKey", bedRespawn.coordKey))
          .order("desc")
          .take(2);
        if (bedRows.length > 1) return { ok: false, reason: "duplicate_state" };
        if (bedRows[0]?.blockType === "bed") destination = bedRespawn.pose;
      }
      const previousEpoch = storedRevision(existingRespawn?.grantEpoch ?? "0");
      if (previousEpoch === null) return { ok: false, reason: "invalid_state" };
      const epoch = nextWorldBlockRevision(previousEpoch);
      if (epoch === null) return { ok: false, reason: "invalid_state" };
      const grant = buildPresenceRelocationGrant(ctx.auth.userId, epoch, destination, serverNow);
      if (!grant) return { ok: false, reason: "authorization_failure" };
      const value = {
        userId: ctx.auth.userId,
        bedCoordKey: existingRespawn?.bedCoordKey ?? "",
        bedX: existingRespawn?.bedX ?? "",
        bedY: existingRespawn?.bedY ?? "",
        bedZ: existingRespawn?.bedZ ?? "",
        bedYaw: existingRespawn?.bedYaw ?? "",
        bedPitch: existingRespawn?.bedPitch ?? "",
        bedSetAt: existingRespawn?.bedSetAt ?? "0",
        grantEpoch: grant.epoch,
        grantX: grant.x,
        grantY: grant.y,
        grantZ: grant.z,
        grantYaw: grant.yaw,
        grantPitch: grant.pitch,
        grantIssuedAt: grant.issuedAt,
        grantExpiresAt: grant.expiresAt,
        grantConsumedAt: String(serverNow),
        lastAuthorizedAt: String(serverNow),
      };
      if (existingRespawn) await ctx.db.playerRespawns.update(existingRespawn.id, value);
      else await ctx.db.playerRespawns.insert(value);
      await ctx.db.playerPresence.update(presence.id, {
        x: grant.x,
        y: grant.y,
        z: grant.z,
        yaw: grant.yaw,
        pitch: grant.pitch,
        vx: "0",
        vy: "0",
        vz: "0",
        heartbeatAt: String(serverNow),
        online: true,
      });
      const deadState = materializePlayerCombatState(
        databaseRowToStoredPlayerCombat(combatRow),
        ctx.auth.userId,
        deadUntil - 1,
      );
      await ctx.db.playerCombat.update(combatRow.id, storedPlayerCombatRow({
        ...deadState,
        health: deadState.maxHealth,
        revision: deadState.revision + 1,
        deadUntil: 0,
      }));
      return { ok: true, target: destination, epoch: grant.epoch, expiresAt: Number(grant.expiresAt) };
    }),

    heartbeatPlayer: mutation(
      async (
        ctx,
        _displayName: string,
        color: string,
        x: string,
        y: string,
        z: string,
        yaw: string,
        pitch: string,
        _heartbeatAt: string,
        rawVx?: string,
        rawVy?: string,
        rawVz?: string,
        rawHeldItem?: string,
        rawArmorHead?: string,
        rawArmorChest?: string,
        rawArmorLegs?: string,
        rawArmorFeet?: string,
        rawSessionId?: string,
        rawRelocationEpoch?: string
      ) => {
        if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to join the shared world.");
        const pose = validatePresencePoseFields(x, y, z, yaw, pitch);
        const velocity = validatePresenceVelocityFields(rawVx ?? "0", rawVy ?? "0", rawVz ?? "0");
        const sessionId = validPresenceSessionId(rawSessionId) ? rawSessionId : null;
        if (!pose || !velocity || !sessionId) return { ok: false, reason: "invalid_request" };
        const appearance = normalizeAvatarAppearance(
          rawHeldItem,
          rawArmorHead,
          rawArmorChest,
          rawArmorLegs,
          rawArmorFeet,
        );
        const profile = await ctx.db.profiles
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .first();
        if (!profile) throw new Error("Choose a username before joining the shared world.");
        const safeColor = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#8fbf79";
        const existingRows = await ctx.db.playerPresence
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .take(2);
        if (existingRows.length > 1) return { ok: false, reason: "duplicate_state" };
        const existing = existingRows[0] ?? null;
        if (existing?.sessionId && existing.sessionId !== sessionId) {
          return { ok: false, reason: "session_mismatch" };
        }
        const serverNow = Date.now();
        const gate = decidePresenceWriteGate(existing?.heartbeatAt, serverNow);
        if (!gate.accept) return { ok: false, reason: "rate_limited", retryAfterMs: gate.retryAfterMs };
        const relocationEpoch = typeof rawRelocationEpoch === "string" && /^\d{1,16}$/.test(rawRelocationEpoch)
          ? rawRelocationEpoch
          : null;
        let respawnRow: Record<string, unknown> | null = null;
        let activeGrant: PresenceRelocationGrant | null = null;
        if (relocationEpoch) {
          const respawnRows = await ctx.db.playerRespawns
            .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
            .order("desc")
            .take(2);
          if (respawnRows.length !== 1) return { ok: false, reason: "relocation_missing" };
          respawnRow = respawnRows[0];
          activeGrant = storedRespawnGrant(respawnRow);
        }
        const trajectory = decidePresenceTrajectory(
          ctx.auth.userId,
          existing,
          pose,
          serverNow,
          trailheadPoseForUser(ctx.auth.userId),
          relocationEpoch,
          activeGrant,
        );
        if (!trajectory.accept) {
          const persistedPose = existing
            ? validatePresencePoseFields(existing.x, existing.y, existing.z, existing.yaw, existing.pitch)
            : trailheadPoseForUser(ctx.auth.userId);
          return {
            ok: false,
            reason: trajectory.reason,
            ...(persistedPose ? { canonicalPose: persistedPose } : {}),
          };
        }
        const value = {
          userId: ctx.auth.userId,
          displayName: profile.username,
          color: safeColor,
          x: String(pose.x),
          y: String(pose.y),
          z: String(pose.z),
          yaw: String(pose.yaw),
          pitch: String(pose.pitch),
          ...encodePresenceVelocityFields(velocity),
          ...appearance,
          sessionId,
          heartbeatAt: String(serverNow),
          online: true
        };
        const persistedPresence = existing
          ? await ctx.db.playerPresence.update(existing.id, value)
          : await ctx.db.playerPresence.insert(value);
        if (!persistedPresence) throw new Error("Unable to persist authoritative presence.");
        if (trajectory.relocationGrantUpdate && respawnRow && typeof respawnRow.id === "string") {
          await ctx.db.playerRespawns.update(respawnRow.id, {
            grantConsumedAt: trajectory.relocationGrantUpdate.consumedAt ?? String(serverNow),
          });
        }
        return { ok: true, reason: trajectory.reason };
      }
    ),

    leavePlayer: mutation(async (ctx, rawSessionId: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to leave the shared world.");
      const existingRows = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (existingRows.length > 1) return null;
      const existing = existingRows[0] ?? null;
      // A leave without a prior authoritative heartbeat must not manufacture a
      // second source of spawn truth. Existing rows retain their exact pose.
      if (!existing || existing.sessionId !== rawSessionId) return null;
      return ctx.db.playerPresence.update(existing.id, buildOfflinePresenceValue(existing, Date.now()));
    }),

    saveInventory: mutation(async (ctx, inventoryJson: string, rawExpectedUpdatedAt?: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", inventory: null };
      }
      const validation = validatePlayerStateJson(inventoryJson.trim());
      if (!validation.ok) {
        return { ok: false, reason: "invalid_inventory", detail: validation.reason, inventory: null };
      }
      const expectedUpdatedAt = normalizeChestToken(rawExpectedUpdatedAt ?? "");
      if (expectedUpdatedAt === null) return { ok: false, reason: "invalid_token", inventory: null };
      const existing = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if ((existing?.updatedAt ?? null) === null) {
        if (expectedUpdatedAt !== "") return { ok: false, reason: "conflict", inventory: null };
      } else if (existing?.updatedAt !== expectedUpdatedAt) {
        return { ok: false, reason: "conflict", inventory: existing };
      }
      if (existing) {
        const previous = validatePlayerStateJson(existing.inventoryJson);
        if (!previous.ok || !isValidDurabilitySaveTransition(previous.state, validation.state)) {
          return { ok: false, reason: "invalid_inventory", inventory: existing };
        }
      }
      const value = {
        userId: ctx.auth.userId,
        inventoryJson: validation.playerStateJson,
        revision: incrementStoredRevision(existing?.revision),
      };
      const inventory = existing
        ? ctx.db.inventories.update(existing.id, value)
        : ctx.db.inventories.insert(value);
      return { ok: true, inventory: await inventory };
    }),

    dropItem: mutation(async (ctx, requestJson: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateDropItemRequestJson(requestJson);
      if (!validation.ok) return { ok: false, reason: "invalid_request", detail: validation.reason };
      const request = validation.request;
      const existingReceipt = await ctx.db.droppedItemReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .first();
      const replay = decideDroppedItemReplay(existingReceipt?.fingerprint ?? null, request.fingerprint);
      if (replay === "operation_id_reused") return { ok: false, reason: "operation_id_reused" };
      if (replay === "replay" && existingReceipt) {
        return decodeDroppedItemReceipt(existingReceipt.resultJson)
          ?? { ok: false, reason: "conservation_failure" };
      }

      const serverNow = Date.now();
      const presence = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const position = authoritativeDroppedItemPosition(presence, ctx.auth.userId, serverNow);
      if (!position) return { ok: false, reason: "active_presence_required" };

      const existingPlayer = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!existingPlayer) return { ok: false, reason: "inventory_required" };
      if (decideDroppedItemInventoryCas(existingPlayer.updatedAt, request.expectedInventoryUpdatedAt) !== "apply") {
        return { ok: false, reason: "conflict", inventory: existingPlayer };
      }
      const playerStateDecision = compareDroppedItemStoredPlayerState(
        existingPlayer.inventoryJson,
        request.canonicalPlayerStateJson
      );
      if (playerStateDecision === "invalid") return { ok: false, reason: "conservation_failure" };
      if (playerStateDecision === "mismatch") return { ok: false, reason: "conflict", inventory: existingPlayer };

      const activeOwnedDrops = await ctx.db.droppedItems
        .withIndex("by_owner_expiry", (q) => q
          .eq("ownerUserId", ctx.auth.userId)
          .gt("expiresAt", String(serverNow)))
        .order("asc")
        .take(65);
      if (!canCreateDroppedItem(activeOwnedDrops.length)) return { ok: false, reason: "drop_limit" };

      const applied = applyDropItemToInventory(request);
      if (!applied.ok) return { ok: false, reason: applied.reason };
      const droppedValue = buildDroppedItemRow(
        ctx.auth.userId,
        request.operationId,
        applied.dropped,
        position,
        Number(presence?.yaw),
        serverNow
      );
      if (!droppedValue) return { ok: false, reason: "invalid_presence" };
      const collision = await ctx.db.droppedItems
        .withIndex("by_drop", (q) => q.eq("dropId", droppedValue.dropId))
        .order("desc")
        .first();
      if (collision) return { ok: false, reason: "drop_id_collision" };

      const player = await ctx.db.inventories.update(existingPlayer.id, {
        userId: ctx.auth.userId,
        inventoryJson: JSON.stringify({ ...request.playerState, inventory: applied.inventory }),
        revision: incrementStoredRevision(existingPlayer.revision),
      });
      const droppedItem = await ctx.db.droppedItems.insert(droppedValue);
      const result: DroppedItemReceiptResult = {
        ok: true,
        replayed: false,
        operation: "drop",
        dropId: droppedValue.dropId,
        moved: applied.dropped,
        inventory: player,
        droppedItem
      };
      const receipt = await ctx.db.droppedItemReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint: request.fingerprint,
        resultJson: encodeDroppedItemReceipt(result),
        receiptCreatedAt: String(serverNow)
      });
      await maintainDroppedItemReceipts(ctx.db, ctx.auth.userId, receipt.id, serverNow);
      await pruneExpiredDroppedItems(ctx.db, serverNow);
      return result;
    }),

    pickupDroppedItem: mutation(async (ctx, requestJson: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validatePickupDroppedItemRequestJson(requestJson);
      if (!validation.ok) return { ok: false, reason: "invalid_request", detail: validation.reason };
      const request = validation.request;
      const existingReceipt = await ctx.db.droppedItemReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .first();
      const replay = decideDroppedItemReplay(existingReceipt?.fingerprint ?? null, request.fingerprint);
      if (replay === "operation_id_reused") return { ok: false, reason: "operation_id_reused" };
      if (replay === "replay" && existingReceipt) {
        return decodeDroppedItemReceipt(existingReceipt.resultJson)
          ?? { ok: false, reason: "conservation_failure" };
      }

      const serverNow = Date.now();
      const presence = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const position = authoritativeDroppedItemPosition(presence, ctx.auth.userId, serverNow);
      if (!position) return { ok: false, reason: "active_presence_required" };
      const existingPlayer = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!existingPlayer) return { ok: false, reason: "inventory_required" };
      if (decideDroppedItemInventoryCas(existingPlayer.updatedAt, request.expectedInventoryUpdatedAt) !== "apply") {
        return { ok: false, reason: "conflict", inventory: existingPlayer };
      }
      const playerStateDecision = compareDroppedItemStoredPlayerState(
        existingPlayer.inventoryJson,
        request.canonicalPlayerStateJson
      );
      if (playerStateDecision === "invalid") return { ok: false, reason: "conservation_failure" };
      if (playerStateDecision === "mismatch") return { ok: false, reason: "conflict", inventory: existingPlayer };

      const storedDrop = await ctx.db.droppedItems
        .withIndex("by_drop", (q) => q.eq("dropId", request.dropId))
        .order("desc")
        .first();
      if (!storedDrop) return { ok: false, reason: "not_found" };
      const dropped = normalizeDroppedItemRow(storedDrop, serverNow, true);
      if (!dropped) return { ok: false, reason: "invalid_drop_state" };
      const applied = applyPickupDroppedItem(
        request.playerState.inventory,
        dropped,
        ctx.auth.userId,
        position,
        serverNow
      );
      if (!applied.ok) {
        if (applied.reason === "expired") await ctx.db.droppedItems.delete(storedDrop.id);
        return { ok: false, reason: applied.reason };
      }

      const player = await ctx.db.inventories.update(existingPlayer.id, {
        userId: ctx.auth.userId,
        inventoryJson: JSON.stringify({ ...request.playerState, inventory: applied.inventory }),
        revision: incrementStoredRevision(existingPlayer.revision),
      });
      const droppedItem = applied.remaining
        ? await ctx.db.droppedItems.update(storedDrop.id, {
          dropId: storedDrop.dropId,
          chunkKey: storedDrop.chunkKey,
          ownerUserId: storedDrop.ownerUserId,
          sourceUserId: storedDrop.sourceUserId,
          itemJson: JSON.stringify(applied.remaining),
          x: storedDrop.x,
          y: storedDrop.y,
          z: storedDrop.z,
          droppedAt: storedDrop.droppedAt,
          ownerPickupAt: storedDrop.ownerPickupAt,
          expiresAt: storedDrop.expiresAt
        })
        : (await ctx.db.droppedItems.delete(storedDrop.id), null);
      const result: DroppedItemReceiptResult = {
        ok: true,
        replayed: false,
        operation: "pickup",
        dropId: storedDrop.dropId,
        moved: applied.picked,
        inventory: player,
        droppedItem
      };
      const receipt = await ctx.db.droppedItemReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint: request.fingerprint,
        resultJson: encodeDroppedItemReceipt(result),
        receiptCreatedAt: String(serverNow)
      });
      await maintainDroppedItemReceipts(ctx.db, ctx.auth.userId, receipt.id, serverNow);
      await pruneExpiredDroppedItems(ctx.db, serverNow);
      return result;
    }),

    saveChest: mutation(async (ctx, _rawCoordKey: string, _rawInventoryJson: string, _rawExpectedUpdatedAt: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      return { ok: false, reason: "atomic_transfer_required" };
    }),

    operateFurnace: mutation(async (ctx, requestJson: string) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const request = validateFurnaceTransferRequestJson(requestJson);
      if (!request) return { ok: false, reason: "invalid_request", serverNow };
      const receiptRows = await ctx.db.furnaceTransferReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .take(2);
      if (receiptRows.length > 1) return { ok: false, reason: "duplicate_state", serverNow };
      const receiptDecision = decideFurnaceReceiptReplay(
        receiptRows[0]?.fingerprint ?? null,
        request.fingerprint,
      );
      if (receiptDecision === "operation_id_reused") {
        return { ok: false, reason: "operation_id_reused", serverNow };
      }
      if (receiptDecision === "replay") {
        const saved = decodeFurnaceReceipt(receiptRows[0].resultJson);
        if (!saved) return { ok: false, reason: "invalid_receipt", serverNow };
        const replayInventoryRows = await ctx.db.inventories
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .take(2);
        const replayWorldRows = await ctx.db.worldEdits
          .withIndex("by_coord", (q) => q.eq("coordKey", request.coordKey))
          .order("desc")
          .take(2);
        const replayFurnaceRows = await ctx.db.furnaces
          .withIndex("by_coord", (q) => q.eq("coordKey", request.coordKey))
          .order("desc")
          .take(2);
        const replayBlockInstanceToken = replayWorldRows.length === 1
          && replayWorldRows[0].blockType === "furnace"
          ? furnaceBlockInstanceToken(replayWorldRows[0])
          : null;
        const replayFurnace = replayBlockInstanceToken && replayFurnaceRows.length <= 1
          ? materializedFurnaceView(
            replayFurnaceRows[0] ?? null,
            request.coordKey,
            replayBlockInstanceToken,
            serverNow,
          )
          : null;
        if (replayInventoryRows.length !== 1 || !validatePlayerStateJson(replayInventoryRows[0].inventoryJson).ok
          || !replayFurnace) {
          return { ok: false, reason: "replay_state_unavailable", serverNow };
        }
        return {
          ...saved,
          replayed: true,
          player: replayInventoryRows[0],
          furnace: replayFurnace,
          serverNow,
        };
      }

      const coordinate = validateFurnaceCoordinate(request.coordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason, serverNow };
      const worldRows = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .take(2);
      const presenceRows = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      const inventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      const furnaceRows = await ctx.db.furnaces
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .take(2);
      if (worldRows.length !== 1 || worldRows[0].blockType !== "furnace") {
        return { ok: false, reason: "furnace_required", serverNow };
      }
      if (presenceRows.length !== 1
        || !furnaceWithinReach(presenceRows[0], ctx.auth.userId, coordinate, serverNow)) {
        return { ok: false, reason: "out_of_reach", serverNow };
      }
      if (inventoryRows.length !== 1) return { ok: false, reason: "inventory_required", serverNow };
      if (furnaceRows.length > 1) return { ok: false, reason: "duplicate_state", serverNow };
      const playerState = validatePlayerStateJson(inventoryRows[0].inventoryJson);
      if (!playerState.ok) return { ok: false, reason: "invalid_inventory", serverNow };
      const blockInstanceToken = furnaceBlockInstanceToken(worldRows[0]);
      const furnace = blockInstanceToken
        ? materializedFurnaceView(furnaceRows[0] ?? null, coordinate.coordKey, blockInstanceToken, serverNow)
        : null;
      if (!furnace) return { ok: false, reason: "invalid_state", serverNow };
      if (decideFurnaceTransferCas({
        inventoryUpdatedAt: inventoryRows[0].updatedAt,
        furnaceRevision: furnace.revision,
        blockInstanceToken: furnace.blockInstanceToken,
      }, {
        inventoryUpdatedAt: request.expectedInventoryUpdatedAt,
        furnaceRevision: request.expectedFurnaceRevision,
        blockInstanceToken: request.expectedBlockInstanceToken,
      }) === "conflict") {
        return {
          ok: false,
          reason: "conflict",
          player: inventoryRows[0],
          furnace,
          serverNow,
        };
      }

      const applied = applyFurnaceTransfer(
        furnace.state,
        playerState.state.inventory,
        request.action,
        serverNow,
      );
      if (!applied.ok) return { ok: false, reason: applied.reason, furnace, serverNow };
      const serialized = serializeFurnaceState(applied.state);
      if (!serialized.ok) return { ok: false, reason: "conservation_failure", serverNow };
      const nextRevision = incrementStoredRevision(furnace.revision);
      const player = await ctx.db.inventories.update(inventoryRows[0].id, {
        userId: ctx.auth.userId,
        inventoryJson: JSON.stringify({ ...playerState.state, inventory: applied.inventory }),
        revision: incrementStoredRevision(inventoryRows[0].revision),
      });
      const furnaceValue = {
        coordKey: coordinate.coordKey,
        blockInstanceToken,
        stateJson: serialized.furnaceJson,
        revision: nextRevision,
        lastActorId: ctx.auth.userId,
      };
      const persistedFurnace = furnaceRows[0]
        ? await ctx.db.furnaces.update(furnaceRows[0].id, furnaceValue)
        : await ctx.db.furnaces.insert(furnaceValue);
      if (!player || !persistedFurnace) return { ok: false, reason: "conservation_failure", serverNow };
      const furnaceResult = {
        state: serialized.state,
        revision: nextRevision,
        blockInstanceToken,
      };
      const result = {
        ok: true,
        replayed: false,
        moved: {
          direction: request.action.kind.startsWith("deposit_") ? "to_furnace" : "to_player",
          ...applied.moved,
        },
        player,
        furnace: furnaceResult,
        serverNow,
      };
      const receipt = await ctx.db.furnaceTransferReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint: request.fingerprint,
        resultJson: encodeFurnaceReceipt(result),
        receiptCreatedAt: String(serverNow),
      });
      const newestReceipts = await ctx.db.furnaceTransferReceipts
        .withIndex("by_user_created", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER + FURNACE_RECEIPT_OVERFLOW_PRUNE_LIMIT);
      for (const receiptId of selectFurnaceReceiptOverflow(newestReceipts, receipt.id)) {
        await ctx.db.furnaceTransferReceipts.delete(receiptId);
      }
      const staleReceipts = await ctx.db.furnaceTransferReceipts
        .withIndex("by_user_created", (q) => q
          .eq("userId", ctx.auth.userId)
          .lt("receiptCreatedAt", String(serverNow - FURNACE_RECEIPT_TTL_MS)))
        .order("asc")
        .take(FURNACE_RECEIPT_OVERFLOW_PRUNE_LIMIT);
      for (const staleReceipt of staleReceipts) await ctx.db.furnaceTransferReceipts.delete(staleReceipt.id);
      return result;
    }),

    transferChest: mutation(async (ctx, requestJson: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateChestTransferRequestJson(requestJson);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid_request",
          detail: validation.playerStateIssue ?? validation.reason
        };
      }
      const request = validation.request;
      const existingReceipt = await ctx.db.chestTransferReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .first();
      const replayDecision = decideChestTransferReplay(existingReceipt?.fingerprint ?? null, request.fingerprint);
      if (replayDecision === "operation_id_reused") {
        return { ok: false, reason: "operation_id_reused" };
      }
      if (replayDecision === "replay" && existingReceipt) {
        const savedResult = decodeChestTransferReceipt(existingReceipt.resultJson);
        return savedResult ?? { ok: false, reason: "conservation_failure" };
      }

      const worldBlock = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", request.coordKey))
        .order("desc")
        .first();
      if (!worldBlock || worldBlock.blockType !== "chest") {
        return { ok: false, reason: "chest_required" };
      }

      const existingPlayer = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const existingChest = await ctx.db.chests
        .withIndex("by_coord", (q) => q.eq("coordKey", request.coordKey))
        .order("desc")
        .first();
      const cas = decideChestTransferCas(
        existingPlayer?.updatedAt ?? null,
        existingChest?.updatedAt ?? null,
        request.expectedInventoryUpdatedAt,
        request.expectedChestUpdatedAt
      );
      if (cas !== "apply") {
        const conflict = cas === "inventory_conflict"
          ? "inventory"
          : cas === "chest_conflict" ? "chest" : "both";
        return { ok: false, reason: "conflict", conflict, player: existingPlayer ?? null, chest: existingChest ?? null };
      }

      if (existingPlayer) {
        const playerStateDecision = compareStoredPlayerState(
          existingPlayer.inventoryJson,
          request.canonicalPlayerStateJson
        );
        if (playerStateDecision === "invalid") return { ok: false, reason: "conservation_failure" };
        if (playerStateDecision === "mismatch") {
          return {
            ok: false,
            reason: "conflict",
            conflict: "inventory",
            player: existingPlayer,
            chest: existingChest ?? null
          };
        }
      }

      const chestValidation = validateChestInventoryJson(existingChest?.inventoryJson ?? "[]");
      if (!chestValidation.ok) return { ok: false, reason: "conservation_failure" };
      const applied = applyChestTransfer(request, request.playerState.inventory, chestValidation.inventory);
      if (!applied.ok) return { ok: false, reason: applied.reason };
      const nextPlayerJson = JSON.stringify({ ...request.playerState, inventory: applied.playerInventory });
      const nextChestJson = JSON.stringify(applied.chestInventory);
      const playerValue = {
        userId: ctx.auth.userId,
        inventoryJson: nextPlayerJson,
        revision: incrementStoredRevision(existingPlayer?.revision),
      };
      const chestValue = {
        coordKey: request.coordKey,
        inventoryJson: nextChestJson,
        lastActorId: ctx.auth.userId
      };
      const player = existingPlayer
        ? await ctx.db.inventories.update(existingPlayer.id, playerValue)
        : await ctx.db.inventories.insert(playerValue);
      const chest = existingChest
        ? await ctx.db.chests.update(existingChest.id, chestValue)
        : await ctx.db.chests.insert(chestValue);
      if (!player || !chest) return { ok: false, reason: "conservation_failure" };

      const receiptCreatedAt = String(Date.now());
      const result = { ok: true, replayed: false, moved: applied.moved, player, chest };
      const receipt = await ctx.db.chestTransferReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint: request.fingerprint,
        resultJson: encodeChestTransferReceipt(result),
        receiptCreatedAt
      });
      const newestReceipts = await ctx.db.chestTransferReceipts
        .withIndex("by_user_created", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(MAX_CHEST_TRANSFER_RECEIPTS_PER_USER + CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT);
      const overflowReceiptIds = selectChestTransferReceiptOverflow(newestReceipts, receipt.id);
      for (const receiptId of overflowReceiptIds) await ctx.db.chestTransferReceipts.delete(receiptId);

      const staleBefore = String(Number(receiptCreatedAt) - CHEST_RECEIPT_TTL_MS);
      const staleReceipts = await ctx.db.chestTransferReceipts
        .withIndex("by_user_created", (q) => q
          .eq("userId", ctx.auth.userId)
          .lt("receiptCreatedAt", staleBefore))
        .order("asc")
        .take(CHEST_RECEIPT_PRUNE_LIMIT);
      for (const staleReceipt of staleReceipts) await ctx.db.chestTransferReceipts.delete(staleReceipt.id);
      return result;
    }),

    sleepInBed: mutation(async (ctx, rawCoordKey: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const coordinate = validateSleepCoordinate(rawCoordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason };
      const bedRows = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .take(2);
      const bed = bedRows.length === 1 ? bedRows[0] : null;
      if (!bed || bed.blockType !== "bed") return { ok: false, reason: "bed_required" };

      const serverNow = Date.now();
      const activeSince = String(serverNow - ACTIVE_PLAYER_WINDOW_MS);
      const presences = await ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", activeSince))
        .order("desc")
        .take(MAX_SLEEP_PARTICIPANTS);
      const preVoteStatus = sleepVoteStatus(presences, [], serverNow);
      if (!preVoteStatus.activePlayerIds.includes(ctx.auth.userId)) {
        return { ok: false, reason: "active_presence_required" };
      }
      const ownPresences = presences.filter((presence) => presence.userId === ctx.auth.userId);
      if (ownPresences.length !== 1) return { ok: false, reason: "active_presence_required" };
      const bedPose = validatePresencePoseFields(
        ownPresences[0].x,
        ownPresences[0].y,
        ownPresences[0].z,
        ownPresences[0].yaw,
        ownPresences[0].pitch,
      );
      if (!bedPose || Math.hypot(
        bedPose.x - (coordinate.x + 0.5),
        bedPose.y + 1.62 - (coordinate.y + 0.5),
        bedPose.z - (coordinate.z + 0.5),
      ) > 6) return { ok: false, reason: "active_presence_required" };
      const respawnRows = await ctx.db.playerRespawns
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (respawnRows.length > 1) return { ok: false, reason: "active_presence_required" };
      const existingRespawn = respawnRows[0] ?? null;
      const respawnValue = {
        userId: ctx.auth.userId,
        bedCoordKey: coordinate.coordKey,
        bedX: String(bedPose.x),
        bedY: String(bedPose.y),
        bedZ: String(bedPose.z),
        bedYaw: String(bedPose.yaw),
        bedPitch: String(bedPose.pitch),
        bedSetAt: String(serverNow),
        grantEpoch: existingRespawn?.grantEpoch ?? "0",
        grantX: existingRespawn?.grantX ?? "",
        grantY: existingRespawn?.grantY ?? "",
        grantZ: existingRespawn?.grantZ ?? "",
        grantYaw: existingRespawn?.grantYaw ?? "",
        grantPitch: existingRespawn?.grantPitch ?? "",
        grantIssuedAt: existingRespawn?.grantIssuedAt ?? "0",
        grantExpiresAt: existingRespawn?.grantExpiresAt ?? "0",
        grantConsumedAt: existingRespawn?.grantConsumedAt ?? "",
        lastAuthorizedAt: existingRespawn?.lastAuthorizedAt ?? "0",
      };
      if (existingRespawn) await ctx.db.playerRespawns.update(existingRespawn.id, respawnValue);
      else await ctx.db.playerRespawns.insert(respawnValue);

      const staleBefore = String(serverNow - SLEEP_VOTE_FRESH_MS);
      const staleVotes = await ctx.db.sleepVotes
        .withIndex("by_voted_at", (q) => q.lt("votedAt", staleBefore))
        .order("asc")
        .take(MAX_SLEEP_PARTICIPANTS);
      for (const staleVote of staleVotes) await ctx.db.sleepVotes.delete(staleVote.id);

      const existingVote = await ctx.db.sleepVotes
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const voteValue = {
        userId: ctx.auth.userId,
        coordKey: coordinate.coordKey,
        votedAt: String(serverNow)
      };
      if (existingVote) await ctx.db.sleepVotes.update(existingVote.id, voteValue);
      else await ctx.db.sleepVotes.insert(voteValue);

      const votes = await ctx.db.sleepVotes
        .withIndex("by_voted_at", (q) => q.gte("votedAt", staleBefore))
        .order("desc")
        .take(MAX_SLEEP_PARTICIPANTS);
      const status = sleepVoteStatus(presences, votes, serverNow);
      if (!status.reached) {
        return {
          ok: true,
          slept: false,
          activePlayers: status.activePlayers,
          sleepingPlayers: status.sleepingPlayers,
          requiredPlayers: status.requiredPlayers
        };
      }

      const existingClock = await ctx.db.worldClock
        .withIndex("by_key", (q) => q.eq("clockKey", WORLD_CLOCK_KEY))
        .order("desc")
        .first();
      const clockValue = {
        clockKey: WORLD_CLOCK_KEY,
        epochMs: String(serverNow),
        epochPhase: String(MORNING_PHASE)
      };
      if (existingClock) await ctx.db.worldClock.update(existingClock.id, clockValue);
      else await ctx.db.worldClock.insert(clockValue);
      for (const vote of votes) await ctx.db.sleepVotes.delete(vote.id);

      return {
        ok: true,
        slept: true,
        activePlayers: status.activePlayers,
        sleepingPlayers: status.sleepingPlayers,
        requiredPlayers: status.requiredPlayers,
        clock: morningClockSnapshot(serverNow)
      };
    }),

    checkpointMobWorld: mutation(async (ctx, requestJson: string) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const request = validateMobWorldCheckpointRequestJson(requestJson);
      if (!request) return { ok: false, reason: "invalid_request", serverNow };
      const presenceRow = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!authoritativeCombatPose(presenceRow, ctx.auth.userId, serverNow)
        || presenceRow?.sessionId !== request.leaseId) {
        return { ok: false, reason: "active_presence_required", serverNow };
      }
      const rows = await ctx.db.mobWorldAuthority
        .withIndex("by_key", (q) => q.eq("authorityKey", MOB_WORLD_AUTHORITY_KEY))
        .order("desc")
        .take(2);
      if (rows.length > 1) return { ok: false, reason: "duplicate_state", serverNow };
      const existing = rows[0] ?? null;
      const stored = databaseRowToStoredMobWorld(existing);
      const readCurrentReplayInput = async () => {
        const presenceRows = await ctx.db.playerPresence
          .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", String(serverNow - ACTIVE_PLAYER_WINDOW_MS)))
          .order("desc")
          .take(64);
        const targets = presenceRows.flatMap((row) => {
          const heartbeatAt = /^\d{1,16}$/.test(row.heartbeatAt) ? Number(row.heartbeatAt) : Number.NaN;
          const pose = validatePresencePoseFields(row.x, row.y, row.z, row.yaw, row.pitch);
          return row.online && pose && heartbeatAt <= serverNow + 5_000
            && serverNow - heartbeatAt >= 0 && serverNow - heartbeatAt <= ACTIVE_PLAYER_WINDOW_MS
            ? [{ userId: row.userId, x: pose.x, y: pose.y, z: pose.z, active: true }]
            : [];
        });
        const clock = await ctx.db.worldClock
          .withIndex("by_key", (q) => q.eq("clockKey", WORLD_CLOCK_KEY))
          .order("desc")
          .first();
        const snapshot = { isNight: mobWorldIsNight(clock, serverNow), targets };
        const inputJson = encodeMobWorldReplayInput(snapshot);
        return inputJson ? { snapshot, inputJson } : null;
      };
      if (!stored) {
        if (existing || request.expectedRevision !== 0) {
          return { ok: false, reason: existing ? "invalid_checkpoint" : "revision_conflict", serverNow };
        }
        const state = createCanonicalMobWorldState(
          serverNow,
          serverTerrainHeight,
          (_kind, x, y, z) => naturalWorldBlockAt(x, y, z) === "air"
            && naturalWorldBlockAt(x, y + 1, z) === "air",
        );
        if (!state) return { ok: false, reason: "initialization_failed", serverNow };
        const replayInput = await readCurrentReplayInput();
        if (!replayInput) return { ok: false, reason: "initialization_failed", serverNow };
        await ctx.db.mobWorldAuthority.insert({
          authorityKey: MOB_WORLD_AUTHORITY_KEY,
          ownerUserId: ctx.auth.userId,
          leaseId: request.leaseId,
          leaseExpiresAt: String(serverNow + MOB_WORLD_LEASE_MS),
          checkpointJson: encodeMobWorldCheckpoint(state),
          inputJson: replayInput.inputJson,
          checkpointRevision: "1",
          checkpointAt: String(serverNow),
        });
        return {
          ok: true,
          checkpointRevision: 1,
          checkpointAt: serverNow,
          leaseExpiresAt: serverNow + MOB_WORLD_LEASE_MS,
          serverNow,
        };
      }

      const revision = parseStoredInteger(stored.checkpointRevision);
      const checkpointAt = parseStoredInteger(stored.checkpointAt);
      const leaseExpiresAt = parseStoredInteger(stored.leaseExpiresAt);
      const storedReplayInput = parseMobWorldReplayInputJson(stored.inputJson);
      if (revision === null || checkpointAt === null || leaseExpiresAt === null
        || !parseMobWorldCheckpointJson(stored.checkpointJson) || !storedReplayInput) {
        return { ok: false, reason: "invalid_checkpoint", serverNow };
      }
      if (request.expectedRevision !== revision) {
        return { ok: false, reason: "revision_conflict", checkpointRevision: revision, serverNow };
      }
      const sameLease = stored.ownerUserId === ctx.auth.userId && stored.leaseId === request.leaseId;
      const sameOwner = stored.ownerUserId === ctx.auth.userId;
      if (!sameLease && !sameOwner && leaseExpiresAt > serverNow) {
        return { ok: false, reason: "lease_held", leaseExpiresAt, serverNow };
      }
      if (sameLease && serverNow - checkpointAt < MOB_WORLD_CHECKPOINT_MS - 200) {
        return {
          ok: false,
          reason: "checkpoint_cooldown",
          retryAfterMs: MOB_WORLD_CHECKPOINT_MS - (serverNow - checkpointAt),
          serverNow,
        };
      }
      const nextReplayInput = await readCurrentReplayInput();
      if (!nextReplayInput) return { ok: false, reason: "invalid_replay_input", serverNow };
      const advanced = advanceMobWorldState(stored, serverNow, storedReplayInput);
      if (!advanced) return { ok: false, reason: "invalid_checkpoint", serverNow };
      const nextRevision = revision + 1;
      const nextLeaseExpiresAt = serverNow + MOB_WORLD_LEASE_MS;
      await ctx.db.mobWorldAuthority.update(existing.id, {
        authorityKey: MOB_WORLD_AUTHORITY_KEY,
        ownerUserId: ctx.auth.userId,
        leaseId: request.leaseId,
        leaseExpiresAt: String(nextLeaseExpiresAt),
        checkpointJson: encodeMobWorldCheckpoint(advanced.state),
        inputJson: nextReplayInput.inputJson,
        checkpointRevision: String(nextRevision),
        checkpointAt: String(serverNow),
      });
      return {
        ok: true,
        checkpointRevision: nextRevision,
        checkpointAt: serverNow,
        leaseExpiresAt: nextLeaseExpiresAt,
        serverNow,
      };
    }),

    claimMobPlayerDamage: mutation(async (ctx, requestJson: string) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const request = validateMobDamageRequestJson(requestJson);
      if (!request) return { ok: false, reason: "invalid_request", serverNow };
      const fingerprint = JSON.stringify([
        request.operationId,
        request.mobId,
        request.tick,
      ]);
      const receipt = await ctx.db.playerCombatReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .first();
      const replay = decidePlayerCombatReplay(receipt?.fingerprint ?? null, fingerprint);
      if (replay === "operation_id_reused") return { ok: false, reason: "operation_id_reused", serverNow };
      if (replay === "replay" && receipt) {
        try {
          const parsed = JSON.parse(receipt.resultJson) as Record<string, unknown>;
          const replayInventoryRows = await ctx.db.inventories
            .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
            .order("desc")
            .take(2);
          if (parsed?.ok === true && parsed.state && typeof parsed.state === "object"
            && Array.isArray(parsed.armorDamaged) && Array.isArray(parsed.brokenArmor)
            && replayInventoryRows.length === 1
            && validatePlayerStateJson(replayInventoryRows[0].inventoryJson).ok) {
            return {
              ...parsed,
              replayed: true,
              inventory: replayInventoryRows[0],
              inventoryRevision: replayInventoryRows[0].revision,
            };
          }
        } catch {
          // Corrupt server-authored receipts are rejected below.
        }
        return { ok: false, reason: "invalid_receipt", serverNow };
      }

      const authorityRow = await ctx.db.mobWorldAuthority
        .withIndex("by_key", (q) => q.eq("authorityKey", MOB_WORLD_AUTHORITY_KEY))
        .order("desc")
        .first();
      const storedWorld = databaseRowToStoredMobWorld(authorityRow);
      if (!storedWorld) return { ok: false, reason: "authority_unavailable", serverNow };
      const storedReplayInput = parseMobWorldReplayInputJson(storedWorld.inputJson);
      if (!storedReplayInput) return { ok: false, reason: "authority_unavailable", serverNow };
      const presenceRows = await ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", String(serverNow - ACTIVE_PLAYER_WINDOW_MS)))
        .order("desc")
        .take(64);
      const targets = presenceRows.flatMap((row) => {
        const heartbeatAt = /^\d{1,16}$/.test(row.heartbeatAt) ? Number(row.heartbeatAt) : Number.NaN;
        const pose = validatePresencePoseFields(row.x, row.y, row.z, row.yaw, row.pitch);
        return row.online && pose && heartbeatAt <= serverNow + 5_000
          && serverNow - heartbeatAt >= 0 && serverNow - heartbeatAt <= ACTIVE_PLAYER_WINDOW_MS
          ? [{ userId: row.userId, x: pose.x, y: pose.y, z: pose.z, active: true }]
          : [];
      });
      const callerPresenceRow = presenceRows.find((row) => row.userId === ctx.auth.userId) ?? null;
      if (!authoritativeCombatPose(callerPresenceRow, ctx.auth.userId, serverNow)) {
        return { ok: false, reason: "active_presence_required", serverNow };
      }
      const callerTarget = targets.find((target) => target.userId === ctx.auth.userId);
      if (!callerTarget) return { ok: false, reason: "active_presence_required", serverNow };
      const advanced = advanceMobWorldState(storedWorld, serverNow, storedReplayInput);
      if (!advanced) return { ok: false, reason: "authority_unavailable", serverNow };
      const mobIdentity = validateMobIdentity(request.mobId, undefined, MOB_AUTHORITY_WORLD_SEED_TOKEN);
      if (!mobIdentity.ok) return { ok: false, reason: "unknown_mob", serverNow };
      const mobCombatRow = await ctx.db.mobAuthority
        .withIndex("by_mob", (q) => q.eq("mobId", request.mobId))
        .order("desc")
        .first();
      const mobCombatState = materializeMobAuthorityState(
        databaseRowToStoredMobAuthority(mobCombatRow),
        mobIdentity.mobId,
        mobIdentity.kind,
        serverNow,
      );
      if (mobCombatState.health <= 0) return { ok: false, reason: "mob_dead", serverNow };
      const combatRow = await ctx.db.playerCombat
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const inventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (inventoryRows.length !== 1) return { ok: false, reason: "inventory_required", serverNow };
      const inventoryRow = inventoryRows[0];
      const playerState = validatePlayerStateJson(inventoryRow.inventoryJson);
      if (!playerState.ok) return { ok: false, reason: "target_state_invalid", serverNow };
      const rawHealth = combatRow && /^\d{1,3}$/.test(combatRow.health) ? Number(combatRow.health) : 20;
      if (rawHealth <= 0) return { ok: false, reason: "target_dead", serverNow };
      const armorProtection = equippedArmorProtection(playerState.state.equipment);
      const resolution = resolveMobDamage(
        advanced.state,
        request,
        callerTarget,
        advanced.revision,
        rawHealth,
        armorProtection,
      );
      if (!resolution.ok) return { ...resolution, serverNow };
      const armorDamage = applyConfirmedArmorDamage(playerState.state.equipment);
      let inventoryRevision = inventoryRow.revision;
      let persistedInventory = inventoryRow;
      if (armorDamage.damaged.length > 0) {
        const updatedInventory = await ctx.db.inventories.update(inventoryRow.id, {
          userId: ctx.auth.userId,
          inventoryJson: JSON.stringify({ ...playerState.state, equipment: armorDamage.equipment }),
          revision: incrementStoredRevision(inventoryRow.revision),
        });
        if (!updatedInventory) throw new Error("Unable to persist authoritative armor wear.");
        persistedInventory = updatedInventory;
        inventoryRevision = updatedInventory.revision;
      }
      const previousState = materializePlayerCombatState(
        databaseRowToStoredPlayerCombat(combatRow),
        ctx.auth.userId,
        serverNow,
      );
      const state = {
        ...previousState,
        health: resolution.health,
        revision: previousState.revision + 1,
        deadUntil: resolution.killed ? serverNow + PLAYER_RESPAWN_DELAY_MS : 0,
        lastAttackAt: serverNow,
        lastAttackerId: request.mobId,
      };
      const nextRow = storedPlayerCombatRow(state);
      if (combatRow) await ctx.db.playerCombat.update(combatRow.id, nextRow);
      else await ctx.db.playerCombat.insert(nextRow);
      const result = {
        ok: true,
        replayed: false,
        killed: resolution.killed,
        damage: resolution.damage,
        armorProtection,
        armorDamaged: armorDamage.damaged,
        brokenArmor: armorDamage.broken,
        inventory: persistedInventory,
        inventoryRevision,
        state,
        serverNow,
      };
      const committedReceipt = await ctx.db.playerCombatReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint,
        resultJson: JSON.stringify(result),
        receiptCreatedAt: String(serverNow),
      });
      await maintainPlayerCombatReceipts(ctx.db, ctx.auth.userId, committedReceipt.id, serverNow);
      return result;
    }),

    attackMob: mutation(async (
      ctx,
      rawMobId: string,
      rawKind: string,
      rawDamage: string,
      operationId: string,
    ) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const identity = validateMobIdentity(rawMobId, rawKind, MOB_AUTHORITY_WORLD_SEED_TOKEN);
      if (!identity.ok) return { ok: false, reason: identity.reason, serverNow };
      if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(operationId)) {
        return { ok: false, reason: "invalid_operation", serverNow };
      }
      const fingerprint = JSON.stringify([identity.mobId, identity.kind, rawDamage]);
      const existingReceipt = await ctx.db.playerCombatReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", operationId))
        .order("desc")
        .first();
      const replay = decidePlayerCombatReplay(existingReceipt?.fingerprint ?? null, fingerprint);
      if (replay === "operation_id_reused") return { ok: false, reason: "operation_id_reused", serverNow };
      if (replay === "replay" && existingReceipt) {
        try {
          const result = JSON.parse(existingReceipt.resultJson) as Record<string, unknown>;
          const inventoryRows = await ctx.db.inventories
            .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
            .order("desc")
            .take(2);
          if (result.ok === true && inventoryRows.length === 1
            && validatePlayerStateJson(inventoryRows[0].inventoryJson).ok) {
            return { ...result, replayed: true, inventory: inventoryRows[0], serverNow };
          }
        } catch {
          // Corrupt server-authored receipts fail closed.
        }
        return { ok: false, reason: "invalid_receipt", serverNow };
      }

      const presenceRow = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const attackerPresence = authoritativeCombatPose(presenceRow, ctx.auth.userId, serverNow);
      if (!attackerPresence) return { ok: false, reason: "active_presence_required", serverNow };
      const attackerCombatRow = await ctx.db.playerCombat
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const attackerCombat = materializePlayerCombatState(
        databaseRowToStoredPlayerCombat(attackerCombatRow),
        ctx.auth.userId,
        serverNow,
      );
      if (attackerCombat.health === 0) {
        return { ok: false, reason: "attacker_dead", retryAfterMs: attackerCombat.deadUntil - serverNow, serverNow };
      }
      const inventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (inventoryRows.length !== 1) return { ok: false, reason: "inventory_required", serverNow };
      const inventoryRow = inventoryRows[0];
      const playerState = validatePlayerStateJson(inventoryRow.inventoryJson);
      if (!playerState.ok) return { ok: false, reason: "inventory_invalid", serverNow };
      const selectedStack = playerState.state.inventory[playerState.state.selectedHotbar] ?? null;
      const selectedItemId = selectedStack?.itemId ?? null;
      if (Number(rawDamage) !== attackDamage(selectedItemId)) {
        return { ok: false, reason: "weapon_mismatch", serverNow };
      }

      const authorityRow = await ctx.db.mobWorldAuthority
        .withIndex("by_key", (q) => q.eq("authorityKey", MOB_WORLD_AUTHORITY_KEY))
        .order("desc")
        .first();
      const storedWorld = databaseRowToStoredMobWorld(authorityRow);
      const replayInput = storedWorld ? parseMobWorldReplayInputJson(storedWorld.inputJson) : null;
      const advancedWorld = storedWorld && replayInput
        ? advanceMobWorldState(storedWorld, serverNow, replayInput)
        : null;
      const mobPose = advancedWorld
        ? writeMobMotionPoses(advancedWorld.state).find((pose) => pose.mobId === identity.mobId)
        : null;
      if (!mobPose) return { ok: false, reason: "authority_unavailable", serverNow };
      const spatial = validatePlayerMeleeSpatialAuthority(attackerPresence, {
        userId: mobPose.mobId,
        x: mobPose.x,
        y: mobPose.y,
        z: mobPose.z,
        yaw: mobPose.yaw,
        pitch: 0,
        heartbeatAt: serverNow,
        online: true,
      });
      if (!spatial.ok) return { ok: false, reason: spatial.reason, serverNow };

      const existing = await ctx.db.mobAuthority
        .withIndex("by_mob", (q) => q.eq("mobId", identity.mobId))
        .order("desc")
        .first();
      const resolution = resolveMobAttack({
        stored: databaseRowToStoredMobAuthority(existing),
        rawMobId: identity.mobId,
        rawKind: identity.kind,
        rawDamage,
        attackerId: ctx.auth.userId,
        serverNow,
      });
      if (!resolution.ok) return { ...resolution, serverNow };
      const toolUse = applyConfirmedToolUse(
        playerState.state.inventory,
        playerState.state.selectedHotbar,
        "attack",
        selectedItemId,
      );
      let nextInventory = toolUse.inventory;
      const collectedDrops = [] as typeof resolution.drops;
      if (resolution.killed) {
        for (const drop of resolution.drops) {
          const added = addItem(nextInventory, drop.itemId as ItemId, drop.count);
          nextInventory = added.inventory;
          const collected = drop.count - added.remainder;
          if (collected > 0) collectedDrops.push({ ...drop, count: collected });
        }
      }
      if (existing) await ctx.db.mobAuthority.update(existing.id, resolution.nextRow);
      else await ctx.db.mobAuthority.insert(resolution.nextRow);
      const inventoryChanged = toolUse.used || collectedDrops.length > 0;
      const inventory = inventoryChanged
        ? await ctx.db.inventories.update(inventoryRow.id, {
            userId: ctx.auth.userId,
            inventoryJson: JSON.stringify({ ...playerState.state, inventory: nextInventory }),
            revision: incrementStoredRevision(inventoryRow.revision),
          })
        : inventoryRow;
      const result = {
        ok: true,
        replayed: false,
        killed: resolution.killed,
        drops: collectedDrops,
        state: resolution.state,
        inventory,
        serverNow,
      };
      const receipt = await ctx.db.playerCombatReceipts.insert({
        userId: ctx.auth.userId,
        operationId,
        fingerprint,
        resultJson: JSON.stringify(result),
        receiptCreatedAt: String(serverNow),
      });
      await maintainPlayerCombatReceipts(ctx.db, ctx.auth.userId, receipt.id, serverNow);
      return result;
    }),

    attackPlayer: mutation(async (ctx, requestJson: string) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const validation = validatePlayerAttackRequestJson(requestJson);
      if (!validation.ok) return { ok: false, reason: "invalid_request", detail: validation.reason, serverNow };
      const request = validation.request;
      const existingReceipt = await ctx.db.playerCombatReceipts
        .withIndex("by_user_operation", (q) => q
          .eq("userId", ctx.auth.userId)
          .eq("operationId", request.operationId))
        .order("desc")
        .first();
      const replay = decidePlayerCombatReplay(existingReceipt?.fingerprint ?? null, request.fingerprint);
      if (replay === "operation_id_reused") return { ok: false, reason: "operation_id_reused", serverNow };
      if (replay === "replay" && existingReceipt) {
        return decodePlayerCombatReceipt(existingReceipt.resultJson)
          ?? { ok: false, reason: "invalid_receipt", serverNow };
      }

      const attackerPresenceRow = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const targetPresenceRow = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", request.targetUserId))
        .order("desc")
        .first();
      const attackerPresence = authoritativeCombatPose(attackerPresenceRow, ctx.auth.userId, serverNow);
      const targetPresence = authoritativeCombatPose(targetPresenceRow, request.targetUserId, serverNow);

      const attackerInventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .take(2);
      if (attackerInventoryRows.length !== 1) return { ok: false, reason: "inventory_required", serverNow };
      const attackerInventoryRow = attackerInventoryRows[0];
      const attackerPlayerState = validatePlayerStateJson(attackerInventoryRow.inventoryJson);
      if (!attackerPlayerState.ok) return { ok: false, reason: "attacker_state_invalid", serverNow };
      const targetInventoryRows = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", request.targetUserId))
        .order("desc")
        .take(2);
      if (targetInventoryRows.length !== 1) return { ok: false, reason: "target_state_invalid", serverNow };
      const targetInventoryRow = targetInventoryRows[0];
      const targetPlayerState = validatePlayerStateJson(targetInventoryRow.inventoryJson);
      if (!targetPlayerState.ok) return { ok: false, reason: "target_state_invalid", serverNow };

      const attackerCombatRow = await ctx.db.playerCombat
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const targetCombatRow = await ctx.db.playerCombat
        .withIndex("by_user", (q) => q.eq("userId", request.targetUserId))
        .order("desc")
        .first();
      const resolution = resolvePlayerAttack({
        request,
        attackerId: ctx.auth.userId,
        attackerStored: databaseRowToStoredPlayerCombat(attackerCombatRow),
        targetStored: databaseRowToStoredPlayerCombat(targetCombatRow),
        attackerPresence,
        targetPresence,
        attackerPlayerState: attackerPlayerState.state,
        targetPlayerState: targetPlayerState.state,
        serverNow,
      });
      if (!resolution.ok) return { ...resolution, serverNow };
      let targetInventoryRevision = targetInventoryRow.revision;
      if (resolution.armorDamaged.length > 0) {
        const updatedTargetInventory = await ctx.db.inventories.update(targetInventoryRow.id, {
          userId: request.targetUserId,
          inventoryJson: JSON.stringify({ ...targetPlayerState.state, equipment: resolution.targetEquipment }),
          revision: incrementStoredRevision(targetInventoryRow.revision),
        });
        if (!updatedTargetInventory) throw new Error("Unable to persist authoritative PvP armor wear.");
        targetInventoryRevision = updatedTargetInventory.revision;
      }
      if (attackerCombatRow) await ctx.db.playerCombat.update(attackerCombatRow.id, resolution.attackerRow);
      else await ctx.db.playerCombat.insert(resolution.attackerRow);
      if (targetCombatRow) await ctx.db.playerCombat.update(targetCombatRow.id, resolution.targetRow);
      else await ctx.db.playerCombat.insert(resolution.targetRow);
      const result: PlayerCombatReceiptResult = {
        ...resolution,
        replayed: false,
        serverNow,
        targetInventoryRevision,
      };
      const receipt = await ctx.db.playerCombatReceipts.insert({
        userId: ctx.auth.userId,
        operationId: request.operationId,
        fingerprint: request.fingerprint,
        resultJson: encodePlayerCombatReceipt(result),
        receiptCreatedAt: String(serverNow),
      });
      await maintainPlayerCombatReceipts(ctx.db, ctx.auth.userId, receipt.id, serverNow);
      return result;
    }),

    claimUsername: mutation(async (ctx, requestedUsername: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateUsername(requestedUsername);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const existingProfile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (existingProfile) {
        if (existingProfile.normalizedUsername === validation.username) {
          return { ok: true, profile: existingProfile };
        }
        return { ok: false, reason: "username_locked" };
      }

      const existingClaim = await ctx.db.profiles
        .withIndex("by_username", (q) => q.eq("normalizedUsername", validation.username))
        .order("asc")
        .first();
      if (existingClaim) return { ok: false, reason: "taken" };

      const claimedAt = String(Date.now());
      const profile = await ctx.db.profiles.insert({
        userId: ctx.auth.userId,
        username: validation.username,
        normalizedUsername: validation.username,
        claimedAt
      });
      return { ok: true, profile };
    }),

    sendChat: mutation(async (ctx, rawMessage: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateChatMessage(rawMessage);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const profile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!profile) return { ok: false, reason: "profile_required" };

      const previous = await ctx.db.chatMessages
        .withIndex("by_user_sent_at", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const now = Date.now();
      const elapsed = previous ? now - Number(previous.sentAt) : CHAT_RATE_LIMIT_MS;
      if (elapsed < CHAT_RATE_LIMIT_MS) {
        return { ok: false, reason: "rate_limited", retryAfterMs: CHAT_RATE_LIMIT_MS - elapsed };
      }

      const message = await ctx.db.chatMessages.insert({
        userId: ctx.auth.userId,
        username: profile.username,
        message: validation.message,
        sentAt: String(now)
      });
      return { ok: true, message };
    })
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("lakecraft:ok"))
  }
});
