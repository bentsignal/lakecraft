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
  authoritativeCombatPose,
  decidePlayerCombatReplay,
  materializePlayerCombatState,
  resolvePlayerAttack,
  selectPlayerCombatReceiptOverflow,
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
  buildOfflinePresenceValue,
  decidePresenceWriteGate,
  validatePresencePoseFields
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

const PLACEABLE_BLOCKS = new Set<string>(BLOCK_TYPES.filter((block) => block !== "air"));
const CHEST_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const CHEST_RECEIPT_PRUNE_LIMIT = 8;

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
      heartbeatAt: string(),
      online: boolean().default(true)
    })
      .index("by_user", ["userId"])
      .index("by_heartbeat", ["heartbeatAt"]),

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

    /** Sparse combat authority only; mob movement intentionally never enters Lakebed. */
    mobAuthority: table({
      mobId: string(),
      kind: string(),
      health: string(),
      revision: string(),
      deadUntil: string(),
      lastAttackAt: string(),
      lastAttackerId: string()
    }).index("by_mob", ["mobId"]),

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

    recentPlayers: query(async (ctx, activeSince: string) =>
      ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", activeSince.trim().slice(0, 32)))
        .order("desc")
        .take(128)
    ),

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
        rawArmorFeet?: string
      ) => {
        if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to join the shared world.");
        const pose = validatePresencePoseFields(x, y, z, yaw, pitch);
        const velocity = validatePresenceVelocityFields(rawVx ?? "0", rawVy ?? "0", rawVz ?? "0");
        if (!pose || !velocity) return;
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
        const existing = await ctx.db.playerPresence
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .first();
        const serverNow = Date.now();
        const gate = decidePresenceWriteGate(existing?.heartbeatAt, serverNow);
        if (!gate.accept) return;
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
          heartbeatAt: String(serverNow),
          online: true
        };
        return existing
          ? ctx.db.playerPresence.update(existing.id, value)
          : ctx.db.playerPresence.insert(value);
      }
    ),

    leavePlayer: mutation(async (ctx, _heartbeatAt: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to leave the shared world.");
      const existing = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      // A leave without a prior authoritative heartbeat must not manufacture a
      // second source of spawn truth. Existing rows retain their exact pose.
      if (!existing) return null;
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
      const bed = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .first();
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

    attackMob: mutation(async (ctx, rawMobId: string, rawKind: string, rawDamage: string) => {
      const serverNow = Date.now();
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required", serverNow };
      }
      const identity = validateMobIdentity(rawMobId, rawKind, MOB_AUTHORITY_WORLD_SEED_TOKEN);
      if (!identity.ok) return { ok: false, reason: identity.reason, serverNow };
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
      if (existing) await ctx.db.mobAuthority.update(existing.id, resolution.nextRow);
      else await ctx.db.mobAuthority.insert(resolution.nextRow);
      return {
        ok: true,
        killed: resolution.killed,
        drops: resolution.drops,
        state: resolution.state,
        serverNow,
      };
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

      const attackerInventoryRow = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!attackerInventoryRow) return { ok: false, reason: "inventory_required", serverNow };
      const attackerPlayerState = validatePlayerStateJson(attackerInventoryRow.inventoryJson);
      if (!attackerPlayerState.ok) return { ok: false, reason: "attacker_state_invalid", serverNow };
      const targetInventoryRow = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", request.targetUserId))
        .order("desc")
        .first();
      const targetPlayerState = validatePlayerStateJson(targetInventoryRow?.inventoryJson ?? "[]");
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
      if (attackerCombatRow) await ctx.db.playerCombat.update(attackerCombatRow.id, resolution.attackerRow);
      else await ctx.db.playerCombat.insert(resolution.attackerRow);
      if (targetCombatRow) await ctx.db.playerCombat.update(targetCombatRow.id, resolution.targetRow);
      else await ctx.db.playerCombat.insert(resolution.targetRow);
      const result: PlayerCombatReceiptResult = { ...resolution, replayed: false, serverNow };
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
