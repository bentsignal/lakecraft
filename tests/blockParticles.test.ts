import assert from "node:assert/strict";
import {
  BLOCK_PARTICLE_FLOATS_PER_VERTEX,
  BLOCK_PARTICLE_VERTICES,
  BLOCK_PARTICLES_PER_ACTION,
  MAX_BLOCK_PARTICLES,
  blockParticleBufferCapacity,
  createBlockParticleSystem,
  type BlockParticleGeometryStats,
} from "../client/game/blockParticles.ts";
import { BLOCK } from "../client/game/types.ts";

const capacity = blockParticleBufferCapacity();
assert.deepEqual(capacity, {
  particleCount: MAX_BLOCK_PARTICLES,
  vertexCount: MAX_BLOCK_PARTICLES * BLOCK_PARTICLE_VERTICES,
  floatCount: MAX_BLOCK_PARTICLES * BLOCK_PARTICLE_VERTICES * BLOCK_PARTICLE_FLOATS_PER_VERTEX,
  totalBytes: 27_648,
});
assert.deepEqual(blockParticleBufferCapacity(-1), { particleCount: 0, vertexCount: 0, floatCount: 0, totalBytes: 0 });
assert.equal(blockParticleBufferCapacity(10_000).particleCount, MAX_BLOCK_PARTICLES, "capacity is a hard ceiling");

const geometryStats = (): BlockParticleGeometryStats => ({
  activeParticleCount: 0,
  writtenParticleCount: 0,
  vertexCount: 0,
  floatCount: 0,
});
const event = {
  block: BLOCK.DIAMOND_ORE,
  x: -7,
  y: 20,
  z: 13,
  normalX: 1,
  normalY: 0,
  normalZ: 0,
  action: "break" as const,
};

const first = createBlockParticleSystem();
const second = createBlockParticleSystem();
assert.equal(first.spawn(event), BLOCK_PARTICLES_PER_ACTION.break);
assert.equal(second.spawn(event), BLOCK_PARTICLES_PER_ACTION.break);
first.update(1 / 60);
second.update(1 / 60);
const firstGeometry = new Float32Array(capacity.floatCount);
const secondGeometry = new Float32Array(capacity.floatCount);
const firstGeometryStats = geometryStats();
const secondGeometryStats = geometryStats();
assert.equal(first.writeGeometry([1, 0, 0], [0, 1, 0], firstGeometry, firstGeometryStats), firstGeometryStats);
second.writeGeometry([1, 0, 0], [0, 1, 0], secondGeometry, secondGeometryStats);
assert.deepEqual(firstGeometryStats, secondGeometryStats);
assert.deepEqual(firstGeometry, secondGeometry, "block, coordinate, action, and normal produce deterministic geometry");
assert.equal(firstGeometryStats.writtenParticleCount, BLOCK_PARTICLES_PER_ACTION.break);
assert.equal(firstGeometryStats.floatCount, BLOCK_PARTICLES_PER_ACTION.break * 36);

const changed = createBlockParticleSystem();
changed.spawn({ ...event, x: event.x + 1 });
changed.update(1 / 60);
const changedGeometry = new Float32Array(capacity.floatCount);
changed.writeGeometry([1, 0, 0], [0, 1, 0], changedGeometry, geometryStats());
assert.notDeepEqual(changedGeometry, firstGeometry, "coordinates participate in the deterministic seed and origin");

const tiny = createBlockParticleSystem(5);
assert.equal(tiny.spawn({ ...event, action: "hit" }), BLOCK_PARTICLES_PER_ACTION.hit);
assert.equal(tiny.activeCount, 4);
assert.equal(tiny.spawn({ ...event, action: "place" }), 5, "one event cannot exceed a custom pool capacity");
assert.equal(tiny.activeCount, 5);
assert.equal(tiny.stats.totalOverwritten, 4, "full pools replace slots instead of growing");
for (let index = 0; index < 1_000; index += 1) tiny.spawn({ ...event, x: index, action: "break" });
assert.equal(tiny.activeCount, 5);
assert.equal(tiny.capacity, 5);

const truncated = new Float32Array(2 * BLOCK_PARTICLE_VERTICES * BLOCK_PARTICLE_FLOATS_PER_VERTEX);
const truncatedStats = geometryStats();
tiny.writeGeometry([1, 0, 0], [0, 1, 0], truncated, truncatedStats);
assert.deepEqual(truncatedStats, {
  activeParticleCount: 5,
  writtenParticleCount: 2,
  vertexCount: 12,
  floatCount: truncated.length,
}, "caller-owned output bounds geometry without resizing");

