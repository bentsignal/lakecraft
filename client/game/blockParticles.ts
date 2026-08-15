import type { BlockId } from "./types.ts";
import { BLOCK_MATERIAL_COLORS } from "./blockColors.ts";
import { REALTIME_BLOCK_ID_MAX } from "../../shared/realtimeWorldChunks.ts";

export type BlockParticleAction = "hit" | "break" | "place";

export interface BlockParticleEvent {
  readonly block: BlockId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Outward face normal. Omit it for an upward-facing effect. */
  readonly normalX?: number;
  readonly normalY?: number;
  readonly normalZ?: number;
  readonly action: BlockParticleAction;
}

export interface BlockParticleStats {
  activeCount: number;
  totalSpawned: number;
  totalOverwritten: number;
  totalExpired: number;
}

export interface BlockParticleGeometryStats {
  activeParticleCount: number;
  writtenParticleCount: number;
  vertexCount: number;
  floatCount: number;
}

export interface BlockParticleBufferCapacity {
  particleCount: number;
  vertexCount: number;
  floatCount: number;
  totalBytes: number;
}

export interface BlockParticleSystem {
  readonly capacity: number;
  readonly activeCount: number;
  readonly stats: BlockParticleStats;
  /** Emits a fixed action-specific count, overwriting the oldest pool slots when full. */
  spawn(event: Readonly<BlockParticleEvent>): number;
  /** Advances TTL and bounded ballistic motion. The returned object is stable and reusable. */
  update(deltaSeconds: number): BlockParticleStats;
  /**
   * Writes camera-facing square triangles as position + RGB (six floats per
   * vertex), matching Lakecraft's retained color-mesh convention.
   */
  writeGeometry(
    cameraRight: ArrayLike<number>,
    cameraUp: ArrayLike<number>,
    output: Float32Array,
    geometryStats: BlockParticleGeometryStats,
  ): BlockParticleGeometryStats;
  clear(): void;
}

export const MAX_BLOCK_PARTICLES = 192;
export const BLOCK_PARTICLE_VERTICES = 6;
export const BLOCK_PARTICLE_FLOATS_PER_VERTEX = 6;
export const MAX_BLOCK_PARTICLE_STEP_SECONDS = 0.1;

export const BLOCK_PARTICLES_PER_ACTION: Readonly<Record<BlockParticleAction, number>> = Object.freeze({
  hit: 4,
  break: 16,
  place: 6,
});

const FLOATS_PER_PARTICLE = BLOCK_PARTICLE_VERTICES * BLOCK_PARTICLE_FLOATS_PER_VERTEX;
const GRAVITY = 13.5;
const BOUNCE = 0.28;
const MAX_BLOCK_ID = REALTIME_BLOCK_ID_MAX;
const UINT32_SCALE = 1 / 4_294_967_296;

const BLOCK_COLORS = new Float32Array(BLOCK_MATERIAL_COLORS.flat());

function boundedParticleCount(value: number): number {
  if (!Number.isFinite(value)) return MAX_BLOCK_PARTICLES;
  return Math.max(0, Math.min(MAX_BLOCK_PARTICLES, Math.floor(value)));
}

/** Exact CPU geometry/GPU upload ceiling for the requested bounded pool size. */
export function blockParticleBufferCapacity(
  particleCount = MAX_BLOCK_PARTICLES,
): BlockParticleBufferCapacity {
  const count = boundedParticleCount(particleCount);
  const vertexCount = count * BLOCK_PARTICLE_VERTICES;
  const floatCount = vertexCount * BLOCK_PARTICLE_FLOATS_PER_VERTEX;
  return {
    particleCount: count,
    vertexCount,
    floatCount,
    totalBytes: floatCount * Float32Array.BYTES_PER_ELEMENT,
  };
}

function scramble(seed: number): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

function mixHash(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x45d9f3b) >>> 0;
}

function eventSeed(event: Readonly<BlockParticleEvent>): number {
  let hash = mixHash(0x9e3779b9, event.block | 0);
  hash = mixHash(hash, Math.floor(event.x) | 0);
  hash = mixHash(hash, Math.floor(event.y) | 0);
  hash = mixHash(hash, Math.floor(event.z) | 0);
  hash = mixHash(hash, event.action === "hit" ? 1 : event.action === "break" ? 2 : 3);
  return hash || 0x6d2b79f5;
}

function writeVertex(
  output: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  red: number,
  green: number,
  blue: number,
): number {
  output[offset++] = x;
  output[offset++] = y;
  output[offset++] = z;
  output[offset++] = red;
  output[offset++] = green;
  output[offset++] = blue;
  return offset;
}

/**
 * Creates all simulation storage up front. Spawn, update, and geometry writes
 * allocate no arrays, objects, strings, or GPU resources and perform no I/O.
 */
