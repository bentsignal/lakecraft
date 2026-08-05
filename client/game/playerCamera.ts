export type PlayerCameraMode = "first_person" | "third_person_back" | "third_person_front";

export const PLAYER_CAMERA_MODES = Object.freeze([
  "first_person",
  "third_person_back",
  "third_person_front",
] as const satisfies readonly PlayerCameraMode[]);

export function nextPlayerCameraMode(mode: PlayerCameraMode): PlayerCameraMode {
  const index = PLAYER_CAMERA_MODES.indexOf(mode);
  return PLAYER_CAMERA_MODES[(index + 1) % PLAYER_CAMERA_MODES.length];
}

type MutableVec3 = [number, number, number];
type Vec3 = readonly [number, number, number];

function blockedWithClearance(point: Vec3, blocked: (x: number, y: number, z: number) => boolean): boolean {
  const clearance = 0.12;
  return blocked(point[0], point[1], point[2])
    || blocked(point[0] + clearance, point[1], point[2])
    || blocked(point[0] - clearance, point[1], point[2])
    || blocked(point[0], point[1] + clearance, point[2])
    || blocked(point[0], point[1] - clearance, point[2])
    || blocked(point[0], point[1], point[2] + clearance)
    || blocked(point[0], point[1], point[2] - clearance);
}

/**
 * Writes a familiar three-state camera. Third-person rays shorten before solid
 * terrain so the camera never shows the inside of a wall or unloaded void.
 */
export function writePlayerCamera(
  eye: MutableVec3,
  facing: MutableVec3,
  mode: PlayerCameraMode,
  playerEye: Vec3,
  playerFacing: Vec3,
  blocked: (x: number, y: number, z: number) => boolean,
  distance = 4,
): void {
  if (mode === "first_person") {
    eye[0] = playerEye[0]; eye[1] = playerEye[1]; eye[2] = playerEye[2];
    facing[0] = playerFacing[0]; facing[1] = playerFacing[1]; facing[2] = playerFacing[2];
    return;
  }
  const target: MutableVec3 = [playerEye[0], playerEye[1] - 0.2, playerEye[2]];
  const side = mode === "third_person_back" ? -1 : 1;
  const offsetX = playerFacing[0] * distance * side;
  const offsetY = playerFacing[1] * distance * side;
  const offsetZ = playerFacing[2] * distance * side;
  let safe = 0;
  const sample: MutableVec3 = [0, 0, 0];
  for (let step = 1; step <= 32; step += 1) {
    const amount = step / 32;
    sample[0] = target[0] + offsetX * amount;
    sample[1] = target[1] + offsetY * amount;
    sample[2] = target[2] + offsetZ * amount;
    if (blockedWithClearance(sample, blocked)) break;
    safe = amount;
  }
  eye[0] = target[0] + offsetX * safe;
  eye[1] = target[1] + offsetY * safe;
  eye[2] = target[2] + offsetZ * safe;
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  facing[0] = dx / length; facing[1] = dy / length; facing[2] = dz / length;
}
