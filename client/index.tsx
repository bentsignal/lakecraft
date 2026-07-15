import { signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
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
  type RemotePlayer,
  type VoxelEngine,
  type VoxelPerformanceStats,
  type WorldEdit as EngineWorldEdit,
} from "./game";
import { LobbyScreen, type LobbyJoinPhase, type UsernameClaimState } from "./lobby";
import {
  ITEMS,
  BLOCKS,
  MAX_HEALTH,
  MAX_HUNGER,
  addItem,
  applyConfirmedToolUse,
  attackDamage,
  clampHotbarIndex,
  craftRecipe,
  createEmptyEquipment,
  createEmptyInventory,
  createSerializablePlayerState,
  createStarterInventory,
  createSurvivalTickState,
  consumeFood,
  equipArmorFromInventory,
  equippedArmorProtection,
  miningSeconds,
  normalizeEquipment,
  normalizeInventory,
  normalizeRespawnPoint,
  parseSerializablePlayerStateJson,
  tickSurvival,
  unequipArmor,
  type ArmorSlot,
  type BlockId,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
  type PlayerRespawnPoint,
  type Recipe,
  type SurvivalTickState,
  type ToolUseKind,
} from "../shared/game";
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
  type ChatMessage,
  type ClaimUsernameResult,
  type Profile,
  type SendChatResult,
} from "../shared/multiplayer";
import { PLAYER_RESPAWN_DELAY_MS, type PlayerCombatState } from "../shared/playerCombat";
import {
  PLAYER_STALE_AFTER_MS,
  activePlayerPresences,
  blockCoordinateKey,
  latestWorldEdits,
  type PersistedInventory,
  type PlayerPresence,
  type WorldEdit,
} from "../shared/protocol";
import {
  PRESENCE_ACTIVE_WRITES_PER_SECOND,
  PRESENCE_REALTIME_BURST_WRITES,
  PRESENCE_SAMPLE_INTERVAL_MS,
  PRESENCE_SESSION_WRITE_BUDGET,
  classifyPresenceTransportError,
  createPresenceBurstGuardState,
  createPresenceSchedulerState,
  parsePersistedPresencePose,
  parsePresenceVelocityFields,
  presenceBurstGuardSnapshot,
  recordPresenceFailure,
  recordPresenceSuccess,
  reservePresenceAttempt,
  stepPresenceScheduler,
  type PresenceBurstGuardState,
  type PresenceSchedulerState,
} from "../shared/presenceMotion";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance";
import { type SleepInBedResult, type WorldClockSnapshot } from "../shared/sleep";
import {
  MAX_MOB_ATTACK_DAMAGE,
  type MobAttackResult,
  type MobAuthorityState,
} from "../shared/mobCombat";
import type { MobMotionPose } from "../shared/mobMotionAuthority.ts";
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
.lakecraft-perf { background: rgba(9,12,9,.88); border-left: 3px solid #91ae58; color: #dce7c4; font: 11px/1.45 "Courier New", monospace; left: 14px; padding: 9px 11px; pointer-events: none; position: absolute; top: 14px; white-space: pre; z-index: 70; }
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

const PRESENCE_BUDGET_STORAGE_PREFIX = "lakecraft:presence-budget:v1:";
const AUDIO_MUTED_STORAGE_KEY = "lakecraft:audio-muted:v1";

function loadAudioMuted(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function audioSurfaceForBlock(block: EngineBlockId): GameAudioSurface {
  if (block === BLOCK.GRASS || block === BLOCK.DIRT || block === BLOCK.LEAVES || block === BLOCK.BED) return "grass";
  if (block === BLOCK.WOOD || block === BLOCK.PLANKS || block === BLOCK.CRAFTING_TABLE
    || block === BLOCK.CHEST || block === BLOCK.DOOR_CLOSED || block === BLOCK.DOOR_OPEN || block === BLOCK.LADDER) return "wood";
  if (block === BLOCK.SAND) return "sand";
  if (block === BLOCK.GLASS) return "glass";
  if (block === BLOCK.IRON_ORE || block === BLOCK.GOLD_ORE || block === BLOCK.DIAMOND_ORE || block === BLOCK.FURNACE) return "metal";
  if (block === BLOCK.STONE || block === BLOCK.COBBLESTONE || block === BLOCK.COAL_ORE) return "stone";
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
  | { ok: true; target: PlayerPose; epoch: string; expiresAt: number | string }
  | { ok: false; reason: string; retryAfterMs?: number };

type HeartbeatPlayerResult = void | { ok: boolean; reason?: string; canonicalPose?: PlayerPose };
type StartPresenceSessionResult = {
  ok: boolean;
  reason?: string;
  resetToTrailhead?: boolean;
  spawnPose?: PlayerPose | null;
};

type MobDamageClaim = {
  operationId: string;
  mobId: string;
  checkpointRevision: number;
  tick: number;
};

type MobWorldAuthorityResult =
  | {
      ok: true;
      checkpointRevision: number;
      motionTick: number;
      checkpointAt: number;
      leaseOwnerUserId: string;
      leaseExpiresAt: number;
      serverNow: number;
      poses: MobMotionPose[];
      states: MobAuthorityState[];
      damageClaims: MobDamageClaim[];
      needsCheckpoint: boolean;
    }
  | { ok: false; reason: string; poses: []; states: []; damageClaims: []; serverNow: number };

type MobWorldCheckpointResult =
  | { ok: true; checkpointRevision: number; checkpointAt: number; leaseExpiresAt: number; serverNow: number }
  | { ok: false; reason: string; retryAfterMs?: number; serverNow: number };

type MobPlayerDamageResult =
  | { ok: true; replayed: boolean; killed: boolean; damage: number; state: PlayerCombatState; serverNow: number }
  | { ok: false; reason: string; retryAfterMs?: number; serverNow: number };

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

const ENGINE_TO_PROTOCOL: Record<EngineBlockId, "air" | "grass" | "dirt" | "stone" | "cobblestone" | "sand" | "glass" | "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore" | "wood" | "leaves" | "planks" | "crafting_table" | "furnace" | "torch" | "chest" | "door_closed" | "door_open" | "bed" | "ladder"> = {
  [BLOCK.AIR]: "air",
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
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
};

const PROTOCOL_TO_ENGINE: Record<string, EngineBlockId> = {
  air: BLOCK.AIR,
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND,
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
};

const ENGINE_TO_GAME: Partial<Record<EngineBlockId, BlockId>> = {
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
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
};

const ITEM_TO_ENGINE: Partial<Record<ItemId, EngineBlockId>> = {
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND,
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
};

type WorldChunksQueryResult =
  | { ok: true; chunks: Array<{ chunkKey: string; snapshotJson: string; revision: string; updatedAt: string }> }
  | { ok: false; reason: "invalid_chunk_keys" | "too_many_chunks"; chunks: [] };

type SaveInventoryResult =
  | { ok: true; inventory: PersistedInventoryState }
  | { ok: false; reason: "authentication_required" | "invalid_inventory" | "invalid_token" | "conflict"; inventory: PersistedInventoryState | null };

type PendingChestTransfer = { requestJson: string; transportFailures: number };

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
      inventory?: PersistedInventoryState;
    }
  | { ok: false; reason: string; detail?: string; inventory?: PersistedInventoryState | null };

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

const WORLD_RADIUS = 18;
const DEFAULT_PLAYER_POSE: Readonly<PlayerPose> = Object.freeze({ x: 0.5, y: 8, z: 0.5, yaw: 0, pitch: 0 });
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

function remoteColor(value: string): readonly [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const number = Number.parseInt(match[1], 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
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
  return row ? parseSerializablePlayerStateJson(row.inventoryJson) : null;
}

export function App() {
  const auth = useAuth();
  const [activeChestKey, setActiveChestKey] = useState("");
  const [activeFurnaceKey, setActiveFurnaceKey] = useState("");
  const [furnaceQuerySample, setFurnaceQuerySample] = useState("0");
  const [inWorld, setInWorld] = useState(false);
  const [mobLeaseSessionId, setMobLeaseSessionId] = useState("");
  const [mobQuerySample, setMobQuerySample] = useState("0");
  const [worldChunkKeys, setWorldChunkKeys] = useState<string[]>(() => visibleWorldChunkKeys(DEFAULT_PLAYER_POSE.x, DEFAULT_PLAYER_POSE.z));
  const worldEvents = useQuery<WorldEdit[]>("worldEdits") ?? [];
  const worldChunks = useQuery<WorldChunksQueryResult, string[]>("worldChunks", worldChunkKeys);
  const [activeSince] = useState(() => String(Date.now() - PLAYER_STALE_AFTER_MS));
  const presenceEvents = useQuery<PlayerPresence[], string>("recentPlayers", activeSince) ?? [];
  const activePlayers = activePlayerPresences(presenceEvents);
  const combatUserIds = [...new Set([
    auth.userId,
    ...activePlayers.slice(0, 127).map((player) => player.userId),
  ].filter((userId): userId is string => typeof userId === "string" && userId.length > 0))].sort();
  const playerCombatResult = useQuery<{
    ok: boolean;
    reason?: string;
    states: PlayerCombatState[];
    serverNow: number;
  }, string[]>("playerCombatStates", inWorld ? combatUserIds : []);
  const savedPresence = useQuery<PlayerPresence | null>("myPresence");
  const savedInventory = useQuery<PersistedInventory | null>("myInventory");
  const profile = useQuery<Profile | null>("myProfile");
  const chatEvents = useQuery<ChatMessage[]>("recentChat") ?? [];
  const chestResult = useQuery<ChestAtResult, string>("chestAt", activeChestKey);
  const furnaceResult = useQuery<FurnaceAtResult, { coordKey: string; sample: string }>(
    "furnaceAt",
    { coordKey: activeFurnaceKey, sample: activeFurnaceKey ? furnaceQuerySample : "0" },
  );
  const worldClock = useQuery<WorldClockSnapshot>("worldClock");
  const [mobIds, setMobIds] = useState<string[]>([]);
  const mobWorldAuthority = useQuery<MobWorldAuthorityResult, { mobIds: string[]; sample: string }>(
    "mobWorldAuthority",
    { mobIds, sample: inWorld ? mobQuerySample : "0" },
  );
  const [droppedChunkKeys, setDroppedChunkKeys] = useState<string[]>(() => visibleDroppedItemChunkKeys(DEFAULT_PLAYER_POSE.x, DEFAULT_PLAYER_POSE.z));
  const droppedItemsResult = useQuery<DroppedItemsQueryResult, string[]>("droppedItems", inWorld ? droppedChunkKeys : []);

  const editWorldBlock = useMutation<[
    requestJson: string,
    poseX: string,
    poseY: string,
    poseZ: string,
    poseYaw: string,
    posePitch: string,
  ], WorldBlockEditMutationResult>("editWorldBlock");
  const heartbeatPlayer = useMutation<[displayName: string, color: string, x: string, y: string, z: string, yaw: string, pitch: string, heartbeatAt: string, vx: string, vy: string, vz: string, heldItem: string, armorHead: string, armorChest: string, armorLegs: string, armorFeet: string, sessionId: string], HeartbeatPlayerResult>("heartbeatPlayer");
  const authorizeRespawn = useMutation<[], AuthorizeRespawnResult>("authorizeRespawn");
  const startPresenceSession = useMutation<[sessionId: string], StartPresenceSessionResult>("startPresenceSession");
  const leavePlayer = useMutation<[sessionId: string], void>("leavePlayer");
  const saveInventory = useMutation<[inventoryJson: string, expectedUpdatedAt: string], SaveInventoryResult>("saveInventory");
  const claimUsername = useMutation<[requestedUsername: string], ClaimUsernameResult>("claimUsername");
  const sendChat = useMutation<[rawMessage: string], SendChatResult>("sendChat");
  const transferChest = useMutation<[requestJson: string], ChestTransferResult>("transferChest");
  const operateFurnace = useMutation<[requestJson: string], FurnaceOperationResult>("operateFurnace");
  const sleepInBed = useMutation<[coordKey: string], SleepInBedResult>("sleepInBed");
  const attackMob = useMutation<[mobId: string, kind: string, damage: string, operationId: string], MobAttackResult>("attackMob");
  const checkpointMobWorld = useMutation<[requestJson: string], MobWorldCheckpointResult>("checkpointMobWorld");
  const claimMobPlayerDamage = useMutation<[requestJson: string], MobPlayerDamageResult>("claimMobPlayerDamage");
  const attackPlayer = useMutation<[requestJson: string], {
    ok: boolean;
    reason?: string;
    retryAfterMs?: number;
    killed?: boolean;
    replayed?: boolean;
    damage?: number;
    weaponItemId?: ItemId | null;
    targetState?: PlayerCombatState;
    serverNow: number;
  }>("attackPlayer");
  const dropItemMutation = useMutation<[requestJson: string], DroppedItemMutationResult>("dropItem");
  const pickupDroppedItemMutation = useMutation<[requestJson: string], DroppedItemMutationResult>("pickupDroppedItem");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const poseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const presenceSampleRef = useRef<((pose: PlayerPose, at?: number) => void) | null>(null);
  const presenceSchedulerRef = useRef<PresenceSchedulerState | null>(null);
  const presenceBurstGuardRef = useRef<PresenceBurstGuardState | null>(null);
  const presenceModeNoticeRef = useRef("");
  const targetRef = useRef<BlockTarget | null>(null);
  const inventoryRef = useRef<Inventory>(createStarterInventory());
  const equipmentRef = useRef<Equipment>(createEmptyEquipment());
  const respawnPointRef = useRef<PlayerRespawnPoint | null>(null);
  const hungerRef = useRef(MAX_HUNGER);
  const survivalRef = useRef<SurvivalTickState>(createSurvivalTickState());
  const recentlyActiveUntilRef = useRef(0);
  const selectedRef = useRef(2);
  const hydratedRef = useRef(false);
  const hydratedUserRef = useRef("");
  const inventoryTokenRef = useRef("");
  const inventoryRevisionRef = useRef("0");
  const inventorySessionRef = useRef(0);
  const lastCommittedPlayerJsonRef = useRef("");
  const inventorySavePromiseRef = useRef<Promise<void> | null>(null);
  const inventorySavePendingRef = useRef(false);
  const chestTokenRef = useRef("");
  const chestInventoryRef = useRef<Inventory>(createEmptyInventory(CHEST_SLOT_COUNT));
  const chestBusyRef = useRef(false);
  const furnaceBusyRef = useRef(false);
  const furnaceAuthorityRef = useRef<FurnaceAuthorityView | null>(null);
  const chestTransferActiveRef = useRef(false);
  const pendingChestTransferRef = useRef<PendingChestTransfer | null>(null);
  const pendingWorldBlockEditRef = useRef<PendingWorldBlockEdit | null>(null);
  const deferredMobDropsRef = useRef<Array<{ itemId: string; count: number }>>([]);
  const worldChunkRevisionRef = useRef(new Map<string, string>());
  const authoritativeWorldEditRef = useRef(new Map<string, EngineWorldEdit>());
  const latestSavedInventoryRef = useRef<PersistedInventory | null | undefined>(undefined);
  const activeWorkstationRef = useRef<{ kind: "crafting_table" | "furnace"; position: WorkstationPosition } | null>(null);
  const toastCounter = useRef(0);
  const droppedItemBusyRef = useRef(false);
  const droppedChunkCenterRef = useRef("");
  const worldChunkCenterRef = useRef("");
  const intentionalPointerUnlockRef = useRef(false);
  const droppedItemsClockRef = useRef<{ result: DroppedItemsQueryResult; receivedAt: number } | null>(null);
  const droppedPickupAttemptRef = useRef(new Map<string, number>());
  const lastDroppedPickupSweepRef = useRef(0);
  const appliedOwnCombatHealthRef = useRef<number | null>(null);
  const mobCheckpointInFlightRef = useRef(false);
  const mobDamageClaimsRef = useRef(new Set<string>());
  const realtimePresenceRef = useRef(false);
  const respawnRequestInFlightRef = useRef(false);
  const respawnTimerRef = useRef<number | null>(null);
  const confirmedFeedbackOperationsRef = useRef<Set<string> | null>(null);
  const previousChestKeyRef = useRef("");

  if (!presenceSchedulerRef.current) presenceSchedulerRef.current = createPresenceSchedulerState();
  if (!presenceBurstGuardRef.current) presenceBurstGuardRef.current = createPresenceBurstGuardState(Date.now());
  if (!confirmedFeedbackOperationsRef.current) confirmedFeedbackOperationsRef.current = new Set<string>();

  const [inventory, setInventory] = useState<Inventory>(() => createStarterInventory());
  const [equipment, setEquipment] = useState<Equipment>(() => createEmptyEquipment());
  const [respawnPoint, setRespawnPoint] = useState<PlayerRespawnPoint | null>(null);
  const [hunger, setHunger] = useState(MAX_HUNGER);
  const [selectedHotbar, setSelectedHotbar] = useState(2);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [furnaceOpen, setFurnaceOpen] = useState(false);
  const [furnaceState, setFurnaceState] = useState<FurnaceState | null>(null);
  const [furnaceBusy, setFurnaceBusy] = useState(false);
  const [furnaceStatus, setFurnaceStatus] = useState("Input and fuel are shared through Lakebed.");
  const [furnaceError, setFurnaceError] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(loadAudioMuted);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [mobileUnsupported, setMobileUnsupported] = useState(false);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [engineError, setEngineError] = useState("");
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [joinPhase, setJoinPhase] = useState<LobbyJoinPhase>("idle");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameClaimState>("idle");
  const [usernameError, setUsernameError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const [performanceStats, setPerformanceStats] = useState<VoxelPerformanceStats | null>(null);
  const [showPerformance, setShowPerformance] = useState(false);
  const [playerHealth, setPlayerHealth] = useState(20);
  const [miningProgress, setMiningProgress] = useState(0);
  const [handActionToken, setHandActionToken] = useState(0);
  const [chestInventory, setChestInventory] = useState<Inventory>(() => createEmptyInventory(CHEST_SLOT_COUNT));
  const [chestBusy, setChestBusy] = useState(false);
  const [chestError, setChestError] = useState("");

  useEffect(() => {
    appliedOwnCombatHealthRef.current = null;
  }, [auth.userId]);
  const [chestRetryAvailable, setChestRetryAvailable] = useState(false);
  const [activeBedKey, setActiveBedKey] = useState("");
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepStatus, setSleepStatus] = useState("Rest until every active explorer is in bed, then Lakebed will move the shared clock to morning.");

  useEffect(() => {
    const audio = createGameAudio({ muted: soundMuted, maxVoices: 16 });
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
    audioRef.current?.setMuted(soundMuted);
    try { window.localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, String(soundMuted)); } catch { /* local preference only */ }
  }, [soundMuted]);

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

  function requestAuthorizedRespawn(): void {
    if (respawnRequestInFlightRef.current) return;
    if (!auth.isAuthenticated || auth.isGuest) {
      notify("Respawn unavailable", "Sign in again before returning to the world.", "warning");
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    respawnRequestInFlightRef.current = true;
    void authorizeRespawn().then((result) => {
      if (!result.ok) {
        notify("Respawn not authorized", "Lakebed did not approve a spawn jump. You remain at the death location.", "warning");
        respawnTimerRef.current = window.setTimeout(() => {
          respawnTimerRef.current = null;
          requestAuthorizedRespawn();
        }, Math.max(1_000, Math.min(15_000, result.retryAfterMs ?? 2_000)));
        return;
      }
      const target = validateRespawnPoint(result.target, Number.MAX_SAFE_INTEGER);
      const expiresAt = Number(result.expiresAt);
      if (!target
        || typeof result.epoch !== "string"
        || !result.epoch
        || !Number.isSafeInteger(expiresAt)
        || engineRef.current !== engine) {
        notify("Respawn not authorized", "Lakebed returned an invalid or expired spawn authorization.", "warning");
        return;
      }
      engine.setRespawnPoint(target);
      engine.respawn();
    }).catch(() => {
      notify("Respawn lost contact", "Lakebed could not authorize the jump. You remain at the death location.", "warning");
      respawnTimerRef.current = window.setTimeout(() => {
        respawnTimerRef.current = null;
        requestAuthorizedRespawn();
      }, 2_000);
    }).finally(() => {
      respawnRequestInFlightRef.current = false;
    });
  }

  function scheduleAuthorizedRespawn(): void {
    if (respawnRequestInFlightRef.current || respawnTimerRef.current !== null) return;
    respawnTimerRef.current = window.setTimeout(() => {
      respawnTimerRef.current = null;
      requestAuthorizedRespawn();
    }, PLAYER_RESPAWN_DELAY_MS);
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

  function recordConfirmedToolUse(slot: number, itemId: ItemId | null, kind: ToolUseKind): void {
    if (!itemId) return;
    const result = applyConfirmedToolUse(inventoryRef.current, slot, kind, itemId);
    if (!result.used) return;
    updateInventory(result.inventory);
    if (result.broke && result.itemId) {
      notify(`${ITEMS[result.itemId].label} broke`, "The last durability point was consumed by a Lakebed-confirmed action.", "warning");
    }
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
    const saved = parseSerializablePlayerStateJson(row.inventoryJson);
    if (!saved) return false;
    inventoryTokenRef.current = row.updatedAt;
    inventoryRevisionRef.current = row.revision;
    const canonical = validatePlayerStateJson(row.inventoryJson);
    lastCommittedPlayerJsonRef.current = canonical.ok ? canonical.playerStateJson : row.inventoryJson;
    updateInventory(saved.inventory);
    selectedRef.current = saved.selectedHotbar;
    setSelectedHotbar(saved.selectedHotbar);
    equipmentRef.current = saved.equipment;
    setEquipment(saved.equipment);
    respawnPointRef.current = saved.respawnPoint;
    setRespawnPoint(saved.respawnPoint);
    if (saved.respawnPoint) engineRef.current?.setRespawnPoint(saved.respawnPoint);
    hungerRef.current = saved.hunger;
    survivalRef.current.hunger = saved.hunger;
    setHunger(saved.hunger);
    return true;
  }

  function requestInventorySave(
    allowWhileChestBusy = false,
    allowWhileWorldEditPending = false,
    allowWhileFurnaceBusy = false,
  ): Promise<void> {
    if (pendingWorldBlockEditRef.current && !allowWhileWorldEditPending) {
      inventorySavePendingRef.current = true;
      return inventorySavePromiseRef.current ?? Promise.resolve();
    }
    if (chestBusyRef.current && !allowWhileChestBusy) {
      inventorySavePendingRef.current = true;
      return inventorySavePromiseRef.current ?? Promise.resolve();
    }
    if (furnaceBusyRef.current && !allowWhileFurnaceBusy) {
      inventorySavePendingRef.current = true;
      return inventorySavePromiseRef.current ?? Promise.resolve();
    }
    if (inventorySavePromiseRef.current) {
      inventorySavePendingRef.current = true;
      return inventorySavePromiseRef.current;
    }
    const payload = currentPlayerStateJson();
    if (payload === lastCommittedPlayerJsonRef.current) return Promise.resolve();
    const expectedToken = inventoryTokenRef.current;
    const session = inventorySessionRef.current;
    const task = (async () => {
      try {
        const result = await saveInventory(payload, expectedToken);
        if (session !== inventorySessionRef.current) return;
        setConnected(true);
        if (result.ok) {
          inventoryTokenRef.current = result.inventory.updatedAt;
          inventoryRevisionRef.current = result.inventory.revision;
          lastCommittedPlayerJsonRef.current = result.inventory.inventoryJson;
          if (currentPlayerStateJson() !== payload) inventorySavePendingRef.current = true;
        } else if (result.reason === "conflict") {
          inventorySavePendingRef.current = false;
          if (!loadCanonicalPlayer(result.inventory)) {
            notify("Pack reconciliation failed", "Lakebed returned a damaged canonical inventory.", "warning");
          } else {
            notify("Pack reconciled", "A newer Lakebed inventory replaced a stale local save.", "warning");
          }
        } else if (result.reason === "authentication_required") {
          notify("Pack save paused", "Sign in again before saving inventory.", "warning");
        } else {
          notify("Pack save rejected", "Lakebed rejected an invalid inventory update.", "warning");
        }
      } catch {
        setConnected(false);
        notify("Field kit save delayed", "Inventory will retry after your next change.", "warning");
      } finally {
        inventorySavePromiseRef.current = null;
        if (inventorySavePendingRef.current && !chestBusyRef.current
          && !furnaceBusyRef.current && !pendingWorldBlockEditRef.current) {
          inventorySavePendingRef.current = false;
          void requestInventorySave();
        }
      }
    })();
    inventorySavePromiseRef.current = task;
    return task;
  }

  async function handleDropSelected(dropWholeStack = false): Promise<void> {
    if (!hydratedRef.current || droppedItemBusyRef.current || chestBusyRef.current || pendingWorldBlockEditRef.current) return;
    const sourceSlot = selectedRef.current;
    const stack = inventoryRef.current[sourceSlot];
    if (!stack) return;
    droppedItemBusyRef.current = true;
    try {
      await requestInventorySave();
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
        notify(`Dropped ${ITEMS[result.moved.itemId].label}`, result.moved.count > 1 ? `${result.moved.count} items can be picked up by nearby players.` : "Nearby players can pick it up.");
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
    if (!hydratedRef.current || droppedItemBusyRef.current || chestBusyRef.current || pendingWorldBlockEditRef.current) return;
    droppedItemBusyRef.current = true;
    try {
      await requestInventorySave();
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
        notify(`Picked up ${ITEMS[result.moved.itemId].label}`, result.moved.count > 1 ? `${result.moved.count} added to inventory.` : undefined, "success");
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

  function collectMobDrops(drops: readonly { itemId: string; count: number }[]) {
    if (pendingWorldBlockEditRef.current) {
      deferredMobDropsRef.current.push(...drops);
      return;
    }
    let next = inventoryRef.current;
    const collected: string[] = [];
    for (const drop of drops) {
      if (!(drop.itemId in ITEMS)) continue;
      const itemId = drop.itemId as ItemId;
      const added = addItem(next, itemId, drop.count);
      next = added.inventory;
      if (drop.count > added.remainder) collected.push(`${drop.count - added.remainder} ${ITEMS[itemId].label}`);
    }
    updateInventory(next);
    if (collected.length) notify("Mob drops collected", collected.join(" · "), "success");
  }

  function releasePendingWorldBlockEdit(pending: PendingWorldBlockEdit): void {
    if (pendingWorldBlockEditRef.current !== pending) return;
    pendingWorldBlockEditRef.current = null;
    if (deferredMobDropsRef.current.length) {
      const deferredDrops = deferredMobDropsRef.current.splice(0);
      collectMobDrops(deferredDrops);
    }
    if (inventorySavePendingRef.current && !chestBusyRef.current && !furnaceBusyRef.current) {
      inventorySavePendingRef.current = false;
      void requestInventorySave();
    }
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
      if (result.drop) {
        notify(`Collected ${ITEMS[result.drop.itemId].label}`, "Lakebed added it to the field kit.", "success");
      } else {
        const gameBlock = ENGINE_TO_GAME[PROTOCOL_TO_ENGINE[result.previousBlock]];
        if (gameBlock && BLOCKS[gameBlock].drop) {
          notify(`No ${ITEMS[BLOCKS[gameBlock].drop!].label} recovered`, miningRequirementDetail(gameBlock), "warning");
        }
      }
    }
    if (result.toolUse?.broke && result.toolUse.itemId && result.toolUse.itemId in ITEMS) {
      notify(`${ITEMS[result.toolUse.itemId].label} broke`, "Lakebed confirmed the final durability use.", "warning");
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
      audioRef.current?.play(next === BLOCK.DOOR_OPEN ? "doorOpen" : "doorClose", { seed, surface: "wood" });
    }
  }

  async function submitPendingWorldBlockEdit(pending: PendingWorldBlockEdit): Promise<void> {
    try {
      await requestInventorySave(false, true);
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
          request.kind === "mine" ? "Mine rolled back" : request.kind === "place" ? "Placement rolled back" : "Door restored",
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
        engineRef.current?.applyWorldEdits([{
          x: canonicalEdit.x,
          y: canonicalEdit.y,
          z: canonicalEdit.z,
          block: canonicalEdit.block,
        }]);
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
  }, [inventory, selectedHotbar, equipment]);

  useEffect(() => {
    chestInventoryRef.current = chestInventory;
  }, [chestInventory]);

  useEffect(() => {
    if (!auth.isAuthenticated || auth.isGuest || hydratedUserRef.current === auth.userId || savedInventory === undefined) return;
    if (savedInventory && savedInventory.userId !== auth.userId) return;
    hydratedRef.current = true;
    hydratedUserRef.current = auth.userId;
    inventorySessionRef.current += 1;
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
      setEquipment(saved.equipment);
      respawnPointRef.current = saved.respawnPoint;
      setRespawnPoint(saved.respawnPoint);
      hungerRef.current = saved.hunger;
      survivalRef.current = createSurvivalTickState(saved.hunger, playerHealth);
      setHunger(saved.hunger);
      notify("Field kit restored", "Lakebed recovered your last inventory.", "success");
    }
    setInventoryReady(true);
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
      && savedInventory.revision !== inventoryRevisionRef.current
      && currentPlayerStateJson() === lastCommittedPlayerJsonRef.current
      && loadCanonicalPlayer(savedInventory)) {
      return;
    }
    if (!pending && savedInventory.inventoryJson === lastCommittedPlayerJsonRef.current) {
      inventoryTokenRef.current = savedInventory.updatedAt;
      inventoryRevisionRef.current = savedInventory.revision;
    }
  }, [savedInventory, auth.userId]);

  useEffect(() => {
    if (!hydratedRef.current || !auth.isAuthenticated || auth.isGuest) return;
    const timer = window.setTimeout(() => {
      void requestInventorySave();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inventory, selectedHotbar, equipment, respawnPoint, hunger, auth.isAuthenticated, auth.isGuest]);

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
        worldRadius: WORLD_RADIUS,
        dayNight: worldClock ? {
          cycleLengthMs: worldClock.cycleLengthMs,
          epochMs: worldClock.epochMs,
          epochPhase: worldClock.epochPhase,
        } : undefined,
        serverTimeOffsetMs: worldClock ? worldClock.serverNow - Date.now() : 0,
        selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
        canEditBlock: () => pendingWorldBlockEditRef.current === null,
        getMiningDuration: (block) => {
          const gameBlock = ENGINE_TO_GAME[block];
          const heldItem = inventoryRef.current[selectedRef.current]?.itemId;
          return gameBlock ? miningSeconds(gameBlock, heldItem) : 0.2;
        },
        getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
        getPlayerProtection: () => equippedArmorProtection(equipmentRef.current),
        onUseSelectedItem: () => handleUseItem(),
        onMobAttack: (target, damage) => {
          const operationId = createCombatOperationId();
          void requestInventorySave().then(() => attackMob(
            target.id,
            target.kind,
            String(Math.max(1, Math.min(MAX_MOB_ATTACK_DAMAGE, Math.floor(damage)))),
            operationId,
          )).then((result) => {
            setConnected(true);
            if (result.state) {
              engineRef.current?.applyMobCombatStates([result.state], result.serverNow - Date.now());
            }
            if (result.ok) {
              loadCanonicalPlayer(result.inventory);
              audioRef.current?.play("mobHurt", { seed: operationId, intensity: result.killed ? 0.9 : 0.68 });
              if (result.killed && result.drops.length) {
                notify(
                  "Mob drops collected",
                  result.drops.map((drop) => `${drop.count} ${ITEMS[drop.itemId].label}`).join(" · "),
                  "success",
                );
              }
            }
          }).catch(() => {
            setConnected(false);
            notify("Attack lost contact", "Lakebed could not confirm that hit.", "warning");
          });
        },
        onRemotePlayerAttack: (target) => {
          const selectedHotbar = selectedRef.current;
          const weaponItemId = inventoryRef.current[selectedHotbar]?.itemId ?? "";
          const operationId = createCombatOperationId();
          void requestInventorySave().then(() => attackPlayer(JSON.stringify({
            operationId,
            targetUserId: target.id,
            selectedHotbar,
            weaponItemId,
          }))).then((result) => {
            setConnected(true);
            if (result.ok) {
              recordConfirmedToolUse(selectedHotbar, weaponItemId || null, "attack");
              audioRef.current?.play("playerHurt", { seed: operationId, intensity: result.killed ? 0.9 : 0.65 });
              notify(
                result.killed ? `${target.name} was defeated` : `Hit ${target.name}`,
                `${result.damage ?? 0} damage${result.replayed ? " · confirmed retry" : ""}`,
                result.killed ? "success" : "info",
              );
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
        onMobDrops: collectMobDrops,
        onMiningProgress: setMiningProgress,
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
        onHandAction: (action) => {
          setHandActionToken((current) => current + 1);
          if (action === "attack") audioRef.current?.play("playerAttack", { seed: performance.now().toFixed(0), intensity: 0.44 });
        },
        onPlayerDamage: (amount) => {
          audioRef.current?.play("mobAttack", { seed: `mob:${amount}:${performance.now().toFixed(0)}`, intensity: 0.7 });
          audioRef.current?.play("playerHurt", { seed: `${amount}:${performance.now().toFixed(0)}`, intensity: 0.78 });
          notify("Zombie hit", `${amount} health lost.`, "warning");
        },
        onPlayerHealthChange: (health) => {
          survivalRef.current.health = health;
          setPlayerHealth(health);
          if (health <= 0) {
            notify("You were overwhelmed", "Waiting for Lakebed to authorize your respawn…", "warning");
            hungerRef.current = MAX_HUNGER;
            survivalRef.current = createSurvivalTickState(MAX_HUNGER, MAX_HEALTH);
            setHunger(MAX_HUNGER);
            scheduleAuthorizedRespawn();
          }
        },
        onBlockEdit: handleBlockEdit,
        onPoseChange: (pose) => {
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
          recentlyActiveUntilRef.current = performance.now() + 1_200;
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
            const pose = engineRef.current?.getPose();
            const bedSpawn = pose ? normalizeRespawnPoint({
              x: pose.x,
              y: pose.y,
              z: pose.z,
              yaw: pose.yaw,
              pitch: pose.pitch,
            }) : null;
            if (bedSpawn) {
              respawnPointRef.current = bedSpawn;
              setRespawnPoint(bedSpawn);
              engineRef.current?.setRespawnPoint(bedSpawn);
              notify("Spawn point set", "You will return beside this bed after death.", "success");
            }
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
        onPerformanceStats: setPerformanceStats,
      });
      engineRef.current = engine;
      if (respawnPointRef.current) engine.setRespawnPoint(respawnPointRef.current);
      setMobIds(engine.getMobIds());
      engine.start();
      return () => {
        if (respawnTimerRef.current !== null) {
          window.clearTimeout(respawnTimerRef.current);
          respawnTimerRef.current = null;
        }
        respawnRequestInFlightRef.current = false;
        engine.destroy();
        engineRef.current = null;
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
    if (!inWorld) return;
    setMobQuerySample(String(Date.now()));
    const timer = window.setInterval(() => setMobQuerySample(String(Date.now())), 200);
    return () => window.clearInterval(timer);
  }, [inWorld]);

  useEffect(() => {
    if (!mobWorldAuthority?.ok) return;
    const clockOffset = mobWorldAuthority.serverNow - Date.now();
    engineRef.current?.applyMobMotionSnapshot(mobWorldAuthority.poses, clockOffset);
    engineRef.current?.applyMobCombatStates(mobWorldAuthority.states, clockOffset);

    const leaseId = mobLeaseSessionId;
    const mayCheckpoint = mobWorldAuthority.leaseOwnerUserId === ""
      || mobWorldAuthority.leaseOwnerUserId === auth.userId
      || mobWorldAuthority.leaseExpiresAt <= mobWorldAuthority.serverNow;
    if (mobWorldAuthority.needsCheckpoint && mayCheckpoint && leaseId && !mobCheckpointInFlightRef.current) {
      mobCheckpointInFlightRef.current = true;
      void checkpointMobWorld(JSON.stringify({
        leaseId,
        expectedRevision: mobWorldAuthority.checkpointRevision,
      })).then((result) => {
        setConnected(true);
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
      void claimMobPlayerDamage(JSON.stringify(claim)).then((result) => {
        setConnected(result.ok);
        if (result.ok && result.damage > 0) {
          audioRef.current?.play("mobAttack", { seed: claim.operationId, intensity: 0.82 });
          notify(
            result.killed ? "You were overwhelmed" : "Monster hit",
            result.killed ? "Lakebed confirmed your death." : `${result.damage} health lost.`,
            "warning",
          );
        }
      }).catch(() => {
        mobDamageClaimsRef.current.delete(claim.operationId);
        setConnected(false);
      });
    }
  }, [mobWorldAuthority, mobLeaseSessionId, auth.userId]);

  useEffect(() => {
    if (!inWorld || !playerCombatResult?.ok || !engineRef.current) return;
    const ownState = playerCombatResult.states.find((state) => state.userId === auth.userId);
    if (!ownState) return;
    const previous = appliedOwnCombatHealthRef.current;
    appliedOwnCombatHealthRef.current = ownState.health;
    if (previous === null) {
      if (ownState.health < MAX_HEALTH) engineRef.current.adjustPlayerHealth(ownState.health - MAX_HEALTH);
      return;
    }
    if (ownState.health !== previous) {
      if (ownState.health < previous) {
        audioRef.current?.play("playerHurt", { seed: `${ownState.revision}:${ownState.health}`, intensity: 0.8 });
      }
      engineRef.current.adjustPlayerHealth(ownState.health - previous);
    }
  }, [playerCombatResult, inWorld, auth.userId]);

  useEffect(() => {
    if (!inWorld || !inventoryReady) return;
    let lastTickAt = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = Math.max(0, (now - lastTickAt) / 1_000);
      lastTickAt = now;
      const activityMultiplier = now < recentlyActiveUntilRef.current ? 2 : 0.5;
      const result = tickSurvival(survivalRef.current, elapsedSeconds, activityMultiplier);
      survivalRef.current = result.state;
      if (result.state.hunger !== hungerRef.current) {
        hungerRef.current = result.state.hunger;
        setHunger(result.state.hunger);
      }
      const healthDelta = result.healthRecovered - result.starvationDamage;
      if (healthDelta !== 0) engineRef.current?.adjustPlayerHealth(healthDelta);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [inWorld, inventoryReady]);

  useEffect(() => {
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
  }, [worldEvents, worldChunks, worldChunkKeys]);

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

  useEffect(() => {
    const active = activePlayerPresences(presenceEvents).filter((player) => player.userId !== auth.userId);
    const remotes: RemotePlayer[] = active.map((player) => {
      const velocity = parsePresenceVelocityFields(player);
      const appearance = normalizeAvatarAppearance(
        player.heldItem,
        player.armorHead,
        player.armorChest,
        player.armorLegs,
        player.armorFeet,
      );
      return {
        id: player.userId,
        name: player.displayName,
        x: Number(player.x),
        y: Number(player.y),
        z: Number(player.z),
        yaw: Number(player.yaw),
        pitch: Number(player.pitch),
        vx: velocity.vx,
        vy: velocity.vy,
        vz: velocity.vz,
        heldItem: appearance.heldItem || null,
        armorHead: appearance.armorHead || null,
        armorChest: appearance.armorChest || null,
        armorLegs: appearance.armorLegs || null,
        armorFeet: appearance.armorFeet || null,
        color: remoteColor(player.color),
      };
    }).filter((player) => [player.x, player.y, player.z, player.yaw, player.pitch].every(Number.isFinite));
    realtimePresenceRef.current = remotes.length > 0;
    engineRef.current?.setRemotePlayers(remotes);
  }, [presenceEvents, auth.userId]);

  useEffect(() => {
    if (!inWorld || auth.isLoading || !auth.isAuthenticated || auth.isGuest || !profile) return;
    const scheduler = createPresenceSchedulerState();
    const guard = loadPresenceBurstGuard(auth.userId, Date.now());
    const presenceSessionId = crypto.randomUUID();
    setMobLeaseSessionId(presenceSessionId);
    presenceSchedulerRef.current = scheduler;
    presenceBurstGuardRef.current = guard;
    presenceModeNoticeRef.current = "";
    let writeInFlight = false;
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
          `Repeated or quota-like rejections stopped retries. Budget recovery is in ${Math.max(1, Math.ceil(snapshot.windowResetsInMs / 3_600_000))}h.`,
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
    const samplePresence = (pose: PlayerPose, at = Date.now()) => {
      poseRef.current = pose;
      if (writeInFlight) return;
      const guardSnapshot = announceTransportMode(at);
      if (!guardSnapshot.canAttempt) return;
      const realtime = realtimePresenceRef.current && guardSnapshot.realtimeRemaining > 0;
      const decision = stepPresenceScheduler(scheduler, { ...pose, at }, realtime);
      if (!decision.send) return;
      if (!reservePresenceAttempt(guard, at, realtime)) return;
      announceTransportMode(at);
      const worn = equipmentRef.current;
      const appearance = normalizeAvatarAppearance(
        inventoryRef.current[selectedRef.current]?.itemId,
        worn.head,
        worn.chest,
        worn.legs,
        worn.feet,
      );
      writeInFlight = true;
      void heartbeatPlayer(
        profile.username,
        playerColor(auth.userId),
        String(pose.x),
        String(pose.y),
        String(pose.z),
        String(pose.yaw),
        String(pose.pitch),
        String(at),
        decision.fields.vx,
        decision.fields.vy,
        decision.fields.vz,
        appearance.heldItem,
        appearance.armorHead,
        appearance.armorChest,
        appearance.armorLegs,
        appearance.armorFeet,
        presenceSessionId,
      ).then((result) => {
        if (result && !result.ok) {
          const canonicalPose = result.canonicalPose
            ? validateRespawnPoint(result.canonicalPose, Number.MAX_SAFE_INTEGER)
            : null;
          if (canonicalPose) {
            engineRef.current?.reconcilePose(canonicalPose);
            Object.assign(scheduler, createPresenceSchedulerState());
          }
          setConnected(false);
          return;
        }
        recordPresenceSuccess(guard, Date.now());
        setConnected(true);
      }).catch((error: unknown) => {
        recordPresenceFailure(guard, Date.now(), classifyPresenceTransportError(error));
        announceTransportMode(Date.now());
        setConnected(false);
      }).finally(() => {
        persistPresenceBurstGuard(auth.userId, guard);
        writeInFlight = false;
      });
    };
    let cancelled = false;
    let interval = 0;
    let startRetryTimer = 0;
    const beginPresenceSession = () => {
      void startPresenceSession(presenceSessionId).then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error(result.reason ?? "presence session rejected");
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
      }).catch(() => {
        if (cancelled) return;
        setConnected(false);
        startRetryTimer = window.setTimeout(beginPresenceSession, 1_000);
      });
    };
    beginPresenceSession();
    return () => {
      cancelled = true;
      setMobLeaseSessionId((current) => current === presenceSessionId ? "" : current);
      if (presenceSampleRef.current === samplePresence) presenceSampleRef.current = null;
      if (interval) window.clearInterval(interval);
      if (startRetryTimer) window.clearTimeout(startRetryTimer);
      void leavePlayer(presenceSessionId).catch(() => undefined);
    };
  }, [inWorld, auth.userId, auth.isLoading, auth.isAuthenticated, auth.isGuest, profile?.username]);

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
    const resultItems = droppedItemsResult?.ok && Array.isArray(droppedItemsResult.items) ? droppedItemsResult.items : [];
    engineRef.current?.setDroppedItems(resultItems);
  }, [inWorld, inventoryReady, droppedItemsResult]);

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
      if (event.code === "F3" && !event.repeat) {
        event.preventDefault();
        setShowPerformance((shown) => !shown);
        return;
      }
      if (chatOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setChatOpen(false);
          setLastSeenChatCount(chatEvents.length);
          engineRef.current?.requestPointerLock();
        }
        return;
      }
      if ((inventoryOpen || furnaceOpen) && event.code === "Escape") {
        event.preventDefault();
        if (furnaceOpen && furnaceBusyRef.current) return;
        closeInventory();
        engineRef.current?.requestPointerLock();
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
        setLastSeenChatCount(chatEvents.length);
        setChatError("");
        return;
      }
      if (/^Digit[1-9]$/.test(event.code)) setSelectedHotbar(clampHotbarIndex(Number(event.code.slice(5)) - 1));
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        if (!hydratedRef.current) return;
        if (inventoryOpen || furnaceOpen) {
          if (furnaceOpen && furnaceBusyRef.current) return;
          closeInventory();
          engineRef.current?.requestPointerLock();
        } else {
          activeWorkstationRef.current = null;
          setCraftingContext("field");
          exitPointerLockForUi();
          setInventoryOpen(true);
        }
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
  }, [inWorld, pauseOpen, activeChestKey, activeBedKey, chatOpen, inventoryOpen, furnaceOpen, chatEvents.length]);

  const playerListEntries = activePlayers.map((player) => ({
    id: player.userId,
    name: player.displayName,
    isSelf: player.userId === auth.userId,
    connected: player.online,
  }));
  if (profile && !playerListEntries.some(({ isSelf }) => isSelf)) {
    playerListEntries.unshift({ id: auth.userId, name: profile.username, isSelf: true, connected });
  }

  function handleCraft(recipe: Recipe) {
    if (!hydratedRef.current || pendingWorldBlockEditRef.current) return;
    const result = craftRecipe(inventoryRef.current, recipe, craftingContext);
    if (!result.ok) {
      const detail = result.reason === "inventory_full"
        ? "Make room in your pack first."
        : result.reason === "requires_crafting_table"
          ? "Place and use a crafting table for advanced recipes."
          : "Gather the marked ingredients.";
      notify("Recipe unavailable", detail, "warning");
      return;
    }
    updateInventory(result.inventory);
    audioRef.current?.play("craft", { seed: `${recipe.id}:${result.crafted.count}`, intensity: 0.72, surface: "wood" });
    notify(`Made ${ITEMS[result.crafted.itemId].label}`, `Added ${result.crafted.count} to your field kit.`, "success");
  }

  async function handleFurnaceTransfer(action: FurnaceTransferAction): Promise<void> {
    if (!hydratedRef.current || !activeFurnaceKey || furnaceBusyRef.current
      || pendingWorldBlockEditRef.current || chestBusyRef.current) return;
    setFurnaceOperationBusy(true);
    setFurnaceError("");
    try {
      await requestInventorySave(false, false, true);
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
        inventorySavePendingRef.current = false;
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
      if (inventorySavePendingRef.current && !chestBusyRef.current && !pendingWorldBlockEditRef.current) {
        inventorySavePendingRef.current = false;
        void requestInventorySave();
      }
    }
  }

  function handleUseItem(inventoryIndex = selectedRef.current): boolean {
    if (pendingWorldBlockEditRef.current) return false;
    const result = consumeFood(inventoryRef.current, inventoryIndex, hungerRef.current);
    if (!result.ok) {
      if (result.reason === "hunger_full") notify("You are already full", "Save that food for later.");
      return false;
    }
    updateInventory(result.inventory);
    hungerRef.current = result.hunger;
    survivalRef.current.hunger = result.hunger;
    setHunger(result.hunger);
    notify(`Ate ${ITEMS[result.consumed].label}`, `Restored ${result.restored} hunger.`, "success");
    return true;
  }

  function handleEquipArmor(index: number) {
    if (pendingWorldBlockEditRef.current) return;
    const equippedItem = inventory[index]?.itemId;
    const result = equipArmorFromInventory(inventory, equipment, index);
    if (!result.ok) return;
    updateInventory(result.inventory);
    setEquipment(result.equipment);
    notify("Armor equipped", equippedItem ? ITEMS[equippedItem].label : undefined, "success");
  }

  function handleUnequipArmor(slot: ArmorSlot) {
    if (pendingWorldBlockEditRef.current) return;
    const result = unequipArmor(inventory, equipment, slot);
    if (!result.ok) {
      if (result.reason === "inventory_full") notify("Pack is full", "Clear a pocket before removing armor.", "warning");
      return;
    }
    updateInventory(result.inventory);
    setEquipment(result.equipment);
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
        inventorySavePendingRef.current = false;
        setChestOperationBusy(false);
        if (!playerLoaded || !chestLoaded) {
          setChestError("The transfer committed, but its canonical state could not be displayed. Reopen the chest to reconcile.");
          return;
        }
        setChestError("");
        audioRef.current?.play("uiConfirm", { seed: `${result.moved.itemId}:${result.moved.count}:${result.chest.updatedAt}`, intensity: 0.55, surface: "wood" });
        notify(
          result.replayed ? "Chest transfer reconciled" : "Chest transfer committed",
          `${result.moved.count} ${ITEMS[result.moved.itemId].label} moved atomically through Lakebed.`,
          "success",
        );
        return;
      }
      pendingChestTransferRef.current = null;
      chestTransferActiveRef.current = false;
      inventorySavePendingRef.current = false;
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
      if (currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current) void requestInventorySave();
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
    const inFlightSave = inventorySavePromiseRef.current;
    if (inFlightSave) await inFlightSave;
    for (let attempt = 0; attempt < 3 && currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current; attempt += 1) {
      await requestInventorySave(true);
    }
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
        notify("Dawn breaks over Fern Hollow", "The shared Lakebed clock advanced to morning.", "success");
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

  function enterWorld() {
    if (!profile) return;
    setJoinPhase("joining");
    window.setTimeout(() => {
      if (!hydratedRef.current || savedPresence === undefined) {
        setJoinPhase("waiting");
        return;
      }
      setJoinPhase("ready");
      window.setTimeout(() => {
        setInWorld(true);
        setPauseOpen(true);
        setJoinPhase("idle");
      }, 180);
    }, 260);
  }

  useEffect(() => {
    if (joinPhase !== "waiting" || !inventoryReady || savedPresence === undefined || !profile) return;
    setJoinPhase("ready");
    const timer = window.setTimeout(() => {
      setInWorld(true);
      setPauseOpen(true);
      setJoinPhase("idle");
    }, 180);
    return () => window.clearTimeout(timer);
  }, [joinPhase, inventoryReady, savedPresence, profile?.id]);

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
    setChatSending(true);
    setChatError("");
    void sendChat(value).then((result) => {
      if (result.ok) {
        setChatDraft("");
        setLastSeenChatCount(chatEvents.length + 1);
        return;
      }
      if (result.reason === "rate_limited") {
        setChatError(`Slow down — try again in ${Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 100) / 10)}s.`);
      } else if (result.reason === "too_long") {
        setChatError(`Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`);
      } else if (result.reason === "profile_required") {
        setChatError("Choose an explorer tag before chatting.");
      } else {
        setChatError("Lakebed could not send that message.");
      }
    }).catch(() => setChatError("Chat lost contact with Lakebed. Try again.")).finally(() => setChatSending(false));
  }

  const signedIn = auth.isAuthenticated && !auth.isGuest;
  const lobbyAuthState = auth.isLoading || (signedIn && profile === undefined)
    ? "loading"
    : !signedIn
      ? "signed_out"
      : profile
        ? "ready"
        : "needs_username";
  const chatMessages: LakecraftChatMessage[] = chatEvents.map((message) => ({
    id: message.id,
    username: message.username,
    body: message.message,
    sentAt: Number(message.sentAt),
    own: message.userId === auth.userId,
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

  if (!inWorld) {
    return (
      <LobbyScreen
        authState={lobbyAuthState}
        buildLabel="MULTIPLAYER ALPHA"
        displayName={profile?.username ?? auth.displayName}
        email={auth.email}
        joinPhase={joinPhase}
        onlineCount={activePlayers.length}
        onJoinWorld={enterWorld}
        onSignInWithGoogle={() => {
          setUsernameError("");
          void signInWithGoogle().catch(() => {
            setUsernameState("error");
            setUsernameError("Google sign-in could not start. Please try again.");
          });
        }}
        onSignOut={() => {
          signOut();
          updateInventory(createStarterInventory());
          const emptyEquipment = createEmptyEquipment();
          equipmentRef.current = emptyEquipment;
          setEquipment(emptyEquipment);
          respawnPointRef.current = null;
          setRespawnPoint(null);
          hungerRef.current = MAX_HUNGER;
          survivalRef.current = createSurvivalTickState();
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
          inventorySessionRef.current += 1;
          lastCommittedPlayerJsonRef.current = "";
          inventorySavePendingRef.current = false;
          pendingChestTransferRef.current = null;
          pendingWorldBlockEditRef.current = null;
          deferredMobDropsRef.current.length = 0;
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
        worldDescription="One persistent world, synchronized through Lakebed even though Lakebed was absolutely not designed for this."
        worldName="Fern Hollow"
        worldStatus="online"
      />
    );
  }

  return (
    <main className="lakecraft-shell">
      <style>{APP_CSS}</style>
      <canvas aria-label="Lakecraft voxel world" className="lakecraft-world" data-testid="voxel-world" ref={canvasRef} tabIndex={0} />

      <GameHud
        connected={connected}
        equipment={equipment}
        craftingContext={craftingContext}
        health={playerHealth}
        hunger={hunger}
        maxHunger={MAX_HUNGER}
        inventory={inventory}
        inventoryOpen={inventoryOpen}
        miningProgress={miningProgress}
        handActionToken={handActionToken}
        hideFirstPersonFeedback={chatOpen || furnaceOpen || Boolean(activeChestKey) || Boolean(activeBedKey)}
        messages={messages}
        mobileUnsupported={mobileUnsupported}
        onlineCount={Math.max(1, activePlayers.length)}
        onCloseInventory={() => {
          closeInventory();
          engineRef.current?.requestPointerLock();
        }}
        onContinueMobile={() => setMobileUnsupported(false)}
        onCraft={handleCraft}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onDisconnect={() => {
          void requestInventorySave();
          void leavePlayer(String(Date.now())).catch(() => undefined);
          exitPointerLockForUi();
          setPauseOpen(false);
          setShowPlayerList(false);
          setInWorld(false);
          setChatOpen(false);
          closeInventory();
          setActiveChestKey("");
          setActiveBedKey("");
          setMobIds([]);
        }}
        onEquipArmor={handleEquipArmor}
        onOptions={() => notify("Options", "Controls and graphics settings are coming next.")}
        soundMuted={soundMuted}
        onToggleSound={() => {
          const next = !soundMuted;
          audioRef.current?.setMuted(next);
          setSoundMuted(next);
          if (!next) {
            void audioRef.current?.unlock().then(() => {
              audioRef.current?.play("uiConfirm", { seed: "sound-on", intensity: 0.52 });
            });
          }
        }}
        onResume={() => {
          setPauseOpen(false);
          engineRef.current?.requestPointerLock();
        }}
        onSelectHotbar={(index) => setSelectedHotbar(clampHotbarIndex(index))}
        onUnequipArmor={handleUnequipArmor}
        onUseItem={(inventoryIndex) => { handleUseItem(inventoryIndex); }}
        playerName={profile?.username ?? auth.displayName}
        pauseOpen={pauseOpen}
        players={playerListEntries}
        roomCode="FERN-01"
        selectedIndex={selectedHotbar}
        showPlayerList={showPlayerList}
        worldName="Fern Hollow"
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
        connected={connected}
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
        sending={chatSending}
        unreadCount={unreadChat}
      />

      {showPerformance && performanceStats ? (
        <output className="lakecraft-perf" aria-label="Performance statistics">{`FPS ${performanceStats.fps.toFixed(0)}  p95 ${performanceStats.p95FrameTimeMs.toFixed(1)}ms\nXYZ ${poseRef.current.x.toFixed(1)} / ${poseRef.current.y.toFixed(1)} / ${poseRef.current.z.toFixed(1)}\nDRAW ${performanceStats.drawCalls}  CHUNKS ${performanceStats.visibleChunkCount}/${performanceStats.chunkCount}\nPLAYERS ${performanceStats.remoteVisiblePlayers}  REMOTE ${performanceStats.remoteMeshMs.toFixed(2)}ms / ${(performanceStats.remoteUploadBytes / 1024).toFixed(0)}KB\nSYNC ${presenceTelemetry.mode.toUpperCase()} ${presenceCadence} · RT ${presenceTelemetry.realtimeRemaining}/${PRESENCE_REALTIME_BURST_WRITES} · DAY ${presenceTelemetry.sessionRemaining}/${PRESENCE_SESSION_WRITE_BUDGET} · OK ${presenceTelemetry.confirmedCount}/${presenceTelemetry.attemptCount}\nDROPS ${performanceStats.droppedItemVisibleCount}/${performanceStats.droppedItemCount}  ${performanceStats.droppedItemMeshMs.toFixed(2)}ms / ${(performanceStats.droppedItemUploadBytes / 1024).toFixed(0)}KB\nMOBS ${performanceStats.mobVisibleCount}/${performanceStats.mobCount}  AI ${performanceStats.mobSimulationMs.toFixed(2)}ms\nPFX ${performanceStats.activeParticleCount}  DRAW ${performanceStats.particleDrawCalls}  ${(performanceStats.particleUploadBytes / 1024).toFixed(0)}KB\nLIGHT ${performanceStats.activeTorchLights}/${performanceStats.torchCount} torches\nVERT ${performanceStats.worldVertexCount.toLocaleString()}  MESH ${performanceStats.lastMeshRebuildMs.toFixed(1)}ms`}</output>
      ) : null}

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </main>
  );
}
