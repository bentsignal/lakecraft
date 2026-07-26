import { BOX_VERTEX_COORDINATES } from "./generated/renderGeometry.ts";

type Vec3 = readonly [number, number, number];

export const MAX_RENDERED_PLAYER_PROJECTILES = 96;
export const PLAYER_PROJECTILE_LIFETIME_MS = 5_000;
export const PLAYER_PROJECTILE_RENDER_DISTANCE = 72;
export const PLAYER_PROJECTILE_MESH_INTERVAL_MS = 1_000 / 60;
export const PLAYER_PROJECTILE_GRAVITY = 20;
export const PLAYER_PROJECTILE_VERTICES = 108;

const FLOATS_PER_VERTEX = 6;
const BOX_VERTICES = 36;
const RENDER_DISTANCE_SQUARED = PLAYER_PROJECTILE_RENDER_DISTANCE * PLAYER_PROJECTILE_RENDER_DISTANCE;

const FACE_SHADE = [0.82, 0.66, 1, 0.5, 0.9, 0.72] as const;
const ARROW_PARTS = [
  [-0.025, -0.025, -0.34, 0.025, 0.025, 0.32, 0.49, 0.31, 0.14],
  [-0.065, -0.065, 0.30, 0.065, 0.065, 0.43, 0.68, 0.69, 0.66],
  [-0.085, -0.012, -0.39, 0.085, 0.012, -0.22, 0.74, 0.72, 0.65],
] as const;
const ARROW_LOCAL_POINTS = new Float32Array(PLAYER_PROJECTILE_VERTICES * 3);
const ARROW_VERTEX_COLORS = new Float32Array(PLAYER_PROJECTILE_VERTICES * 3);
for (let partIndex = 0, outputOffset = 0; partIndex < ARROW_PARTS.length; partIndex += 1) {
  const [minX, minY, minZ, maxX, maxY, maxZ, red, green, blue] = ARROW_PARTS[partIndex];
  const width = maxX - minX;
  const height = maxY - minY;
  const depth = maxZ - minZ;
  for (let vertexIndex = 0, pointOffset = 0; vertexIndex < BOX_VERTICES; vertexIndex += 1) {
    const shade = FACE_SHADE[(vertexIndex / 6) | 0];
    ARROW_LOCAL_POINTS[outputOffset] = minX + width * BOX_VERTEX_COORDINATES[pointOffset++];
    ARROW_VERTEX_COLORS[outputOffset++] = red * shade;
    ARROW_LOCAL_POINTS[outputOffset] = minY + height * BOX_VERTEX_COORDINATES[pointOffset++];
    ARROW_VERTEX_COLORS[outputOffset++] = green * shade;
    ARROW_LOCAL_POINTS[outputOffset] = minZ + depth * BOX_VERTEX_COORDINATES[pointOffset++];
    ARROW_VERTEX_COLORS[outputOffset++] = blue * shade;
  }
}

/** A launch snapshot supplied by Lakebed-authoritative combat state. */
export interface PlayerProjectileVisual {
  projectileId: string;
  originX: number;
  originY: number;
  originZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  launchedAt: number;
  /** Optional early visual expiry for a server-confirmed collision. */
  expiresAt?: number;
  /** Omit to use the shared visual gravity constant. */
  gravity?: number;
}

export interface BallisticSample {
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  ageSeconds: number;
}

export interface PlayerProjectileRenderStats {
  totalProjectileCount: number;
  activeProjectileCount: number;
  visibleProjectileCount: number;
  vertexCount: number;
  uploadBytes: number;
  meshMs: number;
  meshUpdates: number;
  updated: boolean;
}

export interface PlayerProjectileRenderer {
  readonly buffer: WebGLBuffer;
  readonly stats: PlayerProjectileRenderStats;
  setProjectiles(projectiles: readonly PlayerProjectileVisual[]): void;
  update(now: number, camera: Vec3): PlayerProjectileRenderStats;
  destroy(): void;
}

export function playerProjectileBufferCapacity(projectileCount = MAX_RENDERED_PLAYER_PROJECTILES): {
  projectileCount: number;
  vertexCount: number;
  floatCount: number;
  totalBytes: number;
} {
  const count = Math.max(0, Math.min(MAX_RENDERED_PLAYER_PROJECTILES, Math.floor(projectileCount)));
  const vertexCount = count * PLAYER_PROJECTILE_VERTICES;
  const floatCount = vertexCount * FLOATS_PER_VERTEX;
  return {
    projectileCount: count,
    vertexCount,
    floatCount,
    totalBytes: floatCount * Float32Array.BYTES_PER_ELEMENT,
  };
}

/**
 * Deterministically samples a launch snapshot into caller-owned storage.
 * Returns false before launch, after the hard lifetime, or after server expiry.
 */
