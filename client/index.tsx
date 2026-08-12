import { ErrorBoundary, signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChatOverlay, type LakecraftChatMessage } from "./chat";
import { ChestDrawer, FurnaceDrawer, GameHud, type ChestTransferDirection, type HudMessage } from "./components";
import { isCraftingTableWithinReach as isWorkstationWithinReach, type CraftingTablePosition as WorkstationPosition } from "./crafting";
import {
  BLOCK,
  createVoxelEngine,
  validateRespawnPoint,
  type BlockId as EngineBlockId,
  type BlockTarget,
  type PlayerPose,
  type PlayerProjectileVisual,
  type RemotePlayer,
  type VoxelEngine,
  type WorldEdit as EngineWorldEdit,
} from "./game";
import { LobbyScreen, type LobbyJoinPhase, type LobbyServerEntry, type UsernameClaimState } from "./lobby";
import { SinglePlayerApp } from "./singleplayer";
import { shouldRunSinglePlayer, singlePlayerTitleUrl } from "./runtimeMode.ts";
import { releaseGameplayKeyboardCapture, requestGameplayKeyboardCapture } from "./gameplayKeyboardCapture.ts";
import { requestDocumentPointerLockHandoff } from "./pointerLockHandoff.ts";
import { cycleHotbarIndex } from "./game/hotbarInput";
import { hydrateSelectedPlayerSkin, type HydratedPlayerSkin } from "./game/playerSkin.ts";
import {
  RealtimeMultiplayerTransport,
  type RealtimeBlockSink,
  type RealtimeChatSink,
  type RealtimeDropSink,
  type RealtimePickupSink,
} from "./RealtimeMultiplayerTransport.tsx";
import {
  applyRealtimeChatEvent,
  type RealtimeChatMessage,
} from "./realtimeChat.ts";
import {
  loadMultiplayerInvitationTokens,
  loadSavedMultiplayerServers,
  multiplayerStatusUrl,
  normalizeMultiplayerEndpoint,
  saveMultiplayerInvitationToken,
  saveMultiplayerServers,
  type RealtimeConnectionPhase,
  type RealtimeGameMode,
  type SavedMultiplayerServer,
} from "./realtimeMultiplayer.ts";
import type { MobWorldCompositeSnapshot, SegmentTelemetry } from "./multiplayerSegmentClient.ts";
import {
  canApplyAuthoritativeKnockback,
  multiplayerGameplayPaused,
  updateAuthoritativeKnockbackGate,
  type AuthoritativeKnockbackGate,
} from "./multiplayerGameplay.ts";
import {
  fieldOfViewRadians,
  loadClientSettings,
  mouseLookScale,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettings,
} from "./settings.ts";
import {
  ITEMS,
  BLOCKS,
  MAX_HEALTH,
  MAX_HUNGER,
  attackDamage,
  addItemStack,
  clampHotbarIndex,
  countItem,
  createEmptyEquipment,
  createEmptyInventory,
  createSerializablePlayerState,
  createStarterInventory,
  consumeFood,
  equippedArmorProtection,
  miningSeconds,
  normalizeInventory,
  type BlockId,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
  type PlayerRespawnPoint,
  type Recipe,
} from "../shared/game";
import { RANGED_COMBAT_PROTOCOL_VERSION } from "../shared/rangedCombat.ts";
import type { StowedInventorySnapshot } from "../shared/inventoryWorkspace";
import {
  type InventoryActionMutationResult,
  type InventoryRecipeBatch,
} from "../shared/inventoryActions.ts";
import {
  type FurnaceState,
  type FurnaceTransferAction,
} from "../shared/furnaces.ts";
import { CHEST_SLOT_COUNT, type ChestAtResult, type PersistedChest } from "../shared/chests";
import {
  type ChestTransferRequest,
  type ChestTransferResult,
  type PersistedInventoryState,
  validatePlayerStateJson,
} from "../shared/chestTransfers";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ClaimUsernameResult,
  type Profile,
} from "../shared/multiplayer";
import { type PlayerCombatState } from "../shared/playerCombat";
import {
  blockCoordinateKey,
  latestWorldEdits,
  type PersistedInventory,
  type PlayerPresence,
  type WorldEdit,
} from "../shared/protocol";
import {
  PRESENCE_ACTIVE_WRITES_PER_SECOND,
  PRESENCE_MAX_IN_FLIGHT_WRITES,
  PRESENCE_REALTIME_BURST_WRITES,
  PRESENCE_SAMPLE_INTERVAL_MS,
  PRESENCE_SESSION_WRITE_BUDGET,
  classifyPresenceTransportError,
  createPresenceBurstGuardState,
  createPresenceSchedulerState,
  parsePersistedPresencePose,
  presenceBurstGuardSnapshot,
  presenceTransportQuotaResetAt,
  recordPresenceFailure,
  recordPresenceRateLimit,
  recordPresenceSuccess,
  reservePresenceAttempt,
  stepPresenceScheduler,
  type PresenceBurstGuardState,
  type PresenceSchedulerState,
  type PresenceSendDecision,
} from "../shared/presenceMotion";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance";
import { type SleepInBedResult, type WorldClockSnapshot } from "../shared/sleep";
import {
  MAX_MOB_ATTACK_DAMAGE,
  type MobAttackResult,
  type MobAuthorityState,
  type MobShearResult,
} from "../shared/mobCombat";
import {
  decodeWorldChunkSnapshot,
  worldEditChunkCoordinate,
  worldEditChunkKey,
  type WorldChunkBlockType,
} from "../shared/worldChunks";
import {
  DROPPED_ITEM_CHUNK_SIZE,
  DROPPED_ITEM_PICKUP_RADIUS,
  type NormalizedDroppedItem,
} from "../shared/droppedItems";
import type { WorldBlockOperationRequest } from "../shared/worldBlockOperations";
import {
  buildWorldBlockOperationRequest,
  createWorldBlockOperationId,
  invokeWorldBlockEditWithOneRetry,
  isDecimalRevisionAtLeast,
  overlayPendingWorldBlockEdit,
  serializeWorldBlockEditPose,
  type SerializedWorldBlockEditPose,
} from "./worldBlockEditClient";
import {
  createGameAudio,
  type GameAudio,
  type GameAudioSurface,
} from "./game/audio.ts";

const APP_CSS = `
@font-face { font-display: swap; font-family: "Pixelify Sans"; font-style: normal; font-weight: 400 700; src: url("https://fonts.gstatic.com/s/pixelifysans/v3/CHylV-3HFUT7aC4iv1TxGDR9Jn0Eiw.woff2") format("woff2"); }
:root { --lc-pixel-font: "Pixelify Sans", "Courier New", monospace; }
html, body, #app { height: 100vh; height: 100dvh; margin: 0; overflow: hidden; width: 100%; }
body { background: #171b15; }
button { -webkit-tap-highlight-color: transparent; }
.lakecraft-shell { background: #171b15; height: 100vh; height: 100dvh; inset: 0; isolation: isolate; overflow: hidden; position: fixed; width: 100vw; }
.lakecraft-world { cursor: none; display: block; height: 100%; outline: none; width: 100%; }
.lakecraft-error { background: #171a16; color: #e6dcc1; display: grid; inset: 0; padding: 40px; place-content: center; position: absolute; z-index: 120; }
.lakecraft-error strong { color: #d49a45; font: 700 16px "Courier New", monospace; }.lakecraft-error p { max-width: 560px; }
.lakecraft-sleep-layer { align-items: center; background: rgba(7,10,17,.76); display: flex; inset: 0; justify-content: center; padding: 24px; position: fixed; z-index: 67; }
.lakecraft-sleep { background: #d9cfb3; border-top: 7px solid #8f3e3e; box-shadow: 12px 14px 0 rgba(42,49,66,.5), 0 28px 90px rgba(0,0,0,.58); color: #24261f; max-width: 430px; padding: 30px; width: 100%; }
.lakecraft-sleep small { color: #8f3e3e; font: 10px "Courier New", monospace; letter-spacing: .12em; text-transform: uppercase; }
.lakecraft-sleep h2 { font: 900 34px/1 "Trebuchet MS", sans-serif; margin: 12px 0; text-transform: uppercase; }
.lakecraft-sleep p { font: 12px/1.6 "Courier New", monospace; min-height: 3.2em; }
.lakecraft-sleep__actions { display: grid; gap: 8px; grid-template-columns: 1fr auto; margin-top: 20px; }
.lakecraft-sleep button { background: #24261f; border: 0; color: #e6dcc1; cursor: pointer; font: 800 11px "Trebuchet MS", sans-serif; letter-spacing: .08em; padding: 13px 15px; text-transform: uppercase; }
.lakecraft-sleep button:disabled { cursor: progress; opacity: .58; }
.lakecraft-sleep button:last-child { background: transparent; color: #24261f; outline: 1px solid rgba(36,38,31,.4); }
`;

const QUERY_RECOVERY_CSS = `
.lakecraft-query-recovery{background:linear-gradient(#78a7d2 0 45%,#5f8738 45% 100%);box-sizing:border-box;color:#fff;display:grid;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;min-height:100dvh;padding:24px;place-items:center;position:fixed;text-align:center;text-shadow:2px 2px #202020}
.lakecraft-query-recovery section{background:rgba(0,0,0,.72);border:2px solid #111;box-shadow:inset 0 0 0 2px #555;padding:24px;width:min(560px,100%)}
.lakecraft-query-recovery h1{font-size:clamp(18px,4vw,30px);font-weight:400;margin:0 0 16px}.lakecraft-query-recovery p{line-height:1.5;margin:0 0 20px}
.lakecraft-query-recovery button{background:#777;border:2px solid;border-color:#aaa #333 #333 #aaa;color:#fff;cursor:pointer;font:16px var(--lc-pixel-font,"Courier New",monospace);padding:10px 20px;text-shadow:2px 2px #333}.lakecraft-query-recovery button:active{border-color:#333 #aaa #aaa #333}
`;

const PRESENCE_BUDGET_STORAGE_PREFIX = "lakecraft:presence-budget:v1:";
/** Browser-side guard matching the quota-honest persisted mob cadence. */
const MOB_CHECKPOINT_ATTEMPT_MIN_MS = 30_000;

type ExternalMultiplayerServer = {
  id: string;
  name: string;
  description: string;
  canonicalWssUrl: string;
  status?: "online" | "busy" | "maintenance" | "offline";
  capacity?: number;
};

type ClientBootstrap = readonly [
  PlayerPresence | null,
  PersistedInventory | null,
  Profile | null,
  ExternalMultiplayerServer[],
];

type PlayerCombatQueryResult = {
  ok: boolean;
  reason?: string;
  states: PlayerCombatState[];
  serverNow: number;
};

type ExternalJoinTicketResult =
  | { ok: true; ticket: string; serverId: string; canonicalWssUrl: string; expiresAt: number }
  | { ok: false; reason: string };

type RealtimeSession = {
  ticket?: string;
  serverId: string;
  endpoint: string;
  demo?: { token: string; userId: string; name: string };
};

function audioSurfaceForBlock(block: EngineBlockId): GameAudioSurface {
  if (block === BLOCK.GRASS || block === BLOCK.DIRT || block === BLOCK.LEAVES || block === BLOCK.BED
    || block === BLOCK.WOOL || block === BLOCK.SAPLING) return "grass";
  if (block === BLOCK.WOOD || block === BLOCK.PLANKS || block === BLOCK.CRAFTING_TABLE
    || block === BLOCK.CHEST || block === BLOCK.DOOR_CLOSED || block === BLOCK.DOOR_OPEN || block === BLOCK.LADDER
    || block === BLOCK.OAK_FENCE || block === BLOCK.OAK_FENCE_GATE_CLOSED || block === BLOCK.OAK_FENCE_GATE_OPEN) return "wood";
  if (block === BLOCK.SAND) return "sand";
  if (block === BLOCK.GRAVEL) return "gravel";
  if (block === BLOCK.GLASS) return "glass";
  if (block === BLOCK.IRON_ORE || block === BLOCK.GOLD_ORE || block === BLOCK.DIAMOND_ORE || block === BLOCK.FURNACE) return "metal";
  if (block === BLOCK.STONE || block === BLOCK.COBBLESTONE || block === BLOCK.COAL_ORE
    || block === BLOCK.STONE_BRICKS || block === BLOCK.STONE_BRICK_SLAB || block === BLOCK.BRICKS) return "stone";
  if (block === BLOCK.CLAY) return "gravel";
  return "generic";
}

function loadPresenceBurstGuard(userId: string, now: number): PresenceBurstGuardState {
  try {
    const raw = window.localStorage.getItem(`${PRESENCE_BUDGET_STORAGE_PREFIX}${userId}`);
    return createPresenceBurstGuardState(now, raw ? JSON.parse(raw) : null);
  } catch {
    return createPresenceBurstGuardState(now);
  }
}

function persistPresenceBurstGuard(userId: string, state: PresenceBurstGuardState): void {
  try {
    window.localStorage.setItem(`${PRESENCE_BUDGET_STORAGE_PREFIX}${userId}`, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private contexts; the in-memory guard still applies.
  }
}

type DroppedItemsQueryResult =
  | { ok: true; items: NormalizedDroppedItem[]; serverNow: number }
  | { ok: false; reason: string; items: []; serverNow: number };

type DroppedItemMutationResult =
  | { ok: true; replayed: boolean; operation: "drop" | "pickup"; dropId: string; moved: { itemId: ItemId; count: number }; inventory: PersistedInventoryState; droppedItem: Record<string, unknown> | null }
  | { ok: false; reason: string; inventory?: PersistedInventoryState | null };

type AuthorizeRespawnResult =
  | {
      ok: true;
      target: PlayerPose;
      epoch: string;
      expiresAt: number | string;
      inventory: PersistedInventoryState;
      sessionId: string;
      nextPoseSequence: string;
    }
  | { ok: false; reason: string; retryAfterMs?: number };

type HeartbeatPlayerResult = void | {
  ok: boolean;
  applied?: boolean;
  reason?: string;
  retryAfterMs?: number;
  canonicalPose?: PlayerPose;
  hunger?: number;
  health?: number;
  combatRevision?: number;
  poseSequence?: string;
  inventory?: PersistedInventoryState;
};
type StartPresenceSessionResult = {
  ok: boolean;
  reason?: string;
  resetToTrailhead?: boolean;
  spawnPose?: PlayerPose | null;
  nextPoseSequence?: string;
};

type MobWorldCheckpointResult =
  | { ok: true; checkpointRevision: number; checkpointAt: number; leaseExpiresAt: number; serverNow: number }
  | { ok: false; reason: string; retryAfterMs?: number; serverNow: number };

type MobPlayerDamageResult =
  | { ok: true; replayed: boolean; killed: boolean; damage: number; state: PlayerCombatState; inventory: PersistedInventoryState; serverNow: number }
  | { ok: false; reason: string; retryAfterMs?: number; serverNow: number };

type RangedCombatMutationResult = {
  ok: boolean;
  kind?: "begin_charge" | "cancel_charge" | "release";
  reason?: string;
  replayed?: boolean;
  shot?: {
    landed: boolean;
    missReason?: string;
    targetKind: "none" | "player" | "mob";
    targetId: string;
    targetCombat?: MobAuthorityState | PlayerCombatState;
    killed: boolean;
    bowBroken: boolean;
    trajectory: {
      origin: { x: number; y: number; z: number };
      direction: { x: number; y: number; z: number };
      speed: number;
      chargeMs: number;
    };
    trace: { point: { x: number; y: number; z: number }; elapsedSeconds: number };
  };
  inventory?: PersistedInventoryState;
  drops?: Array<{ itemId: ItemId; count: number }>;
  serverNow: number;
};

type FurnaceAuthorityView = {
  state: FurnaceState;
  revision: string;
  blockInstanceToken: string;
};

type FurnaceAtResult =
  | { ok: true; furnace: FurnaceAuthorityView; serverNow: number }
  | { ok: false; reason: string; serverNow: number };

type FurnaceOperationResult =
  | {
      ok: true;
      replayed: boolean;
      moved: { direction: "to_furnace" | "to_player"; itemId: ItemId; count: number };
      player: PersistedInventoryState;
      furnace: FurnaceAuthorityView;
      serverNow: number;
    }
  | {
      ok: false;
      reason: string;
      player?: PersistedInventoryState;
      furnace?: FurnaceAuthorityView;
      serverNow: number;
    };

function visibleDroppedItemChunkKeys(x: number, z: number): string[] {
  const centerX = Math.floor(x / DROPPED_ITEM_CHUNK_SIZE);
  const centerZ = Math.floor(z / DROPPED_ITEM_CHUNK_SIZE);
  const keys: string[] = [];
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) keys.push(`${centerX + dx}:${centerZ + dz}`);
  }
  return keys;
}

function droppedItemOperationId(): string {
  return `lc_${crypto.randomUUID()}`;
}

function furnaceOperationId(): string {
  return `furnace_${crypto.randomUUID()}`;
}

