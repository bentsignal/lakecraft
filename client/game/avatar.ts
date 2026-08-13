import type { PlayerPose, RemotePlayer } from "./types.ts";
import { PLAYER_SKIN_WIRE_BYTES, type PlayerSkinModel } from "./playerSkin.ts";
import { ITEMS, type ArmorId, type ArmorSlot, type ItemId } from "../../shared/game.ts";
import { playerRigCycleMilliseconds, resolvePlayerRigPose, type PlayerRigInput, type PlayerRigPose } from "./playerRig.ts";
import { FIRST_PERSON_ACTION_MS } from "./firstPersonRenderer.ts";
import {
  PRESENCE_MAX_EXTRAPOLATION_MS,
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_PITCH,
  PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS,
  PRESENCE_MAX_VERTICAL_SPEED,
  PRESENCE_MAX_X,
  PRESENCE_MAX_Y,
  PRESENCE_MAX_YAW,
  PRESENCE_MAX_Z,
  PRESENCE_MIN_X,
  PRESENCE_MIN_Y,
  PRESENCE_MIN_Z,
} from "../../shared/presenceMotion.ts";

export const MAX_REMOTE_PLAYERS = 32;
export const MAX_PLAYER_NAME_LENGTH = 16;

export interface RemoteAvatarMotion {
  readonly id: string;
  name: string;
  color: RemotePlayer["color"];
  heldItem: ItemId | null;
  armorHead: ArmorId | null;
  armorChest: ArmorId | null;
  armorLegs: ArmorId | null;
  armorFeet: ArmorId | null;
  skinId: string;
  skinModel: PlayerSkinModel;
  skinPixels: Uint8Array | null;
  rendered: PlayerPose;
  target: PlayerPose;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  horizontalSpeed: number;
  walkPhase: number;
  bodyYaw: number;
  lastSnapshotAt: number;
  lastVisualActionSequence: number;
  armActionStartedAt: number;
  armActionPhase: number;
  armActionProgress: number;
  bowDrawing: boolean;
  crouching: boolean;
}

function finiteRange(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function safePose(player: RemotePlayer, fallback?: PlayerPose): PlayerPose {
  const base = fallback ?? { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  return {
    x: finiteRange(player.x, base.x, PRESENCE_MIN_X, PRESENCE_MAX_X),
    y: finiteRange(player.y, base.y, PRESENCE_MIN_Y, PRESENCE_MAX_Y),
    z: finiteRange(player.z, base.z, PRESENCE_MIN_Z, PRESENCE_MAX_Z),
    yaw: finiteRange(player.yaw, base.yaw, -PRESENCE_MAX_YAW, PRESENCE_MAX_YAW),
    pitch: finiteRange(player.pitch, base.pitch, -PRESENCE_MAX_PITCH, PRESENCE_MAX_PITCH),
  };
}

function assignBoundedVelocity(
  state: RemoteAvatarMotion,
  rawX: number,
  rawY: number,
  rawZ: number,
): void {
  let vx = Number.isFinite(rawX) ? rawX : 0;
  const vy = Number.isFinite(rawY)
    ? Math.max(-PRESENCE_MAX_VERTICAL_SPEED, Math.min(PRESENCE_MAX_VERTICAL_SPEED, rawY))
    : 0;
  let vz = Number.isFinite(rawZ) ? rawZ : 0;
  const horizontalSpeed = Math.hypot(vx, vz);
  const strictHorizontalLimit = PRESENCE_MAX_HORIZONTAL_SPEED - 1e-9;
  if (horizontalSpeed > strictHorizontalLimit) {
    const scale = strictHorizontalLimit / horizontalSpeed;
    vx *= scale;
    vz *= scale;
  }
  state.velocityX = vx;
  state.velocityY = vy;
  state.velocityZ = vz;
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

/** Rejects unknown/prototype keys before held-item data reaches geometry code. */
export function sanitizeRemoteHeldItem(value: unknown): ItemId | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ITEMS, value)
    ? value as ItemId
    : null;
}

/** Armor snapshots must name a real armor item for the exact rendered slot. */
export function sanitizeRemoteArmor(value: unknown, slot: ArmorSlot): ArmorId | null {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, value)) return null;
  return ITEMS[value as ItemId].armor?.slot === slot ? value as ArmorId : null;
}