export function samplePlayerProjectile(
  projectile: Readonly<PlayerProjectileVisual>,
  now: number,
  output: BallisticSample,
): boolean {
  const hardExpiry = projectile.launchedAt + PLAYER_PROJECTILE_LIFETIME_MS;
  const expiry = Number.isFinite(projectile.expiresAt)
    ? Math.min(hardExpiry, projectile.expiresAt as number)
    : hardExpiry;
  if (!Number.isFinite(now) || now < projectile.launchedAt || now > expiry) return false;
  const ageSeconds = (now - projectile.launchedAt) / 1_000;
  const gravity = Number.isFinite(projectile.gravity) ? projectile.gravity as number : PLAYER_PROJECTILE_GRAVITY;
  output.x = projectile.originX + projectile.velocityX * ageSeconds;
  output.y = projectile.originY + projectile.velocityY * ageSeconds - gravity * ageSeconds * ageSeconds * 0.5;
  output.z = projectile.originZ + projectile.velocityZ * ageSeconds;
  output.velocityX = projectile.velocityX;
  output.velocityY = projectile.velocityY - gravity * ageSeconds;
  output.velocityZ = projectile.velocityZ;
  output.ageSeconds = ageSeconds;
  return Number.isFinite(output.x)
    && Number.isFinite(output.y)
    && Number.isFinite(output.z)
    && Number.isFinite(output.velocityX)
    && Number.isFinite(output.velocityY)
    && Number.isFinite(output.velocityZ);
}

interface VertexWriter {
  data: Float32Array;
  offset: number;
}

function appendArrow(writer: VertexWriter, sample: Readonly<BallisticSample>): void {
  const speedSquared = sample.velocityX * sample.velocityX
    + sample.velocityY * sample.velocityY
    + sample.velocityZ * sample.velocityZ;
  const inverseSpeed = speedSquared > 1e-12 ? 1 / Math.sqrt(speedSquared) : 0;
  const fx = inverseSpeed ? sample.velocityX * inverseSpeed : 0;
  const fy = inverseSpeed ? sample.velocityY * inverseSpeed : 0;
  const fz = inverseSpeed ? sample.velocityZ * inverseSpeed : 1;
  const rightLengthSquared = fx * fx + fz * fz;
  const inverseRightLength = rightLengthSquared > 1e-12 ? 1 / Math.sqrt(rightLengthSquared) : 0;
  const rx = inverseRightLength ? fz * inverseRightLength : 1;
  const rz = inverseRightLength ? -fx * inverseRightLength : 0;
  const ux = fy * rz;
  const uy = fz * rx - fx * rz;
  const uz = -fy * rx;
  const data = writer.data;
  let outputOffset = writer.offset;
  for (let vertexIndex = 0, localOffset = 0; vertexIndex < PLAYER_PROJECTILE_VERTICES; vertexIndex += 1) {
    const localX = ARROW_LOCAL_POINTS[localOffset++];
    const localY = ARROW_LOCAL_POINTS[localOffset++];
    const localZ = ARROW_LOCAL_POINTS[localOffset++];
    data[outputOffset] = sample.x + rx * localX + ux * localY + fx * localZ;
    data[outputOffset + 1] = sample.y + uy * localY + fy * localZ;
    data[outputOffset + 2] = sample.z + rz * localX + uz * localY + fz * localZ;
    outputOffset += FLOATS_PER_VERTEX;
  }
  writer.offset = outputOffset;
}

function isFiniteProjectile(projectile: Readonly<PlayerProjectileVisual>): boolean {
  return typeof projectile.projectileId === "string"
    && projectile.projectileId.length > 0
    && Number.isFinite(projectile.originX)
    && Number.isFinite(projectile.originY)
    && Number.isFinite(projectile.originZ)
    && Number.isFinite(projectile.velocityX)
    && Number.isFinite(projectile.velocityY)
    && Number.isFinite(projectile.velocityZ)
    && Number.isFinite(projectile.launchedAt);
}

