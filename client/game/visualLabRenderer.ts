import type { ItemId } from "../../shared/game.ts";
import { getBowIconArt, getItemIconArt, type ItemIconArt } from "../components/itemIconArt.ts";
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
import { MOB_VERTEX_STRIDE, createMobRenderer, createMobTexture, destroyMobTexture } from "./mobRenderer.ts";
import { MOB_DEFINITIONS, type MobKind, type MobPoseSnapshot } from "./mobs.ts";
import { createPlayerSkinRenderer } from "./playerSkinRenderer.ts";
import type { PlayerRigInput, PlayerRigMotion } from "./playerRig.ts";
import {
  fullPlayerArmorAppearance,
  type PlayerArmorMaterial,
} from "./playerArmorGeometry.ts";
import {
  createFirstPersonRenderer,
  firstPersonSpritePresentation,
  usesCanonicalHeldBlock,
  type FirstPersonSpritePresentation,
} from "./firstPersonRenderer.ts";
import { createDroppedItemRenderer } from "./droppedItemRenderer.ts";
import {
  createFirstPersonSkinRenderer,
  FIRST_PERSON_SKIN_ARM_VERTICES,
} from "./firstPersonSkinRenderer.ts";
import {
  appendOakFenceGateMesh,
  appendOakFenceMesh,
  appendSlabMesh,
  appendStairMesh,
  appendSaplingMesh,
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
  MOB_FRAGMENT_SHADER,
  MOB_VERTEX_SHADER,
  SKIN_FRAGMENT_SHADER,
  SKIN_VERTEX_SHADER,
} from "./visualShaders.ts";

export type VisualLabRenderer = Readonly<{
  setItem(itemId: ItemId, variantIndex?: number): void;
  setPlayerSkin(source: TexImageSource | null, model: PlayerSkinModel): void;
  setPlayerHeldItem(itemId: ItemId | null): void;
  setPlayerPose(motion: PlayerRigMotion, phase: number): void;
  setPlayerArmor(material: PlayerArmorMaterial | null): void;
  setViewmodel(itemId: ItemId, variantIndex?: number, strategy?: VisualLabViewmodelStrategy): void;
  setDroppedItem(itemId: ItemId): void;
  setLighting(preset: VisualLabLighting): void;
  setMob(kind: MobKind, state?: VisualLabMobState): void;
  setOrbit(yawDegrees: number, pitchDegrees: number, zoom: number): void;
  resize(): void;
  stats(): Readonly<{
    vertices: number;
    drawCalls: number;
    states: VisualLabSilhouette | null;
  }>;
  destroy(): void;
}>;

export type VisualLabMobState = "idle" | "walk" | "hurt" | "fallen" | "special";
export type VisualLabLighting = "day" | "night" | "torch" | "unlit";
export type VisualLabViewmodelStrategy = "production" | "transform" | "grip";
export type VisualLabSilhouette = readonly [number, number, number, number, number];

const SPECIAL_VISUAL_BLOCKS: Readonly<Partial<Record<ItemId, EngineBlockId>>> = {
  torch: BLOCK.TORCH,
  chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER,
  sapling: BLOCK.SAPLING,
  oak_fence: BLOCK.OAK_FENCE, oak_fence_gate: BLOCK.OAK_FENCE_GATE_CLOSED,
  stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
  oak_slab: BLOCK.OAK_SLAB, cobblestone_slab: BLOCK.COBBLESTONE_SLAB, brick_slab: BLOCK.BRICK_SLAB,
  oak_stairs: BLOCK.OAK_STAIRS_NORTH, cobblestone_stairs: BLOCK.COBBLESTONE_STAIRS_NORTH,
  stone_brick_stairs: BLOCK.STONE_BRICK_STAIRS_NORTH, brick_stairs: BLOCK.BRICK_STAIRS_NORTH,
};

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

function mirroredItemArt(art: ItemIconArt): ItemIconArt {
  return Object.freeze({
    family: art.family,
    variant: art.variant,
    runs: Object.freeze(art.runs.map((run) => Object.freeze({
      x: 16 - run.x - run.width,
      y: run.y,
      width: run.width,
      color: run.color,
    }))),
  });
}

