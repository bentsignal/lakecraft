import { useEffect, useRef, useState } from "preact/hooks";
import { ChestDrawer, FurnaceDrawer, GameHud, type ChestTransferDirection, type HudMessage } from "../components";
import {
  BLOCK,
  MORNING_PHASE,
  createVoxelEngine,
  phaseAtTime,
  type BlockId as EngineBlockId,
  type DroppedItemRenderItem,
  type LocalExplosionEdit,
  type VoxelEngine,
  type WorldEdit,
} from "../game";
import {
  MAX_HEALTH,
  MAX_HUNGER,
  ITEMS,
  addItem,
  applyConfirmedArmorDamage,
  applyConfirmedDurableItemUse,
  applyConfirmedToolUse,
  attackDamage,
  clampHotbarIndex,
  consumeFood,
  createSurvivalTickState,
  equippedArmorProtection,
  getDeterministicMiningDrop,
  miningSeconds,
  removeItem,
  tickSurvival,
  type BlockId,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
} from "../../shared/game";
import { planDeathDrops } from "../../shared/deathDrops.ts";
import type { StowedInventorySnapshot } from "../../shared/inventoryWorkspace";
import type { InventoryRecipeBatch } from "../../shared/inventoryActions";
import { TNT_FUSE_MS, TNT_IGNITION_REACH } from "../../shared/tntAuthority";
import { planOakTreeGrowth } from "../../shared/treeGrowth";
import { cycleHotbarIndex } from "../game/hotbarInput";
import { createGameAudio, type GameAudio, type GameAudioSurface } from "../game/audio";
import {
  loadClientSettings,
  mouseLookScale,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettings,
} from "../settings";
import {
  SINGLEPLAYER_SAVE_LIMITS,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerLoadResult,
  type SinglePlayerSnapshot,
} from "./localSave.ts";
import {
  commitSaveCadence,
  createSaveCadenceState,
  markSaveCadenceDirty,
  sampleSaveCadence,
} from "./saveCadence.ts";
import {
  createLocalContainers,
  exportLocalContainersSnapshot,
  importLocalContainersSnapshot,
  materializeLocalFurnace,
  openLocalChest,
  openLocalFurnace,
  recoverLocalContainerContents,
  transferLocalChestFullStack,
  transferLocalFurnaceFullStack,
  type LocalContainers,
} from "./localContainers.ts";
import {
  canSleepAtPhase,
  respawnPointForBed,
  respawnPointMatchesBed,
  singlePlayerWorldSpawn,
} from "./localBed.ts";
import type { FurnaceState, FurnaceTransferAction } from "../../shared/furnaces.ts";
import type { ChestInventory } from "../../shared/chests.ts";
import { appendLocalMobDeathDrops, collectLocalDroppedItems } from "./localDroppedItems.ts";

