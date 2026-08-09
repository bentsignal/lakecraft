import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChestDrawer, FurnaceDrawer, GameHud, type ChestTransferDirection, type HudMessage } from "../components";
/* @lakecraft-development:imports:start */
import { FirstPersonPoseLab, VisualLab } from "../components";
/* @lakecraft-development:imports:end */
import { ChatOverlay, type LakecraftChatMessage } from "../chat";
import {
  BLOCK,
  MORNING_PHASE,
  createVoxelEngine,
  phaseAtTime,
  planLocalTntExplosion,
  type BlockId as EngineBlockId,
  type LocalExplosionEdit,
  type PlayerProjectileVisual,
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
  countItem,
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
import { FIRST_PERSON_FOOD_ACTION_MS } from "../game/firstPersonRenderer.ts";
import { RANGED_GRAVITY, rangedChargeProfile } from "../../shared/rangedCombat.ts";
import { planDeathDrops } from "../../shared/deathDrops.ts";
import type { StowedInventorySnapshot } from "../../shared/inventoryWorkspace";
import type { InventoryRecipeBatch } from "../../shared/inventoryActions";
import { TNT_FUSE_MS, TNT_IGNITION_REACH } from "../../shared/tntAuthority";
import { planOakTreeGrowth } from "../../shared/treeGrowth";
import { cycleHotbarIndex } from "../game/hotbarInput";
import { createGameAudio, type GameAudio, type GameAudioSurface } from "../game/audio";
import { performanceHudCoreText, performanceHudFpsText } from "../game/performanceHud.ts";
import { clearPersistedPlayerSkin, loadPersistedPlayerSkin } from "../game/playerSkin.ts";
import { copyGameScreenshot, downloadGameScreenshot, gameScreenshotFilename } from "./gameScreenshot.ts";
import {
  fieldOfViewRadians,
  loadClientSettings,
  mouseLookScale,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettings,
} from "../settings";
import {
  SINGLEPLAYER_SAVE_LIMITS,
  browserSinglePlayerStorage,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  resetSinglePlayerSave,
  saveSinglePlayerSnapshot,
  unsupportedSinglePlayerSaveMessage,
  type SinglePlayerLoadResult,
  type SinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
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
  structuredBedForRespawnPoint,
} from "./localBed.ts";
import type { FurnaceState, FurnaceTransferAction } from "../../shared/furnaces.ts";
import type { ChestInventory } from "../../shared/chests.ts";
import {
  appendLocalMobDeathDrops,
  collectLocalDroppedItems,
  collectMovedLocalDroppedItems,
  pruneExpiredLocalDroppedItems,
} from "./localDroppedItems.ts";
import {
  advanceLocalDropGravity,
  createLocalDropGravityClock,
  localDropSimulationChunkKey,
  rebuildActiveLocalDropIndices,
  wakeUnsupportedLocalDroppedItems,
  type LocalDroppedItem,
} from "./localDropGravity.ts";
import {
  canCommitLocalWorldEdits,
  createLocalWorldEditIndex,
  tryCommitLocalWorldEdits,
} from "./localWorldEditJournal.ts";
import {
  singlePlayerDeathMessage,
  singlePlayerStartsDead,
  type SinglePlayerDeathCause,
} from "./deathPresentation.ts";
import { consumeSelectedPlacementStack } from "./localPlacement.ts";
import {
  SINGLE_PLAYER_INITIAL_PAUSE_OPEN,
  beginSinglePlayerPointerLockAttempt,
  consumeSinglePlayerCommandSurfaceEscape,
  createSinglePlayerPointerSessionState,
  orchestrateSinglePlayerInventoryClose,
  releaseBlockedSinglePlayerPointerLockGrant,
  singlePlayerGameplayPaused,
  singlePlayerSilentRecaptureKey,
  transitionSinglePlayerPointerSession,
  type SinglePlayerPointerSessionEvent,
} from "./sessionState.ts";
import {
  LOCAL_COMMAND_HELP,
  LOCAL_COMMAND_PEEK_MS,
  SINGLE_PLAYER_COMMAND_PERMISSIONS,
  canonicalLocalItemIds,
  giveLocalItem,
  localCommandShortcutDraft,
  localTimeClockUpdate,
  parseLocalCommand,
  transitionLocalGameMode,
  type LocalGameMode,
} from "./localCommands.ts";
import { LocalWorldBrowser } from "./LocalWorldBrowser.tsx";
import { recordFirstLocalWorldPlay, type LocalWorldRecord } from "./localWorldRegistry.ts";

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
  prunedDropCount: number;
};

function loadInitialLocalWorld(world: LocalWorldRecord, storage: SinglePlayerStorageAdapter): InitialLocalWorld {
  const now = Date.now();
  const finish = (snapshot: SinglePlayerSnapshot, load: SinglePlayerLoadResult, saveLocked: boolean): InitialLocalWorld => {
    const pruned = pruneExpiredLocalDroppedItems(snapshot.drops, now);
    const currentSnapshot = pruned.removed > 0 ? { ...snapshot, drops: pruned.drops } : snapshot;
    const imported = importLocalContainersSnapshot({ chests: currentSnapshot.chests, furnaces: currentSnapshot.furnaces });
    return {
      snapshot: currentSnapshot,
      containers: imported.ok ? imported.containers : createLocalContainers(),
      load,
      saveLocked: saveLocked || !imported.ok,
      prunedDropCount: pruned.removed,
    };
  };
  try {
    const load = loadSinglePlayerSave(storage, { worldId: world.id });
    if (load.snapshot) return finish(load.snapshot, load, false);
    if (load.status === "empty") {
      const snapshot = createDefaultSinglePlayerSnapshot(world.seed, world.createdAt, world.id);
      snapshot.world.gameMode = world.initialGameMode;
      return finish(snapshot, load, false);
    }
    // Never overwrite corrupt or future-format data with a permissive reset.
    console.error("[Lakecraft save] Local world could not be loaded safely.", {
      status: load.status,
      issues: load.issues,
      ...("reason" in load ? { reason: load.reason } : {}),
      ...("versions" in load ? { versions: load.versions } : {}),
    });
    const snapshot = createDefaultSinglePlayerSnapshot(world.seed, world.createdAt, world.id);
    snapshot.world.gameMode = world.initialGameMode;
    return finish(snapshot, load, true);
  } catch (error) {
    console.error("[Lakecraft save] Browser storage could not be read.", error);
    const load: SinglePlayerLoadResult = {
      status: "corrupt", snapshot: null, sequence: 0, reason: "storage_read_failed", issues: ["storage:unavailable"],
    };
    const snapshot = createDefaultSinglePlayerSnapshot(world.seed, world.createdAt, world.id);
    snapshot.world.gameMode = world.initialGameMode;
    return finish(snapshot, load, true);
  }
}

