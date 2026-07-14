import { signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChatOverlay, type LakecraftChatMessage } from "./chat";
import { ChestDrawer, FurnaceDrawer, GameHud, type ChestTransferDirection, type HudMessage } from "./components";
import { isCraftingTableWithinReach as isWorkstationWithinReach, type CraftingTablePosition as WorkstationPosition } from "./crafting";
import {
  BLOCK,
  createVoxelEngine,
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
  MAX_HUNGER,
  addItem,
  attackDamage,
  canHarvestBlock,
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
  getMiningDrop,
  miningSeconds,
  normalizeEquipment,
  normalizeInventory,
  normalizeRespawnPoint,
  parseSerializablePlayerStateJson,
  removeItem,
  smeltRecipe,
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
  type SmeltingRecipe,
  type SurvivalTickState,
} from "../shared/game";
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
import {
  activePlayerPresences,
  blockCoordinateKey,
  latestWorldEdits,
  type PersistedInventory,
  type PlayerPresence,
  type WorldEdit,
} from "../shared/protocol";
import {
  PRESENCE_MAX_WRITES_PER_MINUTE,
  createPresenceSchedulerState,
  parsePersistedPresencePose,
  parsePresenceVelocityFields,
  stepPresenceScheduler,
  type PresenceSchedulerState,
} from "../shared/presenceMotion";
import { type SleepInBedResult, type WorldClockSnapshot } from "../shared/sleep";
import {
  MAX_MOB_ATTACK_DAMAGE,
  type MobAttackResult,
  type MobAuthorityQueryResult,
} from "../shared/mobCombat";
import {
  decodeWorldChunkSnapshot,
  worldEditChunkCoordinate,
} from "../shared/worldChunks";

const APP_CSS = `
html, body, #app { height: 100%; margin: 0; overflow: hidden; }
body { background: #171b15; }
button { -webkit-tap-highlight-color: transparent; }
.lakecraft-shell { background: #171b15; height: 100%; isolation: isolate; overflow: hidden; position: relative; width: 100%; }
.lakecraft-world { cursor: crosshair; display: block; height: 100%; outline: none; width: 100%; }
.lakecraft-vignette { background: radial-gradient(circle at center, transparent 52%, rgba(13,17,12,.18) 84%, rgba(9,12,9,.48)); inset: 0; pointer-events: none; position: absolute; z-index: 8; }
.lakecraft-entry { align-items: center; background: linear-gradient(115deg, rgba(15,18,14,.86), rgba(15,18,14,.3) 52%, rgba(15,18,14,.72)); display: flex; inset: 0; justify-content: center; padding: 24px; position: absolute; z-index: 35; }
.lakecraft-entry__card { background: rgba(226,216,189,.96); box-shadow: 12px 14px 0 rgba(94,112,61,.52), 0 30px 90px rgba(0,0,0,.48); color: #24261f; max-width: 430px; padding: 32px; position: relative; transform: rotate(-.45deg); }
.lakecraft-entry__card::before { background: #667541; content: ""; height: 7px; left: 0; position: absolute; right: 0; top: 0; }
.lakecraft-entry__eyebrow { color: #9a5434; font: 10px/1.2 "Courier New", monospace; letter-spacing: .14em; text-transform: uppercase; }
.lakecraft-entry h1 { font: 900 clamp(42px, 8vw, 70px)/.84 "Trebuchet MS", sans-serif; letter-spacing: -.075em; margin: 17px 0 19px; text-transform: uppercase; }
.lakecraft-entry p { font: 12px/1.65 "Courier New", monospace; margin: 0 0 23px; max-width: 38em; }
.lakecraft-entry button { align-items: center; background: #24261f; border: 0; color: #e6dcc1; cursor: pointer; display: flex; font: 800 12px "Trebuchet MS", sans-serif; justify-content: space-between; letter-spacing: .08em; padding: 15px 17px; text-transform: uppercase; width: 100%; }
.lakecraft-entry button:hover { background: #667541; }
.lakecraft-entry button:disabled { background: #777a6d; cursor: progress; opacity: .72; }
.lakecraft-entry small { color: rgba(36,38,31,.56); display: block; font: 9px "Courier New", monospace; margin-top: 13px; }
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
@media (max-width: 700px) { .lakecraft-entry__card { padding: 27px 24px; }.lakecraft-entry h1 { font-size: 48px; } }
`;

