import { createVoxelEngine } from "../game/voxelEngine.ts";
import type { VoxelEngine, VoxelEngineOptions } from "../game/types.ts";
import type { GameplayAuthorityAdapter } from "./authority.ts";

/**
 * The only engine-construction boundary used by playable worlds. Authority
 * callbacks are supplied by one adapter; shared presentation/lifecycle options
 * cannot silently replace them.
 */
export function createGameplaySessionEngine(
  canvas: HTMLCanvasElement,
  authority: GameplayAuthorityAdapter,
  sharedOptions: VoxelEngineOptions = {},
): VoxelEngine {
  for (const key of Object.keys(authority.engineOptions) as (keyof VoxelEngineOptions)[]) {
    if (key in sharedOptions) throw new Error(`Shared gameplay options cannot override authority callback ${String(key)}.`);
  }
  return createVoxelEngine(canvas, {
    ...sharedOptions,
    ...authority.engineOptions,
    simulateMobs: authority.capabilities.localSimulation,
  });
}