const ENGINE_TO_PROTOCOL: Record<EngineBlockId, "air" | "grass" | "dirt" | "stone" | "cobblestone" | "sand" | "gravel" | "glass" | "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore" | "wood" | "leaves" | "planks" | "crafting_table" | "furnace" | "torch" | "chest" | "door_closed" | "door_open" | "bed" | "ladder" | "tnt" | "wool" | "sapling" | "stone_bricks" | "oak_fence" | "oak_fence_gate_closed" | "oak_fence_gate_open" | "stone_brick_slab" | "clay" | "bricks" | "bedrock"> = {
  [BLOCK.AIR]: "air",
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
  [BLOCK.GRAVEL]: "gravel",
  [BLOCK.WOOL]: "wool",
  [BLOCK.SAPLING]: "sapling",
  [BLOCK.STONE_BRICKS]: "stone_bricks",
  [BLOCK.OAK_FENCE]: "oak_fence",
  [BLOCK.OAK_FENCE_GATE_CLOSED]: "oak_fence_gate_closed",
  [BLOCK.OAK_FENCE_GATE_OPEN]: "oak_fence_gate_open",
  [BLOCK.STONE_BRICK_SLAB]: "stone_brick_slab",
  [BLOCK.CLAY]: "clay",
  [BLOCK.BRICKS]: "bricks",
  [BLOCK.BEDROCK]: "bedrock",
  [BLOCK.GLASS]: "glass",
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
  [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore",
  [BLOCK.WOOD]: "wood",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks",
  [BLOCK.CRAFTING_TABLE]: "crafting_table",
  [BLOCK.FURNACE]: "furnace",
  [BLOCK.TORCH]: "torch",
  [BLOCK.CHEST]: "chest",
  [BLOCK.DOOR_CLOSED]: "door_closed",
  [BLOCK.DOOR_OPEN]: "door_open",
  [BLOCK.BED]: "bed",
  [BLOCK.LADDER]: "ladder",
  [BLOCK.TNT]: "tnt",
};

const PROTOCOL_TO_ENGINE: Record<string, EngineBlockId> = {
  air: BLOCK.AIR,
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND,
  gravel: BLOCK.GRAVEL,
  wool: BLOCK.WOOL,
  sapling: BLOCK.SAPLING,
  stone_bricks: BLOCK.STONE_BRICKS,
  oak_fence: BLOCK.OAK_FENCE,
  oak_fence_gate_closed: BLOCK.OAK_FENCE_GATE_CLOSED,
  oak_fence_gate_open: BLOCK.OAK_FENCE_GATE_OPEN,
  stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
  clay: BLOCK.CLAY,
  bricks: BLOCK.BRICKS,
  bedrock: BLOCK.BEDROCK,
  glass: BLOCK.GLASS,
  coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE,
  diamond_ore: BLOCK.DIAMOND_ORE,
  wood: BLOCK.WOOD,
  log: BLOCK.WOOD,
  leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE,
  furnace: BLOCK.FURNACE,
  torch: BLOCK.TORCH,
  chest: BLOCK.CHEST,
  door_closed: BLOCK.DOOR_CLOSED,
  door_open: BLOCK.DOOR_OPEN,
  bed: BLOCK.BED,
  ladder: BLOCK.LADDER,
  tnt: BLOCK.TNT,
};

const ENGINE_TO_GAME: Partial<Record<EngineBlockId, BlockId>> = {
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
  [BLOCK.GRAVEL]: "gravel",
  [BLOCK.GLASS]: "glass",
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
  [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore",
  [BLOCK.WOOD]: "log",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks",
  [BLOCK.CRAFTING_TABLE]: "crafting_table",
  [BLOCK.FURNACE]: "furnace",
  [BLOCK.TORCH]: "torch",
  [BLOCK.CHEST]: "chest",
  [BLOCK.DOOR_CLOSED]: "door",
  [BLOCK.DOOR_OPEN]: "door",
  [BLOCK.BED]: "bed",
  [BLOCK.LADDER]: "ladder",
  [BLOCK.TNT]: "tnt",
  [BLOCK.WOOL]: "wool",
  [BLOCK.SAPLING]: "sapling",
  [BLOCK.STONE_BRICKS]: "stone_bricks",
  [BLOCK.OAK_FENCE]: "oak_fence",
  [BLOCK.OAK_FENCE_GATE_CLOSED]: "oak_fence_gate",
  [BLOCK.OAK_FENCE_GATE_OPEN]: "oak_fence_gate",
  [BLOCK.STONE_BRICK_SLAB]: "stone_brick_slab",
  [BLOCK.CLAY]: "clay",
  [BLOCK.BRICKS]: "bricks",
};

const ITEM_TO_ENGINE: Partial<Record<ItemId, EngineBlockId>> = {
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND,
  gravel: BLOCK.GRAVEL,
  glass: BLOCK.GLASS,
  coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE,
  diamond_ore: BLOCK.DIAMOND_ORE,
  log: BLOCK.WOOD,
  leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE,
  furnace: BLOCK.FURNACE,
  torch: BLOCK.TORCH,
  chest: BLOCK.CHEST,
  door: BLOCK.DOOR_CLOSED,
  bed: BLOCK.BED,
  ladder: BLOCK.LADDER,
  tnt: BLOCK.TNT,
  wool: BLOCK.WOOL,
  sapling: BLOCK.SAPLING,
  stone_bricks: BLOCK.STONE_BRICKS,
  oak_fence: BLOCK.OAK_FENCE,
  oak_fence_gate: BLOCK.OAK_FENCE_GATE_CLOSED,
  stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
  clay: BLOCK.CLAY,
  bricks: BLOCK.BRICKS,
};

type WorldChunksQueryResult =
  | {
      ok: true;
      chunks: Array<{ chunkKey: string; snapshotJson: string; revision: string; updatedAt: string }>;
      tntFuses: Array<{
        eventId: string;
        ignitionId: string;
        x: number;
        y: number;
        z: number;
        ignitedAt: number;
        dueAt: number;
        claim: { eventId: string; ignitionId: string } | null;
      }>;
      serverNow: number;
    }
  | { ok: false; reason: "invalid_chunk_keys" | "too_many_chunks"; chunks: []; tntFuses: []; serverNow: number };

type PendingChestTransfer = { requestJson: string; transportFailures: number };

type PendingInventoryAction = {
  operationId: string;
  requestJson: string;
  transportFailures: number;
  session: number;
  action:
    | { kind: "initialize" }
    | { kind: "select_hotbar"; selectedHotbar: number }
    | { kind: "eat"; sourceSlot: number; expectedItemId: ItemId }
    | {
        kind: "workspace_commit";
        playerStateJson: string;
        recipes: InventoryRecipeBatch[];
        craftingContext: CraftingContext;
        workstationCoordKey: string;
      };
};

type WorldBlockEditMutationResult =
  | {
      ok: true;
      replayed: boolean;
      operationId: string;
      kind: WorldBlockOperationRequest["kind"];
      x: number;
      y: number;
      z: number;
      previousBlock: WorldChunkBlockType;
      nextBlock: WorldChunkBlockType;
      inventoryRevision: string;
      chunkKey: string;
      chunkRevision: string;
      currentChunkRevision?: string;
      inventoryChanged: boolean;
      drop: { itemId: ItemId; count: number } | null;
      consumed: ItemId | null;
      toolUse: null | { used: boolean; broke: boolean; itemId: ItemId | null; remainingDurability: number | null };
      settledEdits: Array<{ x: number; y: number; z: number; blockType: WorldChunkBlockType }>;
      inventory?: PersistedInventoryState;
    }
  | { ok: false; reason: string; detail?: string; inventory?: PersistedInventoryState | null };

type TreeGrowthMutationResult =
  | {
      ok: true;
      replayed: boolean;
      operationId: string;
      x: number;
      y: number;
      z: number;
      consumed: "bone_meal";
      inventoryRevision: string;
      edits: Array<{ x: number; y: number; z: number; blockType: WorldChunkBlockType }>;
      chunks: Array<{ chunkKey: string; revision: string }>;
      currentChunks: Array<{ chunkKey: string; revision: string }>;
      inventory: PersistedInventoryState;
      serverNow: number;
    }
  | { ok: false; reason: string; serverNow: number };

type PendingWorldBlockEdit = {
  operationId: string;
  request: WorldBlockOperationRequest | null;
  requestJson: string;
  pose: SerializedWorldBlockEditPose;
  optimisticEdit: EngineWorldEdit;
  previousBlock: EngineBlockId;
  selectedHotbar: number;
  expectedHeldItem: ItemId | null;
  awaitingInventoryRevision: string;
};

let chestOperationSequence = 0;
let worldBlockOperationSequence = 0;

function createChestOperationId(): string {
  chestOperationSequence += 1;
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `lc_${Date.now().toString(36)}_${chestOperationSequence.toString(36)}_${randomPart}`.slice(0, 64);
}

function createCombatOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `attack_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

function createMobShearOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `shear_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

function createTntOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36).padEnd(16, "0");
  return `tntignite_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

function createTreeGrowthOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36).padEnd(16, "0");
  return `grow_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

async function retryExactLakebedMutation<T>(perform: () => Promise<T>): Promise<T> {
  try {
    return await perform();
  } catch {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    return perform();
  }
}

function createInventoryActionOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `inv_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

const WORLD_RADIUS = 18;
const DEFAULT_PLAYER_POSE: Readonly<PlayerPose> = Object.freeze({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 });
function visibleWorldChunkKeys(x: number, z: number): string[] {
  const centerX = worldEditChunkCoordinate(x);
  const centerZ = worldEditChunkCoordinate(z);
  const keys: string[] = [];
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) keys.push(`${centerX + dx}:${centerZ + dz}`);
  }
  return keys;
}

function playerColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  const red = 96 + ((hash >>> 0) & 95);
  const green = 104 + ((hash >>> 8) & 95);
  const blue = 88 + ((hash >>> 16) & 95);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function toEngineEdits(events: WorldEdit[]): EngineWorldEdit[] {
  return latestWorldEdits(events).flatMap((event) => {
    const block = PROTOCOL_TO_ENGINE[event.blockType];
    const x = Number(event.x);
    const y = Number(event.y);
    const z = Number(event.z);
    return block == null || ![x, y, z].every(Number.isInteger) ? [] : [{ x, y, z, block }];
  });
}

function chunkSnapshotsToEngineEdits(result: WorldChunksQueryResult | undefined): EngineWorldEdit[] {
  if (!result?.ok) return [];
  const edits: EngineWorldEdit[] = [];
  for (const chunk of result.chunks) {
    const decoded = decodeWorldChunkSnapshot(chunk.chunkKey, chunk.snapshotJson);
    if (!decoded.ok) continue;
    for (const edit of decoded.edits) {
      const block = PROTOCOL_TO_ENGINE[edit.blockType];
      if (block == null) continue;
      edits.push({ x: Number(edit.x), y: Number(edit.y), z: Number(edit.z), block });
    }
  }
  return edits;
}

function miningRequirementDetail(blockId: BlockId): string {
  const block = BLOCKS[blockId];
  const requirement = block.requiredDropTool;
  if (!requirement) return `${block.label} cannot be recovered with the held item.`;
  const tier = requirement.minimumTier === "wood" ? "wooden" : requirement.minimumTier;
  const article = tier === "iron" ? "an" : "a";
  return `${block.label} only drops when mined with ${article} ${tier} ${requirement.kind} or better.`;
}

function parsePlayerState(row: PersistedInventory | null) {
  if (!row) return null;
  const canonical = validatePlayerStateJson(row.inventoryJson);
  return canonical.ok ? canonical.state : null;
}

function LakebedQueryRecovery({ error, retry }: { error: Error; retry: () => void }) {
  const [remainingMs, setRemainingMs] = useState(0);
  const quota = classifyPresenceTransportError(error) === "quota";
  const [resetAt] = useState(() => quota ? presenceTransportQuotaResetAt(error, Date.now()) : null);

  useEffect(() => {
    if (resetAt === null) return;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      const remaining = Math.max(0, resetAt - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0) {
        retry();
        return;
      }
      timer = window.setTimeout(tick, Math.min(1_000, remaining));
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resetAt, retry]);

  return (
    <main className="lakecraft-query-recovery" role="status" aria-live="polite">
      <style>{QUERY_RECOVERY_CSS}</style>
      <section>
        <h1>{quota ? "LAKEBED QUOTA PAUSED" : "RECONNECTING TO LAKEBED"}</h1>
        <p>{quota
          ? `The shared world will retry automatically in ${Math.max(1, Math.ceil(remainingMs / 1_000))}s. No refresh is needed.`
          : "The shared world query failed. Retry when your connection is ready; the page has not reloaded."}</p>
        {!quota ? <button type="button" onClick={retry}>Retry now</button> : null}
      </section>
    </main>
  );
}

function LobbyBootstrapQuery({
  identity,
  onResult,
}: {
  identity: string;
  onResult: (identity: string, result: ClientBootstrap) => void;
}) {
  const result = useQuery<ClientBootstrap>("clientBootstrap");
  useEffect(() => {
    if (Array.isArray(result) && result.length === 4) onResult(identity, result);
  }, [identity, onResult, result]);
  return null;
}

function InventoryQuery({ onResult }: { onResult: (result: PersistedInventory | null) => void }) {
  const result = useQuery<PersistedInventory | null>("myInventory");
  useEffect(() => {
    if (result === null || (!Array.isArray(result) && typeof result === "object")) onResult(result);
  }, [onResult, result]);
  return null;
}

function LakebedWorldQueries({
  activeChestKey,
  activeFurnaceKey,
  combatUserIds,
  droppedChunkKeys,
  furnaceQuerySample,
  onChest,
  onCombat,
  onDroppedItems,
  onFurnace,
  onPresence,
  onWorldChunks,
  onWorldClock,
  onWorldEvents,
  worldChunkKeys,
}: {
  activeChestKey: string;
  activeFurnaceKey: string;
  combatUserIds: string[];
  droppedChunkKeys: string[];
  furnaceQuerySample: string;
  onChest: (result: ChestAtResult | undefined) => void;
  onCombat: (result: PlayerCombatQueryResult | undefined) => void;
  onDroppedItems: (result: DroppedItemsQueryResult | undefined) => void;
  onFurnace: (result: FurnaceAtResult | undefined) => void;
  onPresence: (result: PlayerPresence | null) => void;
  onWorldChunks: (result: WorldChunksQueryResult | undefined) => void;
  onWorldClock: (result: WorldClockSnapshot | undefined) => void;
  onWorldEvents: (result: WorldEdit[]) => void;
  worldChunkKeys: string[];
}) {
  const worldEvents = useQuery<WorldEdit[]>("worldEdits");
  const worldChunks = useQuery<WorldChunksQueryResult, string[]>("worldChunks", worldChunkKeys);
  const combat = useQuery<PlayerCombatQueryResult, string[]>("playerCombatStates", combatUserIds);
  const presence = useQuery<PlayerPresence | null>("myPresence");
  const chest = useQuery<ChestAtResult, string>("chestAt", activeChestKey);
  const furnace = useQuery<FurnaceAtResult, { coordKey: string; sample: string }>(
    "furnaceAt",
    { coordKey: activeFurnaceKey, sample: activeFurnaceKey ? furnaceQuerySample : "0" },
  );
  const clock = useQuery<WorldClockSnapshot>("worldClock");
  const dropped = useQuery<DroppedItemsQueryResult, string[]>("droppedItems", droppedChunkKeys);
  useEffect(() => { if (Array.isArray(worldEvents)) onWorldEvents(worldEvents); }, [onWorldEvents, worldEvents]);
  useEffect(() => { if (!Array.isArray(worldChunks)) onWorldChunks(worldChunks); }, [onWorldChunks, worldChunks]);
  useEffect(() => { if (!Array.isArray(combat)) onCombat(combat); }, [combat, onCombat]);
  useEffect(() => { if (presence === null || (!Array.isArray(presence) && typeof presence === "object")) onPresence(presence); }, [onPresence, presence]);
  useEffect(() => { if (!Array.isArray(chest)) onChest(chest); }, [chest, onChest]);
  useEffect(() => { if (!Array.isArray(furnace)) onFurnace(furnace); }, [furnace, onFurnace]);
  useEffect(() => { if (!Array.isArray(clock)) onWorldClock(clock); }, [clock, onWorldClock]);
  useEffect(() => { if (!Array.isArray(dropped)) onDroppedItems(dropped); }, [dropped, onDroppedItems]);
  return null;
}

function GameApp({
  inWorld,
  setInWorld,
  onJoinSingleplayer,
}: {
  inWorld: boolean;
  setInWorld: (inWorld: boolean) => void;
  onJoinSingleplayer: () => void;
}) {
  const auth = useAuth();
  const [clientSettings, setClientSettings] = useState(() => loadClientSettings(window.localStorage));
  const clientSettingsRef = useRef(clientSettings);
  clientSettingsRef.current = clientSettings;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [activeChestKey, setActiveChestKey] = useState("");
  const [activeFurnaceKey, setActiveFurnaceKey] = useState("");
  const [furnaceQuerySample, setFurnaceQuerySample] = useState("0");
  const [mobLeaseSessionId, setMobLeaseSessionId] = useState("");
  const [segmentRemotePlayers, setSegmentRemotePlayers] = useState<RemotePlayer[]>([]);
  const [worldChunkKeys, setWorldChunkKeys] = useState<string[]>(() => visibleWorldChunkKeys(DEFAULT_PLAYER_POSE.x, DEFAULT_PLAYER_POSE.z));
  const [worldEvents, setWorldEvents] = useState<WorldEdit[]>([]);
  const [worldChunks, setWorldChunks] = useState<WorldChunksQueryResult | undefined>(undefined);
  const combatUserIds = [...new Set([
    auth.userId,
    ...segmentRemotePlayers.slice(0, 127).map((player) => player.id),
  ].filter((userId): userId is string => typeof userId === "string" && userId.length > 0))].sort();
  const [playerCombatResult, setPlayerCombatResult] = useState<PlayerCombatQueryResult | undefined>(undefined);
  const [bootstrapIdentity, setBootstrapIdentity] = useState("");
  const [savedPresence, setSavedPresence] = useState<PlayerPresence | null | undefined>(undefined);
  const [savedInventory, setSavedInventory] = useState<PersistedInventory | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [externalMultiplayerServers, setExternalMultiplayerServers] = useState<ExternalMultiplayerServer[]>([]);
  const [chestResult, setChestResult] = useState<ChestAtResult | undefined>(undefined);
  const [furnaceResult, setFurnaceResult] = useState<FurnaceAtResult | undefined>(undefined);
  const [worldClock, setWorldClock] = useState<WorldClockSnapshot | undefined>(undefined);
  const [mobIds, setMobIds] = useState<string[]>([]);
  const [mobWorldAuthority, setMobWorldAuthority] = useState<MobWorldCompositeSnapshot | null>(null);
  const [droppedChunkKeys, setDroppedChunkKeys] = useState<string[]>(() => visibleDroppedItemChunkKeys(DEFAULT_PLAYER_POSE.x, DEFAULT_PLAYER_POSE.z));
  const [droppedItemsResult, setDroppedItemsResult] = useState<DroppedItemsQueryResult | undefined>(undefined);

  const editWorldBlock = useMutation<[
    requestJson: string,
    poseX: string,
    poseY: string,
    poseZ: string,
    poseYaw: string,
    posePitch: string,
  ], WorldBlockEditMutationResult>("editWorldBlock");
  const createExternalMultiplayerJoinTicket = useMutation<[serverId: string], ExternalJoinTicketResult>(
    "createExternalMultiplayerJoinTicket",
  );
  const growOakTree = useMutation<[
    requestJson: string,
    poseX: string,
    poseY: string,
    poseZ: string,
    poseYaw: string,
    posePitch: string,
  ], TreeGrowthMutationResult>("growOakTree");
  const heartbeatPlayer = useMutation<[displayName: string, color: string, x: string, y: string, z: string, yaw: string, pitch: string, poseSequence: string, vx: string, vy: string, vz: string, heldItem: string, armorHead: string, armorChest: string, armorLegs: string, armorFeet: string, sessionId: string], HeartbeatPlayerResult>("heartbeatPlayer");
  const authorizeRespawn = useMutation<[sessionId: string], AuthorizeRespawnResult>("authorizeRespawn");
  const startPresenceSession = useMutation<[sessionId: string], StartPresenceSessionResult>("startPresenceSession");
  const leavePlayer = useMutation<[sessionId: string], void>("leavePlayer");
  const applyInventoryActionMutation = useMutation<[requestJson: string], InventoryActionMutationResult>("applyInventoryAction");
  const claimUsername = useMutation<[requestedUsername: string], ClaimUsernameResult>("claimUsername");
  const transferChest = useMutation<[requestJson: string], ChestTransferResult>("transferChest");
  const operateFurnace = useMutation<[requestJson: string], FurnaceOperationResult>("operateFurnace");
  const sleepInBed = useMutation<[coordKey: string], SleepInBedResult>("sleepInBed");
  const attackMob = useMutation<[mobId: string, kind: string, damage: string, operationId: string], MobAttackResult>("attackMob");
  const shearMob = useMutation<[mobId: string, kind: string, operationId: string], MobShearResult>("shearMob");
  const checkpointMobWorld = useMutation<[requestJson: string], MobWorldCheckpointResult>("checkpointMobWorld");
  const claimMobPlayerDamage = useMutation<[requestJson: string], MobPlayerDamageResult>("claimMobPlayerDamage");
  const claimCreeperExplosion = useMutation<[requestJson: string], {
    ok: boolean;
    reason?: string;
    replayed?: boolean;
    eventId?: string;
    mobId?: string;
    center?: { x: number; y: number; z: number };
    destroyedBlocks?: number;
    victims?: Array<{ userId: string; damage: number; killed: boolean }>;
    serverNow: number;
  }>("claimCreeperExplosion");
  const igniteTnt = useMutation<[requestJson: string], {
    ok: boolean;
    reason?: string;
    replayed?: boolean;
    fuse?: { eventId: string; ignitionId: string; x: number; y: number; z: number; ignitedAt: number; dueAt: number };
    inventory?: PersistedInventoryState;
    toolUse?: { broke: boolean; remainingDurability: number };
    serverNow: number;
  }>("igniteTnt");
  const claimTntExplosion = useMutation<[requestJson: string], {
    ok: boolean;
    reason?: string;
    retryAfterMs?: number;
    replayed?: boolean;
    eventId?: string;
    center?: { x: number; y: number; z: number };
    destroyedBlocks?: number;
    victims?: Array<{ userId: string; damage: number; killed: boolean }>;
    serverNow: number;
  }>("claimTntExplosion");
  const attackPlayer = useMutation<[requestJson: string], {
    ok: boolean;
    reason?: string;
    retryAfterMs?: number;
    killed?: boolean;
    replayed?: boolean;
    damage?: number;
    weaponItemId?: ItemId | null;
    weaponBroken?: boolean;
    attackerInventory?: PersistedInventoryState;
    targetState?: PlayerCombatState;
    serverNow: number;
  }>("attackPlayer");
  const rangedCombat = useMutation<[requestJson: string], RangedCombatMutationResult>("rangedCombat");
  const dropItemMutation = useMutation<[requestJson: string], DroppedItemMutationResult>("dropItem");
  const pickupDroppedItemMutation = useMutation<[requestJson: string], DroppedItemMutationResult>("pickupDroppedItem");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const selectedSkinPromiseRef = useRef<Promise<HydratedPlayerSkin> | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const poseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const presenceSessionIdRef = useRef("");
  const presenceNextPoseSequenceRef = useRef(1);
  const presenceSampleRef = useRef<((pose: PlayerPose, at?: number) => void) | null>(null);
  const authorityRefreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const presenceHeartbeatInFlightRef = useRef(0);
  const presenceSchedulerRef = useRef<PresenceSchedulerState | null>(null);
  const presenceBurstGuardRef = useRef<PresenceBurstGuardState | null>(null);
  const presenceModeNoticeRef = useRef("");
  const targetRef = useRef<BlockTarget | null>(null);
  const inventoryRef = useRef<Inventory>(createStarterInventory());
  const equipmentRef = useRef<Equipment>(createEmptyEquipment());
  const inventoryAuthorityEpochRef = useRef(0);
  const respawnPointRef = useRef<PlayerRespawnPoint | null>(null);
  const hungerRef = useRef(MAX_HUNGER);
  const selectedRef = useRef(2);
  const hydratedRef = useRef(false);
  const hydratedUserRef = useRef("");
  const inventoryTokenRef = useRef("");
  const inventoryRevisionRef = useRef("0");
  const inventoryAuthoritySessionRef = useRef(0);
  const lastCommittedPlayerJsonRef = useRef("");
  const inventoryActionQueueRef = useRef<PendingInventoryAction[]>([]);
  const inventoryActionPromiseRef = useRef<Promise<boolean> | null>(null);
  const chestTokenRef = useRef("");
  const chestInventoryRef = useRef<Inventory>(createEmptyInventory(CHEST_SLOT_COUNT));
  const chestBusyRef = useRef(false);
  const furnaceBusyRef = useRef(false);
  const furnaceAuthorityRef = useRef<FurnaceAuthorityView | null>(null);
  const chestTransferActiveRef = useRef(false);
  const pendingChestTransferRef = useRef<PendingChestTransfer | null>(null);
  const pendingWorldBlockEditRef = useRef<PendingWorldBlockEdit | null>(null);
  const worldChunkRevisionRef = useRef(new Map<string, string>());
  const authoritativeWorldEditRef = useRef(new Map<string, EngineWorldEdit>());
  const worldEventsRef = useRef<WorldEdit[]>([]);
  const latestSavedInventoryRef = useRef<PersistedInventory | null | undefined>(undefined);
  const activeWorkstationRef = useRef<{ kind: "crafting_table" | "furnace"; position: WorkstationPosition } | null>(null);
  const toastCounter = useRef(0);
  const droppedItemBusyRef = useRef(false);
  const droppedChunkCenterRef = useRef("");
  const worldChunkCenterRef = useRef("");
  const intentionalPointerUnlockRef = useRef(false);
  const droppedItemsClockRef = useRef<{ result: DroppedItemsQueryResult; receivedAt: number } | null>(null);
  const realtimeDropsRef = useRef<NormalizedDroppedItem[]>([]);
  const droppedPickupAttemptRef = useRef(new Map<string, number>());
  const lastDroppedPickupSweepRef = useRef(0);
  const appliedOwnCombatHealthRef = useRef<number | null>(null);
  const appliedOwnCombatRevisionRef = useRef(-1);
  const mobCheckpointInFlightRef = useRef(false);
  const lastMobCheckpointAttemptAtRef = useRef(0);
  const mobDamageClaimsRef = useRef(new Set<string>());
  const creeperFuseCuesRef = useRef(new Set<string>());
  const creeperExplosionClaimsRef = useRef(new Set<string>());
  const tntFuseCuesRef = useRef(new Set<string>());
  const tntExplosionClaimsRef = useRef(new Set<string>());
  const tntClaimTimersRef = useRef(new Map<string, number>());
  const tntIgnitionBusyRef = useRef(false);
  const treeGrowthBusyRef = useRef(false);
  const realtimePresenceRef = useRef(false);
  const respawnRequestInFlightRef = useRef(false);
  const respawnLeaseTransitionRef = useRef(false);
  const respawnTimerRef = useRef<number | null>(null);
  const confirmedFeedbackOperationsRef = useRef<Set<string> | null>(null);
  const rangedChargeStartRef = useRef<Promise<boolean> | null>(null);
  const rangedChargeActiveRef = useRef(false);
  const rangedChargeBeginOperationRef = useRef("");
  const rangedChargeRevisionRef = useRef("");
  const rangedChargeSelectedRef = useRef(0);
  const playerProjectilesRef = useRef<PlayerProjectileVisual[]>([]);
  const previousChestKeyRef = useRef("");
  const motionActionSinkRef = useRef<((kind: MotionVisualActionKind, value?: number) => void) | null>(null);
  const entryPointerLockHandoffRef = useRef(false);
  const realtimeCrouchingRef = useRef(false);
  const previousSegmentPoseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const authorityTrafficPausedRef = useRef(false);
  const authoritativeKnockbackGateRef = useRef<AuthoritativeKnockbackGate | null>(null);

  if (!presenceSchedulerRef.current) presenceSchedulerRef.current = createPresenceSchedulerState();
  if (!presenceBurstGuardRef.current) presenceBurstGuardRef.current = createPresenceBurstGuardState(Date.now());
  if (!confirmedFeedbackOperationsRef.current) confirmedFeedbackOperationsRef.current = new Set<string>();
  const selectedSkin = () => selectedSkinPromiseRef.current ??=
    hydrateSelectedPlayerSkin(window.localStorage);

  const [inventory, setInventory] = useState<Inventory>(() => createStarterInventory());
  const [equipment, setEquipment] = useState<Equipment>(() => createEmptyEquipment());
  const [inventoryAuthorityEpoch, setInventoryAuthorityEpoch] = useState(0);
  const [respawnPoint, setRespawnPoint] = useState<PlayerRespawnPoint | null>(null);
  const [hunger, setHunger] = useState(MAX_HUNGER);
  const [selectedHotbar, setSelectedHotbar] = useState(2);
  worldEventsRef.current = worldEvents;
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [furnaceOpen, setFurnaceOpen] = useState(false);
  const [furnaceState, setFurnaceState] = useState<FurnaceState | null>(null);
  const [furnaceBusy, setFurnaceBusy] = useState(false);
  const [furnaceStatus, setFurnaceStatus] = useState("Input and fuel are shared through Lakebed.");
  const [furnaceError, setFurnaceError] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [mobileUnsupported, setMobileUnsupported] = useState(false);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [engineError, setEngineError] = useState("");
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transportReady, setTransportReady] = useState(false);
  const [transportForeground, setTransportForeground] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const [segmentTelemetry, setSegmentTelemetry] = useState<SegmentTelemetry | null>(null);
  const [joinPhase, setJoinPhase] = useState<LobbyJoinPhase>("idle");
  const [joinError, setJoinError] = useState("");
  const [savedMultiplayerServers, setSavedMultiplayerServers] = useState<SavedMultiplayerServer[]>(
    () => loadSavedMultiplayerServers(window.localStorage),
  );
  const [selectedServerId, setSelectedServerId] = useState("");
  const [directConnectValue, setDirectConnectValue] = useState("");
  const [directConnectToken, setDirectConnectToken] = useState("");
  const [demoServerTokens, setDemoServerTokens] = useState<Record<string, string>>(
    () => loadMultiplayerInvitationTokens(window.localStorage),
  );
  const [serverStatuses, setServerStatuses] = useState<Record<string, {
    status: "online" | "offline";
    onlinePlayers: number;
    capacity: number;
  }>>({});
  const [realtimeSession, setRealtimeSession] = useState<RealtimeSession | null>(null);
  const realtimeBlockSinkRef = useRef<RealtimeBlockSink | null>(null);
  const realtimeChatSinkRef = useRef<RealtimeChatSink | null>(null);
  const realtimeDropSinkRef = useRef<RealtimeDropSink | null>(null);
  const realtimePickupSinkRef = useRef<RealtimePickupSink | null>(null);
  const realtimeGameModeRef = useRef<RealtimeGameMode>("survival");
  const [realtimeChatMessages, setRealtimeChatMessages] = useState<RealtimeChatMessage[]>([]);
  const [realtimeGameMode, setRealtimeGameMode] = useState<RealtimeGameMode>("survival");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameClaimState>("idle");
  const [usernameError, setUsernameError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const [playerHealth, setPlayerHealth] = useState(20);
  const [deathScreenOpen, setDeathScreenOpen] = useState(false);
  const [respawning, setRespawning] = useState(false);
  const [chestInventory, setChestInventory] = useState<Inventory>(() => createEmptyInventory(CHEST_SLOT_COUNT));
  const [chestBusy, setChestBusy] = useState(false);
  const [chestError, setChestError] = useState("");
  const [activeBedKey, setActiveBedKey] = useState("");
  const lakebedIdentity = auth.isLoading ? "" : auth.userId ?? "guest";
  const bootstrapReady = lakebedIdentity !== "" && bootstrapIdentity === lakebedIdentity;
  const acceptBootstrap = (identity: string, result: ClientBootstrap) => {
    if (identity !== (auth.userId ?? "guest")) return;
    setSavedPresence(result[0]);
    setSavedInventory(result[1]);
    setProfile(result[2]);
    setExternalMultiplayerServers(result[3]);
    setBootstrapIdentity(identity);
  };
  const multiplayerPaused = multiplayerGameplayPaused({
    foreground: transportForeground,
    mobileUnsupported,
    death: deathScreenOpen,
    pause: pauseOpen,
    inventory: inventoryOpen,
    chat: chatOpen,
    furnace: furnaceOpen,
    chest: Boolean(activeChestKey),
    bed: Boolean(activeBedKey),
  });
  const registeredServers = externalMultiplayerServers.flatMap((server) => {
    const endpoint = normalizeMultiplayerEndpoint(server.canonicalWssUrl);
    return endpoint ? [{ ...server, canonicalWssUrl: endpoint }] : [];
  });
  const combinedServers = [...registeredServers.map((server): SavedMultiplayerServer => ({
    id: server.id,
    name: server.name,
    endpoint: server.canonicalWssUrl,
  }))];
  for (const saved of savedMultiplayerServers) {
    if (combinedServers.some((server) => server.endpoint === saved.endpoint)) continue;
    combinedServers.push(saved);
  }
  const serverProbeKey = combinedServers.map((server) => `${server.id}\u0000${server.endpoint}`).join("\u0001");
  const lobbyServers: LobbyServerEntry[] = combinedServers.map((server) => {
    const registered = registeredServers.find((candidate) => candidate.id === server.id);
    const probe = serverStatuses[server.endpoint];
    return {
      id: server.id,
      name: registered?.name ?? server.name,
      description: registered?.description ?? "Direct Connect · community server",
      endpoint: server.endpoint,
      status: registered?.status === "maintenance" ? "maintenance" : probe?.status ?? "busy",
      onlinePlayers: probe?.onlinePlayers ?? 0,
      capacity: probe?.capacity ?? registered?.capacity ?? 20,
    };
  });
  const activeServerName = lobbyServers.find((server) => server.id === realtimeSession?.serverId)?.name
    ?? lobbyServers.find((server) => server.id === selectedServerId)?.name
    ?? "Community Server";

  useEffect(() => {
    setRealtimeChatMessages([]);
    setLastSeenChatCount(0);
    setChatError("");
    realtimeGameModeRef.current = "survival";
    setRealtimeGameMode("survival");
  }, [realtimeSession?.endpoint]);

  useEffect(() => {
    if (!serverProbeKey) return;
    const controller = new AbortController();
    for (const server of combinedServers.slice(0, 24)) {
      const statusUrl = multiplayerStatusUrl(server.endpoint);
      if (!statusUrl) continue;
      void fetch(statusUrl, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw 0;
        const body = await response.json() as Record<string, unknown>;
        if (body.ok !== true || body.status !== "online" || body.protocolVersion !== 1) {
          throw 0;
        }
        setServerStatuses((current) => ({
          ...current,
          [server.endpoint]: {
            status: "online",
            onlinePlayers: typeof body.players === "number" && Number.isFinite(body.players)
              ? Math.max(0, Math.floor(body.players)) : 0,
            capacity: typeof body.capacity === "number" && Number.isFinite(body.capacity)
              ? Math.max(1, Math.floor(body.capacity)) : 20,
          },
        }));
      }).catch(() => {
        if (controller.signal.aborted) return;
        setServerStatuses((current) => ({
          ...current,
          [server.endpoint]: { status: "offline", onlinePlayers: 0, capacity: current[server.endpoint]?.capacity ?? 20 },
        }));
      });
    }
    return () => controller.abort();
  }, [serverProbeKey]);

  useEffect(() => {
    if (selectedServerId && combinedServers.some((server) => server.id === selectedServerId)) return;
    setSelectedServerId(combinedServers[0]?.id ?? "");
  }, [serverProbeKey, selectedServerId]);
  if (!authoritativeKnockbackGateRef.current) {
    authoritativeKnockbackGateRef.current = { paused: multiplayerPaused, pauseEpoch: multiplayerPaused ? 1 : 0 };
  } else updateAuthoritativeKnockbackGate(authoritativeKnockbackGateRef.current, multiplayerPaused);
  authorityTrafficPausedRef.current = multiplayerPaused;

  useEffect(() => {
    appliedOwnCombatHealthRef.current = null;
    appliedOwnCombatRevisionRef.current = -1;
  }, [auth.userId]);
  useEffect(() => {
    const update = () => setTransportForeground(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  useEffect(() => {
    if (!inWorld || deathScreenOpen) setOptionsOpen(false);
  }, [inWorld, deathScreenOpen]);
  const [chestRetryAvailable, setChestRetryAvailable] = useState(false);
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepStatus, setSleepStatus] = useState("Rest until every active explorer is in bed, then Lakebed will move the shared clock to morning.");

  function updateClientSettings(value: ClientSettings): void {
    const next = normalizeClientSettings(value);
    const soundChanged = clientSettingsRef.current.soundMuted !== next.soundMuted;
    clientSettingsRef.current = next;
    setClientSettings(next);
    saveClientSettings(window.localStorage, next);
    if (soundChanged) audioRef.current?.setMuted(next.soundMuted);
  }

  useEffect(() => {
    const audio = createGameAudio({ muted: clientSettingsRef.current.soundMuted, maxVoices: 16 });
    audioRef.current = audio;
    const unlock = () => { void audio.unlock(); };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button:not(:disabled)")) {
        audio.play("uiClick", { seed: `${target.tagName}:${performance.now().toFixed(0)}`, intensity: 0.48 });
      }
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("click", click, true);
      audio.destroy();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = previousChestKeyRef.current;
    if (!previous && activeChestKey) audioRef.current?.play("chestOpen", { seed: activeChestKey, surface: "wood" });
    if (previous && !activeChestKey) audioRef.current?.play("chestClose", { seed: previous, surface: "wood" });
    previousChestKeyRef.current = activeChestKey;
  }, [activeChestKey]);

  function notify(text: string, detail?: string, tone: HudMessage["tone"] = "info") {
    const id = `note-${++toastCounter.current}`;
    setMessages((current) => [...current.slice(-2), { id, text, detail, tone }]);
    window.setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), 3_500);
  }

  function refreshAuthoritativePose(): Promise<boolean> {
    if (authorityRefreshPromiseRef.current) return authorityRefreshPromiseRef.current;
    const task = (async () => {
      if (!profile || !auth.isAuthenticated || auth.isGuest || !presenceSessionIdRef.current) return false;
      const waitStartedAt = Date.now();
      while (presenceHeartbeatInFlightRef.current > 0 && Date.now() - waitStartedAt < 1_500) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      }
      if (presenceHeartbeatInFlightRef.current > 0) return false;
      const guard = presenceBurstGuardRef.current;
      const attemptAt = Date.now();
      if (!guard || !presenceBurstGuardSnapshot(guard, attemptAt, false).canAttempt
        || !reservePresenceAttempt(guard, attemptAt, false)) return false;
      persistPresenceBurstGuard(auth.userId, guard);
      const pose = engineRef.current?.getPose() ?? poseRef.current;
      const worn = equipmentRef.current;
      const appearance = normalizeAvatarAppearance(
        inventoryRef.current[selectedRef.current]?.itemId,
        worn.head?.itemId,
        worn.chest?.itemId,
        worn.legs?.itemId,
        worn.feet?.itemId,
      );
      const poseSequence = presenceNextPoseSequenceRef.current;
      presenceNextPoseSequenceRef.current += 1;
      presenceHeartbeatInFlightRef.current += 1;
      try {
        const result = await heartbeatPlayer(
          profile.username,
          playerColor(auth.userId),
          String(pose.x), String(pose.y), String(pose.z), String(pose.yaw), String(pose.pitch),
          String(poseSequence), "0", "0", "0",
          appearance.heldItem, appearance.armorHead, appearance.armorChest,
          appearance.armorLegs, appearance.armorFeet, presenceSessionIdRef.current,
        );
        const confirmedSequence = Number(result?.poseSequence ?? poseSequence);
        if (Number.isSafeInteger(confirmedSequence)) {
          presenceNextPoseSequenceRef.current = Math.max(presenceNextPoseSequenceRef.current, confirmedSequence + 1);
        }
        if (!result?.ok) return false;
        poseRef.current = pose;
        Object.assign(presenceSchedulerRef.current!, createPresenceSchedulerState());
        setConnected(true);
        return true;
      } finally {
        presenceHeartbeatInFlightRef.current = Math.max(0, presenceHeartbeatInFlightRef.current - 1);
      }
    })().catch(() => false);
    authorityRefreshPromiseRef.current = task;
    void task.finally(() => {
      if (authorityRefreshPromiseRef.current === task) authorityRefreshPromiseRef.current = null;
    });
    return task;
  }

  function requestAuthorizedRespawn(): void {
    if (respawnRequestInFlightRef.current) return;
    if (!auth.isAuthenticated || auth.isGuest) {
      notify("Respawn unavailable", "Sign in again before returning to the world.", "warning");
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    respawnLeaseTransitionRef.current = true;
    respawnRequestInFlightRef.current = true;
    setRespawning(true);
    void authorizeRespawn(presenceSessionIdRef.current).then((result) => {
      if (!result.ok) {
        respawnLeaseTransitionRef.current = false;
        if (result.reason === "session_mismatch") {
          notify("Respawn lease moved", "Another signed-in session owns this player now.", "warning");
          return;
        }
        const wait = result.reason === "respawn_not_ready" && result.retryAfterMs
          ? ` Try again in ${Math.max(1, Math.ceil(result.retryAfterMs / 1_000))} second${result.retryAfterMs > 1_000 ? "s" : ""}.`
          : "";
        notify("Respawn not authorized", `Lakebed kept you at the death location; no items moved.${wait}`, "warning");
        return;
      }
      const target = validateRespawnPoint(result.target, Number.MAX_SAFE_INTEGER);
      const expiresAt = Number(result.expiresAt);
      if (!target
        || typeof result.epoch !== "string"
        || !result.epoch
        || typeof result.sessionId !== "string"
        || !result.sessionId
        || !Number.isSafeInteger(expiresAt)
        || engineRef.current !== engine) {
        respawnLeaseTransitionRef.current = false;
        notify("Respawn not authorized", "Lakebed returned an invalid or expired spawn authorization.", "warning");
        return;
      }
      const nextPoseSequence = Number(result.nextPoseSequence);
      if (!Number.isSafeInteger(nextPoseSequence) || nextPoseSequence < 1) {
        respawnLeaseTransitionRef.current = false;
        notify("Respawn not authorized", "Lakebed returned an invalid presence lease.", "warning");
        return;
      }
      presenceSessionIdRef.current = result.sessionId;
      presenceNextPoseSequenceRef.current = nextPoseSequence;
      respawnLeaseTransitionRef.current = false;
      setMobLeaseSessionId(result.sessionId);
      engine.setRespawnPoint(target);
      if (!loadCanonicalPlayer(result.inventory)) {
        respawnLeaseTransitionRef.current = false;
        notify("Respawn reconciliation failed", "Lakebed returned a damaged inventory snapshot.", "warning");
        return;
      }
      engine.respawn();
      setDeathScreenOpen(false);
    }).catch(() => {
      respawnLeaseTransitionRef.current = false;
      notify("Respawn lost contact", "Lakebed could not authorize the jump. You remain at the death location.", "warning");
    }).finally(() => {
      respawnRequestInFlightRef.current = false;
      setRespawning(false);
    });
  }

  function exitPointerLockForUi(): void {
    if (!document.pointerLockElement) return;
    intentionalPointerUnlockRef.current = true;
    document.exitPointerLock();
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
  }

  function updateEquipment(next: Equipment) {
    equipmentRef.current = next;
    setEquipment(next);
  }

  function advanceInventoryAuthorityEpoch() {
    inventoryAuthorityEpochRef.current += 1;
    setInventoryAuthorityEpoch(inventoryAuthorityEpochRef.current);
  }

  function closeInventory() {
    activeWorkstationRef.current = null;
    setCraftingContext("field");
    setInventoryOpen(false);
    setFurnaceOpen(false);
    setActiveFurnaceKey("");
    furnaceAuthorityRef.current = null;
    setFurnaceState(null);
    setFurnaceError("");
  }

  function setChestOperationBusy(next: boolean) {
    chestBusyRef.current = next;
    setChestBusy(next);
  }

  function setFurnaceOperationBusy(next: boolean) {
    furnaceBusyRef.current = next;
    setFurnaceBusy(next);
  }

  function loadCanonicalFurnace(furnace: FurnaceAuthorityView): void {
    furnaceAuthorityRef.current = furnace;
    setFurnaceState(furnace.state);
  }

  function setCanonicalChestToken(next: string) {
    chestTokenRef.current = next;
  }

  function currentPlayerStateJson(): string {
    const raw = JSON.stringify(createSerializablePlayerState(
      inventoryRef.current,
      selectedRef.current,
      equipmentRef.current,
      respawnPointRef.current,
      hungerRef.current,
    ));
    const canonical = validatePlayerStateJson(raw);
    return canonical.ok ? canonical.playerStateJson : raw;
  }

  function loadCanonicalPlayer(row: PersistedInventoryState | null): boolean {
    if (!row) {
      inventoryTokenRef.current = "";
      inventoryRevisionRef.current = "0";
      lastCommittedPlayerJsonRef.current = "";
      return true;
    }
    if (row.revision !== inventoryRevisionRef.current
      && isDecimalRevisionAtLeast(inventoryRevisionRef.current, row.revision)) return true;
    const canonical = validatePlayerStateJson(row.inventoryJson);
    if (!canonical.ok) return false;
    const saved = canonical.state;
    inventoryTokenRef.current = row.updatedAt;
    inventoryRevisionRef.current = row.revision;
    lastCommittedPlayerJsonRef.current = canonical.playerStateJson;
    updateInventory(saved.inventory);
    selectedRef.current = saved.selectedHotbar;
    setSelectedHotbar(saved.selectedHotbar);
    updateEquipment(saved.equipment);
    respawnPointRef.current = saved.respawnPoint;
    setRespawnPoint(saved.respawnPoint);
    if (saved.respawnPoint) engineRef.current?.setRespawnPoint(saved.respawnPoint);
    hungerRef.current = saved.hunger;
    setHunger(saved.hunger);
    advanceInventoryAuthorityEpoch();
    return true;
  }

  function enqueueInventoryAction(action: PendingInventoryAction["action"]): Promise<boolean> {
    const queued = inventoryActionQueueRef.current;
    const last = queued[queued.length - 1];
    if (action.kind === "select_hotbar" && last?.action.kind === "select_hotbar" && !last.requestJson) {
      last.action = action;
      return flushInventoryActions();
    }
    inventoryActionQueueRef.current.push({
      operationId: createInventoryActionOperationId(),
      requestJson: "",
      transportFailures: 0,
      session: inventoryAuthoritySessionRef.current,
      action,
    });
    return flushInventoryActions();
  }

  function flushInventoryActions(): Promise<boolean> {
    if (inventoryActionPromiseRef.current) return inventoryActionPromiseRef.current;
    if (inventoryActionQueueRef.current.length === 0) {
      return Promise.resolve(currentPlayerStateJson() === lastCommittedPlayerJsonRef.current);
    }
    const task = (async (): Promise<boolean> => {
      while (inventoryActionQueueRef.current.length > 0) {
        const pending = inventoryActionQueueRef.current[0];
        if (!pending.requestJson) {
          pending.requestJson = JSON.stringify({
            operationId: pending.operationId,
            expectedRevision: inventoryRevisionRef.current,
            ...pending.action,
          });
        }
        let result: InventoryActionMutationResult;
        try {
          result = await applyInventoryActionMutation(pending.requestJson);
          if (pending.session !== inventoryAuthoritySessionRef.current) return false;
          setConnected(true);
          pending.transportFailures = 0;
        } catch {
          if (pending.session !== inventoryAuthoritySessionRef.current) return false;
          setConnected(false);
          pending.transportFailures += 1;
          if (pending.transportFailures <= 3) {
            const retryDelay = 500 * 2 ** (pending.transportFailures - 1);
            notify("Pack action delayed", `Lakebed will reconcile the same action in ${retryDelay / 1_000}s.`, "warning");
            await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelay));
            continue;
          }
          notify("Pack action paused", "Lakebed could not confirm the action. It remains queued with the same operation ID.", "warning");
          return false;
        }
        if (!result.ok) {
          inventoryActionQueueRef.current.length = 0;
          const returnedInventory = "inventory" in result ? result.inventory : undefined;
          const fallbackInventory = latestSavedInventoryRef.current;
          const reconciled = returnedInventory
            ? loadCanonicalPlayer(returnedInventory)
            : fallbackInventory && fallbackInventory.userId === auth.userId
              ? loadCanonicalPlayer(fallbackInventory)
              : false;
          notify(
            result.reason === "conflict" ? "Pack reconciled" : "Pack action rejected",
            reconciled
              ? "Lakebed restored the authoritative inventory; the unconfirmed action was discarded."
              : `Lakebed rejected ${pending.action.kind.replaceAll("_", " ")}; no unconfirmed items were committed.`,
            "warning",
          );
          return false;
        }
        inventoryActionQueueRef.current.shift();
        const superseded = result.inventory.revision !== inventoryRevisionRef.current
          && isDecimalRevisionAtLeast(inventoryRevisionRef.current, result.inventory.revision);
        if (!superseded) {
          inventoryTokenRef.current = result.inventory.updatedAt;
          inventoryRevisionRef.current = result.inventory.revision;
          lastCommittedPlayerJsonRef.current = result.inventory.inventoryJson;
        }
        if (inventoryActionQueueRef.current.length === 0 && !loadCanonicalPlayer(result.inventory)) {
          notify("Pack reconciliation failed", "Lakebed returned a damaged canonical inventory.", "warning");
          return false;
        }
      }
      return currentPlayerStateJson() === lastCommittedPlayerJsonRef.current;
    })();
    inventoryActionPromiseRef.current = task;
    void task.finally(() => {
      if (inventoryActionPromiseRef.current === task) inventoryActionPromiseRef.current = null;
    });
    return task;
  }

  async function handleDropSelected(dropWholeStack = false): Promise<void> {
    if (!hydratedRef.current || rangedChargeActiveRef.current || droppedItemBusyRef.current || chestBusyRef.current || pendingWorldBlockEditRef.current) return;
    const sourceSlot = selectedRef.current;
    const stack = inventoryRef.current[sourceSlot];
    if (!stack) return;
    droppedItemBusyRef.current = true;
    try {
      if (realtimeSession) {
        const count = dropWholeStack ? stack.count : 1;
        const item = { ...stack, count };
        const sink = realtimeDropSinkRef.current;
        if (!sink) throw new Error("multiplayer_not_connected");
        const dropped = await sink(droppedItemOperationId(), item, poseRef.current);
        const next = [...inventoryRef.current];
        const current = next[sourceSlot];
        if (!current || current.itemId !== stack.itemId || current.count < count) throw new Error("inventory_changed");
        next[sourceSlot] = current.count === count ? null : { ...current, count: current.count - count };
        updateInventory(next);
        droppedPickupAttemptRef.current.set(dropped.dropId, Number.POSITIVE_INFINITY);
        audioRef.current?.play("blockPlace", { seed: dropped.dropId, intensity: 0.45, surface: "generic" });
        return;
      }
      if (!await flushInventoryActions()) throw new Error("inventory_action_pending");
      const result = await dropItemMutation(JSON.stringify({
        operationId: droppedItemOperationId(),
        sourceSlot,
        count: dropWholeStack ? stack.count : 1,
        expectedInventoryUpdatedAt: inventoryTokenRef.current,
        playerStateJson: currentPlayerStateJson(),
      }));
      setConnected(true);
      if (result.ok) {
        droppedPickupAttemptRef.current.set(result.dropId, Number.POSITIVE_INFINITY);
        if (!loadCanonicalPlayer(result.inventory)) throw new Error("invalid_inventory");
        audioRef.current?.play("blockPlace", { seed: result.dropId, intensity: 0.45, surface: "generic" });
      } else if (result.reason === "conflict" && result.inventory) {
        loadCanonicalPlayer(result.inventory);
        notify("Drop reconciled", "Lakebed had a newer inventory; try Q again.", "warning");
      } else {
        notify("Could not drop item", result.reason === "active_presence_required" ? "Wait for the world connection, then try Q again." : "Lakebed rejected the shared item drop.", "warning");
      }
    } catch {
      setConnected(false);
      notify("Drop lost contact", "The item stayed in your inventory. Try again.", "warning");
    } finally {
      droppedItemBusyRef.current = false;
    }
  }

  async function pickupNearbyDroppedItem(drop: NormalizedDroppedItem): Promise<void> {
    if (!hydratedRef.current || rangedChargeActiveRef.current || droppedItemBusyRef.current || chestBusyRef.current || pendingWorldBlockEditRef.current) return;
    droppedItemBusyRef.current = true;
    try {
      if (realtimeSession) {
        const planned = addItemStack(inventoryRef.current, drop.item);
        if (planned.remainder > 0) return;
        const sink = realtimePickupSinkRef.current;
        if (!sink) throw new Error("multiplayer_not_connected");
        await sink(droppedItemOperationId(), drop.dropId);
        updateInventory(planned.inventory);
        audioRef.current?.play("pickup", { seed: drop.dropId, intensity: 0.72 });
        return;
      }
      if (!await flushInventoryActions()) throw new Error("inventory_action_pending");
      const result = await pickupDroppedItemMutation(JSON.stringify({
        operationId: droppedItemOperationId(),
        dropId: drop.dropId,
        expectedInventoryUpdatedAt: inventoryTokenRef.current,
        playerStateJson: currentPlayerStateJson(),
      }));
      setConnected(true);
      if (result.ok) {
        if (!loadCanonicalPlayer(result.inventory)) throw new Error("invalid_inventory");
        audioRef.current?.play("pickup", { seed: result.dropId, intensity: 0.72 });
      } else if (result.reason === "conflict" && result.inventory) {
        loadCanonicalPlayer(result.inventory);
      }
    } catch {
      setConnected(false);
    } finally {
      droppedItemBusyRef.current = false;
    }
  }

  function maybePickupNearbyDroppedItem(pose: PlayerPose): void {
    if (realtimeSession) {
      const now = Date.now();
      const nearby = realtimeDropsRef.current
        .filter((drop) => drop.expiresAt > now && (drop.ownerUserId !== auth.userId || drop.ownerPickupAt <= now))
        .map((drop) => ({ drop, distance: Math.hypot(drop.x - pose.x, drop.y - pose.y, drop.z - pose.z) }))
        .filter(({ distance }) => distance <= DROPPED_ITEM_PICKUP_RADIUS)
        .sort((left, right) => left.distance - right.distance)[0]?.drop;
      if (nearby && Date.now() - (droppedPickupAttemptRef.current.get(nearby.dropId) ?? 0) >= 5_000) {
        droppedPickupAttemptRef.current.set(nearby.dropId, Date.now());
        void pickupNearbyDroppedItem(nearby);
      }
      return;
    }
    const snapshot = droppedItemsClockRef.current;
    if (!snapshot?.result.ok || !Array.isArray(snapshot.result.items) || droppedItemBusyRef.current) return;
    const estimatedServerNow = snapshot.result.serverNow + Math.max(0, Date.now() - snapshot.receivedAt);
    const nearby = snapshot.result.items
      .filter((drop) => drop.expiresAt > estimatedServerNow && (drop.ownerUserId !== auth.userId || drop.ownerPickupAt <= estimatedServerNow))
      .map((drop) => ({ drop, distance: Math.hypot(drop.x - pose.x, drop.y - pose.y, drop.z - pose.z) }))
      .filter(({ distance }) => distance <= DROPPED_ITEM_PICKUP_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0]?.drop;
    if (!nearby) return;
    const lastAttempt = droppedPickupAttemptRef.current.get(nearby.dropId) ?? 0;
    if (Date.now() - lastAttempt < 5_000) return;
    droppedPickupAttemptRef.current.set(nearby.dropId, Date.now());
    void pickupNearbyDroppedItem(nearby);
  }

  function releasePendingWorldBlockEdit(pending: PendingWorldBlockEdit): void {
    if (pendingWorldBlockEditRef.current !== pending) return;
    pendingWorldBlockEditRef.current = null;
  }

  function rollbackPendingWorldBlockEdit(
    pending: PendingWorldBlockEdit,
    title: string,
    detail: string,
    transportFailed: boolean,
  ): void {
    if (pendingWorldBlockEditRef.current !== pending) return;
    const coordKey = blockCoordinateKey(
      pending.optimisticEdit.x,
      pending.optimisticEdit.y,
      pending.optimisticEdit.z,
    );
    const authoritative = authoritativeWorldEditRef.current.get(coordKey);
    engineRef.current?.applyWorldEdits([
      authoritative ?? { ...pending.optimisticEdit, block: pending.previousBlock },
    ]);
    const latestInventory = latestSavedInventoryRef.current;
    if (latestInventory
      && latestInventory.revision !== inventoryRevisionRef.current
      && currentPlayerStateJson() === lastCommittedPlayerJsonRef.current) {
      loadCanonicalPlayer(latestInventory);
    }
    releasePendingWorldBlockEdit(pending);
    setConnected(!transportFailed);
    notify(title, detail, "warning");
  }

  function notifyConfirmedWorldBlockEdit(result: Extract<WorldBlockEditMutationResult, { ok: true }>): void {
    if (result.kind === "mine") {
      if (!result.drop) {
        const gameBlock = ENGINE_TO_GAME[PROTOCOL_TO_ENGINE[result.previousBlock]];
        if (gameBlock && BLOCKS[gameBlock].drop) {
          notify(`No ${ITEMS[BLOCKS[gameBlock].drop!].label} recovered`, miningRequirementDetail(gameBlock), "warning");
        }
      }
    }
  }

  function emitConfirmedWorldBlockFeedback(result: Extract<WorldBlockEditMutationResult, { ok: true }>): void {
    const seen = confirmedFeedbackOperationsRef.current!;
    if (seen.has(result.operationId)) return;
    if (seen.size >= 256) seen.delete(seen.values().next().value as string);
    seen.add(result.operationId);
    const previous = PROTOCOL_TO_ENGINE[result.previousBlock];
    const next = PROTOCOL_TO_ENGINE[result.nextBlock];
    const seed = `${result.operationId}:${result.x},${result.y},${result.z}`;
    if (result.kind === "mine" && previous !== BLOCK.AIR) {
      audioRef.current?.play("blockBreak", { seed, surface: audioSurfaceForBlock(previous) });
      engineRef.current?.spawnBlockParticles({
        action: "break", block: previous, x: result.x, y: result.y, z: result.z,
      });
      return;
    }
    if (result.kind === "place" && next !== BLOCK.AIR) {
      audioRef.current?.play("blockPlace", { seed, surface: audioSurfaceForBlock(next) });
      engineRef.current?.spawnBlockParticles({
        action: "place", block: next, x: result.x, y: result.y, z: result.z,
      });
      return;
    }
    if (result.kind === "toggle") {
      const opened = next === BLOCK.DOOR_OPEN || next === BLOCK.OAK_FENCE_GATE_OPEN;
      audioRef.current?.play(opened ? "doorOpen" : "doorClose", { seed, surface: "wood" });
    }
  }

  async function submitPendingWorldBlockEdit(pending: PendingWorldBlockEdit): Promise<void> {
    if (realtimeSession) {
      const sink = realtimeBlockSinkRef.current;
      if (!sink) {
        rollbackPendingWorldBlockEdit(
          pending,
          "Edit paused",
          "The realtime server is still reconnecting. The block was restored.",
          true,
        );
        return;
      }
      try {
        const confirmed = await sink(pending.operationId, pending.optimisticEdit);
        if (pendingWorldBlockEditRef.current !== pending) return;
        authoritativeWorldEditRef.current.set(
          blockCoordinateKey(confirmed.x, confirmed.y, confirmed.z),
          confirmed,
        );
        engineRef.current?.applyWorldEdits([confirmed]);
        const seed = `${pending.operationId}:${confirmed.x},${confirmed.y},${confirmed.z}`;
        if (confirmed.block === BLOCK.AIR && pending.previousBlock !== BLOCK.AIR) {
          audioRef.current?.play("blockBreak", { seed, surface: audioSurfaceForBlock(pending.previousBlock) });
          engineRef.current?.spawnBlockParticles({
            action: "break", block: pending.previousBlock, x: confirmed.x, y: confirmed.y, z: confirmed.z,
          });
        } else if (confirmed.block !== BLOCK.AIR) {
          audioRef.current?.play("blockPlace", { seed, surface: audioSurfaceForBlock(confirmed.block) });
        }
        releasePendingWorldBlockEdit(pending);
      } catch {
        rollbackPendingWorldBlockEdit(
          pending,
          pending.optimisticEdit.block === BLOCK.AIR ? "Mine rejected" : "Edit rejected",
          "The realtime server did not accept this block edit, so the local block was restored.",
          true,
        );
      }
      return;
    }
    try {
      await flushInventoryActions();
      if (pendingWorldBlockEditRef.current !== pending) return;
      if (currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current) {
        rollbackPendingWorldBlockEdit(
          pending,
          "Edit paused",
          "Lakebed could not flush the field kit first. The block was restored; try again after the save reconnects.",
          true,
        );
        return;
      }
      const previousProtocol = ENGINE_TO_PROTOCOL[pending.previousBlock];
      const nextProtocol = ENGINE_TO_PROTOCOL[pending.optimisticEdit.block];
      const chunkKey = worldEditChunkKey(pending.optimisticEdit.x, pending.optimisticEdit.z);
      const request = buildWorldBlockOperationRequest({
        operationId: pending.operationId,
        x: pending.optimisticEdit.x,
        y: pending.optimisticEdit.y,
        z: pending.optimisticEdit.z,
        previousBlock: previousProtocol,
        nextBlock: nextProtocol,
        selectedHotbar: pending.selectedHotbar,
        expectedHeldItem: pending.expectedHeldItem,
        expectedInventoryRevision: inventoryRevisionRef.current,
        expectedChunkRevision: worldChunkRevisionRef.current.get(chunkKey) ?? "0",
      });
      if (!request) {
        rollbackPendingWorldBlockEdit(pending, "Edit rolled back", "That block transition is not supported.", false);
        return;
      }
      pending.request = request;
      pending.requestJson = JSON.stringify(request);
      const args = [pending.requestJson, ...pending.pose] as const;
      const { result } = await invokeWorldBlockEditWithOneRetry(editWorldBlock, args);
      if (pendingWorldBlockEditRef.current !== pending) return;
      setConnected(true);
      if (!result.ok) {
        const latestInventory = latestSavedInventoryRef.current;
        if (request.kind !== "toggle" && latestInventory
          && latestInventory.revision !== request.expectedInventoryRevision) {
          loadCanonicalPlayer(latestInventory);
        }
        rollbackPendingWorldBlockEdit(
          pending,
          request.kind === "mine" ? "Mine rolled back" : request.kind === "place" ? "Placement rolled back" : "Block restored",
          `Lakebed rejected the edit (${result.reason}). The world and field kit were reconciled.`,
          false,
        );
        return;
      }

      const coordKey = blockCoordinateKey(result.x, result.y, result.z);
      const replayPassedByNewerChunk = result.replayed
        && result.currentChunkRevision !== result.chunkRevision;
      const canonicalEdit = replayPassedByNewerChunk
        ? authoritativeWorldEditRef.current.get(coordKey) ?? null
        : { x: result.x, y: result.y, z: result.z, block: PROTOCOL_TO_ENGINE[result.nextBlock] };
      if (canonicalEdit?.block != null) {
        const confirmedEdits: EngineWorldEdit[] = [{
          x: canonicalEdit.x,
          y: canonicalEdit.y,
          z: canonicalEdit.z,
          block: canonicalEdit.block,
        }];
        if (!replayPassedByNewerChunk) {
          for (const settled of result.settledEdits) confirmedEdits.push({
            x: settled.x,
            y: settled.y,
            z: settled.z,
            block: PROTOCOL_TO_ENGINE[settled.blockType],
          });
        }
        engineRef.current?.applyWorldEdits(confirmedEdits);
      }
      worldChunkRevisionRef.current.set(result.chunkKey, result.currentChunkRevision ?? result.chunkRevision);
      if (!replayPassedByNewerChunk) emitConfirmedWorldBlockFeedback(result);
      notifyConfirmedWorldBlockEdit(result);
      if (result.inventory && loadCanonicalPlayer(result.inventory)) {
        releasePendingWorldBlockEdit(pending);
        return;
      }
      if (!result.inventoryChanged) {
        inventoryRevisionRef.current = result.inventoryRevision;
        releasePendingWorldBlockEdit(pending);
        return;
      }

      // A receipt replay intentionally omits the row payload. Keep serialization
      // active until the reactive inventory query supplies that canonical revision.
      pending.awaitingInventoryRevision = result.inventoryRevision;
      const latestInventory = latestSavedInventoryRef.current;
      if (latestInventory
        && isDecimalRevisionAtLeast(latestInventory.revision, result.inventoryRevision)
        && loadCanonicalPlayer(latestInventory)) {
        releasePendingWorldBlockEdit(pending);
      }
    } catch {
      rollbackPendingWorldBlockEdit(
        pending,
        pending.optimisticEdit.block === BLOCK.AIR ? "Mine lost contact" : "Edit lost contact",
        "Lakebed could not confirm the edit after one exact retry, so the local block was restored.",
        true,
      );
    }
  }

  function handleBlockEdit(edit: EngineWorldEdit, previousBlock: EngineBlockId) {
    if (pendingWorldBlockEditRef.current) {
      engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
      return;
    }
    worldBlockOperationSequence += 1;
    const selectedHotbar = selectedRef.current;
    const pending: PendingWorldBlockEdit = {
      operationId: createWorldBlockOperationId(worldBlockOperationSequence),
      request: null,
      requestJson: "",
      pose: serializeWorldBlockEditPose(engineRef.current?.getPose() ?? poseRef.current),
      optimisticEdit: { ...edit },
      previousBlock,
      selectedHotbar,
      expectedHeldItem: inventoryRef.current[selectedHotbar]?.itemId ?? null,
      awaitingInventoryRevision: "",
    };
    pendingWorldBlockEditRef.current = pending;
    void submitPendingWorldBlockEdit(pending);
  }

  useEffect(() => {
    inventoryRef.current = inventory;
    equipmentRef.current = equipment;
    selectedRef.current = selectedHotbar;
    const selected = inventory[selectedHotbar];
    engineRef.current?.setSelectedBlock(selected ? ITEM_TO_ENGINE[selected.itemId] ?? BLOCK.AIR : BLOCK.AIR);
    engineRef.current?.setSelectedItem(selected?.itemId ?? null);
    engineRef.current?.setPlayerArmor({
      head: equipment.head?.itemId ?? null,
      chest: equipment.chest?.itemId ?? null,
      legs: equipment.legs?.itemId ?? null,
      feet: equipment.feet?.itemId ?? null,
    });
  }, [inventory, selectedHotbar, equipment]);

  useEffect(() => {
    engineRef.current?.setPaused(multiplayerPaused);
    engineRef.current?.setFirstPersonFeedbackHidden(multiplayerPaused);
  }, [multiplayerPaused]);

  useEffect(() => {
    chestInventoryRef.current = chestInventory;
  }, [chestInventory]);

  useEffect(() => {
    if (!auth.isAuthenticated || auth.isGuest || hydratedUserRef.current === auth.userId || savedInventory === undefined) return;
    if (savedInventory && savedInventory.userId !== auth.userId) return;
    hydratedRef.current = true;
    hydratedUserRef.current = auth.userId;
    inventoryAuthoritySessionRef.current += 1;
    inventoryTokenRef.current = savedInventory?.updatedAt ?? "";
    inventoryRevisionRef.current = savedInventory?.revision ?? "0";
    if (savedInventory) {
      const canonical = validatePlayerStateJson(savedInventory.inventoryJson);
      lastCommittedPlayerJsonRef.current = canonical.ok ? canonical.playerStateJson : savedInventory.inventoryJson;
    } else {
      lastCommittedPlayerJsonRef.current = "";
    }
    const saved = parsePlayerState(savedInventory);
    if (saved) {
      updateInventory(saved.inventory);
      selectedRef.current = saved.selectedHotbar;
      setSelectedHotbar(saved.selectedHotbar);
      updateEquipment(saved.equipment);
      respawnPointRef.current = saved.respawnPoint;
      setRespawnPoint(saved.respawnPoint);
      hungerRef.current = saved.hunger;
      setHunger(saved.hunger);
      notify("Field kit restored", "Lakebed recovered your last inventory.", "success");
      advanceInventoryAuthorityEpoch();
      setInventoryReady(true);
      return;
    }
    setInventoryReady(false);
    void enqueueInventoryAction({ kind: "initialize" }).then((committed) => {
      if (hydratedUserRef.current !== auth.userId) return;
      if (committed || inventoryTokenRef.current) {
        advanceInventoryAuthorityEpoch();
        setInventoryReady(true);
      }
    });
  }, [savedInventory, auth.userId, auth.isAuthenticated, auth.isGuest]);

  useEffect(() => {
    latestSavedInventoryRef.current = savedInventory;
    if (!savedInventory || savedInventory.userId !== auth.userId) return;
    const pending = pendingWorldBlockEditRef.current;
    if (pending?.awaitingInventoryRevision
      && isDecimalRevisionAtLeast(savedInventory.revision, pending.awaitingInventoryRevision)
      && loadCanonicalPlayer(savedInventory)) {
      releasePendingWorldBlockEdit(pending);
      return;
    }
    if (!pending
      && inventoryActionQueueRef.current.length === 0
      && savedInventory.revision !== inventoryRevisionRef.current
      && currentPlayerStateJson() === lastCommittedPlayerJsonRef.current
      && loadCanonicalPlayer(savedInventory)) {
      return;
    }
    if (!pending && inventoryActionQueueRef.current.length === 0
      && savedInventory.inventoryJson === lastCommittedPlayerJsonRef.current) {
      inventoryTokenRef.current = savedInventory.updatedAt;
      inventoryRevisionRef.current = savedInventory.revision;
    }
  }, [savedInventory, auth.userId]);

  useEffect(() => {
    if (!furnaceOpen || !activeFurnaceKey) return;
    setFurnaceQuerySample(String(Date.now()));
    const timer = window.setInterval(() => setFurnaceQuerySample(String(Date.now())), 2_000);
    return () => window.clearInterval(timer);
  }, [furnaceOpen, activeFurnaceKey]);

  useEffect(() => {
    if (!furnaceOpen || !activeFurnaceKey || !furnaceResult) return;
    if (!furnaceResult.ok) {
      if (furnaceResult.reason === "furnace_required") setFurnaceError("That furnace no longer exists.");
      else if (furnaceResult.reason === "out_of_reach") setFurnaceError("Move closer to use this furnace.");
      else if (furnaceResult.reason !== "invalid_coordinate") setFurnaceError("Lakebed could not read the shared furnace.");
      return;
    }
    if (furnaceResult.furnace.state.coordKey !== activeFurnaceKey || furnaceBusyRef.current) return;
    loadCanonicalFurnace(furnaceResult.furnace);
    setFurnaceStatus(furnaceResult.furnace.state.burnRemainingMs > 0
      ? "The furnace is burning. Progress is derived from Lakebed server time."
      : "Input and fuel are shared through Lakebed.");
    setFurnaceError("");
  }, [furnaceOpen, activeFurnaceKey, furnaceResult]);

  useEffect(() => {
    if (!inWorld || !inventoryReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const resumedPresencePose = savedPresence ? parsePersistedPresencePose(savedPresence) : null;
      if (resumedPresencePose) poseRef.current = resumedPresencePose;
      const engine = createVoxelEngine(canvas, {
        initialPose: resumedPresencePose ?? poseRef.current,
        preserveInitialPose: Boolean(resumedPresencePose),
        getMouseLookSensitivity: () => mouseLookScale(clientSettingsRef.current.mouseSensitivity),
        getFieldOfViewRadians: () => fieldOfViewRadians(clientSettingsRef.current.fovDegrees),
        worldRadius: WORLD_RADIUS,
        dayNight: worldClock ? {
          cycleLengthMs: worldClock.cycleLengthMs,
          epochMs: worldClock.epochMs,
          epochPhase: worldClock.epochPhase,
        } : undefined,
        serverTimeOffsetMs: worldClock ? worldClock.serverNow - Date.now() : 0,
        selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
        selectedItem: inventoryRef.current[selectedRef.current]?.itemId ?? null,
        canEditBlock: () => pendingWorldBlockEditRef.current === null,
        onHotbarSelect: handleSelectHotbar,
        onHotbarCycle: (direction) => handleSelectHotbar(cycleHotbarIndex(selectedRef.current, direction)),
        getMiningDuration: (block) => {
          if (realtimeGameModeRef.current === "creative") return 0.05;
          const gameBlock = ENGINE_TO_GAME[block];
          const heldItem = inventoryRef.current[selectedRef.current]?.itemId;
          return gameBlock ? miningSeconds(gameBlock, heldItem) : 0.2;
        },
        getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
        getPlayerProtection: () => equippedArmorProtection(equipmentRef.current),
        // LAKEBED_COMPACT_LEGACY_COMBAT_START
        isRangedWeaponSelected: () => !realtimeSession && inventoryRef.current[selectedRef.current]?.itemId === "bow"
          && countItem(inventoryRef.current, "arrow") > 0,
        onRangedChargeChange: (charging, normalizedCharge) => {
          rangedChargeActiveRef.current = charging;
          if (!charging || normalizedCharge !== 0 || rangedChargeStartRef.current) return;
          motionActionSinkRef.current?.("bow_draw");
          const operationId = createCombatOperationId();
          rangedChargeBeginOperationRef.current = operationId;
          const startPromise = flushInventoryActions().then(async (flushed) => {
            if (!flushed) return false;
            if (!await refreshAuthoritativePose()) {
              notify("Bow draw rejected", "Lakebed could not refresh your authoritative pose.", "warning");
              return false;
            }
            const selectedHotbar = selectedRef.current;
            const expectedInventoryRevision = inventoryRevisionRef.current;
            rangedChargeRevisionRef.current = expectedInventoryRevision;
            rangedChargeSelectedRef.current = selectedHotbar;
            const requestJson = JSON.stringify({
              version: RANGED_COMBAT_PROTOCOL_VERSION,
              operationId,
              expectedInventoryRevision,
              selectedHotbar,
              kind: "begin_charge",
            });
            return retryExactLakebedMutation(() => rangedCombat(requestJson)).then((result) => {
              if (result.ok) return true;
              notify("Bow draw rejected", `Lakebed rejected the draw (${result.reason ?? "unknown"}).`, "warning");
              return false;
            });
          }).catch(() => {
            setConnected(false);
            notify("Bow lost contact", "Lakebed could not begin the server-timed draw.", "warning");
            return false;
          });
          rangedChargeStartRef.current = startPromise;
        },
        onRangedCancel: () => {
          const startPromise = rangedChargeStartRef.current;
          const beginOperationId = rangedChargeBeginOperationRef.current;
          rangedChargeStartRef.current = null;
          rangedChargeBeginOperationRef.current = "";
          rangedChargeActiveRef.current = false;
          if (!startPromise || !beginOperationId) return;
          const operationId = createCombatOperationId();
          void startPromise.then((started) => {
            if (!started) return null;
            const requestJson = JSON.stringify({
              version: RANGED_COMBAT_PROTOCOL_VERSION,
              operationId,
              expectedInventoryRevision: rangedChargeRevisionRef.current,
              selectedHotbar: rangedChargeSelectedRef.current,
              kind: "cancel_charge",
              beginOperationId,
            });
            return retryExactLakebedMutation(() => rangedCombat(requestJson));
          }).catch(() => {
            setConnected(false);
            notify("Bow cancel delayed", "Lakebed could not immediately clear the draw; the lease will expire safely.", "warning");
          });
        },
        onRangedRelease: (intent) => {
          motionActionSinkRef.current?.("bow_release");
          const startPromise = rangedChargeStartRef.current;
          rangedChargeStartRef.current = null;
          rangedChargeBeginOperationRef.current = "";
          rangedChargeActiveRef.current = false;
          if (!startPromise) return;
          const operationId = createCombatOperationId();
          void startPromise.then((started) => {
            if (!started) return null;
            const selectedHotbar = rangedChargeSelectedRef.current;
            const expectedInventoryRevision = rangedChargeRevisionRef.current;
            const requestJson = JSON.stringify({
              version: RANGED_COMBAT_PROTOCOL_VERSION,
              operationId,
              expectedInventoryRevision,
              selectedHotbar,
              kind: "release",
              targetKind: intent.target.kind,
              targetId: intent.target.id,
            });
            return retryExactLakebedMutation(() => rangedCombat(requestJson));
          }).then((result) => {
            if (!result) return;
            setConnected(true);
            if (!result.ok || !result.shot) {
              notify("Arrow rejected", `Lakebed rejected the shot (${result.reason ?? "unknown"}).`, "warning");
              return;
            }
            if (result.inventory) loadCanonicalPlayer(result.inventory);
            const launchedAt = performance.now();
            const trajectory = result.shot.trajectory;
            const projectile: PlayerProjectileVisual = {
              projectileId: operationId,
              originX: trajectory.origin.x,
              originY: trajectory.origin.y,
              originZ: trajectory.origin.z,
              velocityX: trajectory.direction.x * trajectory.speed,
              velocityY: trajectory.direction.y * trajectory.speed,
              velocityZ: trajectory.direction.z * trajectory.speed,
              launchedAt,
              expiresAt: launchedAt + Math.max(80, result.shot.trace.elapsedSeconds * 1_000),
              gravity: 12,
            };
            playerProjectilesRef.current = [
              ...playerProjectilesRef.current.filter((candidate) => candidate.launchedAt + 5_000 > launchedAt),
              projectile,
            ].slice(-96);
            engineRef.current?.setPlayerProjectiles(playerProjectilesRef.current);
            if (result.shot.targetKind === "mob" && result.shot.targetCombat) {
              engineRef.current?.applyMobCombatStates([result.shot.targetCombat as MobAuthorityState], result.serverNow - Date.now());
              if (result.shot.landed) audioRef.current?.play(result.shot.killed ? "mobDeath" : "mobHurt", {
                seed: operationId,
                intensity: result.shot.killed ? 0.9 : 0.68,
                mob: result.shot.targetCombat.kind,
              });
              if (!result.replayed && result.shot.landed && !result.shot.killed) {
                engineRef.current?.applyConfirmedPlayerHitMobKnockback(
                  operationId,
                  result.shot.targetId,
                  trajectory.origin.x,
                  trajectory.origin.z,
                  trajectory.damage,
                );
              }
            }
          }).catch(() => {
            setConnected(false);
            notify("Arrow lost contact", "Lakebed could not confirm the shot.", "warning");
          });
        },
        onUseSelectedItem: () => {
          const used = handleUseItem();
          return used;
        },
        onMobUse: realtimeSession ? undefined : (target) => {
          if (target.kind !== "sheep" || inventoryRef.current[selectedRef.current]?.itemId !== "shears") return false;
          const operationId = createMobShearOperationId();
          void flushInventoryActions().then(async (flushed) => {
            if (!flushed) throw new Error("inventory_action_pending");
            if (!await refreshAuthoritativePose()) throw new Error("presence_refresh_failed");
            return retryExactLakebedMutation(() => shearMob(target.id, target.kind, operationId));
          }).then((result) => {
            setConnected(true);
            if (!result.ok) {
              if (result.reason === "inventory_full") notify("Inventory full", "Make room for the sheep's wool.", "warning");
              return;
            }
            engineRef.current?.applyMobCombatStates([result.state], result.serverNow - Date.now());
            if (!loadCanonicalPlayer(result.inventory)) {
              notify("Shearing reconciliation failed", "Lakebed returned an invalid inventory snapshot.", "warning");
              return;
            }
            if (!result.replayed) audioRef.current?.play("pickup", { seed: operationId, intensity: 0.58 });
          }).catch(() => {
            setConnected(false);
            notify("Shearing lost contact", "Lakebed could not confirm the interaction.", "warning");
          });
          return true;
        },
        onMobAttack: realtimeSession ? undefined : (target, damage) => {
          const operationId = createCombatOperationId();
          const attackPose = engineRef.current?.getPose();
          void flushInventoryActions().then(async (flushed) => {
            if (!flushed) throw new Error("inventory_action_pending");
            if (!await refreshAuthoritativePose()) throw new Error("presence_refresh_failed");
            return attackMob(
            target.id,
            target.kind,
            String(Math.max(1, Math.min(MAX_MOB_ATTACK_DAMAGE, Math.floor(damage)))),
            operationId,
            );
          }).then((result) => {
            setConnected(true);
            if (result.state) {
              engineRef.current?.applyMobCombatStates([result.state], result.serverNow - Date.now());
            }
            if (result.ok) {
              if (!result.replayed && !result.killed) {
                engineRef.current?.applyConfirmedPlayerHitMobKnockback(
                  operationId,
                  target.id,
                  attackPose?.x ?? 0,
                  attackPose?.z ?? 0,
                  damage,
                );
              }
              loadCanonicalPlayer(result.inventory);
              audioRef.current?.play(result.killed ? "mobDeath" : "mobHurt", {
                seed: operationId,
                intensity: result.killed ? 0.9 : 0.68,
                mob: target.kind,
              });
            }
          }).catch(() => {
            setConnected(false);
            notify("Attack lost contact", "Lakebed could not confirm that hit.", "warning");
          });
        },
        onRemotePlayerAttack: realtimeSession ? () => undefined : (target) => {
          const selectedHotbar = selectedRef.current;
          const weaponItemId = inventoryRef.current[selectedHotbar]?.itemId ?? "";
          const operationId = createCombatOperationId();
          void flushInventoryActions().then(async (flushed) => {
            if (!flushed) throw new Error("inventory_action_pending");
            if (!await refreshAuthoritativePose()) throw new Error("presence_refresh_failed");
            return attackPlayer(JSON.stringify({
              operationId,
              targetUserId: target.id,
              selectedHotbar,
              weaponItemId,
            }));
          }).then((result) => {
            setConnected(true);
            if (result.ok) {
              if (result.attackerInventory) loadCanonicalPlayer(result.attackerInventory);
              audioRef.current?.play("playerHurt", { seed: operationId, intensity: result.killed ? 0.9 : 0.65 });
              return;
            }
            if (result.reason === "cooldown") return;
            const detail = result.reason === "weapon_mismatch"
              ? "Your selected slot changed before Lakebed confirmed it. Swing again."
              : result.reason === "out_of_reach" || result.reason === "not_aimed"
                ? "Lakebed rejected the hit because the latest authoritative poses did not line up."
                : result.reason === "target_dead"
                  ? `${target.name} is already respawning.`
                  : `Lakebed rejected the hit (${result.reason ?? "unknown"}).`;
            notify("PvP hit rejected", detail, "warning");
          }).catch(() => {
            setConnected(false);
            notify("PvP lost contact", "Lakebed could not confirm that swing.", "warning");
          });
        },
        // LAKEBED_COMPACT_LEGACY_COMBAT_END
        onMiningHit: (target) => {
          const surface = audioSurfaceForBlock(target.block.block);
          const seed = `${target.block.x},${target.block.y},${target.block.z}:${performance.now().toFixed(0)}`;
          audioRef.current?.play("miningHit", { seed, surface, intensity: 0.6 });
          engineRef.current?.spawnBlockParticles({
            action: "hit",
            block: target.block.block,
            x: target.block.x,
            y: target.block.y,
            z: target.block.z,
            normalX: target.place.x - target.block.x,
            normalY: target.place.y - target.block.y,
            normalZ: target.place.z - target.block.z,
          });
        },
        onFootstep: (block) => {
          audioRef.current?.play("footstep", {
            seed: `${block}:${poseRef.current.x.toFixed(1)}:${poseRef.current.z.toFixed(1)}`,
            surface: audioSurfaceForBlock(block),
            intensity: 0.48,
          });
        },
        onMobIdle: (kind, mobId, intensity, pan) => audioRef.current?.play("mobIdle", {
          seed: mobId,
          mob: kind,
          intensity,
          pan,
        }),
        canSprint: () => realtimeGameModeRef.current === "creative" || hungerRef.current > 6,
        canCreativeFly: () => Boolean(realtimeSession) && realtimeGameModeRef.current === "creative",
        canMobsTargetPlayer: () => realtimeGameModeRef.current !== "creative",
        canTakePlayerDamage: () => realtimeGameModeRef.current !== "creative",
        onHandAction: (action) => {
          if (action === "attack") audioRef.current?.play("playerAttack", { seed: performance.now().toFixed(0), intensity: 0.44 });
          motionActionSinkRef.current?.(action === "use" ? "use" : "swing");
        },
        onMovementModeChange: (mode) => {
          const crouching = mode === "sneak";
          if (crouching === realtimeCrouchingRef.current) return;
          realtimeCrouchingRef.current = crouching;
          motionActionSinkRef.current?.(crouching ? "crouch_on" : "crouch_off");
        },
        onPlayerDamage: (amount) => {
          audioRef.current?.play("mobAttack", { seed: `mob:${amount}:${performance.now().toFixed(0)}`, intensity: 0.7 });
          audioRef.current?.play("playerHurt", { seed: `${amount}:${performance.now().toFixed(0)}`, intensity: 0.78 });
        },
        onPlayerHealthChange: (health) => {
          setPlayerHealth(health);
        },
        onBlockEdit: (edit, previousBlock) => {
          handleBlockEdit(edit, previousBlock);
        },
        onPoseChange: (pose) => {
          const previousSegmentPose = previousSegmentPoseRef.current;
          if (pose.y - previousSegmentPose.y > 0.08) motionActionSinkRef.current?.("jump");
          previousSegmentPoseRef.current = pose;
          poseRef.current = pose;
          const pickupSweepAt = performance.now();
          if (pickupSweepAt - lastDroppedPickupSweepRef.current >= 250) {
            lastDroppedPickupSweepRef.current = pickupSweepAt;
            maybePickupNearbyDroppedItem(pose);
          }
          const worldChunkCenter = `${worldEditChunkCoordinate(pose.x)}:${worldEditChunkCoordinate(pose.z)}`;
          if (worldChunkCenterRef.current !== worldChunkCenter) {
            worldChunkCenterRef.current = worldChunkCenter;
            setWorldChunkKeys(visibleWorldChunkKeys(pose.x, pose.z));
          }
          const droppedChunkCenter = `${Math.floor(pose.x / DROPPED_ITEM_CHUNK_SIZE)}:${Math.floor(pose.z / DROPPED_ITEM_CHUNK_SIZE)}`;
          if (droppedChunkCenterRef.current !== droppedChunkCenter) {
            droppedChunkCenterRef.current = droppedChunkCenter;
            setDroppedChunkKeys(visibleDroppedItemChunkKeys(pose.x, pose.z));
          }
          presenceSampleRef.current?.(pose);
          const workstation = activeWorkstationRef.current;
          if (workstation && !isWorkstationWithinReach(pose, workstation.position)) {
            const label = workstation.kind === "furnace" ? "Furnace" : "Workbench";
            closeInventory();
            notify(`${label} out of reach`, `Move back to the ${workstation.kind === "furnace" ? "furnace" : "crafting table"} to keep using it.`, "warning");
          }
        },
        onTargetChange: (target) => { targetRef.current = target; },
        onPointerLockChange: (locked) => {
          if (locked) {
            intentionalPointerUnlockRef.current = false;
            setPauseOpen(false);
          } else if (intentionalPointerUnlockRef.current) {
            intentionalPointerUnlockRef.current = false;
          } else {
            setShowPlayerList(false);
            setPauseOpen(true);
          }
        },
        onInteractBlock: (target) => {
          const key = blockCoordinateKey(target.block.x, target.block.y, target.block.z);
          if (target.block.block === BLOCK.TNT) {
            if (inventoryRef.current[selectedRef.current]?.itemId !== "flint_and_steel") {
              notify("Flint and steel required", "Hold flint and steel and use it on TNT to light the fuse.", "warning");
              return true;
            }
            if (tntIgnitionBusyRef.current) return true;
            const placed = worldEventsRef.current.find((row) => row.coordKey === key && row.blockType === "tnt");
            if (!placed) {
              notify("TNT is still settling", "Wait for Lakebed to confirm this block before lighting it.", "warning");
              return true;
            }
            tntIgnitionBusyRef.current = true;
            const request = {
              operationId: createTntOperationId(),
              x: target.block.x,
              y: target.block.y,
              z: target.block.z,
              blockInstanceToken: `${placed.id}:${placed.updatedAt}`,
            };
            void flushInventoryActions().then((flushed) => {
              if (!flushed) throw new Error("inventory_action_pending");
              return retryExactLakebedMutation(() => igniteTnt(JSON.stringify(request)));
            }).then((result) => {
              setConnected(result.ok);
              if (result.ok && result.fuse) {
                if (result.inventory && !loadCanonicalPlayer(result.inventory)) {
                  throw new Error("invalid_inventory");
                }
                tntFuseCuesRef.current.add(result.fuse.eventId);
                audioRef.current?.play("creeperFuse", { seed: result.fuse.eventId, intensity: 0.9 });
              } else {
                const detail = result.reason === "already_primed" ? "That fuse is already burning."
                  : result.reason === "flint_and_steel_required" ? "Hold a usable flint and steel."
                    : "Lakebed rejected the ignition.";
                notify("TNT did not ignite", detail, "warning");
              }
            }).catch(() => setConnected(false)).finally(() => { tntIgnitionBusyRef.current = false; });
            return true;
          }
          if (target.block.block === BLOCK.SAPLING
            && inventoryRef.current[selectedRef.current]?.itemId === "bone_meal") {
            if (treeGrowthBusyRef.current) return true;
            treeGrowthBusyRef.current = true;
            const operationId = createTreeGrowthOperationId();
            const requestJson = JSON.stringify({
              operationId,
              x: target.block.x,
              y: target.block.y,
              z: target.block.z,
            });
            void flushInventoryActions().then(async (flushed) => {
              if (!flushed) throw new Error("inventory_action_pending");
              if (!await refreshAuthoritativePose()) throw new Error("presence_refresh_failed");
              const pose = serializeWorldBlockEditPose(engineRef.current?.getPose() ?? poseRef.current);
              return retryExactLakebedMutation(() => growOakTree(requestJson, ...pose));
            }).then((result) => {
              setConnected(true);
              if (!result.ok) {
                const detail = result.reason === "blocked"
                  ? "The oak needs clear space around and above the sapling."
                  : result.reason === "invalid_support"
                    ? "Oak saplings only grow on dirt or grass."
                    : result.reason === "bone_meal_required"
                      ? "Keep bone meal selected until Lakebed confirms the growth."
                      : result.reason === "not_sapling"
                        ? "That sapling changed before Lakebed confirmed it."
                        : `Lakebed rejected the growth (${result.reason}).`;
                notify("Oak did not grow", detail, "warning");
                return;
              }
              if (!loadCanonicalPlayer(result.inventory)) throw new Error("invalid_inventory");
              const currentChunkRevisions = new Map(result.currentChunks.map((chunk) => [chunk.chunkKey, chunk.revision]));
              for (const chunk of result.currentChunks) worldChunkRevisionRef.current.set(chunk.chunkKey, chunk.revision);
              const receiptStillCurrent = result.chunks.every((chunk) => currentChunkRevisions.get(chunk.chunkKey) === chunk.revision);
              if (receiptStillCurrent) {
                const engineEdits = result.edits.map((edit) => ({
                  x: edit.x,
                  y: edit.y,
                  z: edit.z,
                  block: PROTOCOL_TO_ENGINE[edit.blockType],
                }));
                for (const edit of engineEdits) {
                  authoritativeWorldEditRef.current.set(blockCoordinateKey(edit.x, edit.y, edit.z), edit);
                }
                engineRef.current?.applyWorldEdits(engineEdits);
              }
              audioRef.current?.play("blockPlace", { seed: operationId, surface: "grass", intensity: 0.82 });
              engineRef.current?.spawnBlockParticles({
                action: "place",
                block: BLOCK.LEAVES,
                x: target.block.x,
                y: target.block.y + 1,
                z: target.block.z,
              });
            }).catch(() => {
              setConnected(false);
              notify("Oak growth lost contact", "The exact operation can be retried safely; no background requests were started.", "warning");
            }).finally(() => { treeGrowthBusyRef.current = false; });
            return true;
          }
          if (target.block.block === BLOCK.SAPLING) return false;
          closeInventory();
          setChatOpen(false);
          exitPointerLockForUi();
          if (target.block.block === BLOCK.CRAFTING_TABLE) {
            activeWorkstationRef.current = { kind: "crafting_table", position: { x: target.block.x, y: target.block.y, z: target.block.z } };
            setCraftingContext("crafting_table");
            setInventoryOpen(true);
            return true;
          }
          if (target.block.block === BLOCK.FURNACE) {
            activeWorkstationRef.current = { kind: "furnace", position: { x: target.block.x, y: target.block.y, z: target.block.z } };
            setActiveFurnaceKey(key);
            setFurnaceStatus("Loading shared furnace…");
            setFurnaceError("");
            setFurnaceOpen(true);
            return true;
          }
          if (target.block.block === BLOCK.BED) {
            setActiveBedKey(key);
            setSleepStatus("Checking the shared night watch with Lakebed…");
            void handleSleepInBed(key);
            return true;
          }
          chestTransferActiveRef.current = false;
          pendingChestTransferRef.current = null;
          setChestRetryAvailable(false);
          setActiveChestKey(key);
          setChestOperationBusy(true);
          setChestError("");
          return true;
        },
      });
      engineRef.current = engine;
      void selectedSkin().then((skin) => {
        if (engineRef.current === engine) engine.setPlayerSkin(skin.source, skin.model);
      });
      engine.setPaused(multiplayerPaused);
      engine.setFirstPersonFeedbackHidden(multiplayerPaused);
      if (respawnPointRef.current) engine.setRespawnPoint(respawnPointRef.current);
      setMobIds(engine.getMobIds());
      engine.start();
      if (entryPointerLockHandoffRef.current && document.pointerLockElement === document.documentElement) {
        entryPointerLockHandoffRef.current = false;
        engine.requestPointerLock();
      }
      return () => {
        for (const timer of tntClaimTimersRef.current.values()) window.clearTimeout(timer);
        tntClaimTimersRef.current.clear();
        if (respawnTimerRef.current !== null) {
          window.clearTimeout(respawnTimerRef.current);
          respawnTimerRef.current = null;
        }
        respawnRequestInFlightRef.current = false;
        engine.destroy();
        engineRef.current = null;
        releaseGameplayKeyboardCapture();
      };
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : "Unable to start the WebGL world.");
    }
  }, [inWorld, inventoryReady]);

  useEffect(() => {
    if (!worldClock) return;
    engineRef.current?.setDayNightClock({
      cycleLengthMs: worldClock.cycleLengthMs,
      epochMs: worldClock.epochMs,
      epochPhase: worldClock.epochPhase,
    }, worldClock.serverNow - Date.now());
  }, [worldClock]);

  useEffect(() => {
    if (!inWorld || !mobWorldAuthority?.ok) return;
    const clockOffset = mobWorldAuthority.serverNow - Date.now();
    engineRef.current?.applyMobMotionSnapshot(mobWorldAuthority.poses, clockOffset);
    engineRef.current?.applyMobCombatStates(mobWorldAuthority.states, clockOffset);

    for (const pose of mobWorldAuthority.poses) {
      if (pose.kind !== "creeper" || pose.fuseStartedTick <= 0 || pose.fuseProgress >= 1) continue;
      const fuseId = `${pose.mobId}:${pose.fuseStartedTick}`;
      if (creeperFuseCuesRef.current.has(fuseId)) continue;
      if (creeperFuseCuesRef.current.size >= 64) creeperFuseCuesRef.current.clear();
      creeperFuseCuesRef.current.add(fuseId);
      audioRef.current?.play("creeperFuse", { seed: fuseId, intensity: 0.82 });
    }

    const leaseId = mobLeaseSessionId;
    const checkpointForeground = transportForeground && !deathScreenOpen && !pauseOpen && !inventoryOpen && !chatOpen
      && !furnaceOpen && !activeChestKey && !activeBedKey;
    const mayCheckpoint = mobWorldAuthority.leaseOwnerUserId === ""
      || mobWorldAuthority.leaseOwnerUserId === auth.userId
      || mobWorldAuthority.leaseExpiresAt <= mobWorldAuthority.serverNow;
    const checkpointCadenceReady = mobWorldAuthority.serverNow - lastMobCheckpointAttemptAtRef.current
      >= MOB_CHECKPOINT_ATTEMPT_MIN_MS;
    if (mobWorldAuthority.needsCheckpoint && mayCheckpoint && leaseId && checkpointForeground
      && checkpointCadenceReady && !mobCheckpointInFlightRef.current) {
      lastMobCheckpointAttemptAtRef.current = mobWorldAuthority.serverNow;
      mobCheckpointInFlightRef.current = true;
      void checkpointMobWorld(JSON.stringify({
        leaseId,
        expectedRevision: mobWorldAuthority.checkpointRevision,
      })).then((result) => {
        setConnected(result.ok);
      }).catch(() => {
        setConnected(false);
      }).finally(() => {
        mobCheckpointInFlightRef.current = false;
      });
    }

    for (const claim of mobWorldAuthority.damageClaims) {
      if (mobDamageClaimsRef.current.has(claim.operationId)) continue;
      if (mobDamageClaimsRef.current.size >= 128) {
        const oldest = mobDamageClaimsRef.current.values().next().value;
        if (typeof oldest === "string") mobDamageClaimsRef.current.delete(oldest);
      }
      mobDamageClaimsRef.current.add(claim.operationId);
      const requestGate = authoritativeKnockbackGateRef.current;
      const requestPauseEpoch = requestGate && !requestGate.paused ? requestGate.pauseEpoch : -1;
      void claimMobPlayerDamage(JSON.stringify(claim)).then((result) => {
        setConnected(result.ok);
        if (result.ok && result.damage > 0) {
          if (!loadCanonicalPlayer(result.inventory)) {
            notify("Armor reconciliation failed", "Lakebed returned a damaged canonical equipment snapshot.", "warning");
            return;
          }
          audioRef.current?.play("mobAttack", { seed: claim.operationId, intensity: 0.82 });
          if (!result.replayed && !result.killed && authoritativeKnockbackGateRef.current
            && canApplyAuthoritativeKnockback(
              authoritativeKnockbackGateRef.current,
              requestPauseEpoch,
              document.pointerLockElement === canvasRef.current,
            )) {
            const attacker = mobWorldAuthority.poses.find((pose) => pose.mobId === claim.mobId);
            if (attacker) engineRef.current?.applyConfirmedMobKnockback(
              claim.operationId,
              attacker.x,
              attacker.z,
              result.damage,
              result.serverNow,
            );
          }
        }
      }).catch(() => {
        mobDamageClaimsRef.current.delete(claim.operationId);
        setConnected(false);
      });
    }
    for (const claim of mobWorldAuthority.explosionClaims) {
      if (creeperExplosionClaimsRef.current.has(claim.operationId)) continue;
      if (creeperExplosionClaimsRef.current.size >= 64) creeperExplosionClaimsRef.current.clear();
      creeperExplosionClaimsRef.current.add(claim.operationId);
      void claimCreeperExplosion(JSON.stringify(claim)).then((result) => {
        setConnected(result.ok);
        if (!result.ok) return;
        audioRef.current?.play("explosion", { seed: claim.operationId, intensity: 1 });
      }).catch(() => {
        creeperExplosionClaimsRef.current.delete(claim.operationId);
        setConnected(false);
      });
    }
  }, [mobWorldAuthority, mobLeaseSessionId, auth.userId, inWorld, transportForeground, deathScreenOpen, pauseOpen,
    inventoryOpen, chatOpen, furnaceOpen, activeChestKey, activeBedKey]);

  useEffect(() => {
    if (!inWorld || !playerCombatResult?.ok || !engineRef.current) return;
    const ownState = playerCombatResult.states.find((state) => state.userId === auth.userId);
    if (!ownState) return;
    if (!Number.isSafeInteger(ownState.revision) || ownState.revision < appliedOwnCombatRevisionRef.current) return;
    const previous = appliedOwnCombatHealthRef.current;
    appliedOwnCombatRevisionRef.current = ownState.revision;
    appliedOwnCombatHealthRef.current = ownState.health;
    if (previous !== null && ownState.health !== previous) {
      if (ownState.health < previous) {
        audioRef.current?.play("playerHurt", { seed: `${ownState.revision}:${ownState.health}`, intensity: 0.8 });
      }
    }
    const awaitingRespawnLease = respawnLeaseTransitionRef.current && previous === 0 && ownState.health > 0;
    if (!awaitingRespawnLease) engineRef.current.setPlayerHealth(ownState.health);
    if (ownState.health <= 0) {
      setDeathScreenOpen(true);
      setPauseOpen(false);
      setShowPlayerList(false);
      setChatOpen(false);
      closeInventory();
      setFurnaceOpen(false);
      setActiveChestKey("");
      setActiveBedKey("");
      exitPointerLockForUi();
    }
  }, [playerCombatResult, inWorld, auth.userId]);

  useEffect(() => {
    if (!inWorld || !worldChunks?.ok) return;
    for (const fuse of worldChunks.tntFuses) {
      if (!tntFuseCuesRef.current.has(fuse.eventId)) {
        if (tntFuseCuesRef.current.size >= 64) tntFuseCuesRef.current.clear();
        tntFuseCuesRef.current.add(fuse.eventId);
        audioRef.current?.play("creeperFuse", { seed: fuse.eventId, intensity: 0.9 });
      }
      if (!fuse.claim || tntExplosionClaimsRef.current.has(fuse.eventId)) continue;
      tntExplosionClaimsRef.current.add(fuse.eventId);
      const delay = Math.max(0, fuse.dueAt - worldChunks.serverNow + 50);
      const timer = window.setTimeout(() => {
        tntClaimTimersRef.current.delete(fuse.eventId);
        void claimTntExplosion(JSON.stringify(fuse.claim)).then((result) => {
          setConnected(result.ok);
          if (!result.ok) {
            tntExplosionClaimsRef.current.delete(fuse.eventId);
            return;
          }
          audioRef.current?.play("explosion", { seed: fuse.eventId, intensity: 1 });
        }).catch(() => {
          tntExplosionClaimsRef.current.delete(fuse.eventId);
          setConnected(false);
        });
      }, delay);
      tntClaimTimersRef.current.set(fuse.eventId, timer);
    }
  }, [worldChunks, inWorld, auth.userId]);

  useEffect(() => {
    if (realtimeSession) return;
    if (worldChunks?.ok) {
      for (const chunkKey of worldChunkKeys) {
        if (!worldChunkRevisionRef.current.has(chunkKey)) worldChunkRevisionRef.current.set(chunkKey, "0");
      }
      for (const chunk of worldChunks.chunks) {
        const current = worldChunkRevisionRef.current.get(chunk.chunkKey) ?? "0";
        if (isDecimalRevisionAtLeast(chunk.revision, current)) {
          worldChunkRevisionRef.current.set(chunk.chunkKey, chunk.revision);
        }
      }
    }
    const authoritative = [
      ...toEngineEdits(worldEvents),
      ...chunkSnapshotsToEngineEdits(worldChunks),
    ];
    for (const edit of authoritative) {
      authoritativeWorldEditRef.current.set(blockCoordinateKey(edit.x, edit.y, edit.z), edit);
    }
    engineRef.current?.applyWorldEdits(overlayPendingWorldBlockEdit(
      authoritative,
      pendingWorldBlockEditRef.current?.optimisticEdit ?? null,
    ));
    if (worldChunks?.ok) engineRef.current?.setPrimedTntFuses(worldChunks.tntFuses, worldChunks.serverNow);
  }, [worldEvents, worldChunks, worldChunkKeys, realtimeSession?.serverId]);

  useEffect(() => {
    if (!activeChestKey || chestResult === undefined) return;
    if (chestTransferActiveRef.current || pendingChestTransferRef.current) return;
    if (!chestResult.ok) {
      setChestOperationBusy(false);
      setChestError("That chest coordinate is invalid.");
      return;
    }
    if (chestResult.chest && chestResult.chest.coordKey !== activeChestKey) return;
    if (chestResult.chest) {
      try {
        setChestInventory(normalizeInventory(JSON.parse(chestResult.chest.inventoryJson), CHEST_SLOT_COUNT));
      } catch {
        setChestInventory(createEmptyInventory(CHEST_SLOT_COUNT));
        setChestError("Lakebed returned a damaged chest payload.");
      }
      setCanonicalChestToken(chestResult.chest.updatedAt);
    } else {
      setChestInventory(createEmptyInventory(CHEST_SLOT_COUNT));
      setCanonicalChestToken("");
    }
    setChestOperationBusy(false);
  }, [activeChestKey, chestResult]);

  // LAKEBED_COMPACT_RETIRED_PRESENCE_START
  useEffect(() => {
    // MultiplayerSegmentTransport owns visual motion. This path remains only
    // as Lakebed's sparse authoritative lease for world and combat actions.
    const authorityLeaseTransportEnabled = realtimeSession === null;
    if (!authorityLeaseTransportEnabled) return;
    if (!inWorld || auth.isLoading || !auth.isAuthenticated || auth.isGuest || !profile) return;
    const scheduler = createPresenceSchedulerState();
    const guard = loadPresenceBurstGuard(auth.userId, Date.now());
    const presenceSessionId = crypto.randomUUID();
    setTransportReady(false);
    presenceSessionIdRef.current = presenceSessionId;
    presenceNextPoseSequenceRef.current = 1;
    setMobLeaseSessionId(presenceSessionId);
    presenceSchedulerRef.current = scheduler;
    presenceBurstGuardRef.current = guard;
    presenceModeNoticeRef.current = "";
    type QueuedPresenceWrite = {
      pose: PlayerPose;
      at: number;
      realtime: boolean;
      decision: Extract<PresenceSendDecision, { send: true }>;
      poseSequence: number | null;
    };
    let writesInFlight = 0;
    let pendingOrdinaryWrite: QueuedPresenceWrite | null = null;
    const safetyWrites: QueuedPresenceWrite[] = [];
    const maximumQueuedSafetyWrites = 12;
    const terminalPresenceReason = (reason: string | undefined) => reason === "session_mismatch"
      || reason === "session_required"
      || reason === "invalid_sequence"
      || reason === "combat_revision_exhausted";
    const announceTransportMode = (at: number) => {
      const snapshot = presenceBurstGuardSnapshot(guard, at, realtimePresenceRef.current);
      if (snapshot.mode === presenceModeNoticeRef.current) return snapshot;
      presenceModeNoticeRef.current = snapshot.mode;
      if (snapshot.mode === "degraded") {
        notify(
          "Realtime sync budget spent",
          "Lakebed presence is now a sparse lease. F3 shows the remaining daily session budget.",
          "warning",
        );
      } else if (snapshot.mode === "quota_paused") {
        notify(
          "Lakebed presence paused",
          `Repeated or quota-like rejections stopped retries. Lakebed retry is in ${Math.max(1, Math.ceil(snapshot.retryInMs / 1_000))}s.`,
          "warning",
        );
        setConnected(false);
      } else if (snapshot.mode === "budget_exhausted") {
        notify(
          "Daily presence budget exhausted",
          `No more movement writes will be attempted for ${Math.max(1, Math.ceil(snapshot.windowResetsInMs / 3_600_000))}h.`,
          "warning",
        );
        setConnected(false);
      }
      return snapshot;
    };
    const flushPresence = () => {
      if (cancelled || authorityTrafficPausedRef.current) return;
      if (presenceHeartbeatInFlightRef.current > 0) return;
      const safetyWrite = safetyWrites[0] ?? null;
      if (safetyWrite ? writesInFlight > 0 : writesInFlight >= PRESENCE_MAX_IN_FLIGHT_WRITES) return;
      const queued = safetyWrite ?? pendingOrdinaryWrite;
      if (!queued) return;
      const { pose, decision } = queued;
      poseRef.current = pose;
      const attemptAt = Date.now();
      const guardSnapshot = announceTransportMode(attemptAt);
      if (!guardSnapshot.canAttempt) return;
      const realtime = queued.realtime && guardSnapshot.realtimeRemaining > 0;
      if (!reservePresenceAttempt(guard, attemptAt, realtime)) return;
      if (!safetyWrite) pendingOrdinaryWrite = null;
      let poseSequence = queued.poseSequence;
      if (poseSequence === null) poseSequence = presenceNextPoseSequenceRef.current;
      if (!Number.isSafeInteger(poseSequence) || poseSequence < 1 || poseSequence >= Number.MAX_SAFE_INTEGER) {
        pendingOrdinaryWrite = null;
        safetyWrites.length = 0;
        setConnected(false);
        return;
      }
      if (queued.poseSequence === null) {
        queued.poseSequence = poseSequence;
        presenceNextPoseSequenceRef.current += 1;
      }
      persistPresenceBurstGuard(auth.userId, guard);
      announceTransportMode(attemptAt);
      const worn = equipmentRef.current;
      const appearance = normalizeAvatarAppearance(
        inventoryRef.current[selectedRef.current]?.itemId,
        worn.head?.itemId,
        worn.chest?.itemId,
        worn.legs?.itemId,
        worn.feet?.itemId,
      );
      const heartbeatSessionId = presenceSessionIdRef.current;
      let retrySafetyWrite = false;
      writesInFlight += 1;
      presenceHeartbeatInFlightRef.current += 1;
      void heartbeatPlayer(
        profile.username,
        playerColor(auth.userId),
        String(pose.x),
        String(pose.y),
        String(pose.z),
        String(pose.yaw),
        String(pose.pitch),
        String(poseSequence),
        decision.fields.vx,
        decision.fields.vy,
        decision.fields.vz,
        appearance.heldItem,
        appearance.armorHead,
        appearance.armorChest,
        appearance.armorLegs,
        appearance.armorFeet,
        heartbeatSessionId,
      ).then((result) => {
        if (cancelled) return;
        if (result && !result.ok) {
          const rejectedAt = Date.now();
          if (result.reason === "session_mismatch" && (
            respawnLeaseTransitionRef.current || heartbeatSessionId !== presenceSessionIdRef.current
          )) {
            recordPresenceSuccess(guard, rejectedAt);
            return;
          }
          if (terminalPresenceReason(result.reason)) {
            cancelled = true;
            pendingOrdinaryWrite = null;
            safetyWrites.length = 0;
            if (presenceSampleRef.current === samplePresence) presenceSampleRef.current = null;
            if (interval) window.clearInterval(interval);
            if (startRetryTimer) window.clearTimeout(startRetryTimer);
            setConnected(false);
            notify("Presence lease ended", "Another session or an exhausted authority fence owns this player now.", "warning");
            return;
          }
          const rejection = new Error(`${result.reason ?? "presence rejected"}${result.retryAfterMs ? ` retry-after ${result.retryAfterMs}ms` : ""}`);
          if (result.reason === "rate_limited") {
            recordPresenceRateLimit(guard, rejectedAt, result.retryAfterMs ?? 0);
            retrySafetyWrite = Boolean(safetyWrite);
          } else {
            recordPresenceFailure(
              guard,
              rejectedAt,
              classifyPresenceTransportError(rejection),
              presenceTransportQuotaResetAt(rejection, rejectedAt),
            );
          }
          const canonicalPose = result.canonicalPose
            ? validateRespawnPoint(result.canonicalPose, Number.MAX_SAFE_INTEGER)
            : null;
          if (canonicalPose) {
            engineRef.current?.reconcilePose(canonicalPose);
            Object.assign(scheduler, createPresenceSchedulerState());
            safetyWrites.length = 0;
          }
          announceTransportMode(rejectedAt);
          setConnected(false);
          return;
        }
        recordPresenceSuccess(guard, Date.now());
        setConnected(true);
        setTransportReady(true);
      }).catch((error: unknown) => {
        if (cancelled) return;
        retrySafetyWrite = Boolean(safetyWrite);
        const failedAt = Date.now();
        recordPresenceFailure(
          guard,
          failedAt,
          classifyPresenceTransportError(error),
          presenceTransportQuotaResetAt(error, failedAt),
        );
        announceTransportMode(failedAt);
        setConnected(false);
      }).finally(() => {
        presenceHeartbeatInFlightRef.current = Math.max(0, presenceHeartbeatInFlightRef.current - 1);
        if (!cancelled) persistPresenceBurstGuard(auth.userId, guard);
        writesInFlight = Math.max(0, writesInFlight - 1);
        if (safetyWrite && !retrySafetyWrite && safetyWrites[0] === queued) safetyWrites.shift();
        flushPresence();
      });
    };
    const samplePresence = (pose: PlayerPose, at = Date.now()) => {
      poseRef.current = pose;
      if (authorityTrafficPausedRef.current) return;
      const guardSnapshot = announceTransportMode(at);
      const realtime = false;
      let decision = stepPresenceScheduler(scheduler, { ...pose, at }, realtime);
      const written = scheduler.lastWrittenPose;
      const crossedProximityCell = Boolean(written
        && Math.hypot(pose.x - written.x, pose.y - written.y, pose.z - written.z) >= 16);
      if (!decision.send && crossedProximityCell) {
        decision = stepPresenceScheduler(scheduler, { ...pose, at: at + 1 }, true);
      }
      if (!decision.send) return;
      const queued: QueuedPresenceWrite = { pose, at, realtime: false, decision, poseSequence: null };
      if (decision.safetyCritical) {
        if (safetyWrites.length < maximumQueuedSafetyWrites) safetyWrites.push(queued);
        else safetyWrites[safetyWrites.length - 1] = queued;
      } else if (guardSnapshot.canAttempt) {
        pendingOrdinaryWrite = queued;
      }
      flushPresence();
    };
    let cancelled = false;
    let interval = 0;
    let startRetryTimer = 0;
    const schedulePresenceSessionRetry = (at: number) => {
      const snapshot = announceTransportMode(at);
      const delay = snapshot.retryInMs > 0
        ? Math.max(250, Math.min(60_000, snapshot.retryInMs))
        : 1_000;
      startRetryTimer = window.setTimeout(beginPresenceSession, delay);
    };
    const beginPresenceSession = () => {
      if (cancelled) return;
      if (authorityTrafficPausedRef.current) {
        startRetryTimer = window.setTimeout(beginPresenceSession, 1_000);
        return;
      }
      const attemptedAt = Date.now();
      const snapshot = announceTransportMode(attemptedAt);
      if (!snapshot.canAttempt || !reservePresenceAttempt(guard, attemptedAt, false)) {
        schedulePresenceSessionRetry(attemptedAt);
        return;
      }
      persistPresenceBurstGuard(auth.userId, guard);
      void startPresenceSession(presenceSessionIdRef.current).then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          if (result.reason === "invalid_or_exhausted_sequence_state") {
            cancelled = true;
            setConnected(false);
            notify("Presence lease invalid", "Reload to establish a new ordered presence lease.", "warning");
            return;
          }
          throw new Error(result.reason ?? "presence session rejected");
        }
        recordPresenceSuccess(guard, Date.now());
        const resumedSequence = Number(result.nextPoseSequence ?? "1");
        presenceNextPoseSequenceRef.current = Number.isSafeInteger(resumedSequence) && resumedSequence >= 1 ? resumedSequence : 1;
        if (result.spawnPose) {
          engineRef.current?.reconcilePose(result.spawnPose);
          poseRef.current = result.spawnPose;
          Object.assign(scheduler, createPresenceSchedulerState());
        }
        presenceSampleRef.current = samplePresence;
        samplePresence(engineRef.current?.getPose() ?? poseRef.current);
        interval = window.setInterval(() => {
          samplePresence(engineRef.current?.getPose() ?? poseRef.current);
        }, PRESENCE_SAMPLE_INTERVAL_MS);
      }).catch((error: unknown) => {
        if (cancelled) return;
        const failedAt = Date.now();
        recordPresenceFailure(
          guard,
          failedAt,
          classifyPresenceTransportError(error),
          presenceTransportQuotaResetAt(error, failedAt),
        );
        persistPresenceBurstGuard(auth.userId, guard);
        announceTransportMode(failedAt);
        setConnected(false);
        schedulePresenceSessionRetry(failedAt);
      });
    };
    beginPresenceSession();
    return () => {
      cancelled = true;
      const activeSessionId = presenceSessionIdRef.current;
      setTransportReady(false);
      setMobLeaseSessionId((current) => current === activeSessionId ? "" : current);
      if (presenceSampleRef.current === samplePresence) presenceSampleRef.current = null;
      if (interval) window.clearInterval(interval);
      if (startRetryTimer) window.clearTimeout(startRetryTimer);
      void leavePlayer(activeSessionId).catch(() => undefined);
    };
  }, [inWorld, auth.userId, auth.isLoading, auth.isAuthenticated, auth.isGuest, profile?.username, realtimeSession?.serverId]);
  // LAKEBED_COMPACT_RETIRED_PRESENCE_END

  useEffect(() => {
    if (!droppedItemsResult) return;
    droppedItemsClockRef.current = { result: droppedItemsResult, receivedAt: Date.now() };
    const resultItems = droppedItemsResult.ok && Array.isArray(droppedItemsResult.items) ? droppedItemsResult.items : [];
    const visibleIds = new Set(resultItems.map(({ dropId }) => dropId));
    for (const dropId of droppedPickupAttemptRef.current.keys()) {
      if (!visibleIds.has(dropId)) droppedPickupAttemptRef.current.delete(dropId);
    }
    if (inWorld) maybePickupNearbyDroppedItem(poseRef.current);
  }, [inWorld, droppedItemsResult, auth.userId]);

  useEffect(() => {
    if (realtimeSession) return;
    const resultItems = droppedItemsResult?.ok && Array.isArray(droppedItemsResult.items) ? droppedItemsResult.items : [];
    engineRef.current?.setDroppedItems(resultItems);
  }, [inWorld, inventoryReady, droppedItemsResult, realtimeSession?.serverId]);

  useEffect(() => {
    for (const [dropId, attemptedAt] of droppedPickupAttemptRef.current) {
      if (Number.isFinite(attemptedAt)) droppedPickupAttemptRef.current.delete(dropId);
    }
  }, [inventory]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    const update = () => setMobileUnsupported(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!inWorld) return;
      if (event.code === "Tab") {
        event.preventDefault();
        if (!event.repeat && !pauseOpen && !chatOpen && !inventoryOpen && !furnaceOpen && !activeChestKey && !activeBedKey) {
          setShowPlayerList(true);
        }
        return;
      }
      if (optionsOpen) {
        if (event.code === "Escape" && !event.repeat) {
          event.preventDefault();
          setOptionsOpen(false);
        }
        return;
      }
      if (pauseOpen) {
        if (event.code === "Escape" && !event.repeat) {
          event.preventDefault();
          setPauseOpen(false);
          engineRef.current?.requestPointerLock();
        }
        return;
      }
      if (activeChestKey || activeBedKey) {
        if (event.code === "Escape" || event.code === "KeyE") {
          event.preventDefault();
          if (activeChestKey && chestBusyRef.current) return;
          setActiveChestKey("");
          setActiveBedKey("");
          setChestError("");
          setChestRetryAvailable(false);
          engineRef.current?.requestPointerLock();
        }
        return;
      }
      if (chatOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setChatOpen(false);
          setLastSeenChatCount(realtimeChatMessages.length);
          engineRef.current?.requestPointerLock();
        }
        return;
      }
      if (inventoryOpen || furnaceOpen) {
        if (event.code === "Escape" || event.code === "KeyE") {
          event.preventDefault();
          if (furnaceOpen && furnaceBusyRef.current) return;
          closeInventory();
          engineRef.current?.requestPointerLock();
        }
        return;
      }
      if (event.code === "Escape" && !event.repeat) {
        event.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        setPauseOpen(true);
        setShowPlayerList(false);
        return;
      }
      if (event.code === "KeyQ" && !event.repeat) {
        event.preventDefault();
        if (inventoryOpen || furnaceOpen) return;
        void handleDropSelected(event.ctrlKey || event.metaKey);
        return;
      }
      if ((event.code === "KeyT" || event.code === "Enter") && !event.repeat && !inventoryOpen && !furnaceOpen) {
        event.preventDefault();
        exitPointerLockForUi();
        setChatOpen(true);
        setLastSeenChatCount(realtimeChatMessages.length);
        setChatError("");
        return;
      }
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        if (!hydratedRef.current) return;
        activeWorkstationRef.current = null;
        setCraftingContext("field");
        exitPointerLockForUi();
        setInventoryOpen(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Tab") setShowPlayerList(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [inWorld, optionsOpen, pauseOpen, activeChestKey, activeBedKey, chatOpen, inventoryOpen, furnaceOpen, realtimeChatMessages.length]);

  const worldConnected = realtimeSession ? transportReady : connected;
  const playerListEntries = segmentRemotePlayers.map((player) => ({
    id: player.id,
    name: player.name,
    isSelf: false,
    connected: true,
  }));
  if (profile && !playerListEntries.some(({ isSelf }) => isSelf)) {
    playerListEntries.unshift({ id: auth.userId, name: profile.username, isSelf: true, connected: worldConnected });
  }

  function handleInventoryWorkspaceChange(
    snapshot: StowedInventorySnapshot,
    expectedAuthorityEpoch: number,
    recipes: readonly InventoryRecipeBatch[],
  ): boolean {
    if (!hydratedRef.current
      || expectedAuthorityEpoch !== inventoryAuthorityEpochRef.current
      || rangedChargeActiveRef.current
      || pendingWorldBlockEditRef.current
      || droppedItemBusyRef.current
      || chestBusyRef.current
      || furnaceBusyRef.current) return false;
    updateInventory(snapshot.inventory);
    updateEquipment(snapshot.equipment);
    if (realtimeGameModeRef.current === "creative") return true;
    const workstation = activeWorkstationRef.current;
    const actionContext: CraftingContext = workstation?.kind === "crafting_table" ? "crafting_table" : "field";
    const workstationCoordKey = actionContext === "crafting_table" && workstation
      ? `${workstation.position.x}:${workstation.position.y}:${workstation.position.z}`
      : "";
    const playerStateJson = currentPlayerStateJson();
    if (recipes.length === 0 && playerStateJson === lastCommittedPlayerJsonRef.current) return true;
    void enqueueInventoryAction({
      kind: "workspace_commit",
      playerStateJson,
      recipes: recipes.map(({ recipeId, crafts }) => ({ recipeId, crafts })),
      craftingContext: actionContext,
      workstationCoordKey,
    });
    return true;
  }

  function handleCrafted(recipe: Recipe, craftedCount: number) {
    audioRef.current?.play("craft", { seed: `${recipe.id}:${craftedCount}`, intensity: 0.72, surface: "wood" });
  }

  async function handleFurnaceTransfer(action: FurnaceTransferAction): Promise<void> {
    if (!hydratedRef.current || !activeFurnaceKey || furnaceBusyRef.current
      || pendingWorldBlockEditRef.current || chestBusyRef.current) return;
    setFurnaceOperationBusy(true);
    setFurnaceError("");
    try {
      await flushInventoryActions();
      if (currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current) {
        setFurnaceError("Your pack is still saving. Wait a moment and try again; no items moved.");
        return;
      }
      const authority = furnaceAuthorityRef.current;
      if (!authority || authority.state.coordKey !== activeFurnaceKey) {
        setFurnaceError("The shared furnace has not finished loading.");
        return;
      }
      const result = await operateFurnace(JSON.stringify({
        operationId: furnaceOperationId(),
        coordKey: activeFurnaceKey,
        action,
        expectedInventoryUpdatedAt: inventoryTokenRef.current,
        expectedFurnaceRevision: authority.revision,
        expectedBlockInstanceToken: authority.blockInstanceToken,
      }));
      setConnected(true);
      if (result.ok) {
        const playerLoaded = loadCanonicalPlayer(result.player);
        loadCanonicalFurnace(result.furnace);
        if (!playerLoaded) {
          setFurnaceError("The transfer committed, but Lakebed returned a damaged pack snapshot.");
          return;
        }
        const item = ITEMS[result.moved.itemId];
        audioRef.current?.play("uiConfirm", { seed: `${activeFurnaceKey}:${result.moved.itemId}:${result.furnace.revision}`, intensity: 0.55 });
        setFurnaceStatus(`${result.moved.count} ${item.label} moved ${result.moved.direction === "to_furnace" ? "into" : "out of"} the shared furnace.`);
        return;
      }
      if (result.reason === "conflict") {
        if (result.player) loadCanonicalPlayer(result.player);
        if (result.furnace) {
          loadCanonicalFurnace(result.furnace);
        }
        setFurnaceError("The pack or furnace changed first. Lakebed reloaded both; click again to retry.");
      } else if (result.reason === "no_capacity") {
        setFurnaceError("That slot has no room.");
      } else if (result.reason === "wrong_item") {
        setFurnaceError("Only smeltable items go above the flame, and coal goes below it.");
      } else if (result.reason === "empty_source") {
        setFurnaceError("That stack changed before Lakebed could move it.");
      } else if (result.reason === "out_of_reach") {
        setFurnaceError("Move closer to use this furnace.");
      } else if (result.reason === "furnace_required") {
        setFurnaceError("That furnace no longer exists.");
      } else {
        setFurnaceError("Lakebed rejected the furnace transfer; no items moved.");
      }
    } catch {
      setConnected(false);
      setFurnaceError("Furnace connection lost. No unconfirmed local changes were applied.");
    } finally {
      setFurnaceOperationBusy(false);
    }
  }

  function handleUseItem(inventoryIndex = selectedRef.current): boolean {
    if (rangedChargeActiveRef.current || pendingWorldBlockEditRef.current || chestBusyRef.current || furnaceBusyRef.current) return false;
    const result = consumeFood(inventoryRef.current, inventoryIndex, hungerRef.current);
    if (!result.ok) {
      if (result.reason === "hunger_full") notify("You are already full", "Save that food for later.");
      return false;
    }
    updateInventory(result.inventory);
    hungerRef.current = result.hunger;
    setHunger(result.hunger);
    void enqueueInventoryAction({
      kind: "eat",
      sourceSlot: inventoryIndex,
      expectedItemId: result.consumed,
    });
    return true;
  }

  function handleSelectHotbar(index: number): void {
    const selectedHotbar = clampHotbarIndex(index);
    if (!hydratedRef.current || rangedChargeActiveRef.current || selectedHotbar === selectedRef.current) return;
    selectedRef.current = selectedHotbar;
    setSelectedHotbar(selectedHotbar);
    motionActionSinkRef.current?.("slot", selectedHotbar);
    if (realtimeGameModeRef.current === "creative") return;
    void enqueueInventoryAction({ kind: "select_hotbar", selectedHotbar });
  }

  function loadCanonicalChest(row: PersistedChest | null): boolean {
    if (!row) {
      const empty = createEmptyInventory(CHEST_SLOT_COUNT);
      chestInventoryRef.current = empty;
      setChestInventory(empty);
      setCanonicalChestToken("");
      return true;
    }
    try {
      const next = normalizeInventory(JSON.parse(row.inventoryJson), CHEST_SLOT_COUNT);
      chestInventoryRef.current = next;
      setChestInventory(next);
      setCanonicalChestToken(row.updatedAt);
      return true;
    } catch {
      setChestError("Lakebed returned a damaged chest payload.");
      return false;
    }
  }

  async function submitPendingChestTransfer(): Promise<void> {
    const pending = pendingChestTransferRef.current;
    if (!pending) return;
    setChestRetryAvailable(false);
    try {
      const result = await transferChest(pending.requestJson);
      setConnected(true);
      if (result.ok) {
        const playerLoaded = loadCanonicalPlayer(result.player);
        const chestLoaded = loadCanonicalChest(result.chest);
        pendingChestTransferRef.current = null;
        chestTransferActiveRef.current = false;
        setChestOperationBusy(false);
        if (!playerLoaded || !chestLoaded) {
          setChestError("The transfer committed, but its canonical state could not be displayed. Reopen the chest to reconcile.");
          return;
        }
        setChestError("");
        audioRef.current?.play("uiConfirm", { seed: `${result.moved.itemId}:${result.moved.count}:${result.chest.updatedAt}`, intensity: 0.55, surface: "wood" });
        if (result.replayed) notify(
          "Chest transfer reconciled",
          `${result.moved.count} ${ITEMS[result.moved.itemId].label} moved atomically through Lakebed.`,
          "success",
        );
        return;
      }
      pendingChestTransferRef.current = null;
      chestTransferActiveRef.current = false;
      setChestOperationBusy(false);
      if (result.reason === "conflict") {
        const playerLoaded = loadCanonicalPlayer(result.player);
        const chestLoaded = loadCanonicalChest(result.chest);
        setChestError(playerLoaded && chestLoaded
          ? `The ${result.conflict === "both" ? "pack and chest changed" : result.conflict + " changed"}. Both authoritative states were reloaded; no transfer occurred.`
          : "Lakebed found a conflict, but the authoritative state could not be displayed safely.");
      } else if (result.reason === "authentication_required") {
        setChestError("Sign in again before changing shared storage. No transfer occurred.");
      } else if (result.reason === "no_capacity") {
        setChestError("The destination has no room. No transfer occurred.");
      } else if (result.reason === "empty_source") {
        setChestError("That source slot changed before Lakebed committed the transfer. No transfer occurred.");
      } else if (result.reason === "chest_required") {
        setChestError("That block is no longer a chest. No transfer occurred.");
      } else if (result.reason === "operation_id_reused") {
        setChestError("Lakebed rejected a reused operation identifier. Reopen the chest before trying again.");
      } else {
        setChestError("Lakebed rejected the atomic transfer. No inventory state changed.");
      }
      if (currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current) void flushInventoryActions();
    } catch {
      setConnected(false);
      pending.transportFailures += 1;
      if (pending.transportFailures === 1) {
        setChestError("Transfer outcome unknown after a connection loss. Reconciling the identical operation…");
        await submitPendingChestTransfer();
        return;
      }
      setChestRetryAvailable(true);
      setChestError("Transfer outcome is still unknown. Retry reconciliation with the same operation before moving anything else.");
    }
  }

  function retryPendingChestTransfer() {
    if (!pendingChestTransferRef.current) return;
    setChestRetryAvailable(false);
    setChestError("Reconciling the same atomic transfer with Lakebed…");
    void submitPendingChestTransfer();
  }

  async function handleChestTransfer(direction: ChestTransferDirection, index: number) {
    if (!activeChestKey || chestBusyRef.current || pendingChestTransferRef.current) return;
    chestTransferActiveRef.current = true;
    setChestOperationBusy(true);
    setChestRetryAvailable(false);
    setChestError("");
    await flushInventoryActions();
    if (currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current) {
      chestTransferActiveRef.current = false;
      setChestOperationBusy(false);
      setChestError("Your pack could not be synchronized safely. No chest transfer was attempted.");
      return;
    }
    if (!activeChestKey) {
      chestTransferActiveRef.current = false;
      setChestOperationBusy(false);
      return;
    }
    const source = direction === "to_chest" ? inventoryRef.current : chestInventoryRef.current;
    const stack = source[index];
    if (!stack) {
      chestTransferActiveRef.current = false;
      setChestOperationBusy(false);
      setChestError("That source slot changed before the transfer started.");
      return;
    }
    const request: ChestTransferRequest = {
      operationId: createChestOperationId(),
      coordKey: activeChestKey,
      direction: direction === "to_chest" ? "to_chest" : "from_chest",
      sourceSlot: index,
      count: stack.count,
      expectedChestUpdatedAt: chestTokenRef.current,
      expectedInventoryUpdatedAt: inventoryTokenRef.current,
      playerStateJson: lastCommittedPlayerJsonRef.current,
    };
    pendingChestTransferRef.current = { requestJson: JSON.stringify(request), transportFailures: 0 };
    await submitPendingChestTransfer();
  }

  function handleSleepInBed(coordKey = activeBedKey) {
    if (!coordKey || sleepBusy) return;
    setSleepBusy(true);
    setSleepStatus("Checking the shared night watch with Lakebed…");
    void sleepInBed(coordKey).then((result) => {
      setConnected(true);
      if (!result.ok) {
        const detail = result.reason === "active_presence_required"
          ? "Wait for your multiplayer presence to connect, then try again."
          : result.reason === "bed_required"
            ? "That bed was moved before the sleep vote reached Lakebed."
            : result.reason === "authentication_required"
              ? "Sign in again before sleeping in the shared world."
              : "Lakebed rejected that bed coordinate.";
        setSleepStatus(detail);
        return;
      }
      if (result.slept && result.clock) {
        engineRef.current?.setDayNightClock({
          cycleLengthMs: result.clock.cycleLengthMs,
          epochMs: result.clock.epochMs,
          epochPhase: result.clock.epochPhase,
        }, result.clock.serverNow - Date.now());
        setSleepStatus("Morning reached. Every connected explorer agreed to skip the night.");
      } else {
        setSleepStatus(`${result.sleepingPlayers} of ${result.requiredPlayers} active explorer${result.requiredPlayers === 1 ? "" : "s"} in bed. Waiting for the rest…`);
      }
    }).catch(() => {
      setConnected(false);
      setSleepStatus("The sleep vote lost contact with Lakebed. Try again.");
    }).finally(() => setSleepBusy(false));
  }

  function handleUsernameClaim(value: string) {
    setUsernameState("saving");
    setUsernameError("");
    void claimUsername(value).then((result) => {
      if (result.ok) {
        setProfile(result.profile);
        setUsernameDraft(result.profile.username);
        setUsernameState("claimed");
        return;
      }
      if (result.reason === "taken") {
        setUsernameState("taken");
        setUsernameError("Another explorer already claimed that name.");
      } else if (result.reason === "username_locked") {
        setUsernameState("error");
        setUsernameError("This account already has an explorer tag.");
      } else if (result.reason === "authentication_required") {
        setUsernameState("error");
        setUsernameError("Sign in again before claiming a name.");
      } else {
        setUsernameState("error");
        setUsernameError("That explorer tag is not valid.");
      }
    }).catch(() => {
      setUsernameState("error");
      setUsernameError("Lakebed did not answer. Try claiming the name again.");
    });
  }

  function addDirectServer() {
    const endpoint = normalizeMultiplayerEndpoint(directConnectValue);
    if (!endpoint) {
      setJoinPhase("error");
      setJoinError("Enter a valid wss:// or https:// Railway server address.");
      return;
    }
    const registered = registeredServers.find((server) => server.canonicalWssUrl === endpoint);
    const id = registered?.id ?? `direct:${endpoint}`;
    const enteredToken = directConnectToken.trim();
    const persistedTokens = loadMultiplayerInvitationTokens(window.localStorage);
    const invitationToken = enteredToken.length >= 16
      ? enteredToken
      : demoServerTokens[endpoint] || persistedTokens[endpoint] || "";
    const next = [
      { id, name: registered?.name ?? new URL(endpoint).host, endpoint },
      ...savedMultiplayerServers.filter((server) => server.endpoint !== endpoint),
    ].slice(0, 24);
    setSavedMultiplayerServers(next);
    saveMultiplayerServers(window.localStorage, next);
    if (invitationToken) {
      saveMultiplayerInvitationToken(window.localStorage, endpoint, invitationToken);
      setDemoServerTokens((current) => ({ ...current, [endpoint]: invitationToken }));
    }
    setSelectedServerId(id);
    setDirectConnectValue("");
    setDirectConnectToken("");
    setJoinPhase("idle");
    setJoinError(registered || invitationToken
      ? ""
      : "This address was saved. Add it again with its private invitation token before joining.");
  }

  function enterWorld() {
    if (!profile || joinPhase === "joining" || joinPhase === "waiting" || joinPhase === "ready") return;
    const selected = combinedServers.find((server) => server.id === selectedServerId);
    const registered = selected && registeredServers.find((server) => server.id === selected.id);
    const persistedTokens = loadMultiplayerInvitationTokens(window.localStorage);
    const demoToken = selected ? demoServerTokens[selected.endpoint] || persistedTokens[selected.endpoint] || "" : "";
    if (!selected || (!registered && (!demoToken || demoToken.length < 16))) {
      setJoinPhase("error");
      setJoinError("This server is not registered with Lakebed. Add it again with its private invitation token.");
      return;
    }
    entryPointerLockHandoffRef.current = requestDocumentPointerLockHandoff();
    setJoinError("");
    setJoinPhase("joining");
    void flushInventoryActions().then(async () => {
      let session: RealtimeSession;
      if (!registered) {
        session = {
          serverId: selected.id,
          endpoint: selected.endpoint,
          demo: { token: demoToken, userId: auth.userId, name: profile.username },
        };
      } else {
        const ticket = await createExternalMultiplayerJoinTicket(registered.id);
        if (!ticket.ok || ticket.expiresAt <= Date.now()) {
          throw new Error(ticket.ok ? "join_ticket_expired" : ticket.reason);
        }
        session = {
          ticket: ticket.ticket,
          serverId: ticket.serverId,
          endpoint: normalizeMultiplayerEndpoint(ticket.canonicalWssUrl) ?? registered.canonicalWssUrl,
        };
      }
      setRealtimeSession(session);
      window.setTimeout(() => {
      if (!hydratedRef.current || savedPresence === undefined) {
        setJoinPhase("waiting");
        return;
      }
      setJoinPhase("ready");
      window.setTimeout(() => {
        setInWorld(true);
        setOptionsOpen(false);
        setPauseOpen(false);
        setJoinPhase("idle");
      }, 180);
      }, 100);
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "join_failed";
      setRealtimeSession(null);
      setJoinPhase("error");
      releaseGameplayKeyboardCapture();
      setJoinError(detail === "join_ticket_expired"
        ? "The join ticket expired before the server connection opened. Try again."
        : "Lakebed could not authorize this server connection.");
    });
  }

  useEffect(() => {
    if (joinPhase !== "waiting" || !inventoryReady || savedPresence === undefined || !profile) return;
    let cancelled = false;
    let timer = 0;
    void flushInventoryActions().then(() => {
      if (cancelled) return;
      setJoinPhase("ready");
      timer = window.setTimeout(() => {
        setInWorld(true);
        setOptionsOpen(false);
        setPauseOpen(false);
        setJoinPhase("idle");
      }, 180);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [joinPhase, inventoryReady, savedPresence, profile?.id, realtimeSession?.ticket]);

  useEffect(() => {
    if (inWorld && !auth.isLoading && (!auth.isAuthenticated || auth.isGuest)) {
      exitPointerLockForUi();
      setInWorld(false);
      setChatOpen(false);
      closeInventory();
      setMobIds([]);
    }
  }, [inWorld, auth.isLoading, auth.isAuthenticated, auth.isGuest]);

  function handleChatSubmit(value: string) {
    setChatError("");
    const sink = realtimeChatSinkRef.current;
    if (!sink) {
      setChatError("Chat is reconnecting to this server.");
      return;
    }
    setChatDraft("");
    setLastSeenChatCount(realtimeChatMessages.length + 1);
    void sink(value).catch(() => setChatError("Chat is reconnecting to this server."));
  }

  const signedIn = auth.isAuthenticated && !auth.isGuest;
  const lobbyAuthState = auth.isLoading || (signedIn && profile === undefined)
    ? "loading"
    : !signedIn
      ? "signed_out"
      : profile
        ? "ready"
        : "needs_username";
  const chatMessages: LakecraftChatMessage[] = realtimeChatMessages.map((message) => ({
    id: message.id,
    username: message.username,
    body: message.message,
    sentAt: message.sentAt,
    own: message.userId === (realtimeSession?.demo?.userId ?? auth.userId),
    delivery: message.delivery,
  }));
  const unreadChat = chatOpen ? 0 : Math.max(0, chatMessages.length - lastSeenChatCount);
  const presenceTelemetry = presenceBurstGuardSnapshot(
    presenceBurstGuardRef.current!,
    Date.now(),
    realtimePresenceRef.current,
  );
  const presenceCadence = presenceTelemetry.cadenceHz === PRESENCE_ACTIVE_WRITES_PER_SECOND
    ? `${PRESENCE_ACTIVE_WRITES_PER_SECOND}Hz`
    : presenceTelemetry.cadenceHz > 0
      ? "1/min"
      : "paused";
  const segmentSyncTelemetry = segmentTelemetry
    ? `${String(segmentTelemetry.mode).toUpperCase()} · PUB ${(segmentTelemetry.publishIntervalMs / 1_000).toFixed(1)}s ${segmentTelemetry.mutationAttempts}/${segmentTelemetry.mutationGrant} · READ ${(segmentTelemetry.compositeIntervalMs / 1_000).toFixed(2)}s ${segmentTelemetry.requestAttempts}/${segmentTelemetry.requestGrant}\nSEGMENT PEERS ${segmentTelemetry.nearbyPlayers} · STALE ${segmentTelemetry.stalePlayers} · MAXAGE ${segmentTelemetry.stalestRemoteMs}ms${segmentTelemetry.quotaPausedUntil > Date.now() ? ` · QUOTA ${(segmentTelemetry.quotaPausedUntil - Date.now()) / 1_000 | 0}s` : ""}`
    : "STARTING · no segment budget spent yet";

  if (!inWorld) {
    return (
      <>
      {transportForeground && lakebedIdentity !== "" && !bootstrapReady ? (
        <LobbyBootstrapQuery identity={lakebedIdentity} onResult={acceptBootstrap} />
      ) : null}
      <LobbyScreen
        authState={lobbyAuthState}
        buildLabel="MULTIPLAYER ALPHA"
        displayName={profile?.username ?? auth.displayName}
        email={auth.email}
        joinPhase={joinPhase}
        joinError={joinError}
        servers={lobbyServers}
        selectedServerId={selectedServerId}
        directConnectValue={directConnectValue}
        directConnectToken={directConnectToken}
        settings={clientSettings}
        onAddDirectServer={addDirectServer}
        onDirectConnectChange={(value) => {
          setDirectConnectValue(value);
          if (joinPhase === "error") setJoinPhase("idle");
          setJoinError("");
        }}
        onDirectConnectTokenChange={(value) => {
          setDirectConnectToken(value);
          if (joinPhase === "error") setJoinPhase("idle");
          setJoinError("");
        }}
        onJoinWorld={enterWorld}
        onSelectServer={(serverId) => {
          setSelectedServerId(serverId);
          setJoinPhase("idle");
          setJoinError("");
        }}
        onJoinSingleplayer={onJoinSingleplayer}
        onSettingsChange={updateClientSettings}
        onSignInWithGoogle={() => {
          setUsernameError("");
          void signInWithGoogle().catch(() => {
            setUsernameState("error");
            setUsernameError("Google sign-in could not start. Please try again.");
          });
        }}
        onSignOut={() => {
          signOut();
          setBootstrapIdentity("");
          setSavedPresence(undefined);
          setSavedInventory(undefined);
          setProfile(undefined);
          setExternalMultiplayerServers([]);
          updateInventory(createStarterInventory());
          const emptyEquipment = createEmptyEquipment();
          updateEquipment(emptyEquipment);
          advanceInventoryAuthorityEpoch();
          respawnPointRef.current = null;
          setRespawnPoint(null);
          hungerRef.current = MAX_HUNGER;
          setHunger(MAX_HUNGER);
          selectedRef.current = 2;
          setSelectedHotbar(2);
          poseRef.current = { ...DEFAULT_PLAYER_POSE };
          setUsernameDraft("");
          setUsernameState("idle");
          setInventoryReady(false);
          hydratedRef.current = false;
          hydratedUserRef.current = "";
          inventoryTokenRef.current = "";
          inventoryRevisionRef.current = "0";
          inventoryAuthoritySessionRef.current += 1;
          lastCommittedPlayerJsonRef.current = "";
          inventoryActionQueueRef.current.length = 0;
          inventoryActionPromiseRef.current = null;
          appliedOwnCombatHealthRef.current = null;
          appliedOwnCombatRevisionRef.current = -1;
          respawnLeaseTransitionRef.current = false;
          pendingChestTransferRef.current = null;
          pendingWorldBlockEditRef.current = null;
          worldChunkRevisionRef.current.clear();
          authoritativeWorldEditRef.current.clear();
          latestSavedInventoryRef.current = undefined;
          chestTransferActiveRef.current = false;
          setChestRetryAvailable(false);
        }}
        onUsernameChange={(value) => {
          setUsernameDraft(value);
          setUsernameState("idle");
          setUsernameError("");
        }}
        onUsernameSubmit={handleUsernameClaim}
        username={profile?.username ?? usernameDraft}
        usernameError={usernameError}
        usernameState={profile ? "claimed" : usernameState}
        worldDescription="Survival · Lakebed shared world"
        worldName="Fern Hollow"
        worldStatus="online"
      />
      </>
    );
  }

  return (
    <main className="lakecraft-shell">
      <style>{APP_CSS}</style>
      {transportForeground && !realtimeSession ? <InventoryQuery onResult={setSavedInventory} /> : null}
      {transportForeground && !realtimeSession ? (
        <LakebedWorldQueries
          activeChestKey={activeChestKey}
          activeFurnaceKey={activeFurnaceKey}
          combatUserIds={combatUserIds}
          droppedChunkKeys={droppedChunkKeys}
          furnaceQuerySample={furnaceQuerySample}
          onChest={setChestResult}
          onCombat={setPlayerCombatResult}
          onDroppedItems={setDroppedItemsResult}
          onFurnace={setFurnaceResult}
          onPresence={setSavedPresence}
          onWorldChunks={setWorldChunks}
          onWorldClock={setWorldClock}
          onWorldEvents={setWorldEvents}
          worldChunkKeys={worldChunkKeys}
        />
      ) : null}
      <canvas aria-label="Lakecraft voxel world" className="lakecraft-world" data-testid="voxel-world" ref={canvasRef} tabIndex={0} />

      {realtimeSession ? (
        <RealtimeMultiplayerTransport
          endpoint={realtimeSession.endpoint}
          ticket={realtimeSession.ticket}
          serverId={realtimeSession.serverId}
          demo={realtimeSession.demo}
          localUserId={realtimeSession.demo?.userId ?? auth.userId ?? ""}
          localUsername={realtimeSession.demo?.name ?? profile?.username ?? "Player"}
          getPose={() => engineRef.current?.getPose() ?? poseRef.current}
          getHeldItem={() => inventoryRef.current[selectedRef.current]?.itemId ?? null}
          getSkin={selectedSkin}
          getArmor={() => ({
            armorHead: equipmentRef.current.head?.itemId ?? "",
            armorChest: equipmentRef.current.chest?.itemId ?? "",
            armorLegs: equipmentRef.current.legs?.itemId ?? "",
            armorFeet: equipmentRef.current.feet?.itemId ?? "",
          })}
          onPhase={(phase: RealtimeConnectionPhase, detail?: string) => {
            setTransportReady(phase === "online");
            if (phase === "error" && detail) notify("Server connection rejected", detail, "warning");
          }}
          onReconcilePose={(pose) => engineRef.current?.reconcilePose(pose)}
          onRemotePlayers={(players) => {
            realtimePresenceRef.current = players.length > 0;
            setSegmentRemotePlayers(players);
            engineRef.current?.setRemotePlayers(players);
          }}
          onWorldEdits={(edits, replace) => {
            if (replace) authoritativeWorldEditRef.current.clear();
            for (const edit of edits) {
              authoritativeWorldEditRef.current.set(blockCoordinateKey(edit.x, edit.y, edit.z), edit);
            }
            engineRef.current?.applyWorldEdits(edits);
          }}
          onChatEvent={(event) => setRealtimeChatMessages((messages) => applyRealtimeChatEvent(messages, event))}
          onGameMode={(gameMode) => {
            if (realtimeGameModeRef.current === gameMode) return;
            realtimeGameModeRef.current = gameMode;
            setRealtimeGameMode(gameMode);
            advanceInventoryAuthorityEpoch();
            if (gameMode === "survival" && latestSavedInventoryRef.current) {
              loadCanonicalPlayer(latestSavedInventoryRef.current);
            }
          }}
          onDrops={(drops) => {
            realtimeDropsRef.current = drops;
            engineRef.current?.setDroppedItems(drops);
            maybePickupNearbyDroppedItem(poseRef.current);
          }}
          registerBlockSink={(sink) => { realtimeBlockSinkRef.current = sink; }}
          registerChatSink={(sink) => { realtimeChatSinkRef.current = sink; }}
          registerActionSink={(sink) => { motionActionSinkRef.current = sink; }}
          registerDropSink={(sink) => { realtimeDropSinkRef.current = sink; }}
          registerPickupSink={(sink) => { realtimePickupSinkRef.current = sink; }}
        />
      ) : null}

      <GameHud
        connected={worldConnected}
        equipment={equipment}
        craftingContext={craftingContext}
        deathCause="You died"
        deathScreenOpen={deathScreenOpen}
        health={playerHealth}
        hunger={hunger}
        maxHunger={MAX_HUNGER}
        inventory={inventory}
        inventoryAuthorityEpoch={inventoryAuthorityEpoch}
        creativeInventory={Boolean(realtimeSession) && realtimeGameMode === "creative"}
        inventoryOpen={inventoryOpen}
        modalOpen={chatOpen || furnaceOpen || Boolean(activeChestKey) || Boolean(activeBedKey)}
        messages={messages}
        mobileUnsupported={mobileUnsupported}
        onlineCount={Math.max(1, segmentRemotePlayers.length + 1)}
        showSurvivalStatus={realtimeGameMode !== "creative"}
        onCloseInventory={() => {
          closeInventory();
          engineRef.current?.requestPointerLock();
        }}
        onContinueMobile={() => setMobileUnsupported(false)}
        onCrafted={handleCrafted}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onDisconnect={() => {
          void flushInventoryActions();
          if (!realtimeSession) void leavePlayer(presenceSessionIdRef.current).catch(() => undefined);
          exitPointerLockForUi();
          releaseGameplayKeyboardCapture();
          setOptionsOpen(false);
          setPauseOpen(false);
          setShowPlayerList(false);
          setInWorld(false);
          setChatOpen(false);
          closeInventory();
          setActiveChestKey("");
          setActiveBedKey("");
          setMobIds([]);
          setRealtimeSession(null);
          setSegmentRemotePlayers([]);
        }}
        onInventoryWorkspaceChange={handleInventoryWorkspaceChange}
        fovDegrees={clientSettings.fovDegrees}
        mouseSensitivity={clientSettings.mouseSensitivity}
        onCloseOptions={() => setOptionsOpen(false)}
        onOptions={() => setOptionsOpen(true)}
        onFovChange={(fovDegrees) => updateClientSettings({ ...clientSettingsRef.current, fovDegrees })}
        onSensitivityChange={(mouseSensitivity) => updateClientSettings({ ...clientSettingsRef.current, mouseSensitivity })}
        optionsOpen={optionsOpen}
        onRespawn={requestAuthorizedRespawn}
        soundMuted={clientSettings.soundMuted}
        onToggleSound={() => {
          const nextMuted = !clientSettingsRef.current.soundMuted;
          updateClientSettings({ ...clientSettingsRef.current, soundMuted: nextMuted });
          if (!nextMuted) {
            void audioRef.current?.unlock().then(() => {
              audioRef.current?.play("uiConfirm", { seed: "sound-on", intensity: 0.52 });
            });
          }
        }}
        onResume={() => {
          setOptionsOpen(false);
          setPauseOpen(false);
          requestGameplayKeyboardCapture();
          engineRef.current?.requestPointerLock();
        }}
        onSelectHotbar={handleSelectHotbar}
        onTitleScreen={() => {
          void flushInventoryActions();
          if (!realtimeSession) void leavePlayer(presenceSessionIdRef.current).catch(() => undefined);
          exitPointerLockForUi();
          releaseGameplayKeyboardCapture();
          setDeathScreenOpen(false);
          setRespawning(false);
          setOptionsOpen(false);
          setPauseOpen(false);
          setShowPlayerList(false);
          setInWorld(false);
          setChatOpen(false);
          closeInventory();
          setFurnaceOpen(false);
          setActiveChestKey("");
          setActiveBedKey("");
          setMobIds([]);
          setRealtimeSession(null);
          setSegmentRemotePlayers([]);
        }}
        playerName={profile?.username ?? auth.displayName}
        pauseOpen={pauseOpen}
        players={playerListEntries}
        roomCode={realtimeSession ? "RAILWAY" : "FERN-01"}
        selectedIndex={selectedHotbar}
        respawning={respawning}
        showPlayerList={showPlayerList}
        worldName={activeServerName}
      />

      <FurnaceDrawer
        busy={furnaceBusy}
        error={furnaceError}
        furnace={furnaceState}
        inventory={inventory}
        onClose={() => {
          if (furnaceBusy) return;
          closeInventory();
          engineRef.current?.requestPointerLock();
        }}
        onTransfer={(action) => { void handleFurnaceTransfer(action); }}
        open={furnaceOpen}
        status={furnaceStatus}
      />

      <ChestDrawer
        busy={chestBusy}
        chestInventory={chestInventory}
        error={chestError}
        onClose={() => {
          if (chestBusy) return;
          setActiveChestKey("");
          setChestError("");
          setChestRetryAvailable(false);
          engineRef.current?.requestPointerLock();
        }}
        onTransfer={handleChestTransfer}
        onRetry={retryPendingChestTransfer}
        open={Boolean(activeChestKey)}
        playerInventory={inventory}
        retryAvailable={chestRetryAvailable}
        status={chestBusy ? "Waiting for Lakebed to settle one atomic transfer…" : "Pack and chest are synchronized with Lakebed."}
      />

      {activeBedKey ? (
        <div className="lakecraft-sleep-layer" onMouseDown={(event) => {
          if (event.target !== event.currentTarget || sleepBusy) return;
          setActiveBedKey("");
          engineRef.current?.requestPointerLock();
        }}>
          <section className="lakecraft-sleep" role="dialog" aria-modal="true" aria-labelledby="lakecraft-sleep-title">
            <small>shared Lakebed sleep vote</small>
            <h2 id="lakecraft-sleep-title">Rest until morning</h2>
            <p role="status">{sleepStatus}</p>
            <div className="lakecraft-sleep__actions">
              <button disabled={sleepBusy} onClick={() => handleSleepInBed()} type="button">{sleepBusy ? "Contacting Lakebed…" : "Vote to sleep"}</button>
              <button disabled={sleepBusy} onClick={() => {
                setActiveBedKey("");
                engineRef.current?.requestPointerLock();
              }} type="button">Close · E</button>
            </div>
          </section>
        </div>
      ) : null}

      <ChatOverlay
        connected={worldConnected}
        draft={chatDraft}
        error={chatError}
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        messages={chatMessages}
        onClose={() => {
          setChatOpen(false);
          setLastSeenChatCount(chatMessages.length);
          engineRef.current?.requestPointerLock();
        }}
        onDraftChange={setChatDraft}
        onOpen={() => {
          exitPointerLockForUi();
          setChatOpen(true);
          setLastSeenChatCount(chatMessages.length);
          setChatError("");
        }}
        onSubmit={handleChatSubmit}
        open={chatOpen}
        sending={false}
        unreadCount={unreadChat}
      />

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </main>
  );
}

function LakebedMultiplayerApp({ onJoinSingleplayer }: { onJoinSingleplayer: () => void }) {
  const [inWorld, setInWorld] = useState(false);
  return (
    <ErrorBoundary fallback={(error, retry) => <LakebedQueryRecovery error={error} retry={retry} />}>
      <GameApp inWorld={inWorld} setInWorld={setInWorld} onJoinSingleplayer={onJoinSingleplayer} />
    </ErrorBoundary>
  );
}

export function App() {
  const [singlePlayer, setSinglePlayer] = useState(
    () => shouldRunSinglePlayer(window.location.hostname, window.location.search),
  );

  function joinSingleplayer(): void {
    const url = new URL(window.location.href);
    url.searchParams.set("singleplayer", "1");
    window.history.replaceState(window.history.state, "", url);
    setSinglePlayer(true);
  }

  function leaveSingleplayer(): void {
    window.history.replaceState(window.history.state, "", singlePlayerTitleUrl(window.location.href));
    setSinglePlayer(false);
  }

  return singlePlayer
    ? <SinglePlayerApp onExit={leaveSingleplayer} />
    : <LakebedMultiplayerApp onJoinSingleplayer={joinSingleplayer} />;
}
