import type { ItemId } from "../../shared/game.ts";
import { getBowIconArt, getItemIconArt } from "../components/itemIconArt.ts";
import { blockIdForCubeItem } from "./blockItemCubeGeometry.ts";
import { appendItemSpriteGeometry } from "./itemSpriteGeometry.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { createLakecraftDefaultSkinPixels, type PlayerSkinModel } from "./playerSkin.ts";
import { buildPlayerSkinGeometry, PLAYER_SKIN_VERTEX_STRIDE } from "./playerSkinGeometry.ts";
import { BLOCK, type BlockId as EngineBlockId } from "./types.ts";
import { blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import {
  TEXTURE_ATLAS_COLUMNS, TEXTURE_ATLAS_RGBA, TEXTURE_ATLAS_ROWS, TEXTURE_TILE_SIZE,
} from "./generated/textureAtlas.ts";
import { createMobRenderer } from "./mobRenderer.ts";
import { MOB_DEFINITIONS, type MobKind, type MobPoseSnapshot } from "./mobs.ts";
import { createPlayerSkinRenderer } from "./playerSkinRenderer.ts";
import type { PlayerRigInput, PlayerRigMotion } from "./playerRig.ts";
import {
  fullPlayerArmorAppearance,
  type PlayerArmorMaterial,
} from "./playerArmorGeometry.ts";
import { createFirstPersonRenderer } from "./firstPersonRenderer.ts";
import { createDroppedItemRenderer } from "./droppedItemRenderer.ts";
import {
  createFirstPersonSkinRenderer,
  FIRST_PERSON_SKIN_ARM_VERTICES,
} from "./firstPersonSkinRenderer.ts";
import {
  appendOakFenceGateMesh,
  appendOakFenceMesh,
  appendSaplingMesh,
  appendStoneBrickSlabMesh,
} from "./voxelEngine.ts";
import {
  appendSpecialBedMesh,
  appendSpecialChestMesh,
  appendSpecialDoorMesh,
  appendSpecialLadderMesh,
  appendSpecialTorchMesh,
} from "./specialBlockGeometry.ts";
import {
  COLOR_FRAGMENT_SHADER,
  COLOR_VERTEX_SHADER,
  createVisualProgram,
  SKIN_FRAGMENT_SHADER,
  SKIN_VERTEX_SHADER,
} from "./visualShaders.ts";

export type VisualLabRenderer = Readonly<{
  setItem(itemId: ItemId, variantIndex?: number): void;
  setPlayerSkin(source: TexImageSource | null, model: PlayerSkinModel): void;
  setPlayerHeldItem(itemId: ItemId | null): void;
  setPlayerPose(motion: PlayerRigMotion, phase: number): void;
  setPlayerArmor(material: PlayerArmorMaterial | null): void;
  setViewmodel(itemId: ItemId, variantIndex?: number): void;
  setDroppedItem(itemId: ItemId): void;
  setLighting(preset: VisualLabLighting): void;
  setMob(kind: MobKind, state?: VisualLabMobState): void;
  setOrbit(yawDegrees: number, pitchDegrees: number, zoom: number): void;
  resize(): void;
  stats(): Readonly<{ vertices: number; drawCalls: number }>;
  destroy(): void;
}>;

export type VisualLabMobState = "idle" | "walk" | "hurt" | "fallen" | "special";
export type VisualLabLighting = "day" | "night" | "torch" | "unlit";

const SPECIAL_VISUAL_BLOCKS: Readonly<Partial<Record<ItemId, EngineBlockId>>> = Object.freeze({
  torch: BLOCK.TORCH,
  chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER,
  sapling: BLOCK.SAPLING,
  oak_fence: BLOCK.OAK_FENCE, oak_fence_gate: BLOCK.OAK_FENCE_GATE_CLOSED,
  stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
});

function blockGeometry(block: EngineBlockId): Float32Array {
  const output: number[] = [];
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const uv = textureAtlasUv(texture);
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      output.push(
        point[0] - 0.5, point[1] - 0.5, point[2] - 0.5,
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        face[4],
      );
    }
  }
  return new Float32Array(output);
}

