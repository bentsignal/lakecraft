import { createLakecraftDefaultSkinPixels, type PlayerSkinModel } from "./playerSkin.ts";
import {
  buildPlayerSkinPartGeometry,
  PLAYER_SKIN_VERTEX_STRIDE,
} from "./playerSkinGeometry.ts";
import { currentFirstPersonTuning, type FirstPersonGroupTuning } from "./firstPersonTuning.ts";
import { createVisualProgram, SKIN_FRAGMENT_SHADER, SKIN_VERTEX_SHADER } from "./visualShaders.ts";
import {
  createViewmodelRigPoseFromProjection,
  transformViewmodelArmPoint,
} from "./viewmodelRig.ts";

const ARM_BOXES = 2;
/** Vanilla-style quarter-pixel sleeve shell: concentric, never a separate fist. */
export const FIRST_PERSON_SKIN_SLEEVE_INFLATE = 0.25 / 16;
export const FIRST_PERSON_SKIN_ARM_VERTICES = ARM_BOXES * 36;
export const FIRST_PERSON_SKIN_ARM_BUFFER_BYTES = FIRST_PERSON_SKIN_ARM_VERTICES
  * PLAYER_SKIN_VERTEX_STRIDE * Float32Array.BYTES_PER_ELEMENT;
export const FIRST_PERSON_SKIN_REFERENCE_ASPECT = 16 / 9;

export type FirstPersonSkinRenderer = Readonly<{
  draw(
    mvp: Float32Array,
    projection: Float32Array,
    light: readonly [number, number, number],
  ): void;
  setSkin(source: TexImageSource | null, model: PlayerSkinModel): void;
  destroy(): void;
}>;

function applyTuning(output: Float32Array, tuning: FirstPersonGroupTuning): void {
  const rx = tuning.rotationDegrees[0] * Math.PI / 180;
  const ry = tuning.rotationDegrees[1] * Math.PI / 180;
  const rz = tuning.rotationDegrees[2] * Math.PI / 180;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  for (let offset = 0; offset < output.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    let x = (output[offset] - tuning.pivot[0]) * tuning.scale;
    let y = (output[offset + 1] - tuning.pivot[1]) * tuning.scale;
    let z = (output[offset + 2] - tuning.pivot[2]) * tuning.scale;
    if (rx) { const nextY = y * cx - z * sx; z = y * sx + z * cx; y = nextY; }
    if (ry) { const nextX = x * cy + z * sy; z = -x * sy + z * cy; x = nextX; }
    if (rz) { const nextX = x * cz - y * sz; y = x * sz + y * cz; x = nextX; }
    output[offset] = x + tuning.pivot[0] + tuning.position[0];
    output[offset + 1] = y + tuning.pivot[1] + tuning.position[1];
    output[offset + 2] = z + tuning.pivot[2] + tuning.position[2];
  }
}

/** Deterministic standard-UV arm batch shared by live rendering and viewport tests. */
export function buildFirstPersonSkinArmGeometry(
  model: PlayerSkinModel,
  tuning: FirstPersonGroupTuning = currentFirstPersonTuning().tuning.arm,
  blockMode = false,
): Float32Array {
  // Canonical cubes deliberately retain the exact pre-overhaul arm transform.
  // Sprite/tool work uses the newer anatomical arm, so restoring blocks cannot
  // move the pickaxe, bow, or any other held-item presentation.
  const output = blockMode
    ? buildPlayerSkinPartGeometry("rightArm", model)
    : buildPlayerSkinPartGeometry("rightArm", model, FIRST_PERSON_SKIN_SLEEVE_INFLATE);
  const pivotX = model === "slim" ? 0.34375 : 0.375;
  const pivotY = model === "slim" ? 1.46875 : 1.5;
  if (blockMode) {
    const angle = -150 * Math.PI / 180;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    for (let offset = 0; offset < output.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
      const x = (output[offset] - pivotX) * 0.92;
      const y = (output[offset + 1] - 1.5) * 0.92;
      const z = output[offset + 2] * 0.92;
      output[offset] = x * cosine - y * sine + 0.82;
      output[offset + 1] = x * sine + y * cosine - 0.82;
      output[offset + 2] = z - 1.22;
    }
    applyTuning(output, tuning);
    return output;
  }
  // From the lower-right camera edge toward the center, matching the authored
  // shoulder-to-hand direction rather than mirroring the whole arm broadside.
  const angle = 217 * Math.PI / 180;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  for (let offset = 0; offset < output.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    const x = (output[offset] - pivotX) * 1.3;
    const y = (output[offset + 1] - pivotY) * 1.3;
    const z = output[offset + 2] * 1.3;
    output[offset] = x * cosine - y * sine + 1.7;
    output[offset + 1] = x * sine + y * cosine - 0.62;
    output[offset + 2] = z - 1.22;
  }
  applyTuning(output, tuning);
  return output;
}