const ENGINE_TO_PROTOCOL: Record<EngineBlockId, "air" | "grass" | "dirt" | "stone" | "coal_ore" | "iron_ore" | "wood" | "leaves" | "planks" | "crafting_table" | "furnace" | "torch" | "chest" | "door_closed" | "door_open" | "bed" | "ladder"> = {
  [BLOCK.AIR]: "air",
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
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
  coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE,
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
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
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
  coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE,
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
  | { ok: true; chunks: Array<{ chunkKey: string; snapshotJson: string; updatedAt: string }> }
  | { ok: false; reason: "invalid_chunk_keys" | "too_many_chunks"; chunks: [] };

type SaveInventoryResult =
  | { ok: true; inventory: PersistedInventoryState }
  | { ok: false; reason: "authentication_required" | "invalid_inventory" | "invalid_token" | "conflict"; inventory: PersistedInventoryState | null };

type PendingChestTransfer = { requestJson: string; transportFailures: number };

let chestOperationSequence = 0;

function createChestOperationId(): string {
  chestOperationSequence += 1;
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `lc_${Date.now().toString(36)}_${chestOperationSequence.toString(36)}_${randomPart}`.slice(0, 64);
}

const WORLD_RADIUS = 18;
const DEFAULT_PLAYER_POSE: Readonly<PlayerPose> = Object.freeze({ x: 0.5, y: 8, z: 0.5, yaw: 0, pitch: 0 });
const VISIBLE_WORLD_CHUNK_KEYS = (() => {
  const minimum = worldEditChunkCoordinate(-WORLD_RADIUS);
  const maximum = worldEditChunkCoordinate(WORLD_RADIUS);
  const keys: string[] = [];
  for (let chunkX = minimum; chunkX <= maximum; chunkX += 1) {
    for (let chunkZ = minimum; chunkZ <= maximum; chunkZ += 1) keys.push(`${chunkX}:${chunkZ}`);
  }
  return keys;
})();

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
  const worldEvents = useQuery<WorldEdit[]>("worldEdits") ?? [];
  const worldChunks = useQuery<WorldChunksQueryResult, string[]>("worldChunks", VISIBLE_WORLD_CHUNK_KEYS);
  const [activeSince] = useState(() => String(Date.now() - 30_000));
  const presenceEvents = useQuery<PlayerPresence[], string>("recentPlayers", activeSince) ?? [];
  const savedPresence = useQuery<PlayerPresence | null>("myPresence");
  const savedInventory = useQuery<PersistedInventory | null>("myInventory");
  const profile = useQuery<Profile | null>("myProfile");
  const chatEvents = useQuery<ChatMessage[]>("recentChat") ?? [];
  const chestResult = useQuery<ChestAtResult, string>("chestAt", activeChestKey);
  const worldClock = useQuery<WorldClockSnapshot>("worldClock");
  const [mobIds, setMobIds] = useState<string[]>([]);
  const mobAuthority = useQuery<MobAuthorityQueryResult, string[]>("mobAuthority", mobIds);

  const setBlock = useMutation<[coordKey: string, x: string, y: string, z: string, blockType: string], void>("setBlock");
  const removeBlockMutation = useMutation<[coordKey: string, x: string, y: string, z: string], void>("removeBlock");
  const heartbeatPlayer = useMutation<[displayName: string, color: string, x: string, y: string, z: string, yaw: string, pitch: string, heartbeatAt: string, vx: string, vy: string, vz: string], void>("heartbeatPlayer");
  const leavePlayer = useMutation<[heartbeatAt: string], void>("leavePlayer");
  const saveInventory = useMutation<[inventoryJson: string, expectedUpdatedAt: string], SaveInventoryResult>("saveInventory");
  const claimUsername = useMutation<[requestedUsername: string], ClaimUsernameResult>("claimUsername");
  const sendChat = useMutation<[rawMessage: string], SendChatResult>("sendChat");
  const transferChest = useMutation<[requestJson: string], ChestTransferResult>("transferChest");
  const sleepInBed = useMutation<[coordKey: string], SleepInBedResult>("sleepInBed");
  const attackMob = useMutation<[mobId: string, kind: string, damage: string], MobAttackResult>("attackMob");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const poseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const presenceSampleRef = useRef<((pose: PlayerPose, at?: number) => void) | null>(null);
  const presenceSchedulerRef = useRef<PresenceSchedulerState | null>(null);
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
  const inventorySessionRef = useRef(0);
  const lastCommittedPlayerJsonRef = useRef("");
  const inventorySavePromiseRef = useRef<Promise<void> | null>(null);
  const inventorySavePendingRef = useRef(false);
  const chestTokenRef = useRef("");
  const chestInventoryRef = useRef<Inventory>(createEmptyInventory(CHEST_SLOT_COUNT));
  const chestBusyRef = useRef(false);
  const chestTransferActiveRef = useRef(false);
  const pendingChestTransferRef = useRef<PendingChestTransfer | null>(null);
  const activeWorkstationRef = useRef<{ kind: "crafting_table" | "furnace"; position: WorkstationPosition } | null>(null);
  const toastCounter = useRef(0);

  if (!presenceSchedulerRef.current) presenceSchedulerRef.current = createPresenceSchedulerState();

  const [inventory, setInventory] = useState<Inventory>(() => createStarterInventory());
  const [equipment, setEquipment] = useState<Equipment>(() => createEmptyEquipment());
  const [respawnPoint, setRespawnPoint] = useState<PlayerRespawnPoint | null>(null);
  const [hunger, setHunger] = useState(MAX_HUNGER);
  const [selectedHotbar, setSelectedHotbar] = useState(2);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [furnaceOpen, setFurnaceOpen] = useState(false);
  const [furnaceStatus, setFurnaceStatus] = useState("Choose a firing. One coal smelts up to eight matching items.");
  const [furnaceError, setFurnaceError] = useState("");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [mobileUnsupported, setMobileUnsupported] = useState(false);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [engineError, setEngineError] = useState("");
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [inWorld, setInWorld] = useState(false);
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
  const [chestInventory, setChestInventory] = useState<Inventory>(() => createEmptyInventory(CHEST_SLOT_COUNT));
  const [chestBusy, setChestBusy] = useState(false);
  const [chestError, setChestError] = useState("");
  const [chestRetryAvailable, setChestRetryAvailable] = useState(false);
  const [activeBedKey, setActiveBedKey] = useState("");
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepStatus, setSleepStatus] = useState("Rest until every active explorer is in bed, then Lakebed will move the shared clock to morning.");

  function notify(text: string, detail?: string, tone: HudMessage["tone"] = "info") {
    const id = `note-${++toastCounter.current}`;
    setMessages((current) => [...current.slice(-2), { id, text, detail, tone }]);
    window.setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), 3_500);
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
  }

  function closeInventory() {
    activeWorkstationRef.current = null;
    setCraftingContext("field");
    setInventoryOpen(false);
    setFurnaceOpen(false);
    setFurnaceError("");
  }

  function setChestOperationBusy(next: boolean) {
    chestBusyRef.current = next;
    setChestBusy(next);
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
      lastCommittedPlayerJsonRef.current = "";
      return true;
    }
    const saved = parseSerializablePlayerStateJson(row.inventoryJson);
    if (!saved) return false;
    inventoryTokenRef.current = row.updatedAt;
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

  function requestInventorySave(allowWhileChestBusy = false): Promise<void> {
    if (chestBusyRef.current && !allowWhileChestBusy) {
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
        if (inventorySavePendingRef.current && !chestBusyRef.current) {
          inventorySavePendingRef.current = false;
          void requestInventorySave();
        }
      }
    })();
    inventorySavePromiseRef.current = task;
    return task;
  }

  function collectMobDrops(drops: readonly { itemId: string; count: number }[]) {
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

  function handleBlockEdit(edit: EngineWorldEdit, previousBlock: EngineBlockId) {
    const key = blockCoordinateKey(edit.x, edit.y, edit.z);
    if (edit.block === BLOCK.AIR) {
      const gameBlock = ENGINE_TO_GAME[previousBlock];
      let droppedItem: ItemId | null = null;
      let droppedCount = 0;
      if (gameBlock) {
        const heldItem = inventoryRef.current[selectedRef.current]?.itemId;
        const drop = getMiningDrop(gameBlock, heldItem);
        if (drop) {
          const added = addItem(inventoryRef.current, drop.itemId, drop.count);
          droppedItem = drop.itemId;
          droppedCount = drop.count - added.remainder;
          updateInventory(added.inventory);
          notify(`Collected ${ITEMS[drop.itemId].label}`, added.remainder ? "Your pack is full." : "Added to the field kit.", added.remainder ? "warning" : "success");
        } else if (!canHarvestBlock(gameBlock, heldItem)) {
          const unavailableDrop = BLOCKS[gameBlock].drop;
          notify(`No ${unavailableDrop ? ITEMS[unavailableDrop].label : BLOCKS[gameBlock].label} recovered`, miningRequirementDetail(gameBlock), "warning");
        }
      }
      void removeBlockMutation(key, String(edit.x), String(edit.y), String(edit.z)).then(() => setConnected(true)).catch(() => {
        engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
        if (droppedItem && droppedCount) updateInventory(removeItem(inventoryRef.current, droppedItem, droppedCount).inventory);
        setConnected(false);
        notify("Mine rolled back", "Lakebed rejected the save, so the block and field kit were restored.", "warning");
      });
      return;
    }

    const selected = inventoryRef.current[selectedRef.current];
    const placedItem = selected && ITEM_TO_ENGINE[selected.itemId] === edit.block ? selected.itemId : null;
    if (placedItem) {
      updateInventory(removeItem(inventoryRef.current, selected.itemId, 1).inventory);
    }
    void setBlock(key, String(edit.x), String(edit.y), String(edit.z), ENGINE_TO_PROTOCOL[edit.block]).then(() => setConnected(true)).catch(() => {
      engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
      if (placedItem) updateInventory(addItem(inventoryRef.current, placedItem, 1).inventory);
      setConnected(false);
      notify("Placement rolled back", "Lakebed rejected the save, so the block and field kit were restored.", "warning");
    });
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
    if (!hydratedRef.current || !auth.isAuthenticated || auth.isGuest) return;
    const timer = window.setTimeout(() => {
      void requestInventorySave();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inventory, selectedHotbar, equipment, respawnPoint, hunger, auth.isAuthenticated, auth.isGuest]);

  useEffect(() => {
    if (!inWorld || !inventoryReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const resumedPresencePose = savedPresence ? parsePersistedPresencePose(savedPresence) : null;
      if (resumedPresencePose) poseRef.current = resumedPresencePose;
      const engine = createVoxelEngine(canvas, {
        initialPose: resumedPresencePose ?? poseRef.current,
        worldRadius: WORLD_RADIUS,
        dayNight: worldClock ? {
          cycleLengthMs: worldClock.cycleLengthMs,
          epochMs: worldClock.epochMs,
          epochPhase: worldClock.epochPhase,
        } : undefined,
        serverTimeOffsetMs: worldClock ? worldClock.serverNow - Date.now() : 0,
        selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
        getMiningDuration: (block) => {
          const gameBlock = ENGINE_TO_GAME[block];
          const heldItem = inventoryRef.current[selectedRef.current]?.itemId;
          return gameBlock ? miningSeconds(gameBlock, heldItem) : 0.2;
        },
        getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
        getPlayerProtection: () => equippedArmorProtection(equipmentRef.current),
        onUseSelectedItem: () => handleUseItem(),
        onMobAttack: (target, damage) => {
          void attackMob(target.id, target.kind, String(Math.max(1, Math.min(MAX_MOB_ATTACK_DAMAGE, Math.floor(damage))))).then((result) => {
            setConnected(true);
            if (result.state) {
              engineRef.current?.applyMobCombatStates([result.state], result.serverNow - Date.now());
            }
            if (result.ok && result.killed && result.drops.length) collectMobDrops(result.drops);
          }).catch(() => {
            setConnected(false);
            notify("Attack lost contact", "Lakebed could not confirm that hit.", "warning");
          });
        },
        onMobDrops: collectMobDrops,
        onPlayerDamage: (amount) => notify("Zombie hit", `${amount} health lost.`, "warning"),
        onPlayerHealthChange: (health) => {
          survivalRef.current.health = health;
          setPlayerHealth(health);
          if (health <= 0) {
            notify("You were overwhelmed", "Respawning at the trailhead…", "warning");
            window.setTimeout(() => engineRef.current?.respawn(), 900);
          }
        },
        onBlockEdit: handleBlockEdit,
        onPoseChange: (pose) => {
          poseRef.current = pose;
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
        onPointerLockChange: setPointerLocked,
        onInteractBlock: (target) => {
          const key = blockCoordinateKey(target.block.x, target.block.y, target.block.z);
          closeInventory();
          setChatOpen(false);
          if (document.pointerLockElement) document.exitPointerLock();
          if (target.block.block === BLOCK.CRAFTING_TABLE) {
            activeWorkstationRef.current = { kind: "crafting_table", position: { x: target.block.x, y: target.block.y, z: target.block.z } };
            setCraftingContext("crafting_table");
            setInventoryOpen(true);
            return true;
          }
          if (target.block.block === BLOCK.FURNACE) {
            activeWorkstationRef.current = { kind: "furnace", position: { x: target.block.x, y: target.block.y, z: target.block.z } };
            setFurnaceStatus("Choose a firing. One coal smelts up to eight matching items.");
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
    if (!mobAuthority?.ok) return;
    engineRef.current?.applyMobCombatStates(
      mobAuthority.states,
      mobAuthority.serverNow - Date.now(),
    );
  }, [mobAuthority]);

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
    engineRef.current?.applyWorldEdits([
      ...toEngineEdits(worldEvents),
      ...chunkSnapshotsToEngineEdits(worldChunks),
    ]);
  }, [worldEvents, worldChunks]);

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
        color: remoteColor(player.color),
      };
    }).filter((player) => [player.x, player.y, player.z, player.yaw, player.pitch].every(Number.isFinite));
    engineRef.current?.setRemotePlayers(remotes);
  }, [presenceEvents, auth.userId]);

  useEffect(() => {
    if (!inWorld || auth.isLoading || !auth.isAuthenticated || auth.isGuest || !profile) return;
    const scheduler = createPresenceSchedulerState();
    presenceSchedulerRef.current = scheduler;
    let writeInFlight = false;
    const samplePresence = (pose: PlayerPose, at = Date.now()) => {
      poseRef.current = pose;
      if (writeInFlight) return;
      const decision = stepPresenceScheduler(scheduler, { ...pose, at });
      if (!decision.send) return;
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
      ).then(() => setConnected(true)).catch(() => setConnected(false)).finally(() => {
        writeInFlight = false;
      });
    };
    presenceSampleRef.current = samplePresence;
    samplePresence(engineRef.current?.getPose() ?? poseRef.current);
    const interval = window.setInterval(() => {
      samplePresence(engineRef.current?.getPose() ?? poseRef.current);
    }, 250);
    return () => {
      if (presenceSampleRef.current === samplePresence) presenceSampleRef.current = null;
      window.clearInterval(interval);
      void leavePlayer(String(Date.now())).catch(() => undefined);
    };
  }, [inWorld, auth.userId, auth.isLoading, auth.isAuthenticated, auth.isGuest, profile?.username]);

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
      if (activeChestKey || activeBedKey) {
        if (event.code === "Escape" || event.code === "KeyE") {
          event.preventDefault();
          if (activeChestKey && chestBusyRef.current) return;
          setActiveChestKey("");
          setActiveBedKey("");
          setChestError("");
          setChestRetryAvailable(false);
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
        }
        return;
      }
      if ((inventoryOpen || furnaceOpen) && event.code === "Escape") {
        event.preventDefault();
        closeInventory();
        return;
      }
      if ((event.code === "KeyT" || event.code === "Enter") && !event.repeat && !inventoryOpen && !furnaceOpen) {
        event.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
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
          closeInventory();
        } else {
          activeWorkstationRef.current = null;
          setCraftingContext("field");
          if (document.pointerLockElement) document.exitPointerLock();
          setInventoryOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inWorld, activeChestKey, activeBedKey, chatOpen, inventoryOpen, furnaceOpen, chatEvents.length]);

  const activePlayers = activePlayerPresences(presenceEvents);

  function handleCraft(recipe: Recipe) {
    if (!hydratedRef.current) return;
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
    notify(`Made ${ITEMS[result.crafted.itemId].label}`, `Added ${result.crafted.count} to your field kit.`, "success");
  }

  function handleSmelt(recipe: SmeltingRecipe) {
    if (!hydratedRef.current) return;
    const result = smeltRecipe(inventoryRef.current, recipe);
    if (!result.ok) {
      const detail = result.reason === "missing_fuel"
        ? "Mine coal ore with a wooden pickaxe or better."
        : result.reason === "missing_input"
          ? "Bring raw ore or uncooked meat to the furnace."
          : result.reason === "inventory_full"
            ? "Make room in your pack before firing the furnace."
            : "That firing is not available.";
      setFurnaceError(detail);
      notify("Furnace could not fire", detail, "warning");
      return;
    }
    updateInventory(result.inventory);
    const output = ITEMS[result.smelted.itemId];
    const detail = `${result.smelted.count} ${output.label} returned to your pack · ${result.fuelConsumed} coal burned.`;
    setFurnaceError("");
    setFurnaceStatus(detail);
    notify(`Smelted ${output.label}`, detail, "success");
  }

  function handleUseItem(inventoryIndex = selectedRef.current): boolean {
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
    const equippedItem = inventory[index]?.itemId;
    const result = equipArmorFromInventory(inventory, equipment, index);
    if (!result.ok) return;
    updateInventory(result.inventory);
    setEquipment(result.equipment);
    notify("Armor equipped", equippedItem ? ITEMS[equippedItem].label : undefined, "success");
  }

  function handleUnequipArmor(slot: ArmorSlot) {
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
        setJoinPhase("idle");
      }, 180);
    }, 260);
  }

  useEffect(() => {
    if (joinPhase !== "waiting" || !inventoryReady || savedPresence === undefined || !profile) return;
    setJoinPhase("ready");
    const timer = window.setTimeout(() => {
      setInWorld(true);
      setJoinPhase("idle");
    }, 180);
    return () => window.clearTimeout(timer);
  }, [joinPhase, inventoryReady, savedPresence, profile?.id]);

  useEffect(() => {
    if (inWorld && !auth.isLoading && (!auth.isAuthenticated || auth.isGuest)) {
      if (document.pointerLockElement) document.exitPointerLock();
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
          inventorySessionRef.current += 1;
          lastCommittedPlayerJsonRef.current = "";
          inventorySavePendingRef.current = false;
          pendingChestTransferRef.current = null;
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
      <div className="lakecraft-vignette" />

      {!pointerLocked && !inventoryOpen && !furnaceOpen && !chatOpen && !activeChestKey && !activeBedKey && !engineError ? (
        <section className="lakecraft-entry" aria-label="Enter Lakecraft">
          <div className="lakecraft-entry__card">
            <span className="lakecraft-entry__eyebrow">survey 01 / shared world online</span>
            <h1>Fern<br />Hollow</h1>
            <p>Walk the ridge, fell oak, quarry stone, and leave a shelter for the next wayfarer. Every block edit is shared through Lakebed.</p>
            <button data-testid="enter-world" disabled={!inventoryReady} onClick={() => engineRef.current?.requestPointerLock()} type="button"><span>{inventoryReady ? "Enter the world" : "Restoring field kit…"}</span><span>→</span></button>
            <small>{inventoryReady ? "WASD to move · mouse to look · E opens the field kit" : "Synchronizing this wayfarer with Lakebed"}</small>
          </div>
        </section>
      ) : null}

      <GameHud
        connected={connected}
        equipment={equipment}
        craftingContext={craftingContext}
        health={playerHealth}
        hunger={hunger}
        maxHunger={MAX_HUNGER}
        inventory={inventory}
        inventoryOpen={inventoryOpen}
        messages={messages}
        mobileUnsupported={mobileUnsupported}
        onlineCount={Math.max(1, activePlayers.length)}
        onCloseInventory={closeInventory}
        onContinueMobile={() => setMobileUnsupported(false)}
        onCraft={handleCraft}
        onDismissControls={() => setShowControls(false)}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onEquipArmor={handleEquipArmor}
        onSelectHotbar={(index) => setSelectedHotbar(clampHotbarIndex(index))}
        onUnequipArmor={handleUnequipArmor}
        onUseItem={(inventoryIndex) => { handleUseItem(inventoryIndex); }}
        playerName={profile?.username ?? auth.displayName}
        roomCode="FERN-01"
        selectedIndex={selectedHotbar}
        showControls={showControls && !inventoryOpen && !furnaceOpen && !chatOpen && !activeChestKey && !activeBedKey}
        worldName="Fern Hollow"
      />

      <FurnaceDrawer
        error={furnaceError}
        inventory={inventory}
        onClose={closeInventory}
        onSmelt={handleSmelt}
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
        }}
        onTransfer={handleChestTransfer}
        onRetry={retryPendingChestTransfer}
        open={Boolean(activeChestKey)}
        playerInventory={inventory}
        retryAvailable={chestRetryAvailable}
        status={chestBusy ? "Waiting for Lakebed to settle one atomic transfer…" : "Pack and chest are synchronized with Lakebed."}
      />

      {activeBedKey ? (
        <div className="lakecraft-sleep-layer" onMouseDown={(event) => event.target === event.currentTarget && !sleepBusy && setActiveBedKey("")}>
          <section className="lakecraft-sleep" role="dialog" aria-modal="true" aria-labelledby="lakecraft-sleep-title">
            <small>shared Lakebed sleep vote</small>
            <h2 id="lakecraft-sleep-title">Rest until morning</h2>
            <p role="status">{sleepStatus}</p>
            <div className="lakecraft-sleep__actions">
              <button disabled={sleepBusy} onClick={() => handleSleepInBed()} type="button">{sleepBusy ? "Contacting Lakebed…" : "Vote to sleep"}</button>
              <button disabled={sleepBusy} onClick={() => setActiveBedKey("")} type="button">Close · E</button>
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
        }}
        onDraftChange={setChatDraft}
        onOpen={() => {
          if (document.pointerLockElement) document.exitPointerLock();
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
        <output className="lakecraft-perf" aria-label="Performance statistics">{`FPS ${performanceStats.fps.toFixed(0)}  p95 ${performanceStats.p95FrameTimeMs.toFixed(1)}ms\nDRAW ${performanceStats.drawCalls}  CHUNKS ${performanceStats.visibleChunkCount}/${performanceStats.chunkCount}\nPLAYERS ${performanceStats.remoteVisiblePlayers}  REMOTE ${performanceStats.remoteMeshMs.toFixed(2)}ms / ${(performanceStats.remoteUploadBytes / 1024).toFixed(0)}KB\nPRESENCE ${presenceSchedulerRef.current?.writeCount ?? 0} attempts · cap ${PRESENCE_MAX_WRITES_PER_MINUTE}/min\nMOBS ${performanceStats.mobVisibleCount}/${performanceStats.mobCount}  AI ${performanceStats.mobSimulationMs.toFixed(2)}ms\nLIGHT ${performanceStats.activeTorchLights}/${performanceStats.torchCount} torches\nVERT ${performanceStats.worldVertexCount.toLocaleString()}  MESH ${performanceStats.lastMeshRebuildMs.toFixed(1)}ms`}</output>
      ) : null}

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </main>
  );
}