export function createPlayerProjectileRenderer(gl: WebGLRenderingContext): PlayerProjectileRenderer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to allocate the player-projectile batch buffer.");
  const capacity = playerProjectileBufferCapacity();
  const vertices = new Float32Array(capacity.floatCount);
  for (let vertexIndex = 0; vertexIndex < capacity.vertexCount; vertexIndex += 1) {
    const colorOffset = (vertexIndex % PLAYER_PROJECTILE_VERTICES) * 3;
    const outputOffset = vertexIndex * FLOATS_PER_VERTEX + 3;
    vertices[outputOffset] = ARROW_VERTEX_COLORS[colorOffset];
    vertices[outputOffset + 1] = ARROW_VERTEX_COLORS[colorOffset + 1];
    vertices[outputOffset + 2] = ARROW_VERTEX_COLORS[colorOffset + 2];
  }
  const uploadViews: Float32Array[] = new Array(MAX_RENDERED_PLAYER_PROJECTILES + 1);
  for (let count = 0; count <= MAX_RENDERED_PLAYER_PROJECTILES; count += 1) {
    uploadViews[count] = vertices.subarray(0, count * PLAYER_PROJECTILE_VERTICES * FLOATS_PER_VERTEX);
  }
  const origins = new Float64Array(MAX_RENDERED_PLAYER_PROJECTILES * 3);
  const velocities = new Float64Array(MAX_RENDERED_PLAYER_PROJECTILES * 3);
  const launchedAt = new Float64Array(MAX_RENDERED_PLAYER_PROJECTILES);
  const expiresAt = new Float64Array(MAX_RENDERED_PLAYER_PROJECTILES);
  const gravities = new Float64Array(MAX_RENDERED_PLAYER_PROJECTILES);
  const sample: BallisticSample = { x: 0, y: 0, z: 0, velocityX: 0, velocityY: 0, velocityZ: 0, ageSeconds: 0 };
  const copiedProjectile: PlayerProjectileVisual = {
    projectileId: "pooled",
    originX: 0,
    originY: 0,
    originZ: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    launchedAt: 0,
  };
  const writer: VertexWriter = { data: vertices, offset: 0 };
  const stats: PlayerProjectileRenderStats = {
    totalProjectileCount: 0,
    activeProjectileCount: 0,
    visibleProjectileCount: 0,
    vertexCount: 0,
    uploadBytes: 0,
    meshMs: 0,
    meshUpdates: 0,
    updated: false,
  };
  let projectileCount = 0;
  let lastMeshAt = -Infinity;
  let dirty = true;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);

  return {
    buffer,
    stats,
    setProjectiles(projectiles) {
      projectileCount = 0;
      const limit = Math.min(projectiles.length, MAX_RENDERED_PLAYER_PROJECTILES);
      for (let sourceIndex = 0; sourceIndex < limit; sourceIndex += 1) {
        const projectile = projectiles[sourceIndex];
        if (!projectile || !isFiniteProjectile(projectile)) continue;
        const offset = projectileCount * 3;
        origins[offset] = projectile.originX;
        origins[offset + 1] = projectile.originY;
        origins[offset + 2] = projectile.originZ;
        velocities[offset] = projectile.velocityX;
        velocities[offset + 1] = projectile.velocityY;
        velocities[offset + 2] = projectile.velocityZ;
        launchedAt[projectileCount] = projectile.launchedAt;
        expiresAt[projectileCount] = Number.isFinite(projectile.expiresAt) ? projectile.expiresAt as number : Infinity;
        gravities[projectileCount] = Number.isFinite(projectile.gravity) ? projectile.gravity as number : PLAYER_PROJECTILE_GRAVITY;
        projectileCount += 1;
      }
      dirty = true;
    },
    update(now, camera) {
      stats.updated = false;
      if (!dirty && now - lastMeshAt < PLAYER_PROJECTILE_MESH_INTERVAL_MS) return stats;
      const startedAt = performance.now();
      writer.offset = 0;
      stats.totalProjectileCount = projectileCount;
      stats.activeProjectileCount = 0;
      stats.visibleProjectileCount = 0;
      for (let index = 0; index < projectileCount; index += 1) {
        const offset = index * 3;
        copiedProjectile.originX = origins[offset];
        copiedProjectile.originY = origins[offset + 1];
        copiedProjectile.originZ = origins[offset + 2];
        copiedProjectile.velocityX = velocities[offset];
        copiedProjectile.velocityY = velocities[offset + 1];
        copiedProjectile.velocityZ = velocities[offset + 2];
        copiedProjectile.launchedAt = launchedAt[index];
        copiedProjectile.expiresAt = expiresAt[index];
        copiedProjectile.gravity = gravities[index];
        if (!samplePlayerProjectile(copiedProjectile, now, sample)) continue;
        stats.activeProjectileCount += 1;
        const dx = sample.x - camera[0];
        const dy = sample.y - camera[1];
        const dz = sample.z - camera[2];
        if (dx * dx + dy * dy + dz * dz > RENDER_DISTANCE_SQUARED) continue;
        appendArrow(writer, sample);
        stats.visibleProjectileCount += 1;
      }
      stats.vertexCount = writer.offset / FLOATS_PER_VERTEX;
      const uploadView = uploadViews[stats.visibleProjectileCount];
      stats.uploadBytes = uploadView.byteLength;
      if (uploadView.length > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, uploadView);
      }
      stats.meshMs = performance.now() - startedAt;
      stats.meshUpdates += 1;
      stats.updated = true;
      lastMeshAt = now;
      dirty = false;
      return stats;
    },
    destroy() {
      gl.deleteBuffer(buffer);
    },
  };
}
