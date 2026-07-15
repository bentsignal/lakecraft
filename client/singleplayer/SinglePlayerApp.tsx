import { useEffect, useRef, useState } from "preact/hooks";
import { GameHud, type HudMessage } from "../components";
import {
  BLOCK,
  createVoxelEngine,
  type BlockId as EngineBlockId,
  type VoxelEngine,
  type WorldEdit,
} from "../game";
import {
  MAX_HEALTH,
  MAX_HUNGER,
  ITEMS,
  addItem,
  applyConfirmedDurableItemUse,
  applyConfirmedToolUse,
  attackDamage,
  clampHotbarIndex,
  consumeFood,
  createEmptyEquipment,
  createStarterInventory,
  getDeterministicMiningDrop,
  miningSeconds,
  normalizeEquipment,
  normalizeInventory,
  removeItem,
  type BlockId,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
} from "../../shared/game";
import type { StowedInventorySnapshot } from "../../shared/inventoryWorkspace";
import type { InventoryRecipeBatch } from "../../shared/inventoryActions";
import { TNT_FUSE_MS, TNT_IGNITION_REACH } from "../../shared/tntAuthority";
import { cycleHotbarIndex } from "../game/hotbarInput";
import { createGameAudio } from "../game/audio";

const SAVE_KEY = "lakecraft.singleplayer.v1";

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
};

const ITEM_TO_ENGINE: Partial<Record<ItemId, EngineBlockId>> = {
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE, iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE, log: BLOCK.WOOD, leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS, crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE,
  torch: BLOCK.TORCH, chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER,
  tnt: BLOCK.TNT,
};

type LocalSave = {
  inventory: Inventory;
  equipment: Equipment;
  selected: number;
  hunger: number;
  edits: WorldEdit[];
};

function loadLocalSave(): LocalSave {
  const fallback = { inventory: createStarterInventory(), equipment: createEmptyEquipment(), selected: 2, hunger: MAX_HUNGER, edits: [] };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<LocalSave>;
    const edits = Array.isArray(value.edits) ? value.edits.filter((edit): edit is WorldEdit => Boolean(
      edit && Number.isSafeInteger(edit.x) && Number.isSafeInteger(edit.y) && Number.isSafeInteger(edit.z)
      && Number.isInteger(edit.block) && edit.block >= BLOCK.AIR && edit.block <= BLOCK.TNT,
    )).slice(-8_000) : [];
    return {
      inventory: normalizeInventory(value.inventory),
      equipment: normalizeEquipment(value.equipment),
      selected: clampHotbarIndex(value.selected),
      hunger: Number.isInteger(value.hunger) ? Math.max(0, Math.min(MAX_HUNGER, Number(value.hunger))) : MAX_HUNGER,
      edits,
    };
  } catch {
    return fallback;
  }
}