function assignRemoteGear(state: RemoteAvatarMotion, player: RemotePlayer): void {
  state.heldItem = sanitizeRemoteHeldItem(player.heldItem);
  state.armorHead = sanitizeRemoteArmor(player.armorHead, "head");
  state.armorChest = sanitizeRemoteArmor(player.armorChest, "chest");
  state.armorLegs = sanitizeRemoteArmor(player.armorLegs, "legs");
  state.armorFeet = sanitizeRemoteArmor(player.armorFeet, "feet");
}

/** Keeps malformed community-server skin data outside the WebGL upload path. */
function assignRemoteSkin(state: RemoteAvatarMotion, player: RemotePlayer): void {
  const id = typeof player.skinId === "string" && /^(?:default|[a-f0-9]{64})$/.test(player.skinId)
    ? player.skinId
    : "default";
  state.skinId = id;
  state.skinModel = id !== "default" && player.skinModel === "slim" ? "slim" : "wide";
  state.skinPixels = id !== "default" && player.skinPixels instanceof Uint8Array
    && player.skinPixels.byteLength === PLAYER_SKIN_WIRE_BYTES
    ? player.skinPixels
    : null;
}

function applyRemoteVisualActions(state: RemoteAvatarMotion, player: RemotePlayer, now: number): void {
  for (const action of player.visualActions ?? []) {
    if (!action || !Number.isSafeInteger(action.sequence) || action.sequence < 1
      || !/^(swing|jump|crouch_(on|off)|use|slot|bow_(draw|release))$/.test(action.kind)
      || (action.kind === "slot" ? !Number.isSafeInteger(action.value) || action.value! < 0 || action.value! > 8 : action.value !== undefined)
      || action.sequence <= state.lastVisualActionSequence) continue;
    state.lastVisualActionSequence = action.sequence;
    if (action.kind === "swing" || action.kind === "use" || action.kind === "bow_release") {
      state.armActionStartedAt = now;
    }
    if (action.kind === "bow_draw") state.bowDrawing = true;
    if (action.kind === "bow_release") state.bowDrawing = false;
    if (action.kind === "crouch_on") state.crouching = true;
    if (action.kind === "crouch_off") state.crouching = false;
  }
}

