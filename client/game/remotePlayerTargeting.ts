import type { PlayerPose } from "./types.ts";

export const REMOTE_PLAYER_HITBOX_HALF_WIDTH = 0.34;
export const REMOTE_PLAYER_HITBOX_HEIGHT = 1.85;

export interface RemotePlayerTargetCandidate {
  readonly id: string;
  readonly name?: string;
  readonly rendered: Readonly<PlayerPose>;
}

export interface RemotePlayerRayTarget {
  readonly id: string;
  readonly name: string;
  readonly distance: number;
}

type Vec3 = readonly [number, number, number];

function rayBoxDistance(origin: Vec3, direction: Vec3, minimum: Vec3, maximum: Vec3): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-8) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    let first = (minimum[axis] - origin[axis]) / component;
    let second = (maximum[axis] - origin[axis]) / component;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  return far >= 0 ? Math.max(0, near) : null;
}

/** Select the nearest rendered remote-player hitbox under the crosshair. */
export function raycastRemotePlayers(
  origin: Vec3,
  rawDirection: Vec3,
  candidates: Iterable<RemotePlayerTargetCandidate>,
  maximumDistance: number,
): RemotePlayerRayTarget | null {
  const length = Math.hypot(rawDirection[0], rawDirection[1], rawDirection[2]);
  const limit = Number.isFinite(maximumDistance) ? Math.max(0, maximumDistance) : 0;
  if (length < 1e-8 || limit <= 0) return null;
  const direction: Vec3 = [rawDirection[0] / length, rawDirection[1] / length, rawDirection[2] / length];
  let nearest: RemotePlayerRayTarget | null = null;
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const pose = candidate.rendered;
    if (![pose.x, pose.y, pose.z].every(Number.isFinite)) continue;
    const distance = rayBoxDistance(
      origin,
      direction,
      [pose.x - REMOTE_PLAYER_HITBOX_HALF_WIDTH, pose.y, pose.z - REMOTE_PLAYER_HITBOX_HALF_WIDTH],
      [pose.x + REMOTE_PLAYER_HITBOX_HALF_WIDTH, pose.y + REMOTE_PLAYER_HITBOX_HEIGHT, pose.z + REMOTE_PLAYER_HITBOX_HALF_WIDTH],
    );
    if (distance === null || distance > limit || (nearest && distance >= nearest.distance)) continue;
    nearest = { id: candidate.id, name: candidate.name || "Player", distance };
  }
  return nearest;
}
