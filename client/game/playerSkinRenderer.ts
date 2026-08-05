import type { PlayerPose } from "./types.ts";
import type { ItemId } from "../../shared/game.ts";
import { getItemIconArt } from "../components/itemIconArt.ts";
import {
  appendItemSpriteGeometry,
  ITEM_SPRITE_VERTEX_FLOATS,
  type ItemSpriteGeometryOptions,
} from "./itemSpriteGeometry.ts";
import { itemVisual } from "../../shared/visualCatalog.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { createLakecraftDefaultSkinPixels, type PlayerSkinModel } from "./playerSkin.ts";
import { buildPlayerSkinGeometry, PLAYER_SKIN_VERTEX_STRIDE } from "./playerSkinGeometry.ts";
import {
  buildPlayerArmorGeometry,
  PLAYER_ARMOR_VERTEX_STRIDE,
  type PlayerArmorAppearance,
} from "./playerArmorGeometry.ts";
import {
  PLAYER_RIG_SKIN_DRAWS,
  playerArmorRigDraws,
  resolvePlayerRigPose,
  writePlayerRigPartMatrix,
  type PlayerRigInput,
} from "./playerRig.ts";
import {
  appendBlockItemCubeGeometry,
  blockIdForCubeItem,
} from "./blockItemCubeGeometry.ts";
import {
  COLOR_FRAGMENT_SHADER,
  COLOR_VERTEX_SHADER,
  createVisualProgram,
  SKIN_FRAGMENT_SHADER,
  SKIN_VERTEX_SHADER,
} from "./visualShaders.ts";

export type PlayerSkinRenderer = Readonly<{
  readonly vertexCount: number;
  readonly heldItemVertexCount: number;
  readonly armorVertexCount: number;
  readonly drawCallCount: number;
  draw(viewProjection: Float32Array, pose: Readonly<PlayerPose>, light: readonly [number, number, number], rig?: PlayerRigInput): void;
  setSkin(source: TexImageSource | null, model: PlayerSkinModel): void;
  setHeldItem(itemId: ItemId | null): void;
  setArmor(appearance: PlayerArmorAppearance): void;
  destroy(): void;
}>;

/** Resolves the catalog's 16-unit third-person transform onto the right-hand socket. */
export function thirdPersonHeldItemPresentation(itemId: ItemId): ItemSpriteGeometryOptions {
  const visual = itemVisual(itemId);
  const display = visual.display.thirdPersonRight;
  const baseSize = visual.family === "block" ? 1.25 : 0.54;
  // Bow display translation is authored around its own centered grip while
  // generated/block/handheld parents are authored around the lower hand.
  const socketY = visual.parent === "bow" ? 0.875 : 0.53;
  return Object.freeze({
    center: [
      0.39 + display.translation[0] / 16,
      socketY + display.translation[1] / 16,
      0.17 + display.translation[2] / 16,
    ],
    size: baseSize * display.scale[0],
    depth: Math.max(0.028, 0.052 * display.scale[2]),
    rotationDegrees: display.rotationDegrees,
    pivotPixels: display.pivot ? [display.pivot[0], display.pivot[1]] : undefined,
  });
}