function specialBlockGeometry(
  itemId: ItemId,
  variantIndex: number,
): Readonly<{ textured: Float32Array; color: Float32Array }> | null {
  const textured: number[] = [];
  const color: number[] = [];
  const output = { textured, color };
  if (itemId === "torch") appendSpecialTorchMesh(output, -0.5, -0.5, -0.5);
  else if (itemId === "chest") appendSpecialChestMesh(output, -0.5, -0.5, -0.5);
  else if (itemId === "door") appendSpecialDoorMesh(output, -0.5, -0.5, -0.5, variantIndex > 0);
  else if (itemId === "bed") appendSpecialBedMesh(output, -0.5, -0.5, 0.5, "foot", variantIndex > 0 ? "east" : "north");
  else if (itemId === "ladder") appendSpecialLadderMesh(output, -0.5, -0.5, -0.5);
  else if (itemId === "sapling") appendSaplingMesh(textured, -0.5, -0.5, -0.5);
  else if (itemId === "oak_fence") {
    appendOakFenceMesh(textured, -0.5, -0.75, -0.5, { north: true, east: true, south: true, west: true });
  } else if (itemId === "oak_fence_gate") {
    appendOakFenceGateMesh(textured, -0.5, -0.75, -0.5, variantIndex > 0);
  } else if (itemId === "stone_brick_slab") {
    appendStoneBrickSlabMesh(textured, -0.5, -0.25, -0.5);
  } else return null;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity;
  let maxY = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const data of [textured, color]) {
    for (let offset = 0; offset < data.length; offset += 6) {
      minX = Math.min(minX, data[offset]); maxX = Math.max(maxX, data[offset]);
      minY = Math.min(minY, data[offset + 1]); maxY = Math.max(maxY, data[offset + 1]);
      minZ = Math.min(minZ, data[offset + 2]); maxZ = Math.max(maxZ, data[offset + 2]);
    }
  }
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  for (const data of [textured, color]) {
    for (let offset = 0; offset < data.length; offset += 6) {
      data[offset] -= centerX; data[offset + 1] -= centerY; data[offset + 2] -= centerZ;
    }
  }
  return Object.freeze({ textured: new Float32Array(textured), color: new Float32Array(color) });
}

function writePerspective(output: Float32Array, aspect: number, fieldOfViewDegrees = 36): Float32Array {
  output.fill(0);
  const near = 0.1;
  const far = 20;
  const f = 1 / Math.tan(fieldOfViewDegrees * Math.PI / 360);
  output[0] = f / Math.max(0.1, aspect);
  output[5] = f;
  output[10] = (far + near) / (near - far);
  output[11] = -1;
  output[14] = 2 * far * near / (near - far);
  return output;
}

function writeModelView(
  output: Float32Array,
  yawDegrees: number,
  pitchDegrees: number,
  zoom: number,
  centerY = 0,
): Float32Array {
  const yaw = yawDegrees * Math.PI / 180;
  const pitch = pitchDegrees * Math.PI / 180;
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const cx = Math.cos(pitch); const sx = Math.sin(pitch);
  const scale = Math.max(0.35, Math.min(2.4, zoom));
  // Ry * Rx, uniformly scaled. The model stays centered at camera Z -3.
  output[0] = cy * scale; output[1] = 0; output[2] = -sy * scale; output[3] = 0;
  output[4] = sy * sx * scale; output[5] = cx * scale; output[6] = cy * sx * scale; output[7] = 0;
  output[8] = sy * cx * scale; output[9] = -sx * scale; output[10] = cy * cx * scale; output[11] = 0;
  output[12] = 0; output[13] = centerY; output[14] = -3; output[15] = 1;
  return output;
}

