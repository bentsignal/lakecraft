import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOB_MOTION_MAX_REPLAY_TICKS,
  MOB_MOTION_MAX_TARGETS,
  createMobMotionState,
  hashMobMotionCheckpoint,
  replayMobMotion,
  restoreMobMotionCheckpoint,
  selectMobMotionTarget,
  serializeMobMotionCheckpoint,
  stepMobMotion,
  writeMobMotionCheckpoint,
  writeMobMotionPoses,
  type MobMotionSpawnSnapshot,
  type MobMotionWorldSnapshot,
} from "../shared/mobMotionAuthority.ts";

const seed = 7319;
const epoch = 1_784_100_000_000;
const spawns: MobMotionSpawnSnapshot[] = [
  { mobId: "pig-5nb-0", kind: "pig", x: -8, y: 9, z: 2, yaw: 0.25 },
  { mobId: "cow-5nb-1", kind: "cow", x: 7, y: 8, z: -3, yaw: -0.4 },
  { mobId: "sheep-5nb-2", kind: "sheep", x: 3, y: 8, z: 9, yaw: 1.2 },
  { mobId: "zombie-5nb-3", kind: "zombie", x: -5, y: 8, z: -7, yaw: 0 },
  { mobId: "skeleton-5nb-4", kind: "skeleton", x: 9, y: 8, z: 6, yaw: 0 },
];
const worldSnapshot: MobMotionWorldSnapshot = {
  isNight: true,
  targets: [
    { userId: "zoe", x: 4, y: 8, z: 0 },
    { userId: "alex", x: -4, y: 8, z: 0 },
    { userId: "offline", x: 0, y: 8, z: 0, active: false },
  ],
};

const canonical = createMobMotionState({ seed, epoch, snapshot: spawns });
const reordered = createMobMotionState({ seed, epoch, snapshot: [...spawns].reverse() });
assert.ok(canonical && reordered);
assert.deepEqual(reordered, canonical, "seed, epoch, and spawn snapshot are canonical regardless of input order");
assert.notDeepEqual(
  createMobMotionState({ seed, epoch: epoch + 1, snapshot: spawns }),
  canonical,
  "the authority epoch participates in each mob's deterministic random stream",
);

const tieState = createMobMotionState({
  seed,
  epoch,
  snapshot: [{ mobId: "zombie-5nb-3", kind: "zombie", x: 0, y: 8, z: 0 }],
});
assert.ok(tieState);
const tiedTargets = [
  { userId: "zoe", x: 4, y: 8, z: 0 },
  { userId: "alex", x: -4, y: 8, z: 0 },
];
assert.equal(selectMobMotionTarget(tieState.mobs[0], tiedTargets), "alex");
assert.equal(selectMobMotionTarget(tieState.mobs[0], [...tiedTargets].reverse()), "alex");
assert.equal(
  selectMobMotionTarget(tieState.mobs[0], [
    { userId: "same", x: 8, y: 8, z: 0 },
    { userId: "same", x: 2, y: 8, z: 0 },
  ]),
  "same",
  "duplicate identities are canonicalized without depending on arrival order",
);

const phaseA = restoreMobMotionCheckpoint(writeMobMotionCheckpoint(tieState));
const phaseB = restoreMobMotionCheckpoint(writeMobMotionCheckpoint(tieState));
assert.ok(phaseA && phaseB);
const phaseSnapshot = { isNight: true, targets: [{ userId: "target", x: 10, y: 8, z: 0 }] };
assert.ok(replayMobMotion(phaseA, phaseSnapshot, 1));
assert.ok(replayMobMotion(phaseB, phaseSnapshot, 3));
const phasePoseA = writeMobMotionPoses(phaseA)[0];
const phasePoseB = writeMobMotionPoses(phaseB)[0];
assert.ok(
  Math.hypot(phasePoseA.x - phasePoseB.x, phasePoseA.z - phasePoseB.z) <= 0.25,
  "two 10 Hz ticks of 5 Hz polling phase stay within the multiplayer agreement budget",
);

const singleStepA = restoreMobMotionCheckpoint(writeMobMotionCheckpoint(canonical));
const singleStepB = restoreMobMotionCheckpoint(writeMobMotionCheckpoint(canonical));
assert.ok(singleStepA && singleStepB);
stepMobMotion(singleStepA, worldSnapshot);
stepMobMotion(singleStepB, { ...worldSnapshot, targets: [...worldSnapshot.targets].reverse() });
assert.deepEqual(singleStepB, singleStepA, "target snapshot order cannot perturb a motion tick");