const physics = createBlockParticleSystem(1);
physics.spawn({ block: BLOCK.STONE, x: 0, y: 4, z: 0, action: "break" });
const physicsGeometry = new Float32Array(36);
const physicsStats = geometryStats();
physics.writeGeometry([1, 0, 0], [0, 1, 0], physicsGeometry, physicsStats);
const initialY = physicsGeometry[1];
physics.update(0.1);
physics.writeGeometry([1, 0, 0], [0, 1, 0], physicsGeometry, physicsStats);
const risingY = physicsGeometry[1];
assert.ok(risingY > initialY, "fresh debris receives upward impulse before gravity wins");
for (let index = 0; index < 5; index += 1) physics.update(0.1);
physics.writeGeometry([1, 0, 0], [0, 1, 0], physicsGeometry, physicsStats);
assert.ok(physicsGeometry[1] < risingY, "gravity pulls debris back down");
physics.update(10);
assert.equal(physics.activeCount, 0, "TTL expiry frees pool slots even after a suspended frame");
assert.equal(physics.stats.totalExpired, 1);

const stableStats = first.stats;
for (let frame = 0; frame < 10_000; frame += 1) {
  assert.equal(first.update(1 / 120), stableStats, "frame updates reuse one stats object");
  assert.equal(first.writeGeometry([1, 0, 0], [0, 1, 0], firstGeometry, firstGeometryStats), firstGeometryStats);
}
assert.equal(first.activeCount, 0);

const none = createBlockParticleSystem(0);
assert.equal(none.spawn(event), 0);
assert.equal(none.spawn({ ...event, block: BLOCK.AIR }), 0);
assert.equal(none.activeCount, 0);

const wool = createBlockParticleSystem(1);
assert.equal(wool.spawn({ block: BLOCK.WOOL, x: 2, y: 3, z: 4, action: "break" }), 1);
wool.writeGeometry([1, 0, 0], [0, 1, 0], physicsGeometry, physicsStats);
assert.ok(physicsGeometry[15] > 0.8 && physicsGeometry[16] > 0.78 && physicsGeometry[17] > 0.72,
  "wool debris uses a soft warm-white particle palette");

const sapling = createBlockParticleSystem(1);
assert.equal(sapling.spawn({ block: BLOCK.SAPLING, x: 2, y: 3, z: 4, action: "break" }), 1,
  "the append-only particle palette accepts saplings");

const stoneBricks = createBlockParticleSystem(1);
assert.equal(stoneBricks.spawn({ block: BLOCK.STONE_BRICKS, x: 2, y: 3, z: 4, action: "break" }), 1,
  "the append-only particle palette accepts stone bricks");

for (const [block, label] of [
  [BLOCK.OAK_FENCE, "oak fence"],
  [BLOCK.OAK_FENCE_GATE_CLOSED, "closed oak fence gate"],
  [BLOCK.OAK_FENCE_GATE_OPEN, "open oak fence gate"],
] as const) {
  const particles = createBlockParticleSystem(32);
  assert.equal(
    particles.spawn({ block, x: 2, y: 3, z: 4, action: "break" }),
    BLOCK_PARTICLES_PER_ACTION.break,
    `${label} emits the bounded break burst`,
  );
  assert.equal(
    particles.spawn({ block, x: 2, y: 3, z: 4, action: "place" }),
    BLOCK_PARTICLES_PER_ACTION.place,
    `${label} emits the bounded place burst`,
  );
  assert.equal(particles.activeCount, BLOCK_PARTICLES_PER_ACTION.break + BLOCK_PARTICLES_PER_ACTION.place);
  const output = new Float32Array(blockParticleBufferCapacity(32).floatCount);
  const outputStats = geometryStats();
  particles.writeGeometry([1, 0, 0], [0, 1, 0], output, outputStats);
  assert.equal(outputStats.writtenParticleCount, particles.activeCount);
  assert.ok(output[3] > 0.5 && output[4] > 0.34 && output[5] > 0.17,
    `${label} debris uses the warm oak particle palette`);
}

console.log("bounded deterministic block particle tests passed");