function experimentalSpritePresentation(
  itemId: ItemId,
  bowDrawn: boolean,
  strategy: Exclude<VisualLabViewmodelStrategy, "production">,
): FirstPersonSpritePresentation {
  const source = firstPersonSpritePresentation(itemId, bowDrawn);
  if (strategy === "transform") {
    // Compose the published handheld item transform with the classic
    // first-person camera turn instead of guessing a final Euler triple.
    return Object.freeze({
      center: [-0.2, -0.28, -1.12],
      size: source.size * 0.94,
      depth: 0.025,
      rotationDegrees: [0, -45, 25],
      pivotPixels: source.pivotPixels,
    });
  }
  return Object.freeze({
    center: [0.5, -0.28, -1.14],
    size: source.size * 0.78,
    depth: 0.006,
    rotationDegrees: [4, 0, -18],
    pivotPixels: [15 - source.pivotPixels[0], source.pivotPixels[1]],
  });
}

function transformedBlockGeometry(
  block: EngineBlockId,
  strategy: Exclude<VisualLabViewmodelStrategy, "production">,
): Float32Array {
  const output = blockGeometry(block);
  const center = strategy === "grip" ? [0.38, -0.28, -1.3] : [0.48, -0.42, -1.3];
  const rotation = strategy === "transform" ? [30, 45, 0] : [28, -38, 2];
  const size = strategy === "grip" ? 0.58 : 0.66;
  const rx = rotation[0] * Math.PI / 180;
  const ry = rotation[1] * Math.PI / 180;
  const rz = rotation[2] * Math.PI / 180;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  for (let offset = 0; offset < output.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    let x = output[offset] * size;
    let y = output[offset + 1] * size;
    let z = output[offset + 2] * size;
    let next = y * cx - z * sx; z = y * sx + z * cx; y = next;
    next = x * cy + z * sy; z = -x * sy + z * cy; x = next;
    next = x * cz - y * sz; y = x * sz + y * cz; x = next;
    output[offset] = x + center[0];
    output[offset + 1] = y + center[1];
    output[offset + 2] = z + center[2];
  }
  return output;
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
  } else if (itemId.endsWith("_slab")) {
    appendSlabMesh(textured, -0.5, -0.25, -0.5, block);
  } else if (itemId.endsWith("_stairs")) {
    appendStairMesh(textured, -0.5, -0.5, -0.5, block);
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
  const mobProgram = createVisualProgram(gl, MOB_VERTEX_SHADER, MOB_FRAGMENT_SHADER);
  const mobRenderer = createMobRenderer(gl);
  const mobTexture = createMobTexture(gl);
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
  const comparisonColorBuffer = gl.createBuffer();
  const comparisonTexturedBuffer = gl.createBuffer();
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
  const mobPosition = gl.getAttribLocation(mobProgram, "aPosition");
  const mobUv = gl.getAttribLocation(mobProgram, "aUv");
  const mobTint = gl.getAttribLocation(mobProgram, "aTint");
  const mobMvpLocation = gl.getUniformLocation(mobProgram, "uMvp");
  const mobLightLocation = gl.getUniformLocation(mobProgram, "uLight");
  const mobAtlasLocation = gl.getUniformLocation(mobProgram, "uAtlas");
  if (!buffer || !skinBuffer || !comparisonColorBuffer || !comparisonTexturedBuffer
    || !skinTexture || !atlasTexture || position < 0 || color < 0 || !mvpLocation
    || !lightLocation || skinPosition < 0 || skinUv < 0 || skinShade < 0 || !skinMvpLocation
    || !skinSamplerLocation || !skinLightLocation || mobPosition < 0 || mobUv < 0 || mobTint < 0
    || !mobMvpLocation || !mobLightLocation || !mobAtlasLocation) {
    gl.deleteBuffer(buffer);
    gl.deleteBuffer(skinBuffer);
    gl.deleteBuffer(comparisonColorBuffer);
    gl.deleteBuffer(comparisonTexturedBuffer);
    gl.deleteTexture(skinTexture);
    gl.deleteTexture(atlasTexture);
    destroyMobTexture(gl, mobTexture);
    gl.deleteProgram(program);
    gl.deleteProgram(skinProgram);
    gl.deleteProgram(mobProgram);
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
  let viewmodelBlockArm = false;
  let viewmodelItem: ItemId = "diamond_pickaxe";
  let viewmodelVariant = 0;
  let viewmodelStrategy: VisualLabViewmodelStrategy = "production";
  let comparisonColorVertices = 0;
  let comparisonTexturedVertices = 0;
  const light: [number, number, number] = [1, 1, 1];
  let yaw = -22;
  let pitch = 12;
  let zoom = 1.65;
  let playerRig: PlayerRigInput = Object.freeze({ motion: "idle", phase: 0.25 });
  let silhouettePixels = new Uint8Array(0);

  function measureSilhouette(): VisualLabSilhouette | null {
    const width = canvas.width;
    const height = canvas.height;
    const pixelCount = width * height;
    if (pixelCount <= 0) return null;
    const required = pixelCount * 4;
    if (silhouettePixels.length !== required) silhouettePixels = new Uint8Array(required);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, silhouettePixels);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let opaque = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (silhouettePixels[(y * width + x) * 4 + 3] === 0) continue;
        opaque += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const rounded = (value: number) => Math.round(value * 10) / 10;
    return Object.freeze([
      rounded(minX / width * 100),
      rounded((height - 1 - maxY) / height * 100),
      rounded((maxX - minX + 1) / width * 100),
      rounded((maxY - minY + 1) / height * 100),
      rounded(opaque / pixelCount * 100),
    ] as const);
  }

  function rebuildComparisonViewmodel(): void {
    comparisonColorVertices = 0;
    comparisonTexturedVertices = 0;
    if (viewmodelStrategy === "production") return;
    const block = blockIdForCubeItem(viewmodelItem) ?? SPECIAL_VISUAL_BLOCKS[viewmodelItem] ?? BLOCK.AIR;
    if (usesCanonicalHeldBlock(viewmodelItem, block)) {
      const data = transformedBlockGeometry(block, viewmodelStrategy);
      comparisonTexturedVertices = data.length / PLAYER_SKIN_VERTEX_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, comparisonTexturedBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return;
    }
    const bowDrawn = viewmodelItem === "bow" && viewmodelVariant > 0;
    const sourceArt = viewmodelItem === "bow"
      ? getBowIconArt(Math.max(0, Math.min(3, Math.floor(viewmodelVariant))) as 0 | 1 | 2 | 3)
      : getItemIconArt(viewmodelItem);
    const art = viewmodelStrategy === "transform" ? sourceArt : mirroredItemArt(sourceArt);
    const geometry: number[] = [];
    appendItemSpriteGeometry(
      geometry,
      art,
      experimentalSpritePresentation(viewmodelItem, bowDrawn, viewmodelStrategy),
    );
    const data = new Float32Array(geometry);
    comparisonColorVertices = data.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, comparisonColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

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
      const production = viewmodelStrategy === "production";
      const texturedVertices = production ? viewmodelStats[1] : comparisonTexturedVertices;
      const colorVertices = production ? viewmodelStats[0] : comparisonColorVertices;
      if (texturedVertices > 0) {
        gl.useProgram(skinProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, production ? viewmodelTexturedBuffer : comparisonTexturedBuffer);
        gl.enableVertexAttribArray(skinPosition);
        gl.enableVertexAttribArray(skinUv);
        gl.enableVertexAttribArray(skinShade);
        gl.vertexAttribPointer(skinPosition, 3, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 0);
        gl.vertexAttribPointer(skinUv, 2, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 12);
        gl.vertexAttribPointer(skinShade, 1, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 20);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.uniform1i(skinSamplerLocation, 0); gl.uniformMatrix4fv(skinMvpLocation, false, viewmodelMvp);
        gl.uniform3f(skinLightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, texturedVertices);
      }
      if (colorVertices > 0) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, production ? viewmodelColorBuffer : comparisonColorBuffer);
        gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(mvpLocation, false, viewmodelMvp);
        gl.uniform3f(lightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, colorVertices);
      }
      if (!viewmodelBow && (production || viewmodelStrategy === "grip")) {
        viewmodelSkinRenderer.draw(viewmodelMvp, light, viewmodelBlockArm);
      }
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
    } else if (mode === "mob") {
      gl.useProgram(mobProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, mobRenderer.buffer);
      gl.enableVertexAttribArray(mobPosition);
      gl.enableVertexAttribArray(mobUv);
      gl.enableVertexAttribArray(mobTint);
      gl.vertexAttribPointer(mobPosition, 3, gl.FLOAT, false, MOB_VERTEX_STRIDE * 4, 0);
      gl.vertexAttribPointer(mobUv, 2, gl.FLOAT, false, MOB_VERTEX_STRIDE * 4, 12);
      gl.vertexAttribPointer(mobTint, 3, gl.FLOAT, false, MOB_VERTEX_STRIDE * 4, 20);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mobTexture);
      gl.uniform1i(mobAtlasLocation, 0);
      gl.uniformMatrix4fv(mobMvpLocation, false, mvp);
      gl.uniform3f(mobLightLocation, light[0], light[1], light[2]);
    } else if (mode === "dropped") {
      if (droppedItemRenderer.stats.textureVertexCount > 0) {
        gl.useProgram(skinProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, droppedItemRenderer.textureBuffer);
        gl.enableVertexAttribArray(skinPosition);
        gl.enableVertexAttribArray(skinUv);
        gl.enableVertexAttribArray(skinShade);
        gl.vertexAttribPointer(skinPosition, 3, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 0);
        gl.vertexAttribPointer(skinUv, 2, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 12);
        gl.vertexAttribPointer(skinShade, 1, gl.FLOAT, false, PLAYER_SKIN_VERTEX_STRIDE * 4, 20);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.uniform1i(skinSamplerLocation, 0);
        gl.uniformMatrix4fv(skinMvpLocation, false, mvp);
        gl.uniform3f(skinLightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, droppedItemRenderer.stats.textureVertexCount);
      }
      if (droppedItemRenderer.stats.colorVertexCount > 0) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, droppedItemRenderer.buffer);
        gl.enableVertexAttribArray(position);
        gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(mvpLocation, false, mvp);
        gl.uniform3f(lightLocation, light[0], light[1], light[2]);
        gl.drawArrays(gl.TRIANGLES, 0, droppedItemRenderer.stats.colorVertexCount);
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
    setViewmodel(itemId, variantIndex = 0, strategy = "production") {
      mode = "viewmodel";
      specialColorVertexCount = 0;
      viewmodelItem = itemId;
      viewmodelVariant = variantIndex;
      viewmodelStrategy = strategy;
      const block = blockIdForCubeItem(itemId) ?? SPECIAL_VISUAL_BLOCKS[itemId] ?? BLOCK.AIR;
      viewmodelBow = itemId === "bow";
      viewmodelBlockArm = usesCanonicalHeldBlock(itemId, block);
      setViewmodelHeldItem(itemId, block);
      setViewmodelBowCharge(viewmodelBow && variantIndex > 0,
        variantIndex <= 1 ? 0 : variantIndex === 2 ? 0.6 : 1);
      rebuildComparisonViewmodel();
      const production = viewmodelStrategy === "production";
      vertexCount = (production ? viewmodelStats[0] + viewmodelStats[1]
        : comparisonColorVertices + comparisonTexturedVertices)
        + (!viewmodelBow && (production || viewmodelStrategy === "grip") ? FIRST_PERSON_SKIN_ARM_VERTICES : 0);
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
        ? Number((viewmodelStrategy === "production" ? viewmodelStats[0] : comparisonColorVertices) > 0)
          + Number((viewmodelStrategy === "production" ? viewmodelStats[1] : comparisonTexturedVertices) > 0)
          + Number(!viewmodelBow && (viewmodelStrategy === "production" || viewmodelStrategy === "grip"))
        : mode === "player"
          ? playerRenderer.drawCallCount
          : mode === "block"
            ? Number(vertexCount - specialColorVertexCount > 0) + Number(specialColorVertexCount > 0)
            : Number(vertexCount > 0),
      states: measureSilhouette(),
    }),
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(skinBuffer);
      gl.deleteBuffer(comparisonColorBuffer);
      gl.deleteBuffer(comparisonTexturedBuffer);
      gl.deleteTexture(skinTexture);
      gl.deleteTexture(atlasTexture);
      destroyMobTexture(gl, mobTexture);
      gl.deleteProgram(program);
      gl.deleteProgram(skinProgram);
      gl.deleteProgram(mobProgram);
      mobRenderer.destroy();
      droppedItemRenderer.destroy();
      playerRenderer.destroy();
      destroyViewmodelRenderer();
      viewmodelSkinRenderer.destroy();
    },
  });
}