export function createVisualLabRenderer(canvas: HTMLCanvasElement): VisualLabRenderer {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: true,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error("Visual Lab requires WebGL.");
  const program = createVisualProgram(gl, COLOR_VERTEX_SHADER, COLOR_FRAGMENT_SHADER);
  const skinProgram = createVisualProgram(gl, SKIN_VERTEX_SHADER, SKIN_FRAGMENT_SHADER);
  const mobRenderer = createMobRenderer(gl);
  const droppedItemRenderer = createDroppedItemRenderer(gl);
  const playerRenderer = createPlayerSkinRenderer(gl);
  const [
    viewmodelColorBuffer,
    viewmodelTexturedBuffer,
    viewmodelStats,
    setViewmodelHeldItem,
    setViewmodelBowCharge,
    ,
    writeViewmodelMvp,
    destroyViewmodelRenderer,
  ] = createFirstPersonRenderer(gl);
  const viewmodelSkinRenderer = createFirstPersonSkinRenderer(gl);
  const buffer = gl.createBuffer();
  const skinBuffer = gl.createBuffer();
  const skinTexture = gl.createTexture();
  const atlasTexture = gl.createTexture();
  const position = gl.getAttribLocation(program, "aPosition");
  const color = gl.getAttribLocation(program, "aColor");
  const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const lightLocation = gl.getUniformLocation(program, "uLight");
  const skinPosition = gl.getAttribLocation(skinProgram, "aPosition");
  const skinUv = gl.getAttribLocation(skinProgram, "aUv");
  const skinShade = gl.getAttribLocation(skinProgram, "aShade");
  const skinMvpLocation = gl.getUniformLocation(skinProgram, "uMvp");
  const skinSamplerLocation = gl.getUniformLocation(skinProgram, "uSkin");
  const skinLightLocation = gl.getUniformLocation(skinProgram, "uLight");
  if (!buffer || !skinBuffer || !skinTexture || !atlasTexture || position < 0 || color < 0 || !mvpLocation
    || !lightLocation || skinPosition < 0 || skinUv < 0 || skinShade < 0 || !skinMvpLocation
    || !skinSamplerLocation || !skinLightLocation) {
    gl.deleteBuffer(buffer);
    gl.deleteBuffer(skinBuffer);
    gl.deleteTexture(skinTexture);
    gl.deleteTexture(atlasTexture);
    gl.deleteProgram(program);
    gl.deleteProgram(skinProgram);
    throw new Error("Visual Lab shader bindings are incomplete.");
  }

  gl.bindTexture(gl.TEXTURE_2D, skinTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
  gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEXTURE_TILE_SIZE * TEXTURE_ATLAS_COLUMNS,
    TEXTURE_TILE_SIZE * TEXTURE_ATLAS_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, TEXTURE_ATLAS_RGBA);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

  const projection = new Float32Array(16);
  const modelView = new Float32Array(16);
  const mvp = new Float32Array(16);
  const viewmodelMvp = new Float32Array(16);
  let vertexCount = 0;
  let specialColorVertexCount = 0;
  let mode: "item" | "player" | "block" | "mob" | "viewmodel" | "dropped" = "item";
  let viewmodelBow = false;
  const light: [number, number, number] = [1, 1, 1];
  let yaw = -22;
  let pitch = 12;
  let zoom = 1.65;
  let playerRig: PlayerRigInput = Object.freeze({ motion: "idle", phase: 0.25 });

  function resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    draw();
  }

  function draw(): void {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.055, 0.06, 0.055, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!vertexCount) return;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    writePerspective(projection, canvas.width / Math.max(1, canvas.height), mode === "viewmodel" ? 70 : 36);
    if (mode === "viewmodel") {
      writeViewmodelMvp(viewmodelMvp, projection, 0, false);
      if (viewmodelStats[1] > 0) {
        gl.useProgram(skinProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, viewmodelTexturedBuffer);
        gl.enableVertexAttribArray(skinPosition);
        gl.enableVertexAttribArray(skinUv);
        gl.enableVertexAttribArray(skinShade);
        gl.vertexAttribPointer(skinPosition, 3, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 0);
        gl.vertexAttribPointer(skinUv, 2, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 12);
        gl.vertexAttribPointer(skinShade, 1, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 20);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.uniform1i(skinSamplerLocation, 0); gl.uniformMatrix4fv(skinMvpLocation, false, viewmodelMvp);
        gl.uniform3f(skinLightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, viewmodelStats[1]);
      }
      if (viewmodelStats[0] > 0) {
        gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, viewmodelColorBuffer);
        gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(mvpLocation, false, viewmodelMvp);
        gl.uniform3f(lightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, viewmodelStats[0]);
      }
      if (!viewmodelBow) viewmodelSkinRenderer.draw(viewmodelMvp, light);
      return;
    }
    writeModelView(modelView, yaw, pitch, zoom, mode === "player" ? -1 : mode === "mob" ? -0.72 : 0);
    writeMatrixProduct(mvp, projection, modelView);
    if (mode === "player") {
      playerRenderer.draw(mvp, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, light, playerRig);
      return;
    }
    if (mode === "block") {
      const texturedVertexCount = vertexCount - specialColorVertexCount;
      gl.useProgram(skinProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, skinBuffer);
      gl.enableVertexAttribArray(skinPosition);
      gl.enableVertexAttribArray(skinUv);
      gl.enableVertexAttribArray(skinShade);
      gl.vertexAttribPointer(skinPosition, 3, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 0);
      gl.vertexAttribPointer(skinUv, 2, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 12);
      gl.vertexAttribPointer(skinShade, 1, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 20);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mode === "block" ? atlasTexture : skinTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.uniform1i(skinSamplerLocation, 0);
      gl.uniformMatrix4fv(skinMvpLocation, false, mvp);
      gl.uniform3f(skinLightLocation, light[0], light[1], light[2]);
      if (texturedVertexCount > 0) gl.drawArrays(gl.TRIANGLES, 0, texturedVertexCount);
      if (specialColorVertexCount > 0) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(position);
        gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(mvpLocation, false, mvp);
        gl.uniform3f(lightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, specialColorVertexCount);
      }
      return;
    } else {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, mode === "mob" ? mobRenderer.buffer : mode === "dropped" ? droppedItemRenderer.buffer : buffer);
      gl.enableVertexAttribArray(position);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix4fv(mvpLocation, false, mvp);
      gl.uniform3f(lightLocation, light[0], light[1], light[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  function setItem(itemId: ItemId, variantIndex = 0): void {
    const special = specialBlockGeometry(itemId, variantIndex);
    if (special) {
      mode = "block";
      specialColorVertexCount = special.color.length / PLAYER_SKIN_VERTEX_STRIDE;
      vertexCount = special.textured.length / PLAYER_SKIN_VERTEX_STRIDE + specialColorVertexCount;
      gl.bindBuffer(gl.ARRAY_BUFFER, skinBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, special.textured, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, special.color, gl.STATIC_DRAW);
      draw();
      return;
    }
    const block = blockIdForCubeItem(itemId);
    if (block !== null) {
      const data = blockGeometry(block);
      if (data.length) {
        mode = "block";
        specialColorVertexCount = 0;
        vertexCount = data.length / PLAYER_SKIN_VERTEX_STRIDE;
        gl.bindBuffer(gl.ARRAY_BUFFER, skinBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        draw();
        return;
      }
    }
    mode = "item";
    specialColorVertexCount = 0;
    const geometry: number[] = [];
    const art = itemId === "bow"
      ? getBowIconArt(Math.max(0, Math.min(3, Math.floor(variantIndex))) as 0 | 1 | 2 | 3)
      : getItemIconArt(itemId);
    appendItemSpriteGeometry(geometry, art, { depth: 0.085 });
    const data = new Float32Array(geometry);
    vertexCount = data.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    draw();
  }

  resize();
  return Object.freeze({
    setItem,
    setPlayerSkin(source, model) {
      mode = "player";
      specialColorVertexCount = 0;
      const data = buildPlayerSkinGeometry(model);
      vertexCount = data.length / PLAYER_SKIN_VERTEX_STRIDE + playerRenderer.heldItemVertexCount + playerRenderer.armorVertexCount;
      gl.bindBuffer(gl.ARRAY_BUFFER, skinBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, skinTexture);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, createLakecraftDefaultSkinPixels());
      playerRenderer.setSkin(source, model);
      viewmodelSkinRenderer.setSkin(source, model);
      draw();
    },
    setPlayerHeldItem(itemId) {
      playerRenderer.setHeldItem(itemId);
      vertexCount = playerRenderer.vertexCount + playerRenderer.heldItemVertexCount + playerRenderer.armorVertexCount;
      if (mode === "player") draw();
    },
    setPlayerPose(motion, phase) {
      playerRig = Object.freeze({ motion, phase: Number.isFinite(phase) ? phase : 0 });
      if (mode === "player") draw();
    },
    setPlayerArmor(material) {
      playerRenderer.setArmor(material ? fullPlayerArmorAppearance(material) : {});
      vertexCount = playerRenderer.vertexCount + playerRenderer.heldItemVertexCount + playerRenderer.armorVertexCount;
      if (mode === "player") draw();
    },
    setViewmodel(itemId, variantIndex = 0) {
      mode = "viewmodel";
      specialColorVertexCount = 0;
      const block = blockIdForCubeItem(itemId) ?? SPECIAL_VISUAL_BLOCKS[itemId] ?? BLOCK.AIR;
      viewmodelBow = itemId === "bow";
      setViewmodelHeldItem(itemId, block);
      setViewmodelBowCharge(viewmodelBow && variantIndex > 0,
        variantIndex <= 1 ? 0 : variantIndex === 2 ? 0.6 : 1);
      vertexCount = viewmodelStats[0] + viewmodelStats[1]
        + (viewmodelBow ? 0 : FIRST_PERSON_SKIN_ARM_VERTICES);
      draw();
    },
    setDroppedItem(itemId) {
      mode = "dropped";
      specialColorVertexCount = 0;
      droppedItemRenderer.setItems([{
        dropId: `visual-lab-${itemId}`,
        item: { itemId, count: 1 },
        x: 0,
        y: 0,
        z: 0,
        droppedAt: 0,
      }]);
      vertexCount = droppedItemRenderer.update(1_250, [0, 0, 3]).vertexCount;
      draw();
    },
    setLighting(preset) {
      if (preset === "night") { light[0] = 0.32; light[1] = 0.38; light[2] = 0.55; }
      else if (preset === "torch") { light[0] = 1.12; light[1] = 0.82; light[2] = 0.48; }
      else if (preset === "day") { light[0] = 0.92; light[1] = 0.97; light[2] = 1; }
      else { light[0] = 1; light[1] = 1; light[2] = 1; }
      draw();
    },
    setMob(kind, state = "idle") {
      mode = "mob";
      specialColorVertexCount = 0;
      const definition = MOB_DEFINITIONS[kind];
      const walking = state === "walk";
      const pose: MobPoseSnapshot = {
        id: `visual-lab-${kind}`,
        kind,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        previousX: walking ? -0.24 : 0,
        previousY: 0,
        previousZ: 0,
        previousYaw: 0,
        behavior: walking ? "wander" : "idle",
        health: state === "hurt" ? Math.max(1, definition.maxHealth - 2) : definition.maxHealth,
        maxHealth: definition.maxHealth,
        hostileActive: !definition.passive,
        sheared: state === "special" && kind === "sheep",
        fuseProgress: state === "special" && kind === "creeper" ? 0.82 : 0,
        sunBurning: state === "hurt",
        deathFall: state === "fallen" ? 1 : 0,
      };
      const stats = mobRenderer.rebuild([pose], 0, 3, 0, -1, 1, walking ? 0.2 : 0);
      vertexCount = stats.vertexCount;
      draw();
    },
    setOrbit(nextYaw, nextPitch, nextZoom) {
      yaw = Number.isFinite(nextYaw) ? nextYaw : yaw;
      pitch = Math.max(-85, Math.min(85, Number.isFinite(nextPitch) ? nextPitch : pitch));
      zoom = Math.max(0.35, Math.min(2.4, Number.isFinite(nextZoom) ? nextZoom : zoom));
      draw();
    },
    resize,
    stats: () => Object.freeze({
      vertices: vertexCount,
      drawCalls: mode === "viewmodel"
        ? viewmodelStats[2] + Number(!viewmodelBow)
        : mode === "player"
          ? playerRenderer.drawCallCount
          : mode === "block"
            ? Number(vertexCount - specialColorVertexCount > 0) + Number(specialColorVertexCount > 0)
            : Number(vertexCount > 0),
    }),
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(skinBuffer);
      gl.deleteTexture(skinTexture);
      gl.deleteTexture(atlasTexture);
      gl.deleteProgram(program);
      gl.deleteProgram(skinProgram);
      mobRenderer.destroy();
      droppedItemRenderer.destroy();
      playerRenderer.destroy();
      destroyViewmodelRenderer();
      viewmodelSkinRenderer.destroy();
    },
  });
}
