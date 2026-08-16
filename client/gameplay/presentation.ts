import {
  attackDamage,
  equippedArmorProtection,
  miningSeconds,
  type Equipment,
  type Inventory,
  type ItemId,
} from "../../shared/game.ts";
import type { GameAudio } from "../game/audio.ts";
import { cycleHotbarIndex } from "../game/hotbarInput.ts";
import type { VoxelEngineOptions, VoxelPerformanceStats } from "../game/types.ts";
import { fieldOfViewRadians, mouseLookScale, type ClientSettings } from "../settings.ts";
import type { GameplayControlBindings } from "./controlBindings.ts";
import { audioSurfaceForBlock, ENGINE_TO_GAME, ITEM_TO_ENGINE } from "./catalog.ts";

export interface GameplayPresentationContext {
  getSettings(): Pick<ClientSettings, "fovDegrees" | "mouseSensitivity" | "keyBindings">;
  getInventory(): Inventory;
  getEquipment(): Equipment;
  getSelectedHotbar(): number;
  getGameMode(): "creative" | "survival";
  getHunger(): number;
  selectHotbar(index: number): void;
  audio: Pick<GameAudio, "play">;
  footstepSeedPrefix: string;
  onPerformanceStats(stats: VoxelPerformanceStats): void;
}

/** Rules and presentation callbacks that must not vary with world authority. */
export function createGameplayPresentationOptions(context: GameplayPresentationContext): VoxelEngineOptions {
  const selectedItem = (): ItemId | null => context.getInventory()[context.getSelectedHotbar()]?.itemId ?? null;
  return {
    getMouseLookSensitivity: () => mouseLookScale(context.getSettings().mouseSensitivity),
    getFieldOfViewRadians: () => fieldOfViewRadians(context.getSettings().fovDegrees),
    getControlBindings: (): GameplayControlBindings => context.getSettings().keyBindings,
    selectedBlock: ITEM_TO_ENGINE[selectedItem() ?? "stick"] ?? 0,
    selectedItem: selectedItem(),
    getMiningDuration: (block) => {
      if (context.getGameMode() === "creative") return 0.05;
      const gameBlock = ENGINE_TO_GAME[block];
      return gameBlock ? miningSeconds(gameBlock, selectedItem() ?? undefined) : 0.2;
    },
    getAttackDamage: () => attackDamage(selectedItem() ?? undefined),
    getPlayerProtection: () => equippedArmorProtection(context.getEquipment()),
    canSprint: () => context.getGameMode() === "creative" || context.getHunger() > 6,
    canCreativeFly: () => context.getGameMode() === "creative",
    canMobsTargetPlayer: () => context.getGameMode() === "survival",
    canTakePlayerDamage: () => context.getGameMode() === "survival",
    onHotbarSelect: context.selectHotbar,
    onHotbarCycle: (direction) => context.selectHotbar(cycleHotbarIndex(context.getSelectedHotbar(), direction)),
    onFootstep: (block) => context.audio.play("footstep", {
      seed: `${context.footstepSeedPrefix}:${block}:${performance.now().toFixed(0)}`,
      surface: audioSurfaceForBlock(block),
      intensity: 0.5,
    }),
    onPerformanceStats: context.onPerformanceStats,
  };
}
