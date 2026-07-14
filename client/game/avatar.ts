import type { PlayerPose, RemotePlayer } from "./types.ts";

export const MAX_REMOTE_PLAYERS = 32;
export const MAX_PLAYER_NAME_LENGTH = 16;

const POSITION_LIMIT = 1_000_000;
const MAX_SNAPSHOT_SPEED = 14;

export interface RemoteAvatarMotion {
  readonly id: string;
  name: string;
  color: RemotePlayer["color"];
  rendered: PlayerPose;
  target: PlayerPose;
  velocityX: number;
  velocityZ: number;
  horizontalSpeed: number;
  walkPhase: number;
  bodyYaw: number;
  lastSnapshotAt: number;
}

function finiteBounded(value: number, fallback: number, limit = POSITION_LIMIT): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(-limit, Math.min(limit, value));
}

function safePose(player: RemotePlayer, fallback?: PlayerPose): PlayerPose {
  const base = fallback ?? { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  return {
    x: finiteBounded(player.x, base.x),
    y: finiteBounded(player.y, base.y),
    z: finiteBounded(player.z, base.z),
    yaw: finiteBounded(player.yaw, base.yaw, Math.PI * 1_000),
    pitch: finiteBounded(player.pitch, base.pitch, Math.PI / 2),
  };
}

/**
 * Usernames are never interpreted as HTML, and this further bounds renderer
 * work and replaces control/unsupported glyphs before they reach nameplates.
 */
export function sanitizePlayerName(name: string | undefined): string {
  const safe = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9 _.-]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
  return safe || "Player";
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function createRemoteAvatarMotion(player: RemotePlayer, now: number): RemoteAvatarMotion {
  const target = safePose(player);
  return {
    id: String(player.id).slice(0, 128),
    name: sanitizePlayerName(player.name),
    color: player.color,
    rendered: { ...target },
    target: { ...target },
    velocityX: 0,
    velocityZ: 0,
    horizontalSpeed: 0,
    walkPhase: 0,
    bodyYaw: target.yaw,
    lastSnapshotAt: now,
  };
}

/** Records a sparse Lakebed pose without snapping the rendered avatar to it. */
export function applyRemoteAvatarSnapshot(
  state: RemoteAvatarMotion,
  player: RemotePlayer,
  now: number,
): void {
  const next = safePose(player, state.target);
  const elapsed = Math.max(1 / 60, Math.min(2, (now - state.lastSnapshotAt) / 1_000));
  const rawVelocityX = (next.x - state.target.x) / elapsed;
  const rawVelocityZ = (next.z - state.target.z) / elapsed;
  const rawSpeed = Math.hypot(rawVelocityX, rawVelocityZ);
  const scale = rawSpeed > MAX_SNAPSHOT_SPEED ? MAX_SNAPSHOT_SPEED / rawSpeed : 1;
  state.velocityX = rawVelocityX * scale;
  state.velocityZ = rawVelocityZ * scale;
  state.target = next;
  state.name = sanitizePlayerName(player.name);
  state.color = player.color;
  state.lastSnapshotAt = now;
}

/**
 * Smooths toward the latest pose and permits at most 100ms of bounded
 * extrapolation. The small look-ahead avoids a stop/start gait between sparse
 * snapshots while still settling quickly when a player stops sending updates.
 */
export function advanceRemoteAvatarMotion(
  state: RemoteAvatarMotion,
  now: number,
  deltaSeconds: number,
): void {
  const dt = Math.max(0, Math.min(0.1, deltaSeconds));
  if (dt === 0) return;
  const snapshotAge = Math.max(0, (now - state.lastSnapshotAt) / 1_000);
  const lookAhead = Math.min(0.1, snapshotAge);
  const goalX = state.target.x + state.velocityX * lookAhead;
  const goalZ = state.target.z + state.velocityZ * lookAhead;
  const follow = 1 - Math.exp(-15 * dt);
  const previousX = state.rendered.x;
  const previousZ = state.rendered.z;

  state.rendered.x += (goalX - state.rendered.x) * follow;
  state.rendered.y += (state.target.y - state.rendered.y) * follow;
  state.rendered.z += (goalZ - state.rendered.z) * follow;
  state.rendered.yaw += shortestAngleDelta(state.rendered.yaw, state.target.yaw) * follow;
  state.rendered.pitch += (state.target.pitch - state.rendered.pitch) * follow;

  const measuredSpeed = Math.min(
    MAX_SNAPSHOT_SPEED,
    Math.hypot(state.rendered.x - previousX, state.rendered.z - previousZ) / dt,
  );
  const gaitFollow = 1 - Math.exp(-10 * dt);
  state.horizontalSpeed += (measuredSpeed - state.horizontalSpeed) * gaitFollow;
  state.walkPhase = (state.walkPhase + state.horizontalSpeed * dt * 7.5) % (Math.PI * 2);

  const intendedSpeed = Math.hypot(state.velocityX, state.velocityZ);
  const desiredBodyYaw = intendedSpeed > 0.08
    ? Math.atan2(state.velocityX, -state.velocityZ)
    : state.rendered.yaw;
  state.bodyYaw += shortestAngleDelta(state.bodyYaw, desiredBodyYaw) * (1 - Math.exp(-7 * dt));

  if (snapshotAge > 0.35) {
    const settle = 1 - Math.exp(-8 * dt);
    state.velocityX *= 1 - settle;
    state.velocityZ *= 1 - settle;
  }
}
