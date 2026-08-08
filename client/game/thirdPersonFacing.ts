const MAX_HEAD_YAW = Math.PI * 0.42;
const MAX_HEAD_PITCH = Math.PI * 0.48;

export interface ThirdPersonFacingState {
  readonly bodyYaw: number;
  readonly headYaw: number;
  readonly headPitch: number;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function createThirdPersonFacingState(yaw = 0, pitch = 0): ThirdPersonFacingState {
  return Object.freeze({
    bodyYaw: Number.isFinite(yaw) ? yaw : 0,
    headYaw: 0,
    headPitch: Math.max(-MAX_HEAD_PITCH, Math.min(MAX_HEAD_PITCH, Number.isFinite(pitch) ? pitch : 0)),
  });
}

/**
 * Keeps the head coupled to camera look while the torso follows only as far as
 * needed, then catches up promptly during movement. This makes F5 look input
 * visible instead of rotating camera and the entire avatar as one rigid unit.
 */
export function stepThirdPersonFacing(
  current: ThirdPersonFacingState,
  lookYaw: number,
  lookPitch: number,
  moving: boolean,
  dt: number,
): ThirdPersonFacingState {
  const safeLookYaw = Number.isFinite(lookYaw) ? lookYaw : current.bodyYaw;
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  const lookDelta = shortestAngleDelta(current.bodyYaw, safeLookYaw);
  const desiredBodyYaw = moving
    ? safeLookYaw
    : Math.abs(lookDelta) > MAX_HEAD_YAW
      ? safeLookYaw - Math.sign(lookDelta) * MAX_HEAD_YAW
      : current.bodyYaw;
  const follow = 1 - Math.exp(-(moving ? 12 : 8) * safeDt);
  const bodyYaw = current.bodyYaw + shortestAngleDelta(current.bodyYaw, desiredBodyYaw) * follow;
  return Object.freeze({
    bodyYaw,
    headYaw: Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, shortestAngleDelta(bodyYaw, safeLookYaw))),
    headPitch: Math.max(-MAX_HEAD_PITCH, Math.min(MAX_HEAD_PITCH, Number.isFinite(lookPitch) ? lookPitch : 0)),
  });
}
