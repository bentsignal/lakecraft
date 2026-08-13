import { MAX_REMOTE_PLAYERS, resolveRemoteAvatarRigPose, writeRemoteAvatarDeathLocal, type RemoteAvatarMotion } from "./avatar.ts";
import { createLakecraftDefaultSkinPixels } from "./playerSkin.ts";
import {
  buildPlayerSkinGeometry,
  PLAYER_SKIN_VERTEX_COUNT,
  PLAYER_SKIN_VERTEX_STRIDE,
} from "./playerSkinGeometry.ts";
import {
  PLAYER_RIG_SKIN_DRAWS,
  type PlayerRigPose,
  writePlayerRigPartMatrix,
} from "./playerRig.ts";
import { createVisualProgram, SKIN_FRAGMENT_SHADER, SKIN_VERTEX_SHADER } from "./visualShaders.ts";

type Vec3 = readonly [number, number, number];
const REMOTE_RENDER_DISTANCE_SQUARED = (21 * 16) ** 2;
const REMOTE_WIDE_SKIN_GEOMETRY = buildPlayerSkinGeometry("wide");
const REMOTE_SLIM_SKIN_GEOMETRY = buildPlayerSkinGeometry("slim");
export const REMOTE_SKIN_ATLAS_COLUMNS = 8;
export const REMOTE_SKIN_ATLAS_ROWS = 4;
export const REMOTE_SKIN_ATLAS_WIDTH = REMOTE_SKIN_ATLAS_COLUMNS * 64;
export const REMOTE_SKIN_ATLAS_HEIGHT = REMOTE_SKIN_ATLAS_ROWS * 64;
export const REMOTE_SKIN_ATLAS_BYTES = REMOTE_SKIN_ATLAS_WIDTH * REMOTE_SKIN_ATLAS_HEIGHT * 4;
const REMOTE_PART_MATRIX = new Float32Array(16);
const REMOTE_RIG_SCRATCH_MATRIX = new Float32Array(16);
const REMOTE_RIG_POSE = {} as PlayerRigPose;
const REMOTE_DEATH_LOCAL = new Float32Array(2);
export const REMOTE_SKIN_FLOATS_PER_PLAYER = PLAYER_SKIN_VERTEX_COUNT * PLAYER_SKIN_VERTEX_STRIDE;

export type RemotePlayerSkinRenderer = Readonly<{
  update(states: ReadonlyMap<string, RemoteAvatarMotion>, camera: Vec3): number;
  draw(viewProjection: Float32Array, light: Vec3): void;
  destroy(): void;
}>;

/** CPU-batches the exact installed 64×64 skin and canonical articulated rig. */
export function writeRemotePlayerSkinGeometry(
  states: ReadonlyMap<string, RemoteAvatarMotion>,
  camera: Vec3,
  output: Float32Array,
): number {
  let offset = 0;
  let visited = 0;
  let slot = 0;
  for (const state of states.values()) {
    if (visited++ >= MAX_REMOTE_PLAYERS) break;
    if (state.deathHidden) continue;
    const dx = state.rendered.x - camera[0];
    const dz = state.rendered.z - camera[2];
    if (dx * dx + dz * dz > REMOTE_RENDER_DISTANCE_SQUARED) continue;
    const rig = resolveRemoteAvatarRigPose(state, REMOTE_RIG_POSE);
    const geometry = state.skinModel === "slim" ? REMOTE_SLIM_SKIN_GEOMETRY : REMOTE_WIDE_SKIN_GEOMETRY;
    const atlasX = slot % REMOTE_SKIN_ATLAS_COLUMNS;
    const atlasY = Math.floor(slot / REMOTE_SKIN_ATLAS_COLUMNS);
    const angle = Math.PI - state.bodyYaw;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (const draw of PLAYER_RIG_SKIN_DRAWS) {
      writePlayerRigPartMatrix(REMOTE_PART_MATRIX, draw.part, rig, state.skinModel, true, REMOTE_RIG_SCRATCH_MATRIX);
      const end = (draw.first + draw.count) * PLAYER_SKIN_VERTEX_STRIDE;
      for (let source = draw.first * PLAYER_SKIN_VERTEX_STRIDE; source < end; source += PLAYER_SKIN_VERTEX_STRIDE) {
        const x = geometry[source]; const y = geometry[source + 1]; const z = geometry[source + 2];
        const localX = REMOTE_PART_MATRIX[0] * x + REMOTE_PART_MATRIX[4] * y + REMOTE_PART_MATRIX[8] * z + REMOTE_PART_MATRIX[12];
        const localY = REMOTE_PART_MATRIX[1] * x + REMOTE_PART_MATRIX[5] * y + REMOTE_PART_MATRIX[9] * z + REMOTE_PART_MATRIX[13];
        const localZ = REMOTE_PART_MATRIX[2] * x + REMOTE_PART_MATRIX[6] * y + REMOTE_PART_MATRIX[10] * z + REMOTE_PART_MATRIX[14];
        writeRemoteAvatarDeathLocal(state, localX, localY, REMOTE_DEATH_LOCAL);
        const deathX = REMOTE_DEATH_LOCAL[0];
        output[offset++] = state.rendered.x + cosine * deathX + sine * localZ;
        output[offset++] = state.rendered.y + REMOTE_DEATH_LOCAL[1];
        output[offset++] = state.rendered.z - sine * deathX + cosine * localZ;
        output[offset++] = (geometry[source + 3] + atlasX) / REMOTE_SKIN_ATLAS_COLUMNS;
        output[offset++] = (geometry[source + 4] + atlasY) / REMOTE_SKIN_ATLAS_ROWS;
        output[offset++] = state.hurtFlash ? -geometry[source + 5] : geometry[source + 5];
      }
    }
    slot += 1;
  }
  return offset / PLAYER_SKIN_VERTEX_STRIDE;
}