export function createPlayerSkinRenderer(gl: WebGLRenderingContext): PlayerSkinRenderer {
  const program = createVisualProgram(gl, SKIN_VERTEX_SHADER, SKIN_FRAGMENT_SHADER);
  const itemProgram = createVisualProgram(gl, COLOR_VERTEX_SHADER, COLOR_FRAGMENT_SHADER);
  const buffer = gl.createBuffer(); const itemBuffer = gl.createBuffer(); const armorBuffer = gl.createBuffer(); const texture = gl.createTexture();
  const position = gl.getAttribLocation(program, "aPosition");
  const uv = gl.getAttribLocation(program, "aUv"); const shade = gl.getAttribLocation(program, "aShade");
  const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const textureLocation = gl.getUniformLocation(program, "uSkin");
  const lightLocation = gl.getUniformLocation(program, "uLight");
  const itemPosition = gl.getAttribLocation(itemProgram, "aPosition");
  const itemColor = gl.getAttribLocation(itemProgram, "aColor");
  const itemMvpLocation = gl.getUniformLocation(itemProgram, "uMvp");
  const itemLightLocation = gl.getUniformLocation(itemProgram, "uLight");
  if (!buffer || !itemBuffer || !armorBuffer || !texture || position < 0 || uv < 0 || shade < 0 || !mvpLocation || !textureLocation || !lightLocation
    || itemPosition < 0 || itemColor < 0 || !itemMvpLocation || !itemLightLocation) {
    gl.deleteBuffer(buffer); gl.deleteBuffer(itemBuffer); gl.deleteBuffer(armorBuffer); gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteProgram(itemProgram);
    throw new Error("Player skin shader bindings are incomplete.");
  }
  let model: PlayerSkinModel = "wide";
  let geometry = buildPlayerSkinGeometry(model);
  let vertexCount = geometry.length / PLAYER_SKIN_VERTEX_STRIDE;
  let heldItem: ItemId | null = null;
  let heldItemVertexCount = 0;
  let armorAppearance: PlayerArmorAppearance = Object.freeze({});
  let armorVertexCount = 0;
  let armorDraws = playerArmorRigDraws(armorAppearance);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
  const modelMatrix = new Float32Array(16); const partMatrix = new Float32Array(16);
  const worldPartMatrix = new Float32Array(16); const mvp = new Float32Array(16);

  const renderer: PlayerSkinRenderer = {
    get vertexCount() { return vertexCount; },
    get heldItemVertexCount() { return heldItemVertexCount; },
    get armorVertexCount() { return armorVertexCount; },
    get drawCallCount() { return PLAYER_RIG_SKIN_DRAWS.length + armorDraws.length + Number(heldItemVertexCount > 0); },
    draw(viewProjection, pose, light, rig = { motion: "idle", phase: 0 }) {
      const angle = pose.yaw + Math.PI;
      const cosine = Math.cos(angle); const sine = Math.sin(angle);
      modelMatrix.set([cosine,0,-sine,0, 0,1,0,0, sine,0,cosine,0, pose.x,pose.y,pose.z,1]);
      const rigPose = resolvePlayerRigPose(rig);
      const setPartMvp = (part: (typeof PLAYER_RIG_SKIN_DRAWS)[number]["part"], remapStandardSkinSides: boolean, location: WebGLUniformLocation) => {
        writePlayerRigPartMatrix(partMatrix, part, rigPose, model, remapStandardSkinSides);
        writeMatrixProduct(worldPartMatrix, modelMatrix, partMatrix);
        writeMatrixProduct(mvp, viewProjection, worldPartMatrix);
        gl.uniformMatrix4fv(location, false, mvp);
      };
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv); gl.enableVertexAttribArray(shade);
      const stride = PLAYER_SKIN_VERTEX_STRIDE * Float32Array.BYTES_PER_ELEMENT;
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(shade, 1, gl.FLOAT, false, stride, 20);
      gl.uniform3f(lightLocation, light[0], light[1], light[2]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(textureLocation, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const draw of PLAYER_RIG_SKIN_DRAWS) {
        setPartMvp(draw.part, true, mvpLocation);
        gl.drawArrays(gl.TRIANGLES, draw.first, draw.count);
      }
      gl.disable(gl.BLEND);
      if (armorVertexCount) {
        gl.useProgram(itemProgram); gl.bindBuffer(gl.ARRAY_BUFFER, armorBuffer);
        gl.enableVertexAttribArray(itemPosition); gl.enableVertexAttribArray(itemColor);
        gl.vertexAttribPointer(itemPosition, 3, gl.FLOAT, false, PLAYER_ARMOR_VERTEX_STRIDE * 4, 0);
        gl.vertexAttribPointer(itemColor, 3, gl.FLOAT, false, PLAYER_ARMOR_VERTEX_STRIDE * 4, 12);
        gl.uniform3f(itemLightLocation, light[0], light[1], light[2]);
        for (const draw of armorDraws) {
          setPartMvp(draw.part, false, itemMvpLocation);
          gl.drawArrays(gl.TRIANGLES, draw.first, draw.count);
        }
      }
      if (heldItemVertexCount) {
        gl.useProgram(itemProgram); gl.bindBuffer(gl.ARRAY_BUFFER, itemBuffer);
        gl.enableVertexAttribArray(itemPosition); gl.enableVertexAttribArray(itemColor);
        gl.vertexAttribPointer(itemPosition, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(itemColor, 3, gl.FLOAT, false, 24, 12);
        setPartMvp("rightArm", true, itemMvpLocation);
        gl.uniform3f(itemLightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, heldItemVertexCount);
      }
    },
    setSkin(source, nextModel) {
      if (nextModel !== model) {
        model = nextModel; geometry = buildPlayerSkinGeometry(model);
        vertexCount = geometry.length / PLAYER_SKIN_VERTEX_STRIDE;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
        const armorGeometry = buildPlayerArmorGeometry(armorAppearance, model);
        armorVertexCount = armorGeometry.length / PLAYER_ARMOR_VERTEX_STRIDE;
        gl.bindBuffer(gl.ARRAY_BUFFER, armorBuffer); gl.bufferData(gl.ARRAY_BUFFER, armorGeometry, gl.STATIC_DRAW);
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
    },
    setHeldItem(itemId) {
      if (itemId === heldItem) return;
      heldItem = itemId;
      const output: number[] = [];
      if (itemId) {
        const presentation = thirdPersonHeldItemPresentation(itemId);
        if (blockIdForCubeItem(itemId) !== null) appendBlockItemCubeGeometry(output, itemId, presentation);
        else appendItemSpriteGeometry(output, getItemIconArt(itemId), presentation);
      }
      const data = new Float32Array(output);
      heldItemVertexCount = data.length / ITEM_SPRITE_VERTEX_FLOATS;
      gl.bindBuffer(gl.ARRAY_BUFFER, itemBuffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    },
    setArmor(appearance) {
      armorAppearance = Object.freeze({ ...appearance });
      armorDraws = playerArmorRigDraws(armorAppearance);
      const data = buildPlayerArmorGeometry(armorAppearance, model);
      armorVertexCount = data.length / PLAYER_ARMOR_VERTEX_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, armorBuffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    },
    destroy() { gl.deleteBuffer(buffer); gl.deleteBuffer(itemBuffer); gl.deleteBuffer(armorBuffer); gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteProgram(itemProgram); },
  };
  return Object.freeze(renderer);
}