function SinglePlayerWorld({
  entryPointerLockHandoff = false,
  world,
  onExit,
  storage,
}: {
  entryPointerLockHandoff?: boolean;
  world: LocalWorldRecord;
  onExit: () => void;
  storage: SinglePlayerStorageAdapter;
}) {
  const initial = useRef<InitialLocalWorld | null>(null);
  if (!initial.current) initial.current = loadInitialLocalWorld(world, storage);
  const initialSnapshot = initial.current.snapshot;

  const initialGameMode: LocalGameMode = initialSnapshot.world.gameMode ?? "survival";
  const initialPlayerHealth = initialGameMode === "creative"
    ? MAX_HEALTH
    : initialSnapshot.runtime?.playerHealth ?? MAX_HEALTH;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const entryPointerLockHandoffRef = useRef(entryPointerLockHandoff);
  const pointerSessionRef = useRef(createSinglePlayerPointerSessionState(false));
  const silentPointerRecaptureRef = useRef(false);
  const pointerLockRequestRef = useRef(0);
  const pointerLockPendingRef = useRef(false);
  const pointerSessionMountedRef = useRef(true);
  const inventoryRef = useRef(initialSnapshot.player.inventory);
  const equipmentRef = useRef(initialSnapshot.player.equipment);
  const selectedRef = useRef(initialSnapshot.player.selectedHotbar);
  const editsRef = useRef(createLocalWorldEditIndex(initialSnapshot.world.edits));
  const editCapacityWarningRef = useRef(false);
  const hungerRef = useRef(initialGameMode === "creative" ? MAX_HUNGER : initialSnapshot.player.hunger);
  const healthRef = useRef(initialPlayerHealth);
  const survivalStateRef = useRef(createSurvivalTickState(hungerRef.current, healthRef.current));
  const survivalActivityRef = useRef(0.5);
  const survivalSampledAtRef = useRef(performance.now());
  const dropsRef = useRef<LocalDroppedItem[]>(initialSnapshot.drops);
  const activeDropIndicesRef = useRef(new Set<number>());
  const movedDropIndicesRef = useRef(new Set<number>());
  const dropGravityClockRef = useRef(createLocalDropGravityClock());
  const dropGravityChunkRef = useRef("");
  const worldRef = useRef({
    ...initialSnapshot.world,
    gameMode: initialGameMode,
    weather: { ...initialSnapshot.world.weather },
  });
  const gameModeRef = useRef<LocalGameMode>(initialGameMode);
  const progressionRef = useRef({
    experience: initialSnapshot.progression.experience,
    recipes: [...initialSnapshot.progression.recipes],
    advancements: [...initialSnapshot.progression.advancements],
  });
  const containersRef = useRef<LocalContainers>(initial.current.containers);
  const primedTntRef = useRef(initialSnapshot.primedTnt.map((fuse) => ({ ...fuse })));
  const initialRuntimeRef = useRef(initialSnapshot.runtime);
  const saveCadenceRef = useRef(initial.current.prunedDropCount > 0
    ? markSaveCadenceDirty(createSaveCadenceState(performance.now()))
    : createSaveCadenceState(performance.now()));
  const saveLockedRef = useRef(initial.current.saveLocked);
  const saveInProgressRef = useRef(false);
  const firstPlayRecordedRef = useRef(world.lastPlayedAt > 0);
  const quitSavedRef = useRef(false);
  const performSaveRef = useRef<(reason: "autosave" | "quit") => boolean>(() => false);
  const setLocalFusesPausedRef = useRef<(paused: boolean) => void>(() => undefined);
  const localRespawnBusyRef = useRef(false);
  const pendingDeathCauseRef = useRef<SinglePlayerDeathCause>("unknown");
  const localDropSequenceRef = useRef(0);
  const localArrowSequenceRef = useRef(0);
  const commandMessageSequenceRef = useRef(0);
  const commandHistoryRef = useRef<string[]>([]);
  const commandHistoryIndexRef = useRef(0);
  const commandSurfaceOpenRef = useRef(false);
  const playerProjectilesRef = useRef<PlayerProjectileVisual[]>([]);
  const performanceOutputRef = useRef<HTMLOutputElement | null>(null);
  const fpsOutputRef = useRef<HTMLOutputElement | null>(null);
  const [inventory, setInventory] = useState<Inventory>(initialSnapshot.player.inventory);
  const [equipment, setEquipment] = useState<Equipment>(initialSnapshot.player.equipment);
  const [selected, setSelected] = useState(initialSnapshot.player.selectedHotbar);
  const [hunger, setHunger] = useState(initialGameMode === "creative" ? MAX_HUNGER : initialSnapshot.player.hunger);
  const [health, setHealth] = useState(initialPlayerHealth);
  const [gameMode, setGameMode] = useState<LocalGameMode>(initialGameMode);
  const [deathScreenOpen, setDeathScreenOpen] = useState(() => singlePlayerStartsDead(initialSnapshot.runtime?.playerHealth));
  const [deathCause, setDeathCause] = useState(() => singlePlayerDeathMessage("unknown"));
  const [deathStatus, setDeathStatus] = useState("");
  const [respawning, setRespawning] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(SINGLE_PLAYER_INITIAL_PAUSE_OPEN);
  const [pointerCaptureNeeded, setPointerCaptureNeeded] = useState(true);
  const [silentPointerRecaptureDenied, setSilentPointerRecaptureDenied] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  /* @lakecraft-development:state:start */
  const [visualLabOpen, setVisualLabOpen] = useState(false);
  /* @lakecraft-development:state:end */
  const [clientSettings, setClientSettings] = useState(() => loadClientSettings(storage));
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandDraft, setCommandDraft] = useState("");
  const [commandMessages, setCommandMessages] = useState<LakecraftChatMessage[]>([]);
  const worldModalOpen = containerOpen || sleepingBed !== null;
  const uiModalOpen = worldModalOpen || commandOpen/* @lakecraft-development:modal:start */ || visualLabOpen/* @lakecraft-development:modal:end */;
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0, z: 0 });
  const initialSaveText = initial.current.load.status === "recovered" ? "Recovered the previous good save."
    : initial.current.load.status === "unsupported"
        ? unsupportedSinglePlayerSaveMessage(initial.current.load.versions)
        : initial.current.saveLocked
          ? "This local world could not be read. Saving is disabled; reset it to start fresh."
          : "";
  const [autosaveStatusText, setAutosaveStatusText] = useState(initialSaveText);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const pointerUiBlockedRef = useRef(false);
  pointerUiBlockedRef.current = inventoryOpen || uiModalOpen || deathScreenOpen
    || document.visibilityState !== "visible";

  function clearSilentPointerRecapture(): void {
    silentPointerRecaptureRef.current = false;
    setSilentPointerRecaptureDenied(false);
  }

  function supersedePointerLockRequest(): void {
    pointerLockRequestRef.current += 1;
    pointerLockPendingRef.current = false;
  }

  function requestEnginePointerLock(silent = false, onStarted = () => undefined): void {
    const requestId = ++pointerLockRequestRef.current;
    const engine = engineRef.current;
    beginSinglePlayerPointerLockAttempt(
      () => engine?.requestPointerLock() ?? false,
      () => {
        pointerLockPendingRef.current = Boolean(engine);
        setPointerCaptureNeeded(false);
        onStarted();
      },
      (locked) => {
        if (requestId !== pointerLockRequestRef.current) {
          releaseBlockedSinglePlayerPointerLockGrant(
            locked,
            pointerUiBlockedRef.current,
            pointerSessionRef.current.pauseOpen,
            pointerSessionMountedRef.current,
            () => {
              if (document.pointerLockElement === canvasRef.current) document.exitPointerLock();
            },
          );
          return;
        }
        pointerLockPendingRef.current = false;
        if (locked) {
          clearSilentPointerRecapture();
          setPointerCaptureNeeded(false);
        } else if (silent) {
          silentPointerRecaptureRef.current = true;
          setSilentPointerRecaptureDenied(true);
          setPointerCaptureNeeded(false);
        } else {
          setPointerCaptureNeeded(true);
        }
      },
    );
  }

  function applyPointerSessionEvent(
    event: SinglePlayerPointerSessionEvent,
    onStarted = () => undefined,
  ): void {
    const transition = transitionSinglePlayerPointerSession(pointerSessionRef.current, event);
    pointerSessionRef.current = transition.state;
    const applyUiTransition = () => {
      if (transition.openPause) {
        supersedePointerLockRequest();
        clearSilentPointerRecapture();
        setOptionsOpen(false);
        setPauseOpen(true);
        setPointerCaptureNeeded(false);
      }
      if (transition.closePause) {
        clearSilentPointerRecapture();
        setPauseOpen(false);
      }
      if (transition.showCaptureAffordance) setPointerCaptureNeeded(true);
      onStarted();
    };
    if (transition.requestPointerLock) requestEnginePointerLock(false, applyUiTransition);
    else applyUiTransition();
  }

  function setGamePauseOpen(open: boolean): void {
    if (open) supersedePointerLockRequest();
    applyPointerSessionEvent({ type: "set_pause", open });
    setPauseOpen(open);
    if (open) setPointerCaptureNeeded(false);
  }

  function releasePointerLockForUi(): void {
    entryPointerLockHandoffRef.current = false;
    clearSilentPointerRecapture();
    supersedePointerLockRequest();
    pointerUiBlockedRef.current = true;
    applyPointerSessionEvent({ type: "intentional_release" });
    setPointerCaptureNeeded(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function requestGameplayPointerLock(onStarted = () => undefined): void {
    applyPointerSessionEvent({ type: "resume" }, onStarted);
  }

  function armGameplayResumeAfterEscape(now: number): void {
    silentPointerRecaptureRef.current = true;
    setSilentPointerRecaptureDenied(false);
    setPointerCaptureNeeded(false);
    applyPointerSessionEvent({ type: "close_ui_escape", now });
  }

  function requestGameplayPointerLockAfterEscapeRelease(): void {
    const requestGeneration = pointerLockRequestRef.current;
    let cleanupTimer = 0;
    const onEscapeRelease = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      window.removeEventListener("keyup", onEscapeRelease, true);
      window.clearTimeout(cleanupTimer);
      if (requestGeneration !== pointerLockRequestRef.current
        || !pointerSessionMountedRef.current
        || pointerUiBlockedRef.current
        || pointerSessionRef.current.pauseOpen
        || document.visibilityState !== "visible") return;
      // Waiting for keyup avoids Chrome's native Escape-unlock tail. Browsers
      // that allow re-entry after our earlier programmatic inventory release
      // resume immediately; the existing movement-key fallback remains armed
      // if this quiet attempt is rejected.
      requestEnginePointerLock(true);
    };
    window.addEventListener("keyup", onEscapeRelease, true);
    cleanupTimer = window.setTimeout(() => {
      window.removeEventListener("keyup", onEscapeRelease, true);
    }, 1_000);
  }

  function closeInventoryAndResume(keyboardCode?: "Escape" | "KeyE"): void {
    const closeInventoryUi = () => {
      pointerUiBlockedRef.current = uiModalOpen || deathScreenOpen
        || document.visibilityState !== "visible";
      setInventoryOpen(false);
      setCraftingContext("field");
    };

    orchestrateSinglePlayerInventoryClose(
      keyboardCode,
      () => {
        // A fast pointerlockchange must not reject the trusted E/click grant
        // merely because Preact has not committed the next render yet.
        pointerUiBlockedRef.current = uiModalOpen || deathScreenOpen
          || document.visibilityState !== "visible";
      },
      (onStarted) => requestGameplayPointerLock(onStarted),
      closeInventoryUi,
      () => {
        armGameplayResumeAfterEscape(performance.now());
        requestGameplayPointerLockAfterEscapeRelease();
      },
    );
  }

  function warnWorldEditCapacity(): void {
    if (editCapacityWarningRef.current) return;
    editCapacityWarningRef.current = true;
    setMessages((current) => [...current.slice(-2), {
      id: "local-world-edit-capacity",
      text: "World save full",
      detail: "New terrain changes are blocked; existing saved coordinates remain editable.",
      tone: "warning",
    }]);
  }

  function acceptLocalWorldEdits(edits: readonly WorldEdit[]): boolean {
    const accepted = tryCommitLocalWorldEdits(editsRef.current, edits, SINGLEPLAYER_SAVE_LIMITS.edits);
    if (!accepted) warnWorldEditCapacity();
    else editCapacityWarningRef.current = false;
    return accepted;
  }

  function updateClientSettings(value: ClientSettings): void {
    const next = normalizeClientSettings(value);
    const soundChanged = clientSettingsRef.current.soundMuted !== next.soundMuted;
    clientSettingsRef.current = next;
    setClientSettings(next);
    saveClientSettings(storage, next);
    if (soundChanged) audioRef.current?.setMuted(next.soundMuted);
  }

  function markWorldDirty(): void {
    const cadence = saveCadenceRef.current;
    if (cadence.dirtyRevision === cadence.savedRevision) {
      saveCadenceRef.current = markSaveCadenceDirty(cadence);
    }
  }

  function syncLocalDropGravity(engine = engineRef.current): void {
    if (!engine) return;
    const pose = engine.getPose();
    dropGravityChunkRef.current = localDropSimulationChunkKey(pose.x, pose.z);
    const rebuilt = rebuildActiveLocalDropIndices(
      dropsRef.current,
      activeDropIndicesRef.current,
      pose.x,
      pose.z,
      (x, y, z) => engine.getBlockAt(x, y, z),
    );
    if (rebuilt.woken > 0) markWorldDirty();
  }

  function buildSnapshot(): SinglePlayerSnapshot | null {
    const containers = exportLocalContainersSnapshot(containersRef.current, Date.now());
    if (!containers.ok) return null;
    containersRef.current = containers.containers;
    const activePlayMs = Math.floor(Math.min(
      Number.MAX_SAFE_INTEGER,
      worldRef.current.activePlayMs + saveCadenceRef.current.activePlayMsSinceSave,
    ));
    return {
      world: {
        ...worldRef.current,
        activePlayMs,
        weather: { ...worldRef.current.weather },
        edits: [...editsRef.current.values()].map((edit) => ({ ...edit })),
        beds: engineRef.current?.exportBedStructures() ?? worldRef.current.beds ?? [],
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

  function persist(reason: "autosave" | "quit"): boolean {
    if (saveLockedRef.current || saveInProgressRef.current) return false;
    const action = reason === "quit" ? "Save and Quit" : "Autosave";
    const snapshot = buildSnapshot();
    if (!snapshot) {
      setAutosaveStatusText(`${action} failed: invalid local container state.`);
      return false;
    }
    saveInProgressRef.current = true;
    const now = Date.now();
    const result = saveSinglePlayerSnapshot(storage, snapshot, now, { worldId: world.id });
    if (!result.ok) {
      saveInProgressRef.current = false;
      console.error("[Lakecraft save] Snapshot commit rejected.", {
        reason: result.reason,
        path: result.path,
        previousSequence: result.previousSequence,
      });
      setAutosaveStatusText(result.reason === "too_large" ? `${action} failed: this world exceeds browser storage limits.`
        : result.reason === "unsafe_existing_data" ? `${action} blocked to protect existing world data.`
          : result.path?.startsWith("$.runtime") ? `${action} failed: player state could not be validated. Your previous save is safe.`
            : `${action} failed. Your previous save is safe.`);
      if (result.reason === "unsafe_existing_data") saveLockedRef.current = true;
      return false;
    }
    let firstPlayMetadataPending = false;
    if (!firstPlayRecordedRef.current) {
      const recorded = recordFirstLocalWorldPlay(storage, world, now);
      if (!recorded.ok) {
        console.error("[Lakecraft save] First-play metadata commit rejected.", recorded);
        firstPlayMetadataPending = true;
      } else {
        firstPlayRecordedRef.current = true;
      }
    }
    saveInProgressRef.current = false;
    worldRef.current = {
      ...snapshot.world,
      gameMode: snapshot.world.gameMode ?? "survival",
      weather: { ...snapshot.world.weather },
    };
    initialRuntimeRef.current = snapshot.runtime;
    saveCadenceRef.current = commitSaveCadence(saveCadenceRef.current, performance.now(), !engineRef.current?.isPaused());
    if (reason === "autosave") setLastAutosavedAt(now);
    setAutosaveStatusText(firstPlayMetadataPending
      ? `${action} complete. World activity will update on the next save or entry.`
      : "");
    return true;
  }
  performSaveRef.current = persist;

  function resetUnreadableWorld(): void {
    const confirmed = window.confirm(
      "Reset this local world? This permanently deletes its saved blocks, inventory, and progress. This cannot be undone.",
    );
    if (!confirmed) return;
    const result = resetSinglePlayerSave(storage, { worldId: world.id });
    if (!result.ok) {
      console.error("[Lakecraft save] Explicit local world reset failed.", result);
      setAutosaveStatusText(result.mutationStarted
        ? "Reset stopped partway. Saving remains disabled; reload before trying again."
        : "Reset did not start. Your saved world data was left unchanged.");
      return;
    }
    window.location.reload();
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
    markWorldDirty();
  }

  function appendCommandMessage(
    body: string,
    tone: "player" | "system" | "warning",
  ): void {
    const sequence = ++commandMessageSequenceRef.current;
    setCommandMessages((current) => [...current.slice(-59), {
      id: `local-command-${sequence}`,
      username: tone === "player" ? "Command" : tone === "warning" ? "Error" : "Game",
      body,
      sentAt: Date.now(),
      own: tone === "player",
      tone,
      delivery: "sent",
    }]);
  }

  function changeLocalGameMode(mode: LocalGameMode): void {
    const next = transitionLocalGameMode({
      mode: gameModeRef.current,
      health: healthRef.current,
      hunger: hungerRef.current,
      inventory: inventoryRef.current,
      equipment: equipmentRef.current,
    }, mode);
    gameModeRef.current = mode;
    worldRef.current = { ...worldRef.current, gameMode: mode };
    healthRef.current = next.health;
    hungerRef.current = next.hunger;
    survivalStateRef.current = createSurvivalTickState(next.hunger, next.health);
    inventoryRef.current = next.inventory;
    equipmentRef.current = next.equipment;
    setGameMode(mode);
    setHealth(next.health);
    setHunger(next.hunger);
    setInventory(next.inventory);
    setEquipment(next.equipment);
    engineRef.current?.setPlayerHealth(next.health);
    if (mode === "creative") {
      pendingDeathCauseRef.current = "unknown";
      setDeathScreenOpen(false);
      setDeathStatus("");
    }
    markWorldDirty();
  }

  function submitLocalCommand(source: string): void {
    const normalized = source.trim();
    const history = commandHistoryRef.current;
    if (history[history.length - 1] !== normalized) {
      commandHistoryRef.current = [...history.slice(-49), normalized];
    }
    commandHistoryIndexRef.current = commandHistoryRef.current.length;
    appendCommandMessage(normalized, "player");
    setCommandDraft("");
    const parsed = parseLocalCommand(normalized, SINGLE_PLAYER_COMMAND_PERMISSIONS);
    if (!parsed.ok) {
      appendCommandMessage(parsed.message, "warning");
      return;
    }
    if (parsed.command.kind === "help") {
      appendCommandMessage(`Commands: ${LOCAL_COMMAND_HELP.join(" · ")}`, "system");
      appendCommandMessage(`Item IDs: ${canonicalLocalItemIds().join(", ")}`, "system");
      return;
    }
    if (parsed.command.kind === "gamemode") {
      changeLocalGameMode(parsed.command.mode);
      appendCommandMessage(`Game mode set to ${parsed.command.mode}.`, "system");
      return;
    }
    if (parsed.command.kind === "time") {
      const engine = engineRef.current;
      if (!engine) {
        appendCommandMessage("The world clock is not ready.", "warning");
        return;
      }
      const update = localTimeClockUpdate(engine.getWorldTimeMs(), Date.now(), parsed.command.time);
      engine.setDayNightClock(update.config, update.serverTimeOffsetMs);
      markWorldDirty();
      appendCommandMessage(`Time set to ${parsed.command.time}.`, "system");
      return;
    }
    if (parsed.command.kind === "gamerule") {
      const engine = engineRef.current;
      if (!engine) {
        appendCommandMessage("The world clock is not ready.", "warning");
        return;
      }
      engine.setDaylightCycle(parsed.command.value);
      markWorldDirty();
      appendCommandMessage(`Daylight cycle ${parsed.command.value ? "enabled" : "disabled"}.`, "system");
      return;
    }
    if (parsed.command.kind === "locate") {
      const cave = engineRef.current?.findNearestCave() ?? null;
      appendCommandMessage(cave
        ? `Nearest loaded cave floor: ${cave[0]}, ${cave[1]}, ${cave[2]}.`
        : "No cave was found within 32 blocks of the loaded world.", cave ? "system" : "warning");
      return;
    }
    const granted = giveLocalItem(inventoryRef.current, parsed.command.itemId, parsed.command.count);
    if (!granted.ok) {
      appendCommandMessage(granted.message, "warning");
      return;
    }
    updateInventory(granted.inventory);
    appendCommandMessage(`Gave ${parsed.command.count} ${ITEMS[parsed.command.itemId].label}.`, "system");
  }

  function closeCommandConsole(): void {
    commandSurfaceOpenRef.current = false;
    setCommandOpen(false);
    commandHistoryIndexRef.current = commandHistoryRef.current.length;
    requestGameplayPointerLock();
  }

  function closeCommandConsoleFromEscape(now: number): void {
    commandSurfaceOpenRef.current = false;
    setCommandOpen(false);
    commandHistoryIndexRef.current = commandHistoryRef.current.length;
    armGameplayResumeAfterEscape(now);
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
        markWorldDirty();
      }
    }
    setActiveChestKey(null);
    setActiveFurnaceKey(null);
    setContainerError("");
    setContainerStatus("");
    if (requestPointerLock) requestGameplayPointerLock();
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
    pruneLocalDrops();
    const coordKey = `${x}:${y}:${z}`;
    const recovered = recoverLocalContainerContents(
      containersRef.current,
      coordKey,
      inventoryRef.current,
      SINGLEPLAYER_SAVE_LIMITS.drops - dropsRef.current.length,
      Date.now(),
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
    const recoveredDrops = recovered.overflow.map((stack, index): LocalDroppedItem => ({
      dropId: `local_container_${droppedAt}_${x}_${y}_${z}_${index}`.slice(0, 96),
      item: { ...stack },
      x: x + 0.35 + (index % 3) * 0.15,
      y: y + 0.45,
      z: z + 0.35 + (Math.floor(index / 3) % 3) * 0.15,
      droppedAt,
      velocityY: 0,
      settled: false,
    }));
    inventoryRef.current = recovered.inventory;
    dropsRef.current = [...dropsRef.current, ...recoveredDrops];
    syncLocalDropGravity();
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
    const bed = engine.getBedAt(x, y, z);
    const anchor = bed?.head ?? { x, y, z };
    engine.setRespawnPoint(respawnPointForBed(anchor.x, anchor.y, anchor.z, engine.getPose().yaw));
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
    setSleepingBed(anchor);
    releasePointerLockForUi();
    return true;
  }

  function collectLocalDrops(pose: { x: number; y: number; z: number }): void {
    if (healthRef.current <= 0 || dropsRef.current.length === 0) return;
    const collected = collectLocalDroppedItems(inventoryRef.current, dropsRef.current, pose);
    if (!collected.changed) return;
    inventoryRef.current = collected.inventory;
    dropsRef.current = collected.drops;
    syncLocalDropGravity();
    setInventory(collected.inventory);
    engineRef.current?.setDroppedItems(collected.drops);
    markWorldDirty();
  }

  function pruneLocalDrops(now = Date.now()): boolean {
    const pruned = pruneExpiredLocalDroppedItems(dropsRef.current, now);
    if (pruned.removed === 0) return false;
    dropsRef.current = pruned.drops;
    syncLocalDropGravity();
    engineRef.current?.setDroppedItems(pruned.drops);
    markWorldDirty();
    return true;
  }

  function dropLocalSelected(wholeStack: boolean): void {
    pruneLocalDrops();
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
    const dropped: LocalDroppedItem = {
      dropId: `local_drop_${droppedAt}_${localDropSequenceRef.current}`.slice(0, 96),
      item: { ...source, count },
      x: pose.x + Math.sin(pose.yaw) * 2.25,
      y: pose.y + 1.1,
      z: pose.z - Math.cos(pose.yaw) * 2.25,
      droppedAt,
      velocityY: 0,
      settled: false,
    };
    inventoryRef.current = next;
    dropsRef.current = [...dropsRef.current, dropped];
    syncLocalDropGravity(engine);
    setInventory(next);
    engine.setDroppedItems(dropsRef.current);
    markWorldDirty();
  }

  function respawnLocally(): void {
    if (localRespawnBusyRef.current || !engineRef.current) return;
    pruneLocalDrops();
    localRespawnBusyRef.current = true;
    setDeathStatus("");
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
      setDeathStatus("Respawn failed. Your carried items were left untouched.");
      localRespawnBusyRef.current = false;
      setRespawning(false);
      return;
    }
    if (dropsRef.current.length + plan.drops.length > SINGLEPLAYER_SAVE_LIMITS.drops) {
      setDeathStatus("Respawn blocked. Too many saved items are already lying in this world; your pack was not changed.");
      localRespawnBusyRef.current = false;
      setRespawning(false);
      return;
    }
    const drops = plan.drops.map((drop): LocalDroppedItem => ({
      dropId: drop.operationId,
      item: drop.stack,
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
      droppedAt: deathAt,
      velocityY: 0,
      settled: false,
    }));
    dropsRef.current = [...dropsRef.current, ...drops];
    syncLocalDropGravity(engine);
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
      && !structuredBedForRespawnPoint(respawn, (x, y, z) => engine.getBedAt(x, y, z))) {
      engine.setRespawnPoint(singlePlayerWorldSpawn(worldRef.current.seed));
    }
    engine.respawn();
    pendingDeathCauseRef.current = "unknown";
    setDeathCause(singlePlayerDeathMessage("unknown"));
    setDeathStatus("");
    setDeathScreenOpen(false);
    localRespawnBusyRef.current = false;
    setRespawning(false);
    requestGameplayPointerLock();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let foodUseTimer: number | null = null;
    pointerSessionMountedRef.current = true;
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
      const prospectiveDestruction = planLocalTntExplosion(
        x,
        y,
        z,
        (blockX, blockY, blockZ) => engineRef.current?.getBlockAt(blockX, blockY, blockZ) ?? BLOCK.AIR,
      ).filter((edit) => !edit.chainPrimed);
      if (!canCommitLocalWorldEdits(editsRef.current, prospectiveDestruction, SINGLEPLAYER_SAVE_LIMITS.edits)) {
        warnWorldEditCapacity();
        return false;
      }
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
      if (spendTool && gameModeRef.current === "survival") {
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
      const explode = () => {
        const timer = fuseTimers.get(key);
        if (timer) clearFuseSchedule(timer);
        fuseTimers.delete(key);
        const edits = engineRef.current?.explodeTnt(x, y, z) ?? [];
        primedTntRef.current = primedTntRef.current.filter((fuse) => fuse.x !== x || fuse.y !== y || fuse.z !== z);
        markWorldDirty();
        if (!edits.length && engineRef.current?.getBlockAt(x, y, z) === BLOCK.TNT) {
          engineRef.current.setPrimedTnt(x, y, z, false);
          return;
        }
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
        markWorldDirty();
        if (wakeUnsupportedLocalDroppedItems(
          dropsRef.current,
          destruction,
          (x, y, z) => engineRef.current?.getBlockAt(x, y, z) ?? BLOCK.AIR,
        ) > 0) {
          syncLocalDropGravity();
          engineRef.current?.setDroppedItems(dropsRef.current);
        }
      }
      audio.play("explosion", { seed: key, intensity: 1 });
      if (cascadeDepth < 8) {
        for (const edit of edits.filter((candidate) => candidate.chainPrimed).slice(0, 8)) {
          const hash = Math.abs(Math.imul(edit.x, 73_856_093) ^ Math.imul(edit.y, 19_349_663)
            ^ Math.imul(edit.z, 83_492_791) ^ cascadeDepth);
          primeLocalTnt(edit.x, edit.y, edit.z, 500 + hash % 1_001, cascadeDepth + 1, false);
        }
      }
    }
    const engine = createVoxelEngine(canvas, {
      seed: worldRef.current.seed,
      streamingChunkRadius: clientSettingsRef.current.renderDistance,
      initialEdits: [...editsRef.current.values()],
      initialBedStructures: initialSnapshot.world.beds ?? [],
      twoBlockBeds: true,
      initialPose: initialRuntimeRef.current?.pose,
      preserveInitialPose: Boolean(initialRuntimeRef.current),
      getMouseLookSensitivity: () => mouseLookScale(clientSettingsRef.current.mouseSensitivity),
      getFieldOfViewRadians: () => fieldOfViewRadians(clientSettingsRef.current.fovDegrees),
      onSimulationStep: (elapsedSeconds) => {
        const localEngine = engineRef.current;
        if (!localEngine || dropsRef.current.length === 0) return;
        const pose = localEngine.getPose();
        const chunk = localDropSimulationChunkKey(pose.x, pose.z);
        if (chunk !== dropGravityChunkRef.current) syncLocalDropGravity(localEngine);
        const gravity = advanceLocalDropGravity(
          dropsRef.current,
          activeDropIndicesRef.current,
          dropGravityClockRef.current,
          elapsedSeconds,
          (x, y, z) => localEngine.getBlockAt(x, y, z),
          movedDropIndicesRef.current,
        );
        if (!gravity.changed) return;
        const collected = collectMovedLocalDroppedItems(
          inventoryRef.current,
          dropsRef.current,
          movedDropIndicesRef.current,
          pose,
        );
        if (collected.changed) {
          inventoryRef.current = collected.inventory;
          dropsRef.current = collected.drops;
          syncLocalDropGravity(localEngine);
          setInventory(collected.inventory);
        }
        localEngine.setDroppedItems(dropsRef.current);
        markWorldDirty();
      },
      onPointerLockChange: (locked) => {
        const entryHandoffActive = entryPointerLockHandoffRef.current
          && document.pointerLockElement === document.documentElement
          && !pointerUiBlockedRef.current;
        if (entryHandoffActive) {
          entryPointerLockHandoffRef.current = false;
          setPointerCaptureNeeded(true);
          engineRef.current?.requestPointerLock();
          return;
        }
        if (releaseBlockedSinglePlayerPointerLockGrant(
          locked,
          pointerUiBlockedRef.current,
          pointerSessionRef.current.pauseOpen,
          pointerSessionMountedRef.current,
          () => {
            supersedePointerLockRequest();
            if (document.pointerLockElement === canvas) document.exitPointerLock();
          },
        )) return;
        // The browser can deliver the tail of Escape's unlock after the user
        // has clicked Back to Game. The in-flight request's own result owns
        // denial; this stale unlocked notification must not mount Click to Play.
        if (!locked && pointerLockPendingRef.current) return;
        if (locked) pointerLockPendingRef.current = false;
        applyPointerSessionEvent({
          type: "lock_change",
          locked,
          now: performance.now(),
          uiBlocked: pointerUiBlockedRef.current,
        });
        if (locked) clearSilentPointerRecapture();
        setPointerCaptureNeeded(
          !locked && !pointerUiBlockedRef.current && !silentPointerRecaptureRef.current
            && !pointerSessionRef.current.pauseOpen,
        );
      },
      allowUnlockedKeyboardInput: () => silentPointerRecaptureRef.current,
      selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
      selectedItem: inventoryRef.current[selectedRef.current]?.itemId ?? null,
      getMiningDuration: (block) => {
        if (gameModeRef.current === "creative") return 0;
        const gameBlock = ENGINE_TO_GAME[block];
        return gameBlock ? miningSeconds(gameBlock, inventoryRef.current[selectedRef.current]?.itemId) : 0.2;
      },
      getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
      isRangedWeaponSelected: () => inventoryRef.current[selectedRef.current]?.itemId === "bow"
        && (gameModeRef.current === "creative" || countItem(inventoryRef.current, "arrow") > 0),
      onRangedRelease: (intent) => {
        const profile = rangedChargeProfile(intent.chargeMs);
        const slot = selectedRef.current;
        if (!profile || inventoryRef.current[slot]?.itemId !== "bow") return;
        const creative = gameModeRef.current === "creative";
        const bowUse = creative
          ? { inventory: inventoryRef.current, used: true, broke: false }
          : applyConfirmedDurableItemUse(inventoryRef.current, slot, "bow");
        if (!bowUse.used) return;
        if (!creative) {
          const arrowUse = removeItem(bowUse.inventory, "arrow", 1);
          if (arrowUse.remainder !== 0) return;
          updateInventory(arrowUse.inventory);
        }
        const launchedAt = performance.now();
        const flightMs = Math.max(80, Math.min(5_000, intent.target.distance / profile.speed * 1_000));
        const projectile: PlayerProjectileVisual = {
          projectileId: `local_arrow_${++localArrowSequenceRef.current}`,
          originX: intent.origin[0],
          originY: intent.origin[1],
          originZ: intent.origin[2],
          velocityX: intent.direction[0] * profile.speed,
          velocityY: intent.direction[1] * profile.speed,
          velocityZ: intent.direction[2] * profile.speed,
          launchedAt,
          expiresAt: launchedAt + flightMs,
          gravity: RANGED_GRAVITY,
        };
        playerProjectilesRef.current = [
          ...playerProjectilesRef.current.filter((candidate) => candidate.launchedAt + 5_000 > launchedAt),
          projectile,
        ].slice(-96);
        engine.setPlayerProjectiles(playerProjectilesRef.current);
        audio.play("playerAttack", { seed: projectile.projectileId, intensity: 0.62 });
        if (intent.target.kind === "mob") {
          const hit = engine.damageLocalMobWithRangedShot(
            intent.target.id,
            profile.damage,
            projectile.projectileId,
            intent.origin[0],
            intent.origin[2],
          );
          if (hit.applied) audio.play(hit.killed ? "mobDeath" : "mobHurt", {
            seed: `${projectile.projectileId}:${intent.target.id}`,
            intensity: hit.killed ? 0.9 : 0.7,
            mob: intent.target.mobKind,
          });
        }
      },
      getPlayerProtection: () => equippedArmorProtection(equipmentRef.current),
      canTakePlayerDamage: () => gameModeRef.current === "survival",
      canCreativeFly: () => gameModeRef.current === "creative",
      canMobsTargetPlayer: () => gameModeRef.current === "survival",
      canSprint: () => hungerRef.current > 6 || gameModeRef.current === "creative",
      continuousBlockPlacement: true,
      canPlaceSelectedBlock: (block) => {
        const stack = inventoryRef.current[selectedRef.current];
        return Boolean(stack && stack.count > 0 && ITEM_TO_ENGINE[stack.itemId] === block);
      },
      canMineBlock: (block) => {
        if (gameModeRef.current === "creative") return true;
        pruneLocalDrops();
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
      acceptWorldEdits: acceptLocalWorldEdits,
      onFootstep: (block) => audio.play("footstep", {
        seed: `local-step:${block}:${performance.now().toFixed(0)}`,
        surface: audioSurfaceForBlock(block),
        intensity: 0.5,
      }),
      onBlockEdit: (edit, previousBlock, journalEdits) => {
        if ((previousBlock === BLOCK.CHEST || previousBlock === BLOCK.FURNACE) && edit.block !== previousBlock) {
          settleBrokenContainerContents(edit.x, edit.y, edit.z, previousBlock);
        }
        if (previousBlock === BLOCK.BED && edit.block !== BLOCK.BED) {
          invalidateBrokenBed(edit.x, edit.y, edit.z);
          for (const pairedEdit of journalEdits) {
            if (pairedEdit.block !== BLOCK.BED) invalidateBrokenBed(pairedEdit.x, pairedEdit.y, pairedEdit.z);
          }
        }
        markWorldDirty();
        const supportWoken = wakeUnsupportedLocalDroppedItems(
          dropsRef.current,
          [edit, ...journalEdits],
          (x, y, z) => engine.getBlockAt(x, y, z),
        );
        const held = inventoryRef.current[selectedRef.current]?.itemId ?? null;
        let next = inventoryRef.current;
        const toggledBlock = (previousBlock === BLOCK.DOOR_CLOSED && edit.block === BLOCK.DOOR_OPEN)
          || (previousBlock === BLOCK.DOOR_OPEN && edit.block === BLOCK.DOOR_CLOSED)
          || (previousBlock === BLOCK.OAK_FENCE_GATE_CLOSED && edit.block === BLOCK.OAK_FENCE_GATE_OPEN)
          || (previousBlock === BLOCK.OAK_FENCE_GATE_OPEN && edit.block === BLOCK.OAK_FENCE_GATE_CLOSED);
        const creative = gameModeRef.current === "creative";
        if (!creative && !toggledBlock && edit.block === BLOCK.AIR && previousBlock !== BLOCK.AIR) {
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
              velocityY: 0,
              settled: false,
            }];
            syncLocalDropGravity(engine);
            engine.setDroppedItems(dropsRef.current);
          }
        } else if (!creative && !toggledBlock && previousBlock === BLOCK.AIR && edit.block !== BLOCK.AIR) {
          const placedItem = ENGINE_TO_GAME[edit.block];
          const selectedSlot = selectedRef.current;
          const selectedStack = next[selectedSlot];
          if (!placedItem || ITEM_TO_ENGINE[placedItem] !== edit.block || selectedStack?.itemId !== placedItem) {
            throw new Error("Accepted local placement no longer matches the selected stack.");
          }
          const payment = consumeSelectedPlacementStack(next, selectedSlot, placedItem);
          if (!payment.ok) throw new Error("Accepted local placement could not consume its selected stack.");
          next = payment.inventory;
          const nextSelected = next[selectedSlot];
          engine.setSelectedBlock(nextSelected ? ITEM_TO_ENGINE[nextSelected.itemId] ?? BLOCK.AIR : BLOCK.AIR);
        }
        updateInventory(next);
        if (supportWoken > 0) {
          syncLocalDropGravity(engine);
          engine.setDroppedItems(dropsRef.current);
        }
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
        pruneLocalDrops();
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
        if (appended.added > 0) {
          syncLocalDropGravity(engine);
          engine.setDroppedItems(appended.drops);
        }
        markWorldDirty();
        return true;
      },
      onLocalCreeperExplosion: ({ mobId, edits }) => {
        recordLocalExplosion(`creeper:${mobId}`, edits, 0);
        markWorldDirty();
      },
      onLocalMobHit: (kind, killed) => {
        audio.play(killed ? "mobDeath" : "mobHurt", {
          seed: `local-mob-hit:${kind}:${performance.now().toFixed(0)}`,
          intensity: killed ? 0.9 : 0.68,
          mob: kind,
        });
        if (gameModeRef.current === "creative") return;
        const slot = selectedRef.current;
        const held = inventoryRef.current[slot]?.itemId ?? null;
        const wear = applyConfirmedToolUse(inventoryRef.current, slot, "attack", held);
        if (!wear.used) return;
        updateInventory(wear.inventory);
      },
      onMobIdle: (kind, mobId, intensity, pan) => audio.play("mobIdle", { seed: mobId, mob: kind, intensity, pan }),
      onMobUse: (target) => {
        if (target.kind !== "sheep" || inventoryRef.current[selectedRef.current]?.itemId !== "shears") return false;
        let acceptedInventory: Inventory | null = null;
        const result = engine.shearMob(target.id, (woolCount) => {
          const wear = gameModeRef.current === "creative"
            ? { inventory: inventoryRef.current, used: true, broke: false }
            : applyConfirmedDurableItemUse(inventoryRef.current, selectedRef.current, "shears");
          if (!wear.used) return false;
          const added = addItem(wear.inventory, "wool", woolCount);
          if (added.remainder !== 0) return false;
          acceptedInventory = added.inventory;
          return true;
        });
        if (result.ok && acceptedInventory) {
          updateInventory(acceptedInventory);
          audio.play("pickup", { seed: `${target.id}:${result.woolCount}`, intensity: 0.58 });
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
        if (nextHealth > 0) {
          pendingDeathCauseRef.current = "unknown";
          return;
        }
        setDeathCause(singlePlayerDeathMessage(pendingDeathCauseRef.current));
        pendingDeathCauseRef.current = "unknown";
        setDeathStatus("");
        setDeathScreenOpen(true);
        setGamePauseOpen(false);
        setInventoryOpen(false);
        setActiveChestKey(null);
        setActiveFurnaceKey(null);
        releasePointerLockForUi();
      },
      onPlayerDamage: (amount, cause) => {
        if (amount > 0) pendingDeathCauseRef.current = cause;
        if (amount > 0 && cause !== "fall") {
          const armorDamage = applyConfirmedArmorDamage(equipmentRef.current);
          if (armorDamage.damaged.length > 0) {
            equipmentRef.current = armorDamage.equipment;
            setEquipment(armorDamage.equipment);
            markWorldDirty();
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
        if (action === "attack") audio.play("playerAttack", {
          seed: `local-mob-hit:${performance.now().toFixed(0)}`,
          intensity: 0.68,
        });
      },
      onMovementModeChange: (_mode, activityMultiplier) => {
        survivalActivityRef.current = activityMultiplier;
      },
      onUseSelectedItem: () => {
        if (gameModeRef.current === "creative") return false;
        if (foodUseTimer !== null) return false;
        const selectedSlot = selectedRef.current;
        const selectedStack = inventoryRef.current[selectedSlot];
        if (!selectedStack || !consumeFood(inventoryRef.current, selectedSlot, hungerRef.current).ok) return false;
        foodUseTimer = window.setTimeout(() => {
          foodUseTimer = null;
          if (inventoryRef.current[selectedSlot] !== selectedStack) return;
          const result = consumeFood(inventoryRef.current, selectedSlot, hungerRef.current);
          if (!result.ok) return;
          hungerRef.current = result.hunger;
          survivalStateRef.current = { ...survivalStateRef.current, hunger: result.hunger };
          setHunger(result.hunger);
          updateInventory(result.inventory);
        }, FIRST_PERSON_FOOD_ACTION_MS);
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
          releasePointerLockForUi();
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
          releasePointerLockForUi();
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
          const creative = gameModeRef.current === "creative";
          const nextInventory = creative ? inventoryRef.current : inventoryRef.current.map((stack, index) => {
            if (index !== selectedRef.current || !stack) return stack ? { ...stack } : null;
            return stack.count > 1 ? { ...stack, count: stack.count - 1 } : null;
          }) as Inventory;
          const growthEdits = plan.edits.map((edit): WorldEdit => ({
            x: edit.x,
            y: edit.y,
            z: edit.z,
            block: edit.block === "log" ? BLOCK.WOOD : BLOCK.LEAVES,
          }));
          if (!localEngine.applyWorldEdits(growthEdits)) return true;
          markWorldDirty();
          updateInventory(nextInventory);
          localEngine.spawnBlockParticles({ action: "place", block: BLOCK.LEAVES, x, y: y + 1, z });
          audio.play("blockPlace", { seed: `grow:${x}:${y}:${z}`, surface: "grass", intensity: 0.72 });
          return true;
        }
        if (target.block.block === BLOCK.CRAFTING_TABLE) {
          setCraftingContext("crafting_table");
          setInventoryOpen(true);
          releasePointerLockForUi();
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
      onPerformanceStats: (stats) => {
        if (fpsOutputRef.current) fpsOutputRef.current.textContent = performanceHudFpsText(stats);
        if (performanceOutputRef.current && !performanceOutputRef.current.hidden) {
          performanceOutputRef.current.textContent = performanceHudCoreText(stats);
        }
      },
    });
    engineRef.current = engine;
    const persistedSkin = loadPersistedPlayerSkin(storage);
    if (persistedSkin) {
      const image = new Image();
      image.onload = () => {
        if (engineRef.current !== engine) return;
        if (image.naturalWidth !== persistedSkin.width || image.naturalHeight !== persistedSkin.height) {
          clearPersistedPlayerSkin(storage);
          return;
        }
        engine.setPlayerSkin(image, persistedSkin.model);
      };
      image.onerror = () => clearPersistedPlayerSkin(storage);
      image.src = persistedSkin.dataUrl;
    }
    engine.setPlayerArmor({
      head: equipmentRef.current.head?.itemId ?? null,
      chest: equipmentRef.current.chest?.itemId ?? null,
      legs: equipmentRef.current.legs?.itemId ?? null,
      feet: equipmentRef.current.feet?.itemId ?? null,
    });
    engine.setFirstPersonFeedbackHidden(worldModalOpen || deathScreenOpen || commandOpen);
    if (initialRuntimeRef.current && !engine.importRuntimeSnapshot(initialRuntimeRef.current)) {
      setAutosaveStatusText("The saved player runtime was invalid; world state was left untouched.");
      saveLockedRef.current = true;
    }
    if (gameModeRef.current === "creative") engine.setPlayerHealth(MAX_HEALTH);
    syncLocalDropGravity(engine);
    engine.setDroppedItems(dropsRef.current);
    const respawn = engine.getRespawnPoint();
    const possibleBed = {
      x: Math.round(respawn.x - 0.5),
      y: Math.round(respawn.y - 1.02),
      z: Math.round(respawn.z - 0.5),
    };
    if (respawnPointMatchesBed(respawn, possibleBed.x, possibleBed.y, possibleBed.z)
      && !structuredBedForRespawnPoint(respawn, (x, y, z) => engine.getBedAt(x, y, z))) {
      engine.setRespawnPoint(singlePlayerWorldSpawn(worldRef.current.seed));
    }
    const initiallyPaused = singlePlayerGameplayPaused({
      pauseOpen,
      inventoryOpen,
      worldModalOpen,
      deathScreenOpen,
      pointerCaptureNeeded,
      documentVisible: document.visibilityState === "visible",
    });
    engine.setPaused(initiallyPaused);
    setLocalFusesPausedRef.current(initiallyPaused);
    engine.start();
    if (entryPointerLockHandoffRef.current && document.pointerLockElement === document.documentElement) {
      entryPointerLockHandoffRef.current = false;
      engine.requestPointerLock();
    } else if (document.pointerLockElement === canvas) {
      applyPointerSessionEvent({
        type: "lock_change",
        locked: true,
        now: performance.now(),
        uiBlocked: false,
      });
      setPointerCaptureNeeded(false);
    }
    for (const fuse of [...primedTntRef.current]) {
      if (!primeLocalTnt(fuse.x, fuse.y, fuse.z, Math.max(0, fuse.dueAt - Date.now()), 0, false)) {
        primedTntRef.current = primedTntRef.current.filter((candidate) => candidate.eventId !== fuse.eventId);
        markWorldDirty();
      }
    }
    return () => {
      pointerSessionMountedRef.current = false;
      supersedePointerLockRequest();
      if (foodUseTimer !== null) window.clearTimeout(foodUseTimer);
      foodUseTimer = null;
      for (const timer of fuseTimers.values()) {
        clearFuseSchedule(timer);
      }
      fuseTimers.clear();
      setLocalFusesPausedRef.current = () => undefined;
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
      if (!quitSavedRef.current) performSaveRef.current("quit");
      audio.destroy();
      if (audioRef.current === audio) audioRef.current = null;
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const paused = singlePlayerGameplayPaused({
      pauseOpen,
      inventoryOpen,
      worldModalOpen,
      deathScreenOpen,
      pointerCaptureNeeded,
      documentVisible: document.visibilityState === "visible",
    });
    engineRef.current?.setFirstPersonFeedbackHidden(
      worldModalOpen || deathScreenOpen || commandOpen,
    );
    engineRef.current?.setPaused(paused);
    setLocalFusesPausedRef.current(paused);
  }, [pauseOpen, inventoryOpen, worldModalOpen, deathScreenOpen, commandOpen, pointerCaptureNeeded]);

  useEffect(() => {
    if (deathScreenOpen) setOptionsOpen(false);
  }, [deathScreenOpen]);

  useEffect(() => {
    const sample = () => {
      pruneLocalDrops(Date.now());
      const active = !singlePlayerGameplayPaused({
        pauseOpen,
        inventoryOpen,
        worldModalOpen,
        deathScreenOpen,
        pointerCaptureNeeded,
        documentVisible: document.visibilityState === "visible",
      });
      const now = performance.now();
      const elapsedSeconds = active ? Math.max(0, now - survivalSampledAtRef.current) / 1_000 : 0;
      survivalSampledAtRef.current = now;
      if (active && elapsedSeconds > 0 && gameModeRef.current === "survival") {
        const survival = tickSurvival(survivalStateRef.current, elapsedSeconds, survivalActivityRef.current);
        const hungerChanged = survival.state.hunger !== hungerRef.current;
        const healthChanged = survival.state.health !== healthRef.current;
        survivalStateRef.current = survival.state;
        if (hungerChanged) {
          hungerRef.current = survival.state.hunger;
          setHunger(survival.state.hunger);
        }
        if (healthChanged) {
          if (survival.state.health < healthRef.current) pendingDeathCauseRef.current = "starvation";
          engineRef.current?.setPlayerHealth(survival.state.health);
        }
        if (hungerChanged || healthChanged) markWorldDirty();
      }
      if (active) markWorldDirty();
      const next = sampleSaveCadence(saveCadenceRef.current, now, active);
      saveCadenceRef.current = next.state;
      if (active && next.autosaveDue) performSaveRef.current("autosave");
    };
    sample();
    const interval = window.setInterval(sample, 1_000);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") supersedePointerLockRequest();
      const paused = singlePlayerGameplayPaused({
        pauseOpen,
        inventoryOpen,
        worldModalOpen,
        deathScreenOpen,
        pointerCaptureNeeded,
        documentVisible: document.visibilityState === "visible",
      });
      engineRef.current?.setPaused(paused);
      setLocalFusesPausedRef.current(paused);
      if (!paused && !pointerUiBlockedRef.current && !silentPointerRecaptureRef.current
        && document.pointerLockElement !== canvasRef.current) {
        setPointerCaptureNeeded(true);
      }
      sample();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pauseOpen, inventoryOpen, worldModalOpen, deathScreenOpen, pointerCaptureNeeded]);

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
      setPointerCaptureNeeded(true);
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
    engineRef.current?.setSelectedItem(inventory[selected]?.itemId ?? null);
  }, [inventory, selected]);

  useEffect(() => {
    engineRef.current?.setPlayerArmor({
      head: equipment.head?.itemId ?? null,
      chest: equipment.chest?.itemId ?? null,
      legs: equipment.legs?.itemId ?? null,
      feet: equipment.feet?.itemId ?? null,
    });
  }, [equipment]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "F2" && !event.repeat) {
        const engine = engineRef.current;
        if (!engine) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const png = engine.captureScreenshot();
        const copied = copyGameScreenshot(png);
        const filename = gameScreenshotFilename();
        void png.then((blob) => {
          downloadGameScreenshot(blob, filename);
          return copied;
        }).then((didCopy) => setMessages((current) => [...current.slice(-2), {
          id: `screenshot-${Date.now()}`,
          text: didCopy ? "Screenshot copied" : "Screenshot saved",
          detail: didCopy ? `${filename} also saved to Downloads.` : `${filename} saved to Downloads.`,
          tone: "success",
        }]), () => setMessages((current) => [...current.slice(-2), {
          id: `screenshot-error-${Date.now()}`,
          text: "Screenshot failed",
          detail: "The game kept running. Press F2 to try again.",
          tone: "warning",
        }]));
        return;
      }
      if (event.code === "F3" && !event.repeat) {
        event.preventDefault();
        if (performanceOutputRef.current) {
          performanceOutputRef.current.hidden = !performanceOutputRef.current.hidden;
        }
        return;
      }
      /* @lakecraft-development:guard:start */
      if (visualLabOpen) return;
      /* @lakecraft-development:guard:end */
      if (consumeSinglePlayerCommandSurfaceEscape(
        commandSurfaceOpenRef.current,
        event,
        () => closeCommandConsoleFromEscape(performance.now()),
      )) return;
      if (commandSurfaceOpenRef.current) {
        if ((event.code === "ArrowUp" || event.code === "ArrowDown") && !event.repeat) {
          event.preventDefault();
          const history = commandHistoryRef.current;
          const offset = event.code === "ArrowUp" ? -1 : 1;
          const nextIndex = Math.max(0, Math.min(history.length, commandHistoryIndexRef.current + offset));
          commandHistoryIndexRef.current = nextIndex;
          setCommandDraft(nextIndex === history.length ? "" : history[nextIndex] ?? "");
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
      if (pointerSessionRef.current.pauseOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          applyPointerSessionEvent({
            type: "escape",
            now: performance.now(),
            repeat: event.repeat,
            uiBlocked: false,
          });
        }
        return;
      }
      if (silentPointerRecaptureRef.current && singlePlayerSilentRecaptureKey(event.code, event.repeat)) {
        requestEnginePointerLock(true);
      }
      const commandShortcutDraft = localCommandShortcutDraft(event);
      if (commandShortcutDraft !== null) {
        if (inventoryOpen || worldModalOpen || deathScreenOpen || document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (commandMessageSequenceRef.current === 0) {
          appendCommandMessage("Local command console. Type /help to list commands and item IDs.", "system");
        }
        commandHistoryIndexRef.current = commandHistoryRef.current.length;
        commandSurfaceOpenRef.current = true;
        setCommandDraft(commandShortcutDraft);
        setCommandOpen(true);
        releasePointerLockForUi();
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
      if (event.code === "Escape" && !event.repeat && engineRef.current?.cancelRangedActionForEscape()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        armGameplayResumeAfterEscape(performance.now());
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      if (event.code === "KeyE" && !event.repeat && !inventoryOpen) {
        event.preventDefault();
        setInventoryOpen(true);
        setCraftingContext("field");
        releasePointerLockForUi();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        applyPointerSessionEvent({
          type: "escape",
          now: performance.now(),
          repeat: event.repeat,
          uiBlocked: inventoryOpen || worldModalOpen || deathScreenOpen,
        });
        if (!event.repeat && document.pointerLockElement) document.exitPointerLock();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    optionsOpen,
    /* @lakecraft-development:dependency:start */
    visualLabOpen,
    /* @lakecraft-development:dependency:end */
    pauseOpen,
    inventoryOpen,
    worldModalOpen,
    containerOpen,
    deathScreenOpen,
    activeFurnaceKey,
  ]);

  const lastAutosavedText = lastAutosavedAt === null ? "Last autosaved —"
    : `Last autosaved ${new Date(lastAutosavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  /* @lakecraft-development:callback:start */
  const setPoseLabBowPreview = useCallback((drawn: boolean | null) => {
    engineRef.current?.setPoseLabDrawPreview(drawn);
  }, []);
  const setPoseLabHeldItemPreview = useCallback((itemId: ItemId | null | undefined) => {
    const actual = inventoryRef.current[selectedRef.current]?.itemId ?? null;
    const preview = itemId === undefined ? actual : itemId;
    engineRef.current?.setSelectedBlock(preview ? ITEM_TO_ENGINE[preview] ?? BLOCK.AIR : BLOCK.AIR);
    engineRef.current?.setSelectedItem(preview);
  }, []);
  const setPoseLabUsePreview = useCallback((active: boolean) => {
    engineRef.current?.setPoseLabActionPreview(active ? "use" : null, 0.65);
  }, []);
  const setPoseLabRigPreview = useCallback((kind: "live" | "idle" | "walk" | "crouch" | "crouch_profile" | "walk_profile" | "look_up" | "look_down" | "swing" | "look_left" | "look_right") => {
    const code = ({ live: 0, idle: 1, walk: 2, crouch: 3, crouch_profile: 4, walk_profile: 5, look_up: 6, look_down: 7, swing: 8, look_left: 9, look_right: 10 } as const)[kind];
    engineRef.current?.setPoseLabRigPreview(code);
  }, []);
  /* @lakecraft-development:callback:end */
  const returnToTitle = () => {
    if (!persist("quit")) return;
    quitSavedRef.current = true;
    if (document.pointerLockElement) document.exitPointerLock();
    onExit();
  };

  return (
    <main className="lc-singleplayer">
      <style>{`.lc-singleplayer{position:fixed;inset:0;width:100vw;height:100dvh;overflow:hidden;background:#79a7cf}.lc-singleplayer>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.lc-singleplayer-coordinates{color:#fff;font:16px/1.2 var(--lc-pixel-font,"Courier New",monospace);left:8px;letter-spacing:.01em;pointer-events:none;position:fixed;text-shadow:2px 2px #202020;top:7px;z-index:8}.lc-pointer-capture{align-items:center;background:rgba(0,0,0,.34);display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;justify-content:center;position:fixed;z-index:75}.lc-pointer-capture button{background:#777;border:2px solid #111;box-shadow:inset 2px 2px #aaa,inset -2px -2px #555;color:#fff;cursor:pointer;font:18px/1 var(--lc-pixel-font,"Courier New",monospace);min-width:min(360px,calc(100vw - 32px));padding:16px 24px;text-shadow:2px 2px #333}.lc-pointer-capture button:hover,.lc-pointer-capture button:focus-visible{background:#6b6bb6;box-shadow:inset 2px 2px #9b9be1,inset -2px -2px #3c3c76;outline:2px solid #fff}.lc-pointer-capture small{display:block;font-size:12px;margin-top:8px}.lc-silent-recapture{bottom:12px;color:#ddd;font:11px/1.2 monospace;left:50%;pointer-events:none;position:fixed;text-shadow:1px 1px #111;transform:translateX(-50%);z-index:9}`}</style>
      <canvas aria-label="Lakecraft single-player voxel world" ref={canvasRef} tabIndex={0} />
      <span
        aria-label={`Coordinates X ${coordinates.x}, Y ${coordinates.y}, Z ${coordinates.z}. ${gameMode} mode`}
        className="lc-singleplayer-coordinates"
      >
        XYZ: {coordinates.x} / {coordinates.y} / {coordinates.z} · {gameMode === "creative" ? "Creative" : "Survival"}
      </span>
      <output
        aria-label="Performance statistics"
        className="lc-local-perf"
        hidden
        ref={performanceOutputRef}
      />
      <output aria-label="Frames per second" className="lc-local-fps" ref={fpsOutputRef}>FPS --</output>
      {pointerCaptureNeeded && !pauseOpen && !inventoryOpen && !uiModalOpen && !deathScreenOpen ? (
        <div className="lc-pointer-capture" role="presentation">
          <button autoFocus onClick={() => requestGameplayPointerLock()} type="button">
            Click to Play
            <small>Capture the mouse · Escape opens Game Menu</small>
          </button>
        </div>
      ) : null}
      {silentPointerRecaptureDenied && !pauseOpen && !inventoryOpen && !uiModalOpen && !deathScreenOpen ? (
        <small className="lc-silent-recapture">Press a movement key or click the world to recapture the mouse</small>
      ) : null}
      {/* @lakecraft-development:render:start */}
      <FirstPersonPoseLab
        onBowPreviewChange={setPoseLabBowPreview}
        onCameraModeChange={(mode) => engineRef.current?.setCameraMode(mode)}
        onCycleCamera={() => engineRef.current?.cycleCameraMode() ?? "first_person"}
        onHeldItemPreviewChange={setPoseLabHeldItemPreview}
        onOpenVisualLab={() => setVisualLabOpen(true)}
        onRigPreviewChange={setPoseLabRigPreview}
        onUsePreviewChange={setPoseLabUsePreview}
        open={(pauseOpen || pointerCaptureNeeded) && !inventoryOpen && !uiModalOpen && !deathScreenOpen}
      />
      <VisualLab
        onApplySkin={(source, model) => engineRef.current?.setPlayerSkin(source, model)}
        onClose={() => setVisualLabOpen(false)}
        open={visualLabOpen}
        skinStorage={storage}
      />
      {/* @lakecraft-development:render:end */}
      <GameHud
        connected={false}
        craftingContext={craftingContext}
        deathCause={deathCause}
        deathScreenOpen={deathScreenOpen}
        equipment={equipment}
        creativeInventory={gameMode === "creative"}
        health={health}
        hunger={hunger}
        showSurvivalStatus={gameMode === "survival"}
        inventory={inventory}
        inventoryAuthorityEpoch={0}
        inventoryOpen={inventoryOpen}
        modalOpen={uiModalOpen || pointerCaptureNeeded}
        messages={messages}
        onCloseInventory={closeInventoryAndResume}
        onCrafted={() => undefined}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        disconnectLabel="Save and Quit to Title"
        lastAutosavedText={lastAutosavedText}
        autosaveStatusText={autosaveStatusText}
        disconnectDisabled={saveLockedRef.current}
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
        fovDegrees={clientSettings.fovDegrees}
        mouseSensitivity={clientSettings.mouseSensitivity}
        renderDistance={clientSettings.renderDistance}
        onCloseOptions={() => setOptionsOpen(false)}
        onOptions={() => setOptionsOpen(true)}
        onFovChange={(fovDegrees) => updateClientSettings({ ...clientSettingsRef.current, fovDegrees })}
        onSensitivityChange={(mouseSensitivity) => updateClientSettings({ ...clientSettingsRef.current, mouseSensitivity })}
        onRenderDistanceChange={(renderDistance) => {
          updateClientSettings({ ...clientSettingsRef.current, renderDistance });
          engineRef.current?.setRenderDistance(renderDistance);
        }}
        optionsOpen={optionsOpen}
        onRespawn={respawnLocally}
        onResume={() => { setOptionsOpen(false); requestGameplayPointerLock(); }}
        onResetWorld={saveLockedRef.current ? resetUnreadableWorld : undefined}
        onSelectHotbar={selectHotbar}
        onTitleScreen={returnToTitle}
        pauseTitle="Game Menu"
        pauseOpen={pauseOpen}
        playerName="Player"
        selectedIndex={selected}
        respawnError={deathStatus}
        respawning={respawning}
        soundMuted={clientSettings.soundMuted}
        onToggleSound={() => {
          const nextMuted = !clientSettingsRef.current.soundMuted;
          updateClientSettings({ ...clientSettingsRef.current, soundMuted: nextMuted });
          if (!nextMuted) {
            void audioRef.current?.unlock().then(() => audioRef.current?.play("uiConfirm", { seed: "local-sound-on", intensity: 0.52 }));
          }
        }}
        worldName={world.name}
      />
      <ChatOverlay
        connected
        draft={commandDraft}
        historyLabel="Command history"
        inputLabel="Local command"
        maxLength={240}
        messages={commandMessages}
        peekMaxAgeMs={LOCAL_COMMAND_PEEK_MS}
        onClose={closeCommandConsole}
        onDraftChange={(value) => {
          commandHistoryIndexRef.current = commandHistoryRef.current.length;
          setCommandDraft(value);
        }}
        onSubmit={submitLocalCommand}
        open={commandOpen}
        placeholder="/help"
        playerSender="[Command]"
        submitLabel="Run local command"
        submitText="Run"
        surfaceLabel="Local command console"
        systemSender="[Game]"
        warningSender="[Error]"
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

export function SinglePlayerApp({ onExit }: { onExit: () => void }) {
  const storage = useMemo(browserSinglePlayerStorage, []);
  const [activeWorld, setActiveWorld] = useState<{
    world: LocalWorldRecord;
    pointerLockHandoff: boolean;
  } | null>(null);

  return activeWorld ? (
    <SinglePlayerWorld
      entryPointerLockHandoff={activeWorld.pointerLockHandoff}
      key={activeWorld.world.id}
      onExit={() => setActiveWorld(null)}
      storage={storage}
      world={activeWorld.world}
    />
  ) : (
    <LocalWorldBrowser
      onBack={onExit}
      onPlay={(world, pointerLockHandoff) => setActiveWorld({ world, pointerLockHandoff })}
      storage={storage}
    />
  );
}