/** One canonical pose contract shared by the remote skin and every gear joint. */
const REMOTE_RIG_INPUT: PlayerRigInput = { motion: "idle", phase: 0 };
export function resolveRemoteAvatarRigPose(state: RemoteAvatarMotion, output?: PlayerRigPose): PlayerRigPose {
  const input = REMOTE_RIG_INPUT as { -readonly [Key in keyof PlayerRigInput]: PlayerRigInput[Key] };
  input.motion = state.horizontalSpeed > 0.04 ? "walk" : "idle";
  input.phase = state.walkPhase;
  input.intensity = Math.min(1, state.horizontalSpeed / 4.3);
  input.headYaw = -shortestAngleDelta(state.bodyYaw, state.rendered.yaw);
  // Engine pitch is positive when the camera looks up; skin rig pitch rotates
  // the face downward, so local and remote avatars share the same inversion.
  input.headPitch = -state.rendered.pitch;
  input.actionProgress = state.armActionProgress;
  input.crouching = state.crouching;
  return resolvePlayerRigPose(input, output);
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function createRemoteAvatarMotion(player: RemotePlayer, now: number): RemoteAvatarMotion {
  const target = safePose(player);
  const state: RemoteAvatarMotion = {
    id: String(player.id).slice(0, 128),
    name: sanitizePlayerName(player.name),
    color: player.color,
    heldItem: null,
    armorHead: null,
    armorChest: null,
    armorLegs: null,
    armorFeet: null,
    skinId: "default",
    skinModel: "wide",
    skinPixels: null,
    rendered: { ...target },
    target: { ...target },
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    horizontalSpeed: 0,
    walkPhase: 0,
    bodyYaw: target.yaw,
    lastSnapshotAt: now,
    lastVisualActionSequence: -1,
    armActionStartedAt: -Infinity,
    armActionPhase: 0,
    armActionProgress: 1,
    bowDrawing: false,
    crouching: false,
  };
  if ([player.vx, player.vy, player.vz].every(Number.isFinite)) {
    assignBoundedVelocity(state, player.vx as number, player.vy as number, player.vz as number);
  }
  assignRemoteGear(state, player);
  assignRemoteSkin(state, player);
  applyRemoteVisualActions(state, player, now);
  if (typeof player.crouching === "boolean") state.crouching = player.crouching;
  return state;
}

/** Records a sparse Lakebed pose without snapping the rendered avatar to it. */
export function applyRemoteAvatarSnapshot(
  state: RemoteAvatarMotion,
  player: RemotePlayer,
  now: number,
): void {
  const next = safePose(player, state.target);
  const elapsed = Math.max(1 / 60, Math.min(2, (now - state.lastSnapshotAt) / 1_000));
  if ([player.vx, player.vy, player.vz].every(Number.isFinite)) {
    assignBoundedVelocity(state, player.vx as number, player.vy as number, player.vz as number);
  } else {
    assignBoundedVelocity(
      state,
      (next.x - state.target.x) / elapsed,
      (next.y - state.target.y) / elapsed,
      (next.z - state.target.z) / elapsed,
    );
  }
  state.target = next;
  state.name = sanitizePlayerName(player.name);
  state.color = player.color;
  assignRemoteGear(state, player);
  assignRemoteSkin(state, player);
  applyRemoteVisualActions(state, player, now);
  if (typeof player.crouching === "boolean") state.crouching = player.crouching;
  state.lastSnapshotAt = now;
}

/**
 * Smooths toward the latest pose and permits a few seconds of bounded
 * extrapolation. Explicit zero-velocity corrections immediately collapse the
 * goal back to the authoritative pose, while stale motion never extrapolates
 * beyond the shared presence budget.
 */
export function advanceRemoteAvatarMotion(
  state: RemoteAvatarMotion,
  now: number,
  deltaSeconds: number,
): void {
  const dt = Math.max(0, Math.min(0.1, deltaSeconds));
  if (dt === 0) return;
  const snapshotAge = Math.max(0, (now - state.lastSnapshotAt) / 1_000);
  const lookAhead = Math.min(PRESENCE_MAX_EXTRAPOLATION_MS / 1_000, snapshotAge);
  const verticalLookAhead = Math.min(PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS / 1_000, snapshotAge);
  const goalX = finiteRange(state.target.x + state.velocityX * lookAhead, state.target.x, PRESENCE_MIN_X, PRESENCE_MAX_X);
  const goalY = finiteRange(state.target.y + state.velocityY * verticalLookAhead, state.target.y, PRESENCE_MIN_Y, PRESENCE_MAX_Y);
  const goalZ = finiteRange(state.target.z + state.velocityZ * lookAhead, state.target.z, PRESENCE_MIN_Z, PRESENCE_MAX_Z);
  const follow = 1 - Math.exp(-15 * dt);
  const previousX = state.rendered.x;
  const previousZ = state.rendered.z;

  state.rendered.x += (goalX - state.rendered.x) * follow;
  state.rendered.y += (goalY - state.rendered.y) * follow;
  state.rendered.z += (goalZ - state.rendered.z) * follow;
  state.rendered.yaw += shortestAngleDelta(state.rendered.yaw, state.target.yaw) * follow;
  state.rendered.pitch += (state.target.pitch - state.rendered.pitch) * follow;

  const measuredSpeed = Math.min(
    PRESENCE_MAX_HORIZONTAL_SPEED,
    Math.hypot(state.rendered.x - previousX, state.rendered.z - previousZ) / dt,
  );
  const gaitFollow = 1 - Math.exp(-10 * dt);
  state.horizontalSpeed += (measuredSpeed - state.horizontalSpeed) * gaitFollow;
  const movementMode = state.crouching ? "sneak" : state.horizontalSpeed > 5 ? "sprint" : "walk";
  state.walkPhase = (state.walkPhase + dt * 1_000 / playerRigCycleMilliseconds(movementMode)) % 1;
  const armActionElapsed = now - state.armActionStartedAt;
  state.armActionProgress = armActionElapsed >= 0 && armActionElapsed < FIRST_PERSON_ACTION_MS
    ? armActionElapsed / FIRST_PERSON_ACTION_MS : 1;
  state.armActionPhase = armActionElapsed >= 0 && armActionElapsed < FIRST_PERSON_ACTION_MS
    ? Math.sin(Math.PI * armActionElapsed / FIRST_PERSON_ACTION_MS)
    : 0;

  // The avatar faces the direction the player is looking while locomotion is
  // free to move forward, backward, or sideways relative to that facing.
  // Keeping the same yaw contract as the local F5 rig also prevents remote
  // players from visibly sprinting backward when their input turns quickly.
  const desiredBodyYaw = state.rendered.yaw;
  state.bodyYaw += shortestAngleDelta(state.bodyYaw, desiredBodyYaw) * (1 - Math.exp(-7 * dt));

}
