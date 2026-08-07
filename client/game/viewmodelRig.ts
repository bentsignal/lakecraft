import type { ViewmodelDisplayTransform } from "./generated/viewmodelDisplayTransforms.ts";

export type ViewmodelVec3 = readonly [x: number, y: number, z: number];

export type ViewmodelRigPose = Readonly<{
  shoulder: ViewmodelVec3;
  wrist: ViewmodelVec3;
  socket: ViewmodelVec3;
  armLength: number;
  viewScale: number;
  itemScale: number;
}>;

export type ViewmodelProjectionParameters = Readonly<{
  verticalFovRadians: number;
  aspect: number;
}>;

export const VIEWMODEL_NEAR = 0.01;
export const VIEWMODEL_FAR = 8;
export const VIEWMODEL_SHOULDER_NDC = Object.freeze([1.16, -1.2] as const);
export const VIEWMODEL_WRIST_NDC = Object.freeze([0.66, -0.64] as const);
// The shoulder begins nearest the camera and the wrist reaches away into the
// world. Reversing these depths makes the arm point back at the viewer even
// though its two screen anchors still look superficially connected.
export const VIEWMODEL_SHOULDER_DEPTH = 0.86;
export const VIEWMODEL_WRIST_DEPTH = 1.18;
export const VIEWMODEL_ARM_CROSS_SECTION_SCALE = 0.45;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Converts a screen anchor into camera space at a fixed forward depth.
 * Camera space is right-handed: +X right, +Y up, -Z forward.
 */
export function unprojectViewmodelAnchor(
  ndcX: number,
  ndcY: number,
  depth: number,
  verticalFovRadians: number,
  aspect: number,
): ViewmodelVec3 {
  const safeDepth = finitePositive(depth, 1);
  const safeAspect = finitePositive(aspect, 1);
  const halfHeight = Math.tan(verticalFovRadians / 2) * safeDepth;
  return Object.freeze([
    ndcX * halfHeight * safeAspect,
    ndcY * halfHeight,
    -safeDepth,
  ] as const);
}

/** One authoritative arm chain. The item socket is exactly the wrist endpoint. */
export function createViewmodelRigPose(
  verticalFovRadians: number,
  aspect: number,
): ViewmodelRigPose {
  const shoulder = unprojectViewmodelAnchor(
    VIEWMODEL_SHOULDER_NDC[0], VIEWMODEL_SHOULDER_NDC[1],
    VIEWMODEL_SHOULDER_DEPTH, verticalFovRadians, aspect,
  );
  const wrist = unprojectViewmodelAnchor(
    VIEWMODEL_WRIST_NDC[0], VIEWMODEL_WRIST_NDC[1],
    VIEWMODEL_WRIST_DEPTH, verticalFovRadians, aspect,
  );
  return Object.freeze({
    shoulder,
    wrist,
    socket: wrist,
    armLength: Math.hypot(
      wrist[0] - shoulder[0],
      wrist[1] - shoulder[1],
      wrist[2] - shoulder[2],
    ),
    viewScale: Math.tan(verticalFovRadians / 2),
    itemScale: Math.tan(verticalFovRadians / 2) * (aspect >= 1 ? 1 : aspect / (16 / 9)),
  });
}

/** Recovers the actual camera settings from a standard perspective matrix. */
export function viewmodelProjectionParameters(
  projection: Float32Array,
): ViewmodelProjectionParameters {
  const verticalScale = finitePositive(projection[5], 1);
  const horizontalScale = finitePositive(projection[0], verticalScale);
  return Object.freeze({
    verticalFovRadians: 2 * Math.atan(1 / verticalScale),
    aspect: verticalScale / horizontalScale,
  });
}

export function createViewmodelRigPoseFromProjection(
  projection: Float32Array,
): ViewmodelRigPose {
  const parameters = viewmodelProjectionParameters(projection);
  return createViewmodelRigPose(parameters.verticalFovRadians, parameters.aspect);
}

/**
 * Orthonormal camera-space basis for the arm. Local +Y points from wrist to
 * shoulder; local X stays perpendicular to the arm on screen; local Z gives
 * the cuboid real depth instead of flattening it into a HUD sprite.
 */
export function viewmodelArmBasis(pose: ViewmodelRigPose): Readonly<{
  x: ViewmodelVec3;
  y: ViewmodelVec3;
  z: ViewmodelVec3;
}> {
  const inverseLength = 1 / finitePositive(pose.armLength, 1);
  const y: ViewmodelVec3 = Object.freeze([
    (pose.shoulder[0] - pose.wrist[0]) * inverseLength,
    (pose.shoulder[1] - pose.wrist[1]) * inverseLength,
    (pose.shoulder[2] - pose.wrist[2]) * inverseLength,
  ] as const);
  const screenLength = finitePositive(Math.hypot(y[0], y[1]), 1);
  const x: ViewmodelVec3 = Object.freeze([y[1] / screenLength, -y[0] / screenLength, 0] as const);
  const z: ViewmodelVec3 = Object.freeze([
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ] as const);
  return Object.freeze({ x, y, z });
}

export function transformViewmodelArmPoint(
  point: ViewmodelVec3,
  localShoulder: ViewmodelVec3,
  localArmLength: number,
  pose: ViewmodelRigPose,
): ViewmodelVec3 {
  const basis = viewmodelArmBasis(pose);
  const scale = pose.armLength / finitePositive(localArmLength, 1);
  const x = (point[0] - localShoulder[0]) * scale * VIEWMODEL_ARM_CROSS_SECTION_SCALE;
  const y = (point[1] - localShoulder[1]) * scale;
  const z = (point[2] - localShoulder[2]) * scale * VIEWMODEL_ARM_CROSS_SECTION_SCALE;
  return Object.freeze([
    pose.shoulder[0] + basis.x[0] * x + basis.y[0] * y + basis.z[0] * z,
    pose.shoulder[1] + basis.x[1] * x + basis.y[1] * y + basis.z[1] * z,
    pose.shoulder[2] + basis.x[2] * x + basis.y[2] * y + basis.z[2] * z,
  ] as const);
}

export function writeViewmodelProjection(
  output: Float32Array,
  verticalFovRadians: number,
  aspect: number,
  near = VIEWMODEL_NEAR,
  far = VIEWMODEL_FAR,
): Float32Array {
  const f = 1 / Math.tan(verticalFovRadians / 2);
  output.fill(0);
  output[0] = f / finitePositive(aspect, 1);
  output[5] = f;
  output[10] = (far + near) / (near - far);
  output[11] = -1;
  output[14] = (2 * far * near) / (near - far);
  return output;
}

export function projectViewmodelPoint(
  point: ViewmodelVec3,
  verticalFovRadians: number,
  aspect: number,
): readonly [x: number, y: number] {
  const f = 1 / Math.tan(verticalFovRadians / 2);
  const w = -point[2];
  return Object.freeze([
    point[0] * f / finitePositive(aspect, 1) / w,
    point[1] * f / w,
  ] as const);
}

/** Converts Minecraft's 16-pixel display translation into socket-local blocks. */
export function minecraftDisplayTranslation(
  transform: ViewmodelDisplayTransform,
): ViewmodelVec3 {
  return Object.freeze([
    transform.translationPixels[0] / 16,
    transform.translationPixels[1] / 16,
    transform.translationPixels[2] / 16,
  ] as const);
}