function fullReplay() {
  const state = createMobMotionState({ seed, epoch, snapshot: spawns });
  assert.ok(state);
  assert.equal(replayMobMotion(state, worldSnapshot, MOB_MOTION_MAX_REPLAY_TICKS), state);
  return state;
}

const replayA = fullReplay();
const replayB = fullReplay();
const checkpointA = writeMobMotionCheckpoint(replayA);
const checkpointB = writeMobMotionCheckpoint(replayB);
const bytesA = serializeMobMotionCheckpoint(checkpointA);
const bytesB = serializeMobMotionCheckpoint(checkpointB);
const hashA = hashMobMotionCheckpoint(checkpointA);
assert.equal(bytesB, bytesA, "two ten-minute replays produce byte-identical checkpoints");
assert.equal(hashMobMotionCheckpoint(checkpointB), hashA, "two ten-minute replays produce the same hash");
assert.equal(hashA, "1d5bfbaae8e310f6", "the fixed ten-minute replay remains byte-for-byte stable across releases");

const firstHalf = createMobMotionState({ seed, epoch, snapshot: spawns });
assert.ok(firstHalf);
assert.ok(replayMobMotion(firstHalf, worldSnapshot, MOB_MOTION_MAX_REPLAY_TICKS / 2));
const wireCheckpoint = JSON.parse(JSON.stringify(writeMobMotionCheckpoint(firstHalf)));
const reconstructed = restoreMobMotionCheckpoint(wireCheckpoint);
assert.ok(reconstructed);
assert.ok(replayMobMotion(reconstructed, worldSnapshot, MOB_MOTION_MAX_REPLAY_TICKS / 2));
assert.equal(
  serializeMobMotionCheckpoint(writeMobMotionCheckpoint(reconstructed)),
  bytesA,
  "checkpoint reconstruction continues to the exact uninterrupted ten-minute state",
);

const poses = writeMobMotionPoses(replayA);
assert.equal(poses.length, spawns.length);
assert.deepEqual(poses.map(({ mobId }) => mobId), [...poses.map(({ mobId }) => mobId)].sort());
assert.ok(poses.every(({ x, z }) => Number.isFinite(x) && Number.isFinite(z)));

const tooManySpawns = Array.from({ length: 65 }, (_, slot): MobMotionSpawnSnapshot => ({
  mobId: `pig-5nb-${slot.toString(36)}`,
  kind: "pig",
  x: slot,
  y: 8,
  z: 0,
}));
assert.equal(createMobMotionState({ seed, epoch, snapshot: tooManySpawns }), null, "mob state is hard-bounded");
assert.equal(replayMobMotion(replayA, worldSnapshot, MOB_MOTION_MAX_REPLAY_TICKS + 1), null);
assert.equal(
  createMobMotionState({ seed, epoch, snapshot: [{ ...spawns[0], mobId: "pig-wrong-0" }] }),
  null,
  "mob identities remain bound to the fixed world seed",
);
assert.equal(createMobMotionState({ seed, epoch, snapshot: [{ ...spawns[0], yaw: Number.POSITIVE_INFINITY }] }), null);
assert.equal(
  serializeMobMotionCheckpoint({ ...checkpointA, mobs: [...checkpointA.mobs].reverse() }),
  bytesA,
  "canonical checkpoint bytes do not depend on caller array order",
);

const manyTargets = Array.from({ length: MOB_MOTION_MAX_TARGETS * 2 }, (_, index) => ({
  userId: `user-${index.toString().padStart(3, "0")}`,
  x: index % 12,
  y: 8,
  z: index % 7,
}));
const boundedTargetState = createMobMotionState({ seed, epoch, snapshot: [spawns[3]] });
assert.ok(boundedTargetState);
for (let tick = 0; tick < 100; tick += 1) {
  stepMobMotion(boundedTargetState, { isNight: true, targets: manyTargets });
}
assert.equal(boundedTargetState.mobs.length, 1, "large target snapshots cannot grow persisted motion state");

const source = readFileSync(new URL("../shared/mobMotionAuthority.ts", import.meta.url), "utf8");
assert.equal(/lakebed\/(?:client|server)|\bwindow\b|\bdocument\b|\bHTMLElement\b/.test(source), false);

console.log(JSON.stringify({
  benchmark: "deterministic ten-minute fixed-tick mob replay",
  ticks: MOB_MOTION_MAX_REPLAY_TICKS,
  mobs: replayA.mobs.length,
  checkpointBytes: bytesA.length,
  replayHash: hashA,
}));
console.log("mob motion authority tests passed");
