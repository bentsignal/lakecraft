import { blockKey, createTerrain, raycastVoxels, terrainHeight } from "./terrain.ts";
import {
  BLOCK,
  type BlockId,
  type BlockTarget,
  type PlayerPose,
  type RemotePlayer,
  type VoxelEngine,
  type VoxelEngineOptions,
  type WorldEdit,
} from "./types.ts";

type Vec3 = [number, number, number];

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMvp;
uniform vec3 uCamera;
uniform float uFogEnabled;
varying vec3 vColor;
varying float vFog;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vColor = aColor;
  float distanceFromCamera = length(aPosition - uCamera);
  vFog = uFogEnabled * smoothstep(18.0, 42.0, distanceFromCamera);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uFogColor;
varying vec3 vColor;
varying float vFog;
void main() {
  gl_FragColor = vec4(mix(vColor, uFogColor, vFog), 1.0);
}`;

const FACE_DEFS: ReadonlyArray<{
  neighbor: Vec3;
  shade: number;
  vertices: ReadonlyArray<Vec3>;
}> = [
  { neighbor: [1, 0, 0], shade: 0.79, vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]] },
  { neighbor: [-1, 0, 0], shade: 0.68, vertices: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]] },
  { neighbor: [0, 1, 0], shade: 1.0, vertices: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 1, 0]] },
  { neighbor: [0, -1, 0], shade: 0.52, vertices: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1]] },
  { neighbor: [0, 0, 1], shade: 0.88, vertices: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1]] },
  { neighbor: [0, 0, -1], shade: 0.73, vertices: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]] },
];

const BLOCK_COLORS: Record<BlockId, Vec3> = {
  [BLOCK.AIR]: [0, 0, 0],
  [BLOCK.GRASS]: [0.31, 0.66, 0.23],
  [BLOCK.DIRT]: [0.48, 0.31, 0.17],
  [BLOCK.STONE]: [0.48, 0.51, 0.53],
  [BLOCK.WOOD]: [0.49, 0.31, 0.14],
  [BLOCK.LEAVES]: [0.18, 0.48, 0.19],
  [BLOCK.PLANKS]: [0.69, 0.48, 0.25],
  [BLOCK.CRAFTING_TABLE]: [0.55, 0.35, 0.16],
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compilation failed.");
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create the WebGL program.");
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed.");
  }
  return program;
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function lookAt(eye: Vec3, center: Vec3): Float32Array {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length; zy /= length; zz /= length;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  length = Math.hypot(xx, xy, xz) || 1;
  xx /= length; xy /= length; xz /= length;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function pushVertex(output: number[], position: Vec3, color: Vec3): void {
  output.push(position[0], position[1], position[2], color[0], color[1], color[2]);
}

function tint(color: Vec3, shade: number, variation = 1): Vec3 {
  return [color[0] * shade * variation, color[1] * shade * variation, color[2] * shade * variation];
}

function appendBox(output: number[], min: Vec3, max: Vec3, color: Vec3): void {
  for (const face of FACE_DEFS) {
    const shaded = tint(color, face.shade);
    for (const point of face.vertices) {
      pushVertex(output, [
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
      ], shaded);
    }
  }
}

function colorForPlayer(id: string): Vec3 {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return [0.35 + ((hash >>> 0) & 63) / 180, 0.4 + ((hash >>> 8) & 63) / 190, 0.52 + ((hash >>> 16) & 63) / 170];
}

function normalizePlayerColor(color: RemotePlayer["color"], id: string): Vec3 {
  if (Array.isArray(color)) return [color[0], color[1], color[2]];
  if (typeof color === "string") {
    const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
    if (match) {
      const value = Number.parseInt(match[1], 16);
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }
  }
  return colorForPlayer(id);
}

function sameTarget(a: BlockTarget | null, b: BlockTarget | null): boolean {
  return a === b || (!!a && !!b && a.block.x === b.block.x && a.block.y === b.block.y && a.block.z === b.block.z);
}

export function createVoxelEngine(canvas: HTMLCanvasElement, options: VoxelEngineOptions = {}): VoxelEngine {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  if (!gl) throw new Error("Lakecraft needs a browser with WebGL enabled.");
  const program = createProgram(gl);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const colorLocation = gl.getAttribLocation(program, "aColor");
  const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const cameraLocation = gl.getUniformLocation(program, "uCamera");
  const fogLocation = gl.getUniformLocation(program, "uFogEnabled");
  const fogColorLocation = gl.getUniformLocation(program, "uFogColor");
  const worldBuffer = gl.createBuffer();
  const remoteBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();
  if (!worldBuffer || !remoteBuffer || !lineBuffer) throw new Error("Unable to allocate WebGL buffers.");

  const seed = options.seed ?? 7319;
  const radius = Math.max(8, Math.min(40, options.worldRadius ?? 20));
  const blocks = createTerrain(seed, radius);
  for (const edit of options.initialEdits ?? []) blocks.set(blockKey(edit.x, edit.y, edit.z), edit.block);
  const startY = terrainHeight(0, 0, seed) + 1.02;
  const pose: PlayerPose = {
    x: options.initialPose?.x ?? 0.5,
    y: options.initialPose?.y ?? startY,
    z: options.initialPose?.z ?? 0.5,
    yaw: options.initialPose?.yaw ?? 0,
    pitch: options.initialPose?.pitch ?? -0.08,
  };
  const velocity: Vec3 = [0, 0, 0];
  const keys = new Set<string>();
  let selectedBlock = options.selectedBlock ?? BLOCK.DIRT;
  let worldVertexCount = 0;
  let remoteVertexCount = 0;
  let remotes: readonly RemotePlayer[] = [];
  let target: BlockTarget | null = null;
  let running = false;
  let destroyed = false;
  let frameId = 0;
  let lastFrame = 0;
  let lastPoseSent = 0;
  let poseDirty = true;
  let grounded = false;
  let miningTimer = 0;

  function clearMining(): void {
    if (miningTimer) window.clearTimeout(miningTimer);
    miningTimer = 0;
  }

  const getBlock = (x: number, y: number, z: number): BlockId => {
    if (y < 0) return BLOCK.STONE;
    return blocks.get(blockKey(x, y, z)) ?? BLOCK.AIR;
  };

  function rebuildWorldMesh(): void {
    const vertices: number[] = [];
    for (const [key, block] of blocks) {
      if (block === BLOCK.AIR) continue;
      const [x, y, z] = key.split(",").map(Number);
      const base = BLOCK_COLORS[block] ?? BLOCK_COLORS[BLOCK.STONE];
      const variation = 0.93 + (((Math.imul(x, 13) ^ Math.imul(y, 7) ^ Math.imul(z, 17)) & 7) / 100);
      for (const face of FACE_DEFS) {
        if (getBlock(x + face.neighbor[0], y + face.neighbor[1], z + face.neighbor[2]) !== BLOCK.AIR) continue;
        const color = tint(base, face.shade, variation);
        for (const point of face.vertices) pushVertex(vertices, [x + point[0], y + point[1], z + point[2]], color);
      }
    }
    worldVertexCount = vertices.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, worldBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  }

  function rebuildRemoteMesh(): void {
    const vertices: number[] = [];
    for (const player of remotes) {
      const color = normalizePlayerColor(player.color, player.id);
      const x = player.x;
      const y = player.y;
      const z = player.z;
      appendBox(vertices, [x - 0.28, y + 0.58, z - 0.17], [x + 0.28, y + 1.42, z + 0.17], color);
      appendBox(vertices, [x - 0.25, y + 1.42, z - 0.25], [x + 0.25, y + 1.92, z + 0.25], tint(color, 1.12));
      appendBox(vertices, [x - 0.25, y, z - 0.14], [x - 0.03, y + 0.62, z + 0.14], tint(color, 0.66));
      appendBox(vertices, [x + 0.03, y, z - 0.14], [x + 0.25, y + 0.62, z + 0.14], tint(color, 0.66));
    }
    remoteVertexCount = vertices.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, remoteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  }

  function collides(x: number, y: number, z: number): boolean {
    const halfWidth = 0.29;
    const minX = Math.floor(x - halfWidth);
    const maxX = Math.floor(x + halfWidth);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + 1.77);
    const minZ = Math.floor(z - halfWidth);
    const maxZ = Math.floor(z + halfWidth);
    for (let bx = minX; bx <= maxX; bx += 1) {
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          if (getBlock(bx, by, bz) !== BLOCK.AIR) return true;
        }
      }
    }
    return false;
  }

  function moveAxis(axis: 0 | 1 | 2, amount: number): boolean {
    if (amount === 0) return false;
    const values: Vec3 = [pose.x, pose.y, pose.z];
    const initial = values[axis];
    values[axis] += amount;
    if (!collides(values[0], values[1], values[2])) {
      pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
      poseDirty = true;
      return false;
    }
    let safe = initial;
    let blocked = values[axis];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const midpoint = (safe + blocked) / 2;
      values[axis] = midpoint;
      if (collides(values[0], values[1], values[2])) blocked = midpoint;
      else safe = midpoint;
    }
    values[axis] = safe;
    pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
    if (Math.abs(safe - initial) > 0.00001) poseDirty = true;
    return true;
  }

  function direction(): Vec3 {
    const cosPitch = Math.cos(pose.pitch);
    return [Math.sin(pose.yaw) * cosPitch, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cosPitch];
  }

  function update(dt: number, now: number): void {
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const magnitude = Math.hypot(forward, strafe) || 1;
    const speed = keys.has("ShiftLeft") ? 6.1 : 4.35;
    const dx = ((Math.sin(pose.yaw) * forward + Math.cos(pose.yaw) * strafe) / magnitude) * speed * dt;
    const dz = ((-Math.cos(pose.yaw) * forward + Math.sin(pose.yaw) * strafe) / magnitude) * speed * dt;
    moveAxis(0, dx);
    moveAxis(2, dz);
    velocity[1] = Math.max(-18, velocity[1] - 22 * dt);
    const verticalBlocked = moveAxis(1, velocity[1] * dt);
    if (verticalBlocked) {
      grounded = velocity[1] < 0;
      velocity[1] = 0;
    } else grounded = false;

    const nextTarget = raycastVoxels([pose.x, pose.y + 1.62, pose.z], direction(), getBlock, options.reach ?? 6);
    if (!sameTarget(target, nextTarget)) {
      clearMining();
      target = nextTarget;
      options.onTargetChange?.(target);
    } else target = nextTarget;

    if (now - lastPoseSent > 90 && (poseDirty || forward !== 0 || strafe !== 0 || Math.abs(velocity[1]) > 0.01)) {
      lastPoseSent = now;
      poseDirty = false;
      options.onPoseChange?.({ ...pose });
    }
  }

  function bindBuffer(buffer: WebGLBuffer): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 24, 12);
  }

  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function render(): void {
    resize();
    const eye: Vec3 = [pose.x, pose.y + 1.62, pose.z];
    const facing = direction();
    const projection = perspective(Math.PI / 3, canvas.width / canvas.height, 0.05, 90);
    const view = lookAt(eye, [eye[0] + facing[0], eye[1] + facing[1], eye[2] + facing[2]]);
    const mvp = multiply(projection, view);
    const sky: Vec3 = [0.45, 0.69, 0.86];
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(mvpLocation, false, mvp);
    gl.uniform3fv(cameraLocation, eye);
    gl.uniform3fv(fogColorLocation, sky);
    gl.uniform1f(fogLocation, 1);
    bindBuffer(worldBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, worldVertexCount);
    if (remoteVertexCount) {
      bindBuffer(remoteBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, remoteVertexCount);
    }

    if (target) {
      const { x, y, z } = target.block;
      const e = 0.003;
      const corners: Vec3[] = [
        [x - e, y - e, z - e], [x + 1 + e, y - e, z - e], [x + 1 + e, y + 1 + e, z - e], [x - e, y + 1 + e, z - e],
        [x - e, y - e, z + 1 + e], [x + 1 + e, y - e, z + 1 + e], [x + 1 + e, y + 1 + e, z + 1 + e], [x - e, y + 1 + e, z + 1 + e],
      ];
      const edgeIndices = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7];
      const lines: number[] = [];
      for (const index of edgeIndices) pushVertex(lines, corners[index], [1, 1, 1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      bindBuffer(lineBuffer);
      gl.uniform1f(fogLocation, 0);
      gl.drawArrays(gl.LINES, 0, edgeIndices.length);
    }

    // Crosshair in clip space, drawn last so it remains readable against foliage.
    const crossX = 9 / canvas.width * 2;
    const crossY = 9 / canvas.height * 2;
    const crosshair: number[] = [];
    pushVertex(crosshair, [-crossX, 0, 0], [1, 1, 1]); pushVertex(crosshair, [crossX, 0, 0], [1, 1, 1]);
    pushVertex(crosshair, [0, -crossY, 0], [1, 1, 1]); pushVertex(crosshair, [0, crossY, 0], [1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(crosshair), gl.DYNAMIC_DRAW);
    bindBuffer(lineBuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(mvpLocation, false, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]));
    gl.uniform1f(fogLocation, 0);
    gl.drawArrays(gl.LINES, 0, 4);
  }

  function frame(now: number): void {
    if (!running || destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(dt, now);
    render();
    frameId = requestAnimationFrame(frame);
  }

  function emitEdit(edit: WorldEdit): void {
    const previousBlock = getBlock(edit.x, edit.y, edit.z);
    blocks.set(blockKey(edit.x, edit.y, edit.z), edit.block);
    rebuildWorldMesh();
    options.onBlockEdit?.(edit, previousBlock);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (/^Digit[1-7]$/.test(event.code)) selectedBlock = Number(event.code.slice(5)) as BlockId;
    if (document.pointerLockElement !== canvas) return;
    keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (grounded) {
        velocity[1] = 8.25;
        grounded = false;
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }

  function onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== canvas) return;
    pose.yaw -= event.movementX * 0.0022;
    pose.pitch = Math.max(-1.52, Math.min(1.52, pose.pitch - event.movementY * 0.0022));
    poseDirty = true;
  }

  function playerIntersectsBlock(x: number, y: number, z: number): boolean {
    return pose.x + 0.29 > x && pose.x - 0.29 < x + 1 && pose.y + 1.78 > y && pose.y < y + 1 && pose.z + 0.29 > z && pose.z - 0.29 < z + 1;
  }

  function onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
      return;
    }
    if (!target) return;
    if (event.button === 0) {
      if (miningTimer) return;
      const mined = { ...target.block };
      const duration = Math.max(0, options.getMiningDuration?.(mined.block) ?? 0);
      if (duration === 0) {
        emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
      } else {
        miningTimer = window.setTimeout(() => {
          miningTimer = 0;
          if (getBlock(mined.x, mined.y, mined.z) === mined.block) {
            emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
          }
        }, duration * 1_000);
      }
    } else if (event.button === 2 && selectedBlock !== BLOCK.AIR) {
      const { x, y, z } = target.place;
      if (getBlock(x, y, z) === BLOCK.AIR && !playerIntersectsBlock(x, y, z)) emitEdit({ x, y, z, block: selectedBlock });
    }
  }

  function onMouseUp(event: MouseEvent): void {
    if (event.button === 0) clearMining();
  }

  function onPointerLockChange(): void {
    if (document.pointerLockElement !== canvas) {
      keys.clear();
      clearMining();
    }
    options.onPointerLockChange?.(document.pointerLockElement === canvas);
  }

  function onContextMenu(event: MouseEvent): void { event.preventDefault(); }

  rebuildWorldMesh();
  rebuildRemoteMesh();

  return {
    start() {
      if (running || destroyed) return;
      running = true;
      lastFrame = performance.now();
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("pointerlockchange", onPointerLockChange);
      canvas.addEventListener("mousedown", onMouseDown);
      canvas.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("contextmenu", onContextMenu);
      options.onPoseChange?.({ ...pose });
      frameId = requestAnimationFrame(frame);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearMining();
      gl.deleteBuffer(worldBuffer);
      gl.deleteBuffer(remoteBuffer);
      gl.deleteBuffer(lineBuffer);
      gl.deleteProgram(program);
    },
    applyWorldEdits(edits) {
      for (const edit of edits) blocks.set(blockKey(edit.x, edit.y, edit.z), edit.block);
      if (edits.length) rebuildWorldMesh();
    },
    setSelectedBlock(block) {
      selectedBlock = block;
    },
    setRemotePlayers(players) {
      remotes = players;
      rebuildRemoteMesh();
    },
    getPose() { return { ...pose }; },
    getTarget() { return target ? { block: { ...target.block }, place: { ...target.place }, distance: target.distance } : null; },
    requestPointerLock() { canvas.requestPointerLock(); },
  };
}