export function createRemotePlayerSkinRenderer(gl: WebGLRenderingContext): RemotePlayerSkinRenderer {
  const program = createVisualProgram(gl, SKIN_VERTEX_SHADER, SKIN_FRAGMENT_SHADER);
  const buffer = gl.createBuffer(), texture = gl.createTexture();
  const position = gl.getAttribLocation(program, "aPosition"), uv = gl.getAttribLocation(program, "aUv"), shade = gl.getAttribLocation(program, "aShade");
  const mvp = gl.getUniformLocation(program, "uMvp"), skin = gl.getUniformLocation(program, "uSkin"), lighting = gl.getUniformLocation(program, "uLight");
  if (!buffer || !texture || position < 0 || uv < 0 || shade < 0 || !mvp || !skin || !lighting) {
    gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program);
    throw new Error("Player skin shader bindings are incomplete.");
  }
  const data = new Float32Array(MAX_REMOTE_PLAYERS * REMOTE_SKIN_FLOATS_PER_PLAYER);
  const defaultPixels = createLakecraftDefaultSkinPixels();
  const uploadedIds = Array<string>(MAX_REMOTE_PLAYERS).fill("");
  let upload = data.subarray(0, 0);
  let vertexCount = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, REMOTE_SKIN_ATLAS_WIDTH, REMOTE_SKIN_ATLAS_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return Object.freeze({
    update(states, camera) {
      let visited = 0;
      let slot = 0;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      for (const state of states.values()) {
        if (visited++ >= MAX_REMOTE_PLAYERS) break;
        if (state.deathHidden) continue;
        const dx = state.rendered.x - camera[0], dz = state.rendered.z - camera[2];
        if (dx * dx + dz * dz > REMOTE_RENDER_DISTANCE_SQUARED) continue;
        const uploadId = state.skinPixels ? state.skinId : "default";
        if (uploadedIds[slot] !== uploadId) {
          uploadedIds[slot] = uploadId;
          gl.texSubImage2D(
            gl.TEXTURE_2D, 0,
            slot % REMOTE_SKIN_ATLAS_COLUMNS * 64,
            Math.floor(slot / REMOTE_SKIN_ATLAS_COLUMNS) * 64,
            64, 64, gl.RGBA, gl.UNSIGNED_BYTE,
            state.skinPixels ?? defaultPixels,
          );
        }
        slot += 1;
      }
      vertexCount = writeRemotePlayerSkinGeometry(states, camera, data);
      const floats = vertexCount * PLAYER_SKIN_VERTEX_STRIDE;
      if (upload.length !== floats) upload = data.subarray(0, floats);
      if (floats) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
      }
      return vertexCount;
    },
    draw(viewProjection, light) {
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv); gl.enableVertexAttribArray(shade);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 24, 12);
      gl.vertexAttribPointer(shade, 1, gl.FLOAT, false, 24, 20);
      gl.uniformMatrix4fv(mvp, false, viewProjection);
      gl.uniform3f(lighting, light[0], light[1], light[2]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(skin, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.disable(gl.BLEND);
    },
    destroy() { gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program); },
  });
}