const ENGINE_TO_GAME: Partial<Record<EngineBlockId, BlockId>> = {
  [BLOCK.GRASS]: "grass", [BLOCK.DIRT]: "dirt", [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone", [BLOCK.SAND]: "sand", [BLOCK.GLASS]: "glass",
  [BLOCK.GRAVEL]: "gravel",
  [BLOCK.COAL_ORE]: "coal_ore", [BLOCK.IRON_ORE]: "iron_ore", [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore", [BLOCK.WOOD]: "log", [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks", [BLOCK.CRAFTING_TABLE]: "crafting_table", [BLOCK.FURNACE]: "furnace",
  [BLOCK.TORCH]: "torch", [BLOCK.CHEST]: "chest", [BLOCK.DOOR_CLOSED]: "door",
  [BLOCK.DOOR_OPEN]: "door", [BLOCK.BED]: "bed", [BLOCK.LADDER]: "ladder",
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
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE, iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE, log: BLOCK.WOOD, leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS, crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE,
  torch: BLOCK.TORCH, chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER,
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

function audioSurfaceForBlock(block: EngineBlockId): GameAudioSurface {
  if (block === BLOCK.GRASS || block === BLOCK.DIRT || block === BLOCK.LEAVES || block === BLOCK.SAPLING
    || block === BLOCK.BED || block === BLOCK.WOOL) return "grass";
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

type InitialLocalWorld = {
  snapshot: SinglePlayerSnapshot;
  containers: LocalContainers;
  load: SinglePlayerLoadResult;
  saveLocked: boolean;
};

function loadInitialLocalWorld(): InitialLocalWorld {
  const now = Date.now();
  const finish = (snapshot: SinglePlayerSnapshot, load: SinglePlayerLoadResult, saveLocked: boolean): InitialLocalWorld => {
    const imported = importLocalContainersSnapshot({ chests: snapshot.chests, furnaces: snapshot.furnaces });
    return {
      snapshot,
      containers: imported.ok ? imported.containers : createLocalContainers(),
      load,
      saveLocked: saveLocked || !imported.ok,
    };
  };
  try {
    const load = loadSinglePlayerSave(localStorage, { now: () => now });
    if (load.snapshot) return finish(load.snapshot, load, false);
    if (load.status === "empty") {
      return finish(createDefaultSinglePlayerSnapshot(7_319, now), load, false);
    }
    // Never overwrite corrupt or future-format data with a permissive reset.
    return finish(createDefaultSinglePlayerSnapshot(7_319, now), load, true);
  } catch {
    const load: SinglePlayerLoadResult = {
      status: "corrupt", snapshot: null, sequence: 0, reason: "storage_read_failed", issues: ["storage:unavailable"],
    };
    return finish(createDefaultSinglePlayerSnapshot(7_319, now), load, true);
  }
}

export function SinglePlayerApp() {
  const initial = useRef<InitialLocalWorld | null>(null);
  if (!initial.current) initial.current = loadInitialLocalWorld();
  const initialSnapshot = initial.current.snapshot;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const inventoryRef = useRef(initialSnapshot.player.inventory);
  const equipmentRef = useRef(initialSnapshot.player.equipment);
  const selectedRef = useRef(initialSnapshot.player.selectedHotbar);
  const editsRef = useRef(initialSnapshot.world.edits);
  const hungerRef = useRef(initialSnapshot.player.hunger);
  const healthRef = useRef(initialSnapshot.runtime?.playerHealth ?? MAX_HEALTH);
  const survivalStateRef = useRef(createSurvivalTickState(hungerRef.current, healthRef.current));
  const survivalActivityRef = useRef(0.5);
  const survivalSampledAtRef = useRef(performance.now());
  const dropsRef = useRef<DroppedItemRenderItem[]>(initialSnapshot.drops);
  const worldRef = useRef({ ...initialSnapshot.world, weather: { ...initialSnapshot.world.weather } });
  const progressionRef = useRef({
    experience: initialSnapshot.progression.experience,
    recipes: [...initialSnapshot.progression.recipes],
    advancements: [...initialSnapshot.progression.advancements],
  });
  const containersRef = useRef<LocalContainers>(initial.current.containers);
  const primedTntRef = useRef(initialSnapshot.primedTnt.map((fuse) => ({ ...fuse })));
  const initialRuntimeRef = useRef(initialSnapshot.runtime);
  const saveCadenceRef = useRef(createSaveCadenceState(performance.now()));
  const saveLockedRef = useRef(initial.current.saveLocked);
  const saveInProgressRef = useRef(false);
  const performSaveRef = useRef<(reason: "manual" | "autosave" | "quit") => boolean>(() => false);
  const setLocalFusesPausedRef = useRef<(paused: boolean) => void>(() => undefined);
  const localRespawnBusyRef = useRef(false);
  const localDropSequenceRef = useRef(0);
  const [inventory, setInventory] = useState<Inventory>(initialSnapshot.player.inventory);
  const [equipment, setEquipment] = useState<Equipment>(initialSnapshot.player.equipment);
  const [selected, setSelected] = useState(initialSnapshot.player.selectedHotbar);
  const [hunger, setHunger] = useState(initialSnapshot.player.hunger);
  const [health, setHealth] = useState(initialSnapshot.runtime?.playerHealth ?? MAX_HEALTH);
  const [deathScreenOpen, setDeathScreenOpen] = useState(false);
  const [respawning, setRespawning] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [clientSettings, setClientSettings] = useState(() => loadClientSettings(window.localStorage));
  const clientSettingsRef = useRef(clientSettings);
  clientSettingsRef.current = clientSettings;
  const [activeChestKey, setActiveChestKey] = useState<string | null>(null);
  const [chestInventory, setChestInventory] = useState<ChestInventory>([]);
  const [activeFurnaceKey, setActiveFurnaceKey] = useState<string | null>(null);
  const [sleepingBed, setSleepingBed] = useState<{ x: number; y: number; z: number } | null>(null);
  const [furnaceState, setFurnaceState] = useState<FurnaceState | null>(null);
  const [containerStatus, setContainerStatus] = useState("");
  const [containerError, setContainerError] = useState("");
  const containerOpen = activeChestKey !== null || activeFurnaceKey !== null;
  const worldModalOpen = containerOpen || sleepingBed !== null;
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [handActionToken, setHandActionToken] = useState(0);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0, z: 0 });
  const initialSaveText = initial.current.load.status === "recovered" ? "Recovered the previous good save."
    : initial.current.load.status === "migrated" ? "Imported the previous local world."
      : initial.current.saveLocked ? "Saving disabled to protect unreadable world data." : "";
  const initialSavedAt = "savedAt" in initial.current.load ? initial.current.load.savedAt : null;
  const [saveStatusText, setSaveStatusText] = useState(initialSaveText);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialSavedAt);
  const [saveInProgress, setSaveInProgress] = useState(false);

  function updateClientSettings(value: ClientSettings): void {
    const next = normalizeClientSettings(value);
    const soundChanged = clientSettingsRef.current.soundMuted !== next.soundMuted;
    clientSettingsRef.current = next;
    setClientSettings(next);
    saveClientSettings(window.localStorage, next);
    if (soundChanged) audioRef.current?.setMuted(next.soundMuted);
  }

  function markWorldDirty(): void {
    const cadence = saveCadenceRef.current;
    if (cadence.dirtyRevision === cadence.savedRevision) {
      saveCadenceRef.current = markSaveCadenceDirty(cadence);
    }
  }

  function buildSnapshot(): SinglePlayerSnapshot | null {
    const containers = exportLocalContainersSnapshot(containersRef.current);
    if (!containers.ok) return null;
    const activePlayMs = Math.floor(Math.min(
      Number.MAX_SAFE_INTEGER,
      worldRef.current.activePlayMs + saveCadenceRef.current.activePlayMsSinceSave,
    ));
    return {
      world: {
        ...worldRef.current,
        activePlayMs,
        weather: { ...worldRef.current.weather },
        edits: editsRef.current.map((edit) => ({ ...edit })),
      },
      player: {
        inventory: inventoryRef.current.map((stack) => stack ? { ...stack } : null),
        equipment: {
          head: equipmentRef.current.head ? { ...equipmentRef.current.head } : null,
          chest: equipmentRef.current.chest ? { ...equipmentRef.current.chest } : null,
          legs: equipmentRef.current.legs ? { ...equipmentRef.current.legs } : null,
          feet: equipmentRef.current.feet ? { ...equipmentRef.current.feet } : null,
        },
        selectedHotbar: selectedRef.current,
        hunger: hungerRef.current,
      },
      progression: {
        experience: progressionRef.current.experience,
        recipes: [...progressionRef.current.recipes],
        advancements: [...progressionRef.current.advancements],
      },
      drops: dropsRef.current.map((drop) => ({ ...drop, item: { ...drop.item } })),
      chests: containers.snapshot.chests,
      furnaces: containers.snapshot.furnaces,
      primedTnt: primedTntRef.current.map((fuse) => ({ ...fuse })),
      runtime: engineRef.current?.exportRuntimeSnapshot() ?? initialRuntimeRef.current,
    };
  }

  function persist(reason: "manual" | "autosave" | "quit" = "manual"): boolean {
    if (saveLockedRef.current || saveInProgressRef.current) return false;
    const snapshot = buildSnapshot();
    if (!snapshot) {
      setSaveStatusText("Save failed: invalid local container state.");
      return false;
    }
    saveInProgressRef.current = true;
    setSaveInProgress(true);
    const now = Date.now();
    const result = saveSinglePlayerSnapshot(localStorage, snapshot, now);
    saveInProgressRef.current = false;
    setSaveInProgress(false);
    if (!result.ok) {
      const invalidPath = result.path ? ` (${result.path})` : "";
      setSaveStatusText(result.reason === "too_large" ? "Save failed: this world exceeds browser storage limits."
        : result.reason === "unsafe_existing_data" ? "Save blocked to protect existing world data."
          : `Save failed${invalidPath}. The previous good snapshot is still intact.`);
      if (result.reason === "unsafe_existing_data") saveLockedRef.current = true;
      return false;
    }
    worldRef.current = { ...snapshot.world, weather: { ...snapshot.world.weather } };
    initialRuntimeRef.current = snapshot.runtime;
    saveCadenceRef.current = commitSaveCadence(saveCadenceRef.current, performance.now(), !engineRef.current?.isPaused());
    setLastSavedAt(now);
    setSaveStatusText(reason === "autosave" ? "World autosaved." : reason === "quit" ? "World saved." : "World saved.");
    return true;
  }
  performSaveRef.current = persist;

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
    markWorldDirty();
  }

  function selectHotbar(index: number) {
    const next = clampHotbarIndex(index);
    if (next === selectedRef.current) return;
    selectedRef.current = next;
    setSelected(next);
    markWorldDirty();
  }

  function closeActiveContainer(requestPointerLock = true): void {
    if (activeFurnaceKey) {
      const materialized = materializeLocalFurnace(containersRef.current, activeFurnaceKey, Date.now());
      if (materialized.ok) {
        containersRef.current = materialized.containers;
        setFurnaceState(materialized.furnace);
        markWorldDirty();
      }
    }
    setActiveChestKey(null);
    setActiveFurnaceKey(null);
    setContainerError("");
    setContainerStatus("");
    if (requestPointerLock) engineRef.current?.requestPointerLock();
  }

  function transferChestStack(direction: ChestTransferDirection, index: number): void {
    if (!activeChestKey) return;
    const result = transferLocalChestFullStack(
      containersRef.current,
      activeChestKey,
      inventoryRef.current,
      { direction: direction === "to_chest" ? "to_chest" : "from_chest", sourceSlot: index },
    );
    if (!result.ok) {
      setContainerError(result.reason === "no_capacity" ? "That full stack will not fit." : "Chest transfer failed safely.");
      return;
    }
    containersRef.current = result.containers;
    inventoryRef.current = result.inventory;
    setInventory(result.inventory);
    setChestInventory(result.containers.chests.get(activeChestKey) ?? []);
    setContainerError("");
    setContainerStatus(`Moved ${result.moved.count} ${ITEMS[result.moved.itemId].label}.`);
    markWorldDirty();
  }

  function transferFurnaceStack(action: FurnaceTransferAction): void {
    if (!activeFurnaceKey) return;
    const localAction = action.kind === "deposit_input" || action.kind === "deposit_fuel"
      ? { kind: action.kind, inventorySlot: action.inventorySlot }
      : { kind: action.kind };
    const result = transferLocalFurnaceFullStack(
      containersRef.current,
      activeFurnaceKey,
      inventoryRef.current,
      localAction,
      Date.now(),
    );
    if (!result.ok) {
      setContainerError(result.reason === "no_capacity" || result.reason === "incompatible_stack"
        ? "That full stack will not fit."
        : result.reason === "wrong_item" ? "That item cannot go in this furnace slot."
          : "Furnace transfer failed safely.");
      return;
    }
    containersRef.current = result.containers;
    inventoryRef.current = result.inventory;
    setInventory(result.inventory);
    setFurnaceState(result.furnace);
    setContainerError("");
    setContainerStatus(`Moved ${result.moved.count} ${ITEMS[result.moved.itemId].label}.`);
    markWorldDirty();
  }

  function settleBrokenContainerContents(x: number, y: number, z: number, block: EngineBlockId): void {
    const coordKey = `${x}:${y}:${z}`;
    if (block === BLOCK.FURNACE) {
      const materialized = materializeLocalFurnace(containersRef.current, coordKey, Date.now());
      if (materialized.ok) containersRef.current = materialized.containers;
    }
    const recovered = recoverLocalContainerContents(
      containersRef.current,
      coordKey,
      inventoryRef.current,
      SINGLEPLAYER_SAVE_LIMITS.drops - dropsRef.current.length,
    );
    if (!recovered.ok) {
      setMessages((current) => [...current.slice(-2), {
        id: `container-protected-${coordKey}-${Date.now()}`,
        text: "Container contents protected",
        detail: "The saved contents will return if you place the same container at this coordinate.",
        tone: "warning",
      }]);
      return;
    }
    const droppedAt = Date.now();
    const recoveredDrops = recovered.overflow.map((stack, index): DroppedItemRenderItem => ({
      dropId: `local_container_${droppedAt}_${x}_${y}_${z}_${index}`.slice(0, 96),
      item: { ...stack },
      x: x + 0.35 + (index % 3) * 0.15,
      y: y + 0.45,
      z: z + 0.35 + (Math.floor(index / 3) % 3) * 0.15,
      droppedAt,
    }));
    inventoryRef.current = recovered.inventory;
    dropsRef.current = [...dropsRef.current, ...recoveredDrops];
    engineRef.current?.setDroppedItems(dropsRef.current);
    containersRef.current = recovered.containers;
    setMessages((current) => [...current.slice(-2), {
      id: `container-recovered-${coordKey}-${droppedAt}`,
      text: "Container emptied safely",
      detail: recovered.overflow.length > 0 ? "Contents moved to your pack and the ground." : "Contents moved into your pack.",
      tone: "success",
    }]);
    markWorldDirty();
  }

  function invalidateBrokenBed(x: number, y: number, z: number): void {
    const engine = engineRef.current;
    if (!engine || !respawnPointMatchesBed(engine.getRespawnPoint(), x, y, z)) return;
    engine.setRespawnPoint(singlePlayerWorldSpawn(worldRef.current.seed));
    setSleepingBed(null);
    setMessages((current) => [...current.slice(-2), {
      id: `bed-broken-${x}:${y}:${z}-${Date.now()}`,
      text: "Respawn point lost",
      detail: "Your bed was destroyed. World spawn is active again.",
      tone: "warning",
    }]);
    markWorldDirty();
  }

  function interactWithLocalBed(x: number, y: number, z: number): boolean {
    const engine = engineRef.current;
    if (!engine) return true;
    engine.setRespawnPoint(respawnPointForBed(x, y, z, engine.getPose().yaw));
    markWorldDirty();
    const runtime = engine.exportRuntimeSnapshot();
    if (!canSleepAtPhase(phaseAtTime(runtime.worldTimeMs, runtime.dayNight))) {
      setMessages((current) => [...current.slice(-2), {
        id: `bed-day-${Date.now()}`,
        text: "Respawn point set",
        detail: "You can sleep only at night.",
        tone: "info",
      }]);
      return true;
    }
    setMessages((current) => [...current.slice(-2), {
      id: `bed-night-${Date.now()}`,
      text: "Respawn point set",
      detail: "Sleeping through the night…",
      tone: "success",
    }]);
    setSleepingBed({ x, y, z });
    document.exitPointerLock();
    return true;
  }

  function collectLocalDrops(pose: { x: number; y: number; z: number }): void {
    if (healthRef.current <= 0 || dropsRef.current.length === 0) return;
    const collected = collectLocalDroppedItems(inventoryRef.current, dropsRef.current, pose);
    if (!collected.changed) return;
    inventoryRef.current = collected.inventory;
    dropsRef.current = collected.drops;
    setInventory(collected.inventory);
    engineRef.current?.setDroppedItems(collected.drops);
    markWorldDirty();
  }

  function dropLocalSelected(wholeStack: boolean): void {
    const engine = engineRef.current;
    const source = inventoryRef.current[selectedRef.current];
    if (!engine || !source || dropsRef.current.length >= SINGLEPLAYER_SAVE_LIMITS.drops) return;
    const count = wholeStack ? source.count : 1;
    const next = inventoryRef.current.map((stack, index) => index !== selectedRef.current || !stack
      ? stack ? { ...stack } : null
      : stack.count === count ? null : { ...stack, count: stack.count - count }) as Inventory;
    const pose = engine.getPose();
    const droppedAt = Date.now();
    localDropSequenceRef.current += 1;
    const dropped: DroppedItemRenderItem = {
      dropId: `local_drop_${droppedAt}_${localDropSequenceRef.current}`.slice(0, 96),
      item: { ...source, count },
      x: pose.x + Math.sin(pose.yaw) * 2.25,
      y: pose.y + 1.1,
      z: pose.z - Math.cos(pose.yaw) * 2.25,
      droppedAt,
    };
    inventoryRef.current = next;
    dropsRef.current = [...dropsRef.current, dropped];
    setInventory(next);
    engine.setDroppedItems(dropsRef.current);
    setMessages((current) => [...current.slice(-2), {
      id: dropped.dropId,
      text: `Dropped ${ITEMS[source.itemId].label}`,
      detail: count > 1 ? `${count} items` : "Walk over it to pick it back up.",
      tone: "info",
    }]);
    markWorldDirty();
  }

  function respawnLocally(): void {
    if (localRespawnBusyRef.current || !engineRef.current) return;
    localRespawnBusyRef.current = true;
    setRespawning(true);
    const engine = engineRef.current;
    const deathAt = Date.now();
    const pose = engine.getPose();
    const plan = planDeathDrops({
      identity: { userId: "singleplayer", eventId: `local-${deathAt}` },
      inventory: inventoryRef.current,
      equipment: equipmentRef.current,
      deathPose: { x: pose.x, y: pose.y, z: pose.z },
    });
    if (!plan.ok) {
      setMessages((current) => [...current.slice(-2), { id: `death-${deathAt}`, text: "Respawn failed", detail: "Your carried items were left untouched.", tone: "warning" }]);
      localRespawnBusyRef.current = false;
      setRespawning(false);
      return;
    }
    if (dropsRef.current.length + plan.drops.length > SINGLEPLAYER_SAVE_LIMITS.drops) {
      setMessages((current) => [...current.slice(-2), { id: `death-cap-${deathAt}`, text: "Respawn blocked", detail: "Too many saved items are already lying in this world; your pack was not changed.", tone: "warning" }]);
      localRespawnBusyRef.current = false;
      setRespawning(false);
      return;
    }
    const drops = plan.drops.map((drop): DroppedItemRenderItem => ({
      dropId: drop.operationId,
      item: drop.stack,
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
      droppedAt: deathAt,
    }));
    dropsRef.current = [...dropsRef.current, ...drops];
    inventoryRef.current = plan.carriedState.inventory;
    equipmentRef.current = plan.carriedState.equipment;
    hungerRef.current = MAX_HUNGER;
    survivalStateRef.current = createSurvivalTickState(MAX_HUNGER, MAX_HEALTH);
    setInventory(plan.carriedState.inventory);
    setEquipment(plan.carriedState.equipment);
    setHunger(MAX_HUNGER);
    engine.setDroppedItems(dropsRef.current);
    markWorldDirty();
    const respawn = engine.getRespawnPoint();
    const bed = {
      x: Math.round(respawn.x - 0.5),
      y: Math.round(respawn.y - 1.02),
      z: Math.round(respawn.z - 0.5),
    };
    if (respawnPointMatchesBed(respawn, bed.x, bed.y, bed.z)
      && engine.getBlockAt(bed.x, bed.y, bed.z) !== BLOCK.BED) {
      engine.setRespawnPoint(singlePlayerWorldSpawn(worldRef.current.seed));
    }
    engine.respawn();
    setDeathScreenOpen(false);
    localRespawnBusyRef.current = false;
    setRespawning(false);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audio = createGameAudio({ muted: clientSettingsRef.current.soundMuted, maxVoices: 12 });
    audioRef.current = audio;
    const unlockAudio = () => { void audio.unlock(); };
    type LocalFuseTimer = {
      interval: number;
      timeout: number;
      remainingMs: number;
      startedAt: number;
      explode: () => void;
    };
    const fuseTimers = new Map<string, LocalFuseTimer>();
    let fusesPaused = true;
    const clearFuseSchedule = (timer: LocalFuseTimer) => {
      if (timer.interval) window.clearInterval(timer.interval);
      if (timer.timeout) window.clearTimeout(timer.timeout);
      timer.interval = 0;
      timer.timeout = 0;
    };
    const scheduleFuse = (key: string, timer: LocalFuseTimer) => {
      if (fusesPaused) return;
      timer.startedAt = performance.now();
      timer.interval = window.setInterval(() => {
        const [x, y, z] = key.split(":").map(Number);
        engineRef.current?.spawnBlockParticles({ action: "hit", block: BLOCK.TNT, x, y, z });
      }, 500);
      timer.timeout = window.setTimeout(timer.explode, timer.remainingMs);
    };
    const setFusesPaused = (paused: boolean) => {
      if (paused === fusesPaused) return;
      const now = performance.now();
      fusesPaused = paused;
      for (const [key, timer] of fuseTimers) {
        if (paused) {
          timer.remainingMs = Math.max(0, timer.remainingMs - Math.max(0, now - timer.startedAt));
          clearFuseSchedule(timer);
        } else {
          scheduleFuse(key, timer);
        }
        const [x, y, z] = key.split(":").map(Number);
        const savedAt = Date.now();
        primedTntRef.current = primedTntRef.current.map((fuse) => fuse.x === x && fuse.y === y && fuse.z === z
          ? { ...fuse, ignitedAt: savedAt, dueAt: savedAt + timer.remainingMs }
          : fuse);
      }
      if (fuseTimers.size > 0) markWorldDirty();
    };
    setLocalFusesPausedRef.current = setFusesPaused;
    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    function primeLocalTnt(
      x: number,
      y: number,
      z: number,
      durationMs: number,
      cascadeDepth: number,
      spendTool: boolean,
    ): boolean {
      const key = `${x}:${y}:${z}`;
      if (fuseTimers.has(key)) return true;
      if (fuseTimers.size >= 32 || !engineRef.current?.setPrimedTnt(x, y, z, true)) return false;
      const startedAt = Date.now();
      const persistedFuse = primedTntRef.current.find((fuse) => fuse.x === x && fuse.y === y && fuse.z === z);
      const effectiveDurationMs = persistedFuse
        ? Math.max(0, persistedFuse.dueAt - startedAt)
        : Math.max(0, Math.floor(durationMs));
      if (!persistedFuse) {
        primedTntRef.current = [...primedTntRef.current, {
          eventId: `local_tnt_${startedAt}_${x}_${y}_${z}`.slice(0, 96),
          x, y, z, ignitedAt: startedAt, dueAt: startedAt + effectiveDurationMs,
        }];
        markWorldDirty();
      }
      if (spendTool) {
        const toolUse = applyConfirmedDurableItemUse(inventoryRef.current, selectedRef.current, "flint_and_steel");
        if (!toolUse.used) {
          engineRef.current.setPrimedTnt(x, y, z, false);
          primedTntRef.current = primedTntRef.current.filter((fuse) => fuse.x !== x || fuse.y !== y || fuse.z !== z);
          markWorldDirty();
          return false;
        }
        updateInventory(toolUse.inventory);
      }
      audio.play("creeperFuse", { seed: key, intensity: 0.82 });
      engineRef.current.spawnBlockParticles({ action: "hit", block: BLOCK.TNT, x, y, z });
      if (spendTool) setMessages((current) => [...current.slice(-2), {
        id: `tnt-${key}`,
        text: "TNT primed",
        detail: "Four-second fuse — stand back.",
        tone: "warning",
      }]);
      const explode = () => {
        const timer = fuseTimers.get(key);
        if (timer) clearFuseSchedule(timer);
        fuseTimers.delete(key);
        primedTntRef.current = primedTntRef.current.filter((fuse) => fuse.x !== x || fuse.y !== y || fuse.z !== z);
        markWorldDirty();
        const edits = engineRef.current?.explodeTnt(x, y, z) ?? [];
        recordLocalExplosion(key, edits, cascadeDepth);
      };
      const timer: LocalFuseTimer = {
        interval: 0,
        timeout: 0,
        remainingMs: effectiveDurationMs,
        startedAt: performance.now(),
        explode,
      };
      fuseTimers.set(key, timer);
      scheduleFuse(key, timer);
      return true;
    }
    function recordLocalExplosion(key: string, edits: readonly LocalExplosionEdit[], cascadeDepth: number): void {
      const destruction = edits.filter((edit) => !edit.chainPrimed);
      for (const edit of destruction) {
        if (edit.previousBlock === BLOCK.BED) invalidateBrokenBed(edit.x, edit.y, edit.z);
      }
      if (destruction.length) {
        const byCoordinate = new Map(editsRef.current.map((edit) => [`${edit.x}:${edit.y}:${edit.z}`, edit]));
        for (const edit of destruction) byCoordinate.set(`${edit.x}:${edit.y}:${edit.z}`, edit);
        editsRef.current = [...byCoordinate.values()].slice(-SINGLEPLAYER_SAVE_LIMITS.edits);
        markWorldDirty();
      }
      audio.play("explosion", { seed: key, intensity: 1 });
      if (cascadeDepth < 8) {
        for (const edit of edits.filter((candidate) => candidate.chainPrimed).slice(0, 8)) {
          const hash = Math.abs(Math.imul(edit.x, 73_856_093) ^ Math.imul(edit.y, 19_349_663)
            ^ Math.imul(edit.z, 83_492_791) ^ cascadeDepth);
          primeLocalTnt(edit.x, edit.y, edit.z, 500 + hash % 1_001, cascadeDepth + 1, false);
        }
      }
      setMessages((current) => [...current.slice(-2), {
        id: `boom-${key}`,
        text: key.startsWith("creeper:") ? "Creeper exploded" : "Boom!",
        detail: `${destruction.length} blocks destroyed locally.`,
        tone: "warning",
      }]);
    }
    const engine = createVoxelEngine(canvas, {
      seed: worldRef.current.seed,
      initialEdits: editsRef.current,
      initialPose: initialRuntimeRef.current?.pose,
      preserveInitialPose: Boolean(initialRuntimeRef.current),
      getMouseLookSensitivity: () => mouseLookScale(clientSettingsRef.current.mouseSensitivity),
      selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
      getMiningDuration: (block) => {
        const gameBlock = ENGINE_TO_GAME[block];
        return gameBlock ? miningSeconds(gameBlock, inventoryRef.current[selectedRef.current]?.itemId) : 0.2;
      },
      getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
      getPlayerProtection: () => equippedArmorProtection(equipmentRef.current),
      canSprint: () => hungerRef.current > 6,
      canMineBlock: (block) => {
        const gameBlock = ENGINE_TO_GAME[block.block];
        const drop = gameBlock ? getDeterministicMiningDrop(
          gameBlock,
          inventoryRef.current[selectedRef.current]?.itemId ?? null,
          block.x,
          block.y,
          block.z,
        ) : null;
        return !drop || dropsRef.current.length < SINGLEPLAYER_SAVE_LIMITS.drops;
      },
      onFootstep: (block) => audio.play("footstep", {
        seed: `local-step:${block}:${performance.now().toFixed(0)}`,
        surface: audioSurfaceForBlock(block),
        intensity: 0.5,
      }),
      onBlockEdit: (edit, previousBlock) => {
        const settled = engineRef.current?.settleFallingBlocks(edit, previousBlock) ?? [];
        const nextEdits = new Map(editsRef.current.map((candidate) => [`${candidate.x}:${candidate.y}:${candidate.z}`, candidate]));
        nextEdits.set(`${edit.x}:${edit.y}:${edit.z}`, edit);
        for (const fallingEdit of settled) {
          nextEdits.set(`${fallingEdit.x}:${fallingEdit.y}:${fallingEdit.z}`, fallingEdit);
        }
        editsRef.current = [...nextEdits.values()].slice(-SINGLEPLAYER_SAVE_LIMITS.edits);
        if ((previousBlock === BLOCK.CHEST || previousBlock === BLOCK.FURNACE) && edit.block !== previousBlock) {
          settleBrokenContainerContents(edit.x, edit.y, edit.z, previousBlock);
        }
        if (previousBlock === BLOCK.BED && edit.block !== BLOCK.BED) {
          invalidateBrokenBed(edit.x, edit.y, edit.z);
        }
        markWorldDirty();
        const held = inventoryRef.current[selectedRef.current]?.itemId ?? null;
        let next = inventoryRef.current;
        const toggledBlock = (previousBlock === BLOCK.DOOR_CLOSED && edit.block === BLOCK.DOOR_OPEN)
          || (previousBlock === BLOCK.DOOR_OPEN && edit.block === BLOCK.DOOR_CLOSED)
          || (previousBlock === BLOCK.OAK_FENCE_GATE_CLOSED && edit.block === BLOCK.OAK_FENCE_GATE_OPEN)
          || (previousBlock === BLOCK.OAK_FENCE_GATE_OPEN && edit.block === BLOCK.OAK_FENCE_GATE_CLOSED);
        if (!toggledBlock && edit.block === BLOCK.AIR && previousBlock !== BLOCK.AIR) {
          const gameBlock = ENGINE_TO_GAME[previousBlock];
          const drop = gameBlock ? getDeterministicMiningDrop(gameBlock, held, edit.x, edit.y, edit.z) : null;
          const wear = held === "shears" && gameBlock === "leaves"
            ? applyConfirmedDurableItemUse(next, selectedRef.current, held)
            : applyConfirmedToolUse(next, selectedRef.current, "mine", held);
          next = wear.inventory;
          if (drop) {
            const droppedAt = Date.now();
            dropsRef.current = [...dropsRef.current, {
              dropId: `local_mine_${droppedAt}_${edit.x}_${edit.y}_${edit.z}`.slice(0, 96),
              item: { ...drop },
              x: edit.x + 0.5,
              y: edit.y + 0.45,
              z: edit.z + 0.5,
              droppedAt,
            }];
            engine.setDroppedItems(dropsRef.current);
          }
        } else if (!toggledBlock && previousBlock === BLOCK.AIR && edit.block !== BLOCK.AIR && held) {
          next = removeItem(next, held, 1).inventory;
        }
        updateInventory(next);
        const seed = `local:${edit.x},${edit.y},${edit.z}:${performance.now().toFixed(0)}`;
        if (toggledBlock) {
          const opened = edit.block === BLOCK.DOOR_OPEN || edit.block === BLOCK.OAK_FENCE_GATE_OPEN;
          audio.play(opened ? "doorOpen" : "doorClose", { seed, surface: "wood" });
        } else if (edit.block === BLOCK.AIR && previousBlock !== BLOCK.AIR) {
          audio.play("blockBreak", { seed, surface: audioSurfaceForBlock(previousBlock) });
          engine.spawnBlockParticles({ action: "break", block: previousBlock, x: edit.x, y: edit.y, z: edit.z });
        } else if (previousBlock === BLOCK.AIR && edit.block !== BLOCK.AIR) {
          audio.play("blockPlace", { seed, surface: audioSurfaceForBlock(edit.block) });
          engine.spawnBlockParticles({ action: "place", block: edit.block, x: edit.x, y: edit.y, z: edit.z });
        }
      },
      onMobDrops: (event) => {
        const appended = appendLocalMobDeathDrops(
          dropsRef.current,
          event,
          Date.now(),
          SINGLEPLAYER_SAVE_LIMITS.drops,
        );
        if (!appended.ok) {
          setMessages((current) => [...current.slice(-2), {
            id: `mob-loot-full-${event.eventId}`.slice(0, 96),
            text: "Too many items nearby",
            detail: "Pick up some world drops before finishing this mob.",
            tone: "warning",
          }]);
          return false;
        }
        dropsRef.current = appended.drops;
        if (appended.added > 0) engine.setDroppedItems(appended.drops);
        markWorldDirty();
        return true;
      },
      onLocalCreeperExplosion: ({ mobId, edits }) => {
        recordLocalExplosion(`creeper:${mobId}`, edits, 0);
        markWorldDirty();
      },
      onMobUse: (target) => {
        if (target.kind !== "sheep" || inventoryRef.current[selectedRef.current]?.itemId !== "shears") return false;
        let acceptedInventory: Inventory | null = null;
        let broke = false;
        const result = engine.shearMob(target.id, (woolCount) => {
          const wear = applyConfirmedDurableItemUse(inventoryRef.current, selectedRef.current, "shears");
          if (!wear.used) return false;
          const added = addItem(wear.inventory, "wool", woolCount);
          if (added.remainder !== 0) return false;
          acceptedInventory = added.inventory;
          broke = wear.broke;
          return true;
        });
        if (result.ok && acceptedInventory) {
          updateInventory(acceptedInventory);
          audio.play("pickup", { seed: `${target.id}:${result.woolCount}`, intensity: 0.58 });
          setMessages((current) => [...current.slice(-2), {
            id: `shear-${target.id}`,
            text: `${result.woolCount} Wool`,
            detail: broke ? "Sheep sheared · shears broke" : "Sheep sheared",
            tone: "success",
          }]);
        } else if (result.reason === "rejected") {
          setMessages((current) => [...current.slice(-2), {
            id: `shear-full-${target.id}`,
            text: "Inventory full",
            detail: "Make room for the sheep's wool.",
            tone: "warning",
          }]);
        }
        return true;
      },
      onPlayerHealthChange: (nextHealth) => {
        healthRef.current = nextHealth;
        survivalStateRef.current = { ...survivalStateRef.current, health: nextHealth };
        setHealth(nextHealth);
        markWorldDirty();
        if (nextHealth > 0) return;
        setDeathScreenOpen(true);
        setPauseOpen(false);
        setInventoryOpen(false);
        setActiveChestKey(null);
        setActiveFurnaceKey(null);
        document.exitPointerLock();
      },
      onPlayerDamage: (amount, cause) => {
        if (amount > 0 && cause !== "fall") {
          const armorDamage = applyConfirmedArmorDamage(equipmentRef.current);
          if (armorDamage.damaged.length > 0) {
            equipmentRef.current = armorDamage.equipment;
            setEquipment(armorDamage.equipment);
            markWorldDirty();
          }
          if (armorDamage.broken.length > 0) {
            const labels = armorDamage.broken.map(({ itemId }) => ITEMS[itemId].label);
            setMessages((current) => [...current.slice(-2), {
              id: `armor-break-${performance.now().toFixed(0)}`,
              text: labels.length === 1 ? `${labels[0]} broke` : `${labels.length} armor pieces broke`,
              detail: labels.length === 1 ? "The final durability point was used." : labels.join(" · "),
              tone: "warning",
            }]);
          }
        }
        audio.play("playerHurt", {
          seed: `local-hurt:${cause}:${amount}:${performance.now().toFixed(0)}`,
          intensity: Math.min(1, 0.45 + amount / 12),
        });
      },
      onHotbarSelect: selectHotbar,
      onHotbarCycle: (direction) => selectHotbar(cycleHotbarIndex(selectedRef.current, direction)),
      onHandAction: (action) => {
        setHandActionToken((value) => value + 1);
        if (action === "attack") audio.play("mobHurt", {
          seed: `local-mob-hit:${performance.now().toFixed(0)}`,
          intensity: 0.68,
        });
      },
      onMovementModeChange: (_mode, activityMultiplier) => {
        survivalActivityRef.current = activityMultiplier;
      },
      onUseSelectedItem: () => {
        const result = consumeFood(inventoryRef.current, selectedRef.current, hungerRef.current);
        if (!result.ok) return false;
        hungerRef.current = result.hunger;
        survivalStateRef.current = { ...survivalStateRef.current, hunger: result.hunger };
        setHunger(result.hunger);
        updateInventory(result.inventory);
        return true;
      },
      onInteractBlock: (target) => {
        const coordKey = `${target.block.x}:${target.block.y}:${target.block.z}`;
        if (target.block.block === BLOCK.BED) {
          const { x, y, z } = target.block;
          return interactWithLocalBed(x, y, z);
        }
        if (target.block.block === BLOCK.CHEST) {
          const opened = openLocalChest(containersRef.current, coordKey);
          if (!opened.ok) {
            setContainerError("This chest could not be opened safely.");
            return true;
          }
          containersRef.current = opened.containers;
          setChestInventory(opened.inventory);
          setActiveChestKey(coordKey);
          setActiveFurnaceKey(null);
          setContainerError("");
          setContainerStatus(opened.created ? "New local chest." : "Local chest opened.");
          if (opened.created) markWorldDirty();
          document.exitPointerLock();
          return true;
        }
        if (target.block.block === BLOCK.FURNACE) {
          const opened = openLocalFurnace(containersRef.current, coordKey, Date.now());
          if (!opened.ok) {
            setContainerError("This furnace could not be opened safely.");
            return true;
          }
          containersRef.current = opened.containers;
          setFurnaceState(opened.furnace);
          setActiveFurnaceKey(coordKey);
          setActiveChestKey(null);
          setContainerError("");
          setContainerStatus(opened.created ? "New local furnace." : "Local furnace opened.");
          if (opened.created) markWorldDirty();
          document.exitPointerLock();
          return true;
        }
        if (target.block.block === BLOCK.SAPLING
          && inventoryRef.current[selectedRef.current]?.itemId === "bone_meal") {
          const localEngine = engineRef.current;
          if (!localEngine) return true;
          const { x, y, z } = target.block;
          const plan = planOakTreeGrowth({
            x,
            y,
            z,
            blockAt: (blockX, blockY, blockZ) => {
              const engineBlock = localEngine.getBlockAt(blockX, blockY, blockZ);
              if (engineBlock === BLOCK.AIR) return "air";
              // Unknown engine-only states (for example an open door) remain
              // solid to the pure planner and can never be overwritten.
              return ENGINE_TO_GAME[engineBlock] ?? "stone";
            },
          });
          if (!plan.ok) {
            setMessages((current) => [...current.slice(-2), {
              id: `oak-blocked-${x}:${y}:${z}`,
              text: "The sapling cannot grow",
              detail: plan.reason === "invalid_support" ? "Oak saplings need dirt or grass beneath them." : "Clear some room around and above it.",
              tone: "warning",
            }]);
            return true;
          }

          const selectedStack = inventoryRef.current[selectedRef.current];
          if (!selectedStack || selectedStack.itemId !== "bone_meal") return true;
          const nextInventory = inventoryRef.current.map((stack, index) => {
            if (index !== selectedRef.current || !stack) return stack ? { ...stack } : null;
            return stack.count > 1 ? { ...stack, count: stack.count - 1 } : null;
          }) as Inventory;
          const growthEdits = plan.edits.map((edit): WorldEdit => ({
            x: edit.x,
            y: edit.y,
            z: edit.z,
            block: edit.block === "log" ? BLOCK.WOOD : BLOCK.LEAVES,
          }));
          const savedEdits = new Map(editsRef.current.map((edit) => [`${edit.x}:${edit.y}:${edit.z}`, edit]));
          for (const edit of growthEdits) savedEdits.set(`${edit.x}:${edit.y}:${edit.z}`, edit);
          editsRef.current = [...savedEdits.values()].slice(-SINGLEPLAYER_SAVE_LIMITS.edits);
          markWorldDirty();
          localEngine.applyWorldEdits(growthEdits);
          updateInventory(nextInventory);
          localEngine.spawnBlockParticles({ action: "place", block: BLOCK.LEAVES, x, y: y + 1, z });
          audio.play("blockPlace", { seed: `grow:${x}:${y}:${z}`, surface: "grass", intensity: 0.72 });
          setMessages((current) => [...current.slice(-2), {
            id: `oak-grown-${x}:${y}:${z}`,
            text: "Oak tree grown",
            detail: "Used one bone meal.",
            tone: "success",
          }]);
          return true;
        }
        if (target.block.block === BLOCK.CRAFTING_TABLE) {
          setCraftingContext("crafting_table");
          setInventoryOpen(true);
          document.exitPointerLock();
          return true;
        }
        if (target.block.block !== BLOCK.TNT
          || target.distance > TNT_IGNITION_REACH
          || inventoryRef.current[selectedRef.current]?.itemId !== "flint_and_steel") return false;
        const { x, y, z } = target.block;
        return primeLocalTnt(x, y, z, TNT_FUSE_MS, 0, true);
      },
      onPoseChange: (pose) => {
        const next = { x: Math.floor(pose.x), y: Math.floor(pose.y), z: Math.floor(pose.z) };
        setCoordinates((current) => {
          if (current.x === next.x && current.y === next.y && current.z === next.z) return current;
          markWorldDirty();
          return next;
        });
        collectLocalDrops(pose);
      },
    });
    engineRef.current = engine;
    if (initialRuntimeRef.current && !engine.importRuntimeSnapshot(initialRuntimeRef.current)) {
      setSaveStatusText("The saved player runtime was invalid; world state was left untouched.");
      saveLockedRef.current = true;
    }
    engine.setDroppedItems(dropsRef.current);
    const respawn = engine.getRespawnPoint();
    const possibleBed = {
      x: Math.round(respawn.x - 0.5),
      y: Math.round(respawn.y - 1.02),
      z: Math.round(respawn.z - 0.5),
    };
    if (respawnPointMatchesBed(respawn, possibleBed.x, possibleBed.y, possibleBed.z)
      && engine.getBlockAt(possibleBed.x, possibleBed.y, possibleBed.z) !== BLOCK.BED) {
      engine.setRespawnPoint(singlePlayerWorldSpawn(worldRef.current.seed));
    }
    engine.start();
    for (const fuse of [...primedTntRef.current]) {
      if (!primeLocalTnt(fuse.x, fuse.y, fuse.z, Math.max(0, fuse.dueAt - Date.now()), 0, false)) {
        primedTntRef.current = primedTntRef.current.filter((candidate) => candidate.eventId !== fuse.eventId);
        markWorldDirty();
      }
    }
    return () => {
      for (const timer of fuseTimers.values()) {
        clearFuseSchedule(timer);
      }
      fuseTimers.clear();
      setLocalFusesPausedRef.current = () => undefined;
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
      performSaveRef.current("quit");
      audio.destroy();
      if (audioRef.current === audio) audioRef.current = null;
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const paused = pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen || document.visibilityState !== "visible";
    engineRef.current?.setPaused(paused);
    setLocalFusesPausedRef.current(paused);
  }, [pauseOpen, inventoryOpen, worldModalOpen, deathScreenOpen]);

  useEffect(() => {
    if (deathScreenOpen) setOptionsOpen(false);
  }, [deathScreenOpen]);

  useEffect(() => {
    const sample = () => {
      const active = !pauseOpen && !inventoryOpen && !worldModalOpen && !deathScreenOpen && document.visibilityState === "visible";
      const now = performance.now();
      const elapsedSeconds = active ? Math.max(0, now - survivalSampledAtRef.current) / 1_000 : 0;
      survivalSampledAtRef.current = now;
      if (active && elapsedSeconds > 0) {
        const survival = tickSurvival(survivalStateRef.current, elapsedSeconds, survivalActivityRef.current);
        const hungerChanged = survival.state.hunger !== hungerRef.current;
        const healthChanged = survival.state.health !== healthRef.current;
        survivalStateRef.current = survival.state;
        if (hungerChanged) {
          hungerRef.current = survival.state.hunger;
          setHunger(survival.state.hunger);
        }
        if (healthChanged) engineRef.current?.setPlayerHealth(survival.state.health);
        if (hungerChanged || healthChanged) markWorldDirty();
      }
      if (active) markWorldDirty();
      const next = sampleSaveCadence(saveCadenceRef.current, now, active);
      saveCadenceRef.current = next.state;
      if (next.autosaveDue) performSaveRef.current("autosave");
    };
    sample();
    const interval = window.setInterval(sample, 1_000);
    const onVisibilityChange = () => {
      const paused = document.visibilityState !== "visible" || pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen;
      engineRef.current?.setPaused(paused);
      setLocalFusesPausedRef.current(paused);
      sample();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pauseOpen, inventoryOpen, worldModalOpen, deathScreenOpen]);

  useEffect(() => {
    if (!sleepingBed) return;
    const timer = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine || engine.getBlockAt(sleepingBed.x, sleepingBed.y, sleepingBed.z) !== BLOCK.BED) {
        setSleepingBed(null);
        return;
      }
      const worldTimeMs = engine.getWorldTimeMs();
      engine.setDayNightClock(
        { epochMs: worldTimeMs, epochPhase: MORNING_PHASE },
        worldTimeMs - Date.now(),
      );
      markWorldDirty();
      setSleepingBed(null);
      setMessages((current) => [...current.slice(-2), {
        id: `wake-${Date.now()}`,
        text: "Good morning",
        detail: "You slept through the night. Click the world to continue.",
        tone: "success",
      }]);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [sleepingBed]);

  useEffect(() => {
    const saveBeforeLeaving = () => { performSaveRef.current("quit"); };
    window.addEventListener("pagehide", saveBeforeLeaving);
    window.addEventListener("beforeunload", saveBeforeLeaving);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      window.removeEventListener("beforeunload", saveBeforeLeaving);
    };
  }, []);

  useEffect(() => {
    const block = ITEM_TO_ENGINE[inventory[selected]?.itemId ?? "stick"] ?? BLOCK.AIR;
    engineRef.current?.setSelectedBlock(block);
  }, [inventory, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      if (event.code === "KeyQ" && !event.repeat) {
        if (pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen || document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        dropLocalSelected(event.ctrlKey || event.metaKey);
        return;
      }
      if ((event.code === "KeyE" || event.code === "Escape") && !event.repeat && containerOpen) {
        event.preventDefault();
        closeActiveContainer();
        return;
      }
      if (event.code === "KeyE" && !event.repeat && !inventoryOpen) {
        event.preventDefault();
        setInventoryOpen(true);
        setCraftingContext("field");
        document.exitPointerLock();
      }
      if (event.code === "Escape" && !inventoryOpen) setPauseOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [optionsOpen, pauseOpen, inventoryOpen, worldModalOpen, containerOpen, deathScreenOpen, activeFurnaceKey]);

  const lastSavedText = lastSavedAt === null ? "Not saved yet"
    : `Last saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  const returnToTitle = () => {
    if (!saveLockedRef.current && !persist("quit")) return;
    window.location.href = window.location.pathname;
  };

  return (
    <main className="lc-singleplayer">
      <style>{`.lc-singleplayer{position:fixed;inset:0;width:100vw;height:100dvh;overflow:hidden;background:#79a7cf}.lc-singleplayer>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.lc-singleplayer-coordinates{color:#fff;font:16px/1.2 var(--lc-pixel-font,"Courier New",monospace);left:8px;letter-spacing:.01em;pointer-events:none;position:fixed;text-shadow:2px 2px #202020;top:7px;z-index:8}`}</style>
      <canvas aria-label="Lakecraft single-player voxel world" ref={canvasRef} tabIndex={0} />
      <span aria-label={`Coordinates X ${coordinates.x}, Y ${coordinates.y}, Z ${coordinates.z}`} className="lc-singleplayer-coordinates">XYZ: {coordinates.x} / {coordinates.y} / {coordinates.z}</span>
      <GameHud
        connected={false}
        craftingContext={craftingContext}
        deathCause="Player died"
        deathScreenOpen={deathScreenOpen}
        equipment={equipment}
        handActionToken={handActionToken}
        health={health}
        hideFirstPersonFeedback={worldModalOpen}
        hunger={hunger}
        inventory={inventory}
        inventoryAuthorityEpoch={0}
        inventoryOpen={inventoryOpen}
        modalOpen={worldModalOpen}
        messages={messages}
        onCloseInventory={() => { setInventoryOpen(false); setCraftingContext("field"); engineRef.current?.requestPointerLock(); }}
        onCrafted={() => undefined}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        disconnectLabel="Save and Quit to Title"
        lastSavedText={lastSavedText}
        onDisconnect={returnToTitle}
        onInventoryWorkspaceChange={(snapshot: StowedInventorySnapshot, _epoch: number, _recipes: readonly InventoryRecipeBatch[]) => {
          inventoryRef.current = snapshot.inventory;
          equipmentRef.current = snapshot.equipment;
          setInventory(snapshot.inventory);
          setEquipment(snapshot.equipment);
          markWorldDirty();
          return true;
        }}
        onInventoryWorkspacePreview={(snapshot) => {
          inventoryRef.current = snapshot.inventory;
          equipmentRef.current = snapshot.equipment;
          markWorldDirty();
        }}
        mouseSensitivity={clientSettings.mouseSensitivity}
        onCloseOptions={() => setOptionsOpen(false)}
        onOptions={() => setOptionsOpen(true)}
        onSensitivityChange={(mouseSensitivity) => updateClientSettings({ ...clientSettingsRef.current, mouseSensitivity })}
        optionsOpen={optionsOpen}
        onRespawn={respawnLocally}
        onResume={() => { setOptionsOpen(false); setPauseOpen(false); engineRef.current?.requestPointerLock(); }}
        onSave={() => { persist("manual"); }}
        onSelectHotbar={selectHotbar}
        onTitleScreen={returnToTitle}
        pauseTitle="Game Menu"
        pauseOpen={pauseOpen}
        playerName="Player"
        selectedIndex={selected}
        saveDisabled={saveLockedRef.current}
        saveInProgress={saveInProgress}
        saveStatusText={saveStatusText}
        respawning={respawning}
        soundMuted={clientSettings.soundMuted}
        onToggleSound={() => {
          const nextMuted = !clientSettingsRef.current.soundMuted;
          updateClientSettings({ ...clientSettingsRef.current, soundMuted: nextMuted });
          if (!nextMuted) {
            void audioRef.current?.unlock().then(() => audioRef.current?.play("uiConfirm", { seed: "local-sound-on", intensity: 0.52 }));
          }
        }}
        worldName="Local World"
      />
      <FurnaceDrawer
        busy={false}
        error={containerError}
        furnace={furnaceState}
        inventory={inventory}
        onClose={() => closeActiveContainer()}
        onTransfer={transferFurnaceStack}
        open={activeFurnaceKey !== null}
        status={containerStatus || "Local chest contents stay in this browser world."}
      />
      <ChestDrawer
        chestInventory={chestInventory}
        error={containerError}
        eyebrow="LOCAL SINGLE-PLAYER CONTAINER"
        onClose={() => closeActiveContainer()}
        onTransfer={transferChestStack}
        open={activeChestKey !== null}
        playerInventory={inventory}
        status={containerStatus}
      />
      {sleepingBed ? (
        <div className="lakecraft-sleep-layer" role="presentation">
          <section className="lakecraft-sleep" role="status" aria-live="polite">
            <small>single-player world</small>
            <h2>Sleeping…</h2>
            <p>Skipping through the night and setting this bed as your respawn point.</p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