export function SinglePlayerApp() {
  const initial = useRef<LocalSave | null>(null);
  if (!initial.current) initial.current = loadLocalSave();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const inventoryRef = useRef(initial.current.inventory);
  const equipmentRef = useRef(initial.current.equipment);
  const selectedRef = useRef(initial.current.selected);
  const editsRef = useRef(initial.current.edits);
  const hungerRef = useRef(initial.current.hunger);
  const [inventory, setInventory] = useState<Inventory>(initial.current.inventory);
  const [equipment, setEquipment] = useState<Equipment>(initial.current.equipment);
  const [selected, setSelected] = useState(initial.current.selected);
  const [hunger, setHunger] = useState(initial.current.hunger);
  const [health, setHealth] = useState(MAX_HEALTH);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(true);
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [handActionToken, setHandActionToken] = useState(0);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0, z: 0 });

  function persist(nextInventory = inventoryRef.current, nextEquipment = equipmentRef.current) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        inventory: nextInventory,
        equipment: nextEquipment,
        selected: selectedRef.current,
        hunger: hungerRef.current,
        edits: editsRef.current.slice(-8_000),
      } satisfies LocalSave));
    } catch {
      // A full browser storage bucket must never stop the local game loop.
    }
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
    persist(next);
  }

  function selectHotbar(index: number) {
    const next = clampHotbarIndex(index);
    if (next === selectedRef.current) return;
    selectedRef.current = next;
    setSelected(next);
    persist();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audio = createGameAudio({ maxVoices: 12 });
    const unlockAudio = () => { void audio.unlock(); };
    const fuseTimers = new Map<string, { interval: number; timeout: number }>();
    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    const primeLocalTnt = (
      x: number,
      y: number,
      z: number,
      durationMs: number,
      cascadeDepth: number,
      spendTool: boolean,
    ): boolean => {
      const key = `${x}:${y}:${z}`;
      if (fuseTimers.has(key)) return true;
      if (fuseTimers.size >= 32 || !engineRef.current?.setPrimedTnt(x, y, z, true)) return false;
      if (spendTool) {
        const toolUse = applyConfirmedDurableItemUse(inventoryRef.current, selectedRef.current, "flint_and_steel");
        if (!toolUse.used) {
          engineRef.current.setPrimedTnt(x, y, z, false);
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
      const interval = window.setInterval(() => {
        engineRef.current?.spawnBlockParticles({ action: "hit", block: BLOCK.TNT, x, y, z });
      }, 500);
      const timeout = window.setTimeout(() => {
        window.clearInterval(interval);
        fuseTimers.delete(key);
        const edits = engineRef.current?.explodeTnt(x, y, z) ?? [];
        const destruction = edits.filter((edit) => !edit.chainPrimed);
        if (!destruction.length) return;
        const byCoordinate = new Map(editsRef.current.map((edit) => [`${edit.x}:${edit.y}:${edit.z}`, edit]));
        for (const edit of destruction) byCoordinate.set(`${edit.x}:${edit.y}:${edit.z}`, edit);
        editsRef.current = [...byCoordinate.values()].slice(-8_000);
        persist();
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
          text: "Boom!",
          detail: `${destruction.length} blocks destroyed locally.`,
          tone: "warning",
        }]);
      }, durationMs);
      fuseTimers.set(key, { interval, timeout });
      return true;
    };
    const engine = createVoxelEngine(canvas, {
      initialEdits: editsRef.current,
      selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
      getMiningDuration: (block) => {
        const gameBlock = ENGINE_TO_GAME[block];
        return gameBlock ? miningSeconds(gameBlock, inventoryRef.current[selectedRef.current]?.itemId) : 0.2;
      },
      getAttackDamage: () => attackDamage(inventoryRef.current[selectedRef.current]?.itemId),
      onBlockEdit: (edit, previousBlock) => {
        const settled = engineRef.current?.settleFallingBlocks(edit, previousBlock) ?? [];
        const nextEdits = new Map(editsRef.current.map((candidate) => [`${candidate.x}:${candidate.y}:${candidate.z}`, candidate]));
        nextEdits.set(`${edit.x}:${edit.y}:${edit.z}`, edit);
        for (const fallingEdit of settled) {
          nextEdits.set(`${fallingEdit.x}:${fallingEdit.y}:${fallingEdit.z}`, fallingEdit);
        }
        editsRef.current = [...nextEdits.values()].slice(-8_000);
        const held = inventoryRef.current[selectedRef.current]?.itemId ?? null;
        let next = inventoryRef.current;
        const toggledDoor = (previousBlock === BLOCK.DOOR_CLOSED && edit.block === BLOCK.DOOR_OPEN)
          || (previousBlock === BLOCK.DOOR_OPEN && edit.block === BLOCK.DOOR_CLOSED);
        if (!toggledDoor && edit.block === BLOCK.AIR && previousBlock !== BLOCK.AIR) {
          const gameBlock = ENGINE_TO_GAME[previousBlock];
          const drop = gameBlock ? getDeterministicMiningDrop(gameBlock, held, edit.x, edit.y, edit.z) : null;
          const wear = applyConfirmedToolUse(next, selectedRef.current, "mine", held);
          next = wear.inventory;
          if (drop) next = addItem(next, drop.itemId, drop.count).inventory;
        } else if (!toggledDoor && previousBlock === BLOCK.AIR && edit.block !== BLOCK.AIR && held) {
          next = removeItem(next, held, 1).inventory;
        }
        updateInventory(next);
      },
      onMobDrops: (drops) => {
        let next = inventoryRef.current;
        for (const drop of drops) next = addItem(next, drop.itemId as ItemId, drop.count).inventory;
        updateInventory(next);
      },
      onPlayerHealthChange: setHealth,
      onHotbarSelect: selectHotbar,
      onHotbarCycle: (direction) => selectHotbar(cycleHotbarIndex(selectedRef.current, direction)),
      onHandAction: () => setHandActionToken((value) => value + 1),
      onUseSelectedItem: () => {
        const result = consumeFood(inventoryRef.current, selectedRef.current, hungerRef.current);
        if (!result.ok) return false;
        hungerRef.current = result.hunger;
        setHunger(result.hunger);
        updateInventory(result.inventory);
        return true;
      },
      onInteractBlock: (target) => {
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
        setCoordinates((current) => current.x === next.x && current.y === next.y && current.z === next.z ? current : next);
      },
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      for (const timer of fuseTimers.values()) {
        window.clearInterval(timer.interval);
        window.clearTimeout(timer.timeout);
      }
      fuseTimers.clear();
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
      audio.destroy();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const block = ITEM_TO_ENGINE[inventory[selected]?.itemId ?? "stick"] ?? BLOCK.AIR;
    engineRef.current?.setSelectedBlock(block);
  }, [inventory, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [inventoryOpen]);

  return (
    <main className="lc-singleplayer">
      <style>{`.lc-singleplayer{position:fixed;inset:0;width:100vw;height:100dvh;overflow:hidden;background:#79a7cf}.lc-singleplayer>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.lc-singleplayer-coordinates{color:#fff;font:16px/1.2 var(--lc-pixel-font,"Courier New",monospace);left:8px;letter-spacing:.01em;pointer-events:none;position:fixed;text-shadow:2px 2px #202020;top:7px;z-index:8}`}</style>
      <canvas aria-label="Lakecraft single-player voxel world" ref={canvasRef} tabIndex={0} />
      <span aria-label={`Coordinates X ${coordinates.x}, Y ${coordinates.y}, Z ${coordinates.z}`} className="lc-singleplayer-coordinates">XYZ: {coordinates.x} / {coordinates.y} / {coordinates.z}</span>
      <GameHud
        connected={false}
        craftingContext={craftingContext}
        equipment={equipment}
        handActionToken={handActionToken}
        health={health}
        hunger={hunger}
        inventory={inventory}
        inventoryAuthorityEpoch={0}
        inventoryOpen={inventoryOpen}
        messages={messages}
        miningProgress={0}
        onCloseInventory={() => { setInventoryOpen(false); setCraftingContext("field"); engineRef.current?.requestPointerLock(); }}
        onCrafted={() => undefined}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onDisconnect={() => { persist(); window.location.href = window.location.pathname; }}
        onInventoryWorkspaceChange={(snapshot: StowedInventorySnapshot, _epoch: number, _recipes: readonly InventoryRecipeBatch[]) => {
          inventoryRef.current = snapshot.inventory;
          equipmentRef.current = snapshot.equipment;
          setInventory(snapshot.inventory);
          setEquipment(snapshot.equipment);
          persist(snapshot.inventory, snapshot.equipment);
          return true;
        }}
        onOptions={() => setMessages((current) => [...current, { id: `options-${Date.now()}`, title: "Options", detail: "More single-player settings are next.", tone: "info" }])}
        onResume={() => { setPauseOpen(false); engineRef.current?.requestPointerLock(); }}
        onSelectHotbar={selectHotbar}
        pauseOpen={pauseOpen}
        playerName="Player"
        selectedIndex={selected}
        worldName="Local World"
      />
    </main>
  );
}