export function createBlockParticleSystem(
  requestedCapacity = MAX_BLOCK_PARTICLES,
): BlockParticleSystem {
  const capacity = boundedParticleCount(requestedCapacity);
  // 0 = free, 1 = ballistic, 2 = settled after a small bounce.
  const states = new Uint8Array(capacity);
  const positions = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const ages = new Float32Array(capacity);
  const lifetimes = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  const floors = new Float32Array(capacity);
  const stats: BlockParticleStats = {
    activeCount: 0,
    totalSpawned: 0,
    totalOverwritten: 0,
    totalExpired: 0,
  };
  let nextSlot = 0;

  const system: BlockParticleSystem = {
    capacity,
    get activeCount() {
      return stats.activeCount;
    },
    stats,
    spawn(event) {
      if (
        capacity === 0
        || !Number.isInteger(event.block)
        || event.block <= 0
        || event.block > MAX_BLOCK_ID
        || !Number.isFinite(event.x)
        || !Number.isFinite(event.y)
        || !Number.isFinite(event.z)
        || (event.action !== "hit" && event.action !== "break" && event.action !== "place")
      ) return 0;

      const requestedCount = BLOCK_PARTICLES_PER_ACTION[event.action];
      const spawnCount = Math.min(requestedCount, capacity);
      let normalX = Number.isFinite(event.normalX) ? event.normalX as number : 0;
      let normalY = Number.isFinite(event.normalY) ? event.normalY as number : 1;
      let normalZ = Number.isFinite(event.normalZ) ? event.normalZ as number : 0;
      const normalLength = Math.hypot(normalX, normalY, normalZ);
      if (normalLength > 0.0001) {
        normalX /= normalLength;
        normalY /= normalLength;
        normalZ /= normalLength;
      } else {
        normalX = 0;
        normalY = 1;
        normalZ = 0;
      }

      let seed = eventSeed(event);
      const colorOffset = (event.block < BLOCK_MATERIAL_COLORS.length ? event.block : 3) * 3;
      for (let particleIndex = 0; particleIndex < spawnCount; particleIndex += 1) {
        const slot = nextSlot;
        nextSlot = nextSlot + 1 === capacity ? 0 : nextSlot + 1;
        if (states[slot] === 0) stats.activeCount += 1;
        else stats.totalOverwritten += 1;

        seed = scramble(seed); const randomX = seed * UINT32_SCALE;
        seed = scramble(seed); const randomY = seed * UINT32_SCALE;
        seed = scramble(seed); const randomZ = seed * UINT32_SCALE;
        seed = scramble(seed); const randomVelocityX = seed * UINT32_SCALE;
        seed = scramble(seed); const randomVelocityY = seed * UINT32_SCALE;
        seed = scramble(seed); const randomVelocityZ = seed * UINT32_SCALE;
        seed = scramble(seed); const randomSize = seed * UINT32_SCALE;
        seed = scramble(seed); const randomLifetime = seed * UINT32_SCALE;
        seed = scramble(seed); const randomShade = seed * UINT32_SCALE;

        const vectorOffset = slot * 3;
        const spread = event.action === "break" ? 0.66 : event.action === "place" ? 0.52 : 0.30;
        const faceOffset = event.action === "hit" ? 0.48 : event.action === "place" ? 0.16 : 0;
        positions[vectorOffset] = event.x + 0.5 + normalX * faceOffset + (randomX - 0.5) * spread;
        positions[vectorOffset + 1] = event.y + (event.action === "place" ? 0.12 : 0.5)
          + normalY * faceOffset + (randomY - 0.5) * spread;
        positions[vectorOffset + 2] = event.z + 0.5 + normalZ * faceOffset + (randomZ - 0.5) * spread;

        const outwardSpeed = event.action === "hit" ? 2.3 : event.action === "break" ? 1.25 : 0.4;
        const sidewaysSpeed = event.action === "break" ? 3.2 : event.action === "place" ? 1.5 : 1.8;
        velocities[vectorOffset] = normalX * outwardSpeed + (randomVelocityX - 0.5) * sidewaysSpeed;
        velocities[vectorOffset + 1] = normalY * outwardSpeed
          + (event.action === "break" ? 2.2 : event.action === "place" ? 0.9 : 1.35)
          + randomVelocityY * (event.action === "break" ? 2.4 : 1.2);
        velocities[vectorOffset + 2] = normalZ * outwardSpeed + (randomVelocityZ - 0.5) * sidewaysSpeed;

        const shade = 0.84 + randomShade * 0.22;
        colors[vectorOffset] = Math.min(1, BLOCK_COLORS[colorOffset] * shade);
        colors[vectorOffset + 1] = Math.min(1, BLOCK_COLORS[colorOffset + 1] * shade);
        colors[vectorOffset + 2] = Math.min(1, BLOCK_COLORS[colorOffset + 2] * shade);
        sizes[slot] = 0.035 + randomSize * (event.action === "break" ? 0.065 : 0.045);
        lifetimes[slot] = event.action === "break"
          ? 0.68 + randomLifetime * 0.34
          : event.action === "place"
            ? 0.38 + randomLifetime * 0.20
            : 0.32 + randomLifetime * 0.18;
        ages[slot] = 0;
        floors[slot] = event.y + 0.015;
        states[slot] = 1;
      }
      stats.totalSpawned += spawnCount;
      return spawnCount;
    },
    update(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || stats.activeCount === 0) return stats;
      const elapsed = deltaSeconds;
      const step = Math.min(elapsed, MAX_BLOCK_PARTICLE_STEP_SECONDS);
      for (let slot = 0; slot < capacity; slot += 1) {
        const state = states[slot];
        if (state === 0) continue;
        const age = ages[slot] + elapsed;
        ages[slot] = age;
        if (age >= lifetimes[slot]) {
          states[slot] = 0;
          stats.activeCount -= 1;
          stats.totalExpired += 1;
          continue;
        }
        if (state === 2) continue;
        const offset = slot * 3;
        velocities[offset + 1] -= GRAVITY * step;
        positions[offset] += velocities[offset] * step;
        positions[offset + 1] += velocities[offset + 1] * step;
        positions[offset + 2] += velocities[offset + 2] * step;
        const floor = floors[slot] + sizes[slot];
        if (positions[offset + 1] < floor && velocities[offset + 1] < 0) {
          positions[offset + 1] = floor;
          velocities[offset] *= 0.68;
          velocities[offset + 1] *= -BOUNCE;
          velocities[offset + 2] *= 0.68;
          if (velocities[offset + 1] < 0.42) {
            velocities[offset] = 0;
            velocities[offset + 1] = 0;
            velocities[offset + 2] = 0;
            states[slot] = 2;
          }
        }
      }
      return stats;
    },
    writeGeometry(cameraRight, cameraUp, output, geometryStats) {
      const outputParticleLimit = Math.min(capacity, Math.floor(output.length / FLOATS_PER_PARTICLE));
      const rightX = Number.isFinite(cameraRight[0]) ? cameraRight[0] : 1;
      const rightY = Number.isFinite(cameraRight[1]) ? cameraRight[1] : 0;
      const rightZ = Number.isFinite(cameraRight[2]) ? cameraRight[2] : 0;
      const upX = Number.isFinite(cameraUp[0]) ? cameraUp[0] : 0;
      const upY = Number.isFinite(cameraUp[1]) ? cameraUp[1] : 1;
      const upZ = Number.isFinite(cameraUp[2]) ? cameraUp[2] : 0;
      let outputOffset = 0;
      let writtenParticles = 0;
      for (let slot = 0; slot < capacity && writtenParticles < outputParticleLimit; slot += 1) {
        if (states[slot] === 0) continue;
        const vectorOffset = slot * 3;
        const centerX = positions[vectorOffset];
        const centerY = positions[vectorOffset + 1];
        const centerZ = positions[vectorOffset + 2];
        const halfSize = sizes[slot];
        const rx = rightX * halfSize;
        const ry = rightY * halfSize;
        const rz = rightZ * halfSize;
        const ux = upX * halfSize;
        const uy = upY * halfSize;
        const uz = upZ * halfSize;
        const red = colors[vectorOffset];
        const green = colors[vectorOffset + 1];
        const blue = colors[vectorOffset + 2];

        // Two triangles, ordered consistently for the engine's color shader.
        outputOffset = writeVertex(output, outputOffset, centerX-rx-ux, centerY-ry-uy, centerZ-rz-uz, red*0.82, green*0.82, blue*0.82);
        outputOffset = writeVertex(output, outputOffset, centerX+rx-ux, centerY+ry-uy, centerZ+rz-uz, red*0.90, green*0.90, blue*0.90);
        outputOffset = writeVertex(output, outputOffset, centerX+rx+ux, centerY+ry+uy, centerZ+rz+uz, red, green, blue);
        outputOffset = writeVertex(output, outputOffset, centerX-rx-ux, centerY-ry-uy, centerZ-rz-uz, red*0.82, green*0.82, blue*0.82);
        outputOffset = writeVertex(output, outputOffset, centerX+rx+ux, centerY+ry+uy, centerZ+rz+uz, red, green, blue);
        outputOffset = writeVertex(output, outputOffset, centerX-rx+ux, centerY-ry+uy, centerZ-rz+uz, red*0.91, green*0.91, blue*0.91);
        writtenParticles += 1;
      }
      geometryStats.activeParticleCount = stats.activeCount;
      geometryStats.writtenParticleCount = writtenParticles;
      geometryStats.vertexCount = writtenParticles * BLOCK_PARTICLE_VERTICES;
      geometryStats.floatCount = outputOffset;
      return geometryStats;
    },
    clear() {
      states.fill(0);
      stats.activeCount = 0;
      stats.totalSpawned = 0;
      stats.totalOverwritten = 0;
      stats.totalExpired = 0;
      nextSlot = 0;
    },
  };
  return system;
}