/**
 * New live viewmodel arm. The canonical skin cuboid is treated as a bone whose
 * top-center is the shoulder and bottom-center is the wrist. This makes the
 * final hand endpoint mathematically identical to the held-item socket.
 */
export function buildSocketedFirstPersonSkinArmGeometry(
  model: PlayerSkinModel,
  projection: Float32Array,
): Float32Array {
  const output = buildPlayerSkinPartGeometry("rightArm", model, FIRST_PERSON_SKIN_SLEEVE_INFLATE);
  const centerX = model === "slim" ? 0.34375 : 0.375;
  const shoulderY = model === "slim" ? 1.46875 : 1.5;
  const wristY = model === "slim" ? 0.71875 : 0.75;
  const localShoulder = [centerX, shoulderY, 0] as const;
  const pose = createViewmodelRigPoseFromProjection(projection);
  for (let offset = 0; offset < output.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    const point = transformViewmodelArmPoint(
      [output[offset], output[offset + 1], output[offset + 2]],
      localShoulder,
      shoulderY - wristY,
      pose,
    );
    output[offset] = point[0];
    output[offset + 1] = point[1];
    output[offset + 2] = point[2];
  }
  return output;
}

/**
 * Keeps the camera arm at a stable screen-space width without changing the
 * world/held-item projection. Perspective makes horizontal NDC scale inversely
 * proportional to aspect ratio; row norms recover that ratio even while the
 * shared wrist matrix is rotating during an action.
 */
export function writeResponsiveFirstPersonSkinMvp(
  output: Float32Array,
  input: Float32Array,
): Float32Array {
  output.set(input);
  const horizontal = Math.hypot(input[0], input[4], input[8]);
  const vertical = Math.hypot(input[1], input[5], input[9]);
  if (horizontal > 0 && vertical > 0 && Number.isFinite(horizontal) && Number.isFinite(vertical)) {
    const compensation = vertical / horizontal / FIRST_PERSON_SKIN_REFERENCE_ASPECT;
    output[0] *= compensation; output[4] *= compensation;
    output[8] *= compensation; output[12] *= compensation;
  }
  return output;
}

export function createFirstPersonSkinRenderer(gl: WebGLRenderingContext): FirstPersonSkinRenderer {
  const program = createVisualProgram(gl, SKIN_VERTEX_SHADER, SKIN_FRAGMENT_SHADER);
  const buffer = gl.createBuffer(); const texture = gl.createTexture();
  const position = gl.getAttribLocation(program, "aPosition"); const uv = gl.getAttribLocation(program, "aUv");
  const shade = gl.getAttribLocation(program, "aShade"); const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const textureLocation = gl.getUniformLocation(program, "uSkin"); const lightLocation = gl.getUniformLocation(program, "uLight");
  if (!buffer || !texture || position < 0 || uv < 0 || shade < 0 || !mvpLocation || !textureLocation || !lightLocation) {
    gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program);
    throw new Error("First-person skin bindings are incomplete.");
  }
  let model: PlayerSkinModel = "wide";
  let tuningSnapshot = currentFirstPersonTuning();
  let projectionFingerprint = "";
  const initialProjection = new Float32Array(16);
  initialProjection[0] = 1 / (16 / 9 * Math.tan(70 * Math.PI / 360));
  initialProjection[5] = 1 / Math.tan(70 * Math.PI / 360);
  initialProjection[10] = -1; initialProjection[11] = -1; initialProjection[14] = -0.02;
  const retainedProjection = new Float32Array(initialProjection);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, buildSocketedFirstPersonSkinArmGeometry(model, initialProjection), gl.DYNAMIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
  const finalMvp = new Float32Array(16);

  return Object.freeze({
    draw(mvp, projection, light) {
      const nextTuning = currentFirstPersonTuning();
      const nextProjectionFingerprint = `${projection[0].toFixed(6)}:${projection[5].toFixed(6)}`;
      if (nextTuning.revision !== tuningSnapshot.revision || nextProjectionFingerprint !== projectionFingerprint) {
        tuningSnapshot = nextTuning;
        projectionFingerprint = nextProjectionFingerprint;
        retainedProjection.set(projection);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          buildSocketedFirstPersonSkinArmGeometry(model, projection),
          gl.DYNAMIC_DRAW,
        );
      }
      finalMvp.set(mvp);
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = PLAYER_SKIN_VERTEX_STRIDE * Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(shade); gl.vertexAttribPointer(shade, 1, gl.FLOAT, false, stride, 20);
      gl.uniformMatrix4fv(mvpLocation, false, finalMvp); gl.uniform3f(lightLocation, light[0], light[1], light[2]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(textureLocation, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, FIRST_PERSON_SKIN_ARM_VERTICES); gl.disable(gl.BLEND);
    },
    setSkin(source, nextModel) {
      if (model !== nextModel) {
        model = nextModel;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          buildSocketedFirstPersonSkinArmGeometry(model, retainedProjection),
          gl.DYNAMIC_DRAW,
        );
      }
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
    },
    destroy() { gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program); },
  });
}
