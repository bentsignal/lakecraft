import { terrainHeight, type PlayerPose } from "../game/index.ts";

export const SINGLEPLAYER_SLEEP_START_PHASE = 0.7;
export const SINGLEPLAYER_SLEEP_END_PHASE = 0.18;

export function canSleepAtPhase(phase: number): boolean {
  if (!Number.isFinite(phase)) return false;
  const normalized = phase >= 0 && phase < 1 ? phase : ((phase % 1) + 1) % 1;
  return normalized >= SINGLEPLAYER_SLEEP_START_PHASE || normalized < SINGLEPLAYER_SLEEP_END_PHASE;
}

export function respawnPointForBed(x: number, y: number, z: number, yaw = 0): PlayerPose {
  return { x: x + 0.5, y: y + 1.02, z: z + 0.5, yaw, pitch: -0.08 };
}

export function respawnPointMatchesBed(point: Readonly<PlayerPose>, x: number, y: number, z: number): boolean {
  return Math.abs(point.x - (x + 0.5)) < 0.001
    && Math.abs(point.y - (y + 1.02)) < 0.001
    && Math.abs(point.z - (z + 0.5)) < 0.001;
}

export function singlePlayerWorldSpawn(seed: number): PlayerPose {
  return { x: 0.5, y: terrainHeight(0, 0, seed) + 1.02, z: 0.5, yaw: 0, pitch: -0.08 };
}
