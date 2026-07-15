import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  MAX_RANGED_COMBAT_RECEIPTS_PER_USER,
  MAX_RANGED_COMBAT_REQUEST_BYTES,
  RANGED_COMBAT_PROTOCOL_VERSION,
  RANGED_FULL_CHARGE_MS,
  RANGED_MAX_CHARGE_MS,
  RANGED_MAX_RANGE,
  RANGED_MIN_CHARGE_MS,
  RANGED_RELEASE_COOLDOWN_MS,
  authoritativeRangedTrajectory,
  decodeRangedCombatReceipt,
  encodeRangedCombatReceipt,
  firstOccludingVoxelOnSegment,
  rangedCombatFingerprint,
  rangedTrajectoryPoint,
  resolveRangedChargeStart,
  resolveRangedRelease,
  resolveRangedReleaseIdempotently,
  segmentAabbIntersectionFraction,
  selectRangedCombatReceiptOverflow,
  traceRangedTrajectory,
  validateRangedCombatRequestJson,
  type RangedAuthorityTarget,
  type RangedChargeAuthority,
  type RangedInventoryAuthority,
  type RangedReleaseRequest,
  type ValidatedRangedCombatRequest,
} from "../shared/rangedCombat.ts";
import { defaultMobAuthorityState } from "../shared/mobCombat.ts";
import { defaultPlayerCombatState, type CombatPose } from "../shared/playerCombat.ts";
import { worldEditChunkKey } from "../shared/worldChunks.ts";

const now = 100_000;
const operationId = "ranged_123456789";

function pose(userId: string, x = 0, y = 0, z = 0, yaw = 0, pitch = 0): CombatPose {
  return { userId, x, y, z, yaw, pitch, heartbeatAt: now, online: true };
}

function releaseRequest(overrides: Partial<RangedReleaseRequest> = {}): ValidatedRangedCombatRequest {
  const request: RangedReleaseRequest = {
    version: RANGED_COMBAT_PROTOCOL_VERSION,
    operationId,
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "release",
    targetKind: "player",
    targetId: "bob",
    ...overrides,
  };
  return { ...request, fingerprint: rangedCombatFingerprint(request) };
}

const inventory: RangedInventoryAuthority = {
  revision: "7",
  selectedHotbar: 2,
  heldBowDurability: 2,
  arrowCount: 3,
};
const charge: RangedChargeAuthority = {
  active: true,
  startedAt: now - RANGED_FULL_CHARGE_MS,
  lastReleasedAt: 0,
  revision: 4,
};
const attacker = pose("alice");
const playerTarget: RangedAuthorityTarget = {
  kind: "player",
  id: "bob",
  pose: pose("bob", 0, 0, -10),
  combat: defaultPlayerCombatState("bob"),
  armorProtection: 0,
};
const mobTarget: RangedAuthorityTarget = {
  kind: "mob",
  id: "skeleton-5nb-1",
  position: { x: 0, y: 0, z: -10 },
  height: 1.99,
  radius: 0.4,
  combat: defaultMobAuthorityState("skeleton-5nb-1", "skeleton"),
};

// Strict current-only wire protocol. The client has no fields with which to
// supply origin, direction, charge time, range, speed, or damage.
for (const raw of [
  {
    version: 1,
    operationId: "charge_123456789",
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "begin_charge",
  },
  {
    version: 1,
    operationId,
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "cancel_charge",
    beginOperationId: "charge_123456789",
  },
  {
    version: 1,
    operationId,
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "release",
    targetKind: "none",
    targetId: "",
  },
  {
    version: 1,
    operationId,
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "release",
    targetKind: "player",
    targetId: "bob",
  },
  {
    version: 1,
    operationId,
    expectedInventoryRevision: "7",
    selectedHotbar: 2,
    kind: "release",
    targetKind: "mob",
    targetId: "skeleton-5nb-1",
  },
]) {
  const validated = validateRangedCombatRequestJson(JSON.stringify(raw));
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal(validated.request.fingerprint, rangedCombatFingerprint(validated.request));
}

for (const [raw, reason] of [
  ["{", "invalid_json"],
  [JSON.stringify([]), "invalid_shape"],
  [JSON.stringify({ version: 0, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "begin_charge" }), "invalid_version"],
  [JSON.stringify({ version: 1, operationId: "short", expectedInventoryRevision: "7", selectedHotbar: 2, kind: "begin_charge" }), "invalid_operation_id"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "07", selectedHotbar: 2, kind: "begin_charge" }), "invalid_revision"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "9999999999999999", selectedHotbar: 2, kind: "begin_charge" }), "invalid_revision"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 9, kind: "begin_charge" }), "invalid_selected_hotbar"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "cancel_charge", beginOperationId: "short" }), "invalid_shape"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "none", targetId: "bob" }), "invalid_target"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "mob", targetId: "made-up-mob" }), "invalid_target"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "player", targetId: "bob", damage: 100 }), "invalid_shape"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "player", targetId: "bob", origin: [0, 0, 0] }), "invalid_shape"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "player", targetId: "bob", direction: [1, 0, 0] }), "invalid_shape"],
  [JSON.stringify({ version: 1, operationId, expectedInventoryRevision: "7", selectedHotbar: 2, kind: "release", targetKind: "player", targetId: "bob", chargeMs: 1_000, range: 9_999 }), "invalid_shape"],
] as const) {
  const result = validateRangedCombatRequestJson(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}
assert.equal(validateRangedCombatRequestJson("x".repeat(MAX_RANGED_COMBAT_REQUEST_BYTES + 1)).ok, false);

const fullTrajectory = authoritativeRangedTrajectory(attacker, RANGED_FULL_CHARGE_MS);
assert.ok(fullTrajectory);
if (!fullTrajectory) throw new Error("expected authoritative trajectory");
assert.deepEqual(fullTrajectory.origin, { x: 0, y: 1.62, z: 0 });
assert.ok(Math.abs(fullTrajectory.direction.x) < 1e-12);
assert.equal(fullTrajectory.direction.y, 0);
assert.equal(fullTrajectory.direction.z, -1);
assert.equal(fullTrajectory.power, 1);
assert.equal(fullTrajectory.speed, 30);
assert.equal(fullTrajectory.damage, 6);
assert.equal(authoritativeRangedTrajectory({ ...attacker, yaw: Number.NaN }, RANGED_FULL_CHARGE_MS), null);
assert.equal(authoritativeRangedTrajectory(attacker, RANGED_MIN_CHARGE_MS - 1), null);
const halfTrajectory = authoritativeRangedTrajectory(attacker, RANGED_FULL_CHARGE_MS / 2);
assert.ok(halfTrajectory && halfTrajectory.power > 0 && halfTrajectory.power < 1 && halfTrajectory.damage < fullTrajectory.damage);
const point = rangedTrajectoryPoint(fullTrajectory, 0.5);
assert.equal(point.x, 0);
assert.equal(point.z, -15);
assert.ok(Math.abs(point.y - 0.12) < 1e-12);

assert.equal(segmentAabbIntersectionFraction(
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 1, z: -10 },
  { x: -1, y: 0, z: -6 },
  { x: 1, y: 2, z: -5 },
), 0.5);
assert.equal(segmentAabbIntersectionFraction(
  { x: 0, y: 3, z: 0 },
  { x: 0, y: 3, z: -10 },
  { x: -1, y: 0, z: -6 },
  { x: 1, y: 2, z: -5 },
), null);

const voxel = firstOccludingVoxelOnSegment(
  { x: 0.5, y: 1.5, z: 0.5 },
  { x: 0.5, y: 1.5, z: -8.5 },
  (x, y, z) => x === 0 && y === 1 && z === -4,
);
assert.deepEqual(voxel && { x: voxel.x, y: voxel.y, z: voxel.z }, { x: 0, y: 1, z: -4 });
assert.equal(firstOccludingVoxelOnSegment(
  { x: 0.5, y: 1.5, z: 0.5 },
  { x: 8.5, y: 1.5, z: 0.5 },
  () => false,
), null);

const directTrace = traceRangedTrajectory(fullTrajectory, playerTarget);
assert.equal(directTrace.outcome, "hit");
const blockedTrace = traceRangedTrajectory(fullTrajectory, playerTarget, (x, y, z) => x === 0 && y === 1 && z === -5);
assert.equal(blockedTrace.outcome, "occluded");
if (blockedTrace.outcome === "occluded") assert.deepEqual(blockedTrace.voxel, { x: 0, y: 1, z: -5, fraction: blockedTrace.voxel.fraction });
const offAxisTarget: RangedAuthorityTarget = {
  ...playerTarget,
  pose: pose("bob", 5, 0, -10),
};
assert.equal(traceRangedTrajectory(fullTrajectory, offAxisTarget).outcome, "miss");
for (let index = 0; index < 100; index += 1) assert.deepEqual(traceRangedTrajectory(fullTrajectory, playerTarget), directTrace);

const startRequest = validateRangedCombatRequestJson(JSON.stringify({
  version: 1,
  operationId: "charge_123456789",
  expectedInventoryRevision: "7",
  selectedHotbar: 2,
  kind: "begin_charge",
}));
assert.ok(startRequest.ok);
if (!startRequest.ok) throw new Error("expected valid charge request");
const started = resolveRangedChargeStart({
  request: startRequest.request,
  inventory,
  charge: { active: false, startedAt: 0, lastReleasedAt: 0, revision: 0 },
  attackerPresence: attacker,
  attackerAlive: true,
  serverNow: now,
});
assert.ok(started.ok);
if (started.ok) assert.deepEqual(started.charge, { active: true, startedAt: now, lastReleasedAt: 0, revision: 1 });
assert.deepEqual(resolveRangedChargeStart({
  request: releaseRequest(),
  inventory,
  charge: { active: false, startedAt: 0, lastReleasedAt: 0, revision: 0 },
  attackerPresence: attacker,
  attackerAlive: true,
  serverNow: now,
}), { ok: false, reason: "invalid_request_kind" });

const playerHit = resolveRangedRelease({
  request: releaseRequest(),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: playerTarget,
  serverNow: now,
});
assert.ok(playerHit.ok);
if (!playerHit.ok) throw new Error("expected player hit");
assert.equal(playerHit.landed, true);
assert.equal(playerHit.inventory.arrowCount, 2, "one landed shot consumes exactly one arrow");
assert.equal(playerHit.inventory.heldBowDurability, 1, "one landed shot wears the bow exactly once");
assert.equal(playerHit.inventory.revision, "8");
assert.equal(playerHit.targetCombat?.health, 14);
assert.equal(playerHit.targetCombat?.revision, 1);
assert.equal(playerHit.killed, false);

const armoredHit = resolveRangedRelease({
  request: releaseRequest(),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: { ...playerTarget, armorProtection: 20 },
  serverNow: now,
});
assert.ok(armoredHit.ok && armoredHit.targetCombat?.health === 18, "server-derived armor mitigation applies to arrows");

const mobHit = resolveRangedRelease({
  request: releaseRequest({ targetKind: "mob", targetId: "skeleton-5nb-1" }),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory: { ...inventory, heldBowDurability: 1 },
  charge,
  target: mobTarget,
  serverNow: now,
});
assert.ok(mobHit.ok);
if (!mobHit.ok) throw new Error("expected mob hit");
assert.equal(mobHit.landed, true);
assert.equal(mobHit.targetCombat?.health, 14);
assert.equal(mobHit.inventory.arrowCount, 2);
assert.equal(mobHit.inventory.heldBowDurability, null);
assert.equal(mobHit.bowBroken, true);

for (const [request, target, occludes, missReason] of [
  [releaseRequest({ targetKind: "none", targetId: "" }), null, undefined, "no_target"],
  [releaseRequest(), playerTarget, (x: number, y: number, z: number) => x === 0 && y === 1 && z === -5, "occluded"],
  [releaseRequest(), offAxisTarget, undefined, "not_aimed"],
  [releaseRequest(), { ...playerTarget, pose: pose("bob", 0, 0, -(RANGED_MAX_RANGE + 10)) }, undefined, "out_of_range"],
  [releaseRequest(), null, undefined, "target_unavailable"],
  [releaseRequest({ targetId: "alice" }), playerTarget, undefined, "self_target"],
  [releaseRequest(), { ...playerTarget, combat: { ...playerTarget.combat, health: 0, deadUntil: now + 1_000 } }, undefined, "target_dead"],
  [releaseRequest(), { ...playerTarget, pose: pose("mallory", 0, 0, -10) }, undefined, "target_unavailable"],
] as const) {
  const miss = resolveRangedRelease({
    request,
    attackerId: "alice",
    attackerPresence: attacker,
    attackerAlive: true,
    inventory,
    charge,
    target,
    serverNow: now,
    occludes,
  });
  assert.ok(miss.ok);
  if (!miss.ok) throw new Error("expected valid miss");
  assert.equal(miss.landed, false);
  assert.equal(miss.missReason, missReason);
  assert.equal(miss.inventory.arrowCount, 2, "valid misses also consume exactly one arrow");
  assert.equal(miss.inventory.heldBowDurability, 1, "valid misses also wear the bow exactly once");
  assert.equal(miss.targetCombat, undefined);
}

const originalInventory = structuredClone(inventory);
const originalCharge = structuredClone(charge);
for (const [partial, reason] of [
  [{ attackerPresence: null }, "active_presence_required"],
  [{ attackerPresence: pose("mallory") }, "active_presence_required"],
  [{ attackerAlive: false }, "attacker_dead"],
  [{ request: releaseRequest({ expectedInventoryRevision: "6" }) }, "conflict"],
  [{ request: releaseRequest({ selectedHotbar: 1 }) }, "weapon_mismatch"],
  [{ inventory: { ...inventory, heldBowDurability: null } }, "weapon_mismatch"],
  [{ inventory: { ...inventory, arrowCount: 0 } }, "arrows_required"],
  [{ charge: { ...charge, active: false } }, "charge_required"],
  [{ charge: { ...charge, startedAt: now - RANGED_MIN_CHARGE_MS + 1 } }, "charge_too_short"],
  [{ charge: { ...charge, startedAt: now - RANGED_MAX_CHARGE_MS - 1 } }, "charge_expired"],
  [{ charge: { ...charge, lastReleasedAt: now - RANGED_RELEASE_COOLDOWN_MS + 1 } }, "cooldown"],
  [{ charge: { ...charge, startedAt: now + 1 } }, "charge_invalid"],
] as const) {
  const rejected = resolveRangedRelease({
    request: releaseRequest(),
    attackerId: "alice",
    attackerPresence: attacker,
    attackerAlive: true,
    inventory,
    charge,
    target: playerTarget,
    serverNow: now,
    ...partial,
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, reason);
  assert.deepEqual(inventory, originalInventory, "rejected spoof/stale requests cannot consume or mint inventory");
  assert.deepEqual(charge, originalCharge, "rejected requests cannot mutate charge authority");
}

const firstOnce = resolveRangedReleaseIdempotently(null, {
  request: releaseRequest(),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: playerTarget,
  serverNow: now,
});
assert.ok(firstOnce.ok && !firstOnce.replayed);
if (!firstOnce.ok) throw new Error("expected new idempotent shot");
const receiptJson = encodeRangedCombatReceipt(firstOnce.receipt);
assert.deepEqual(decodeRangedCombatReceipt(receiptJson), firstOnce.receipt);
const replay = resolveRangedReleaseIdempotently(receiptJson, {
  request: releaseRequest(),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: playerTarget,
  serverNow: now,
});
assert.ok(replay.ok && replay.replayed);
if (replay.ok) {
  assert.equal(replay.result.inventory.arrowCount, 2, "replay returns the one committed arrow consumption");
  assert.equal(replay.result.inventory.heldBowDurability, 1, "replay returns the one committed bow wear");
  assert.equal(replay.result.targetCombat?.health, 14, "replay does not apply target damage a second time");
}
const reused = resolveRangedReleaseIdempotently(receiptJson, {
  request: releaseRequest({ targetId: "mallory" }),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: playerTarget,
  serverNow: now,
});
assert.deepEqual(reused, { ok: false, reason: "operation_id_reused" });

const mobOnce = resolveRangedReleaseIdempotently(null, {
  request: releaseRequest({ targetKind: "mob", targetId: "skeleton-5nb-1" }),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory: { ...inventory, heldBowDurability: 1 },
  charge,
  target: mobTarget,
  serverNow: now,
});
assert.ok(mobOnce.ok && !mobOnce.replayed);
if (!mobOnce.ok) throw new Error("expected idempotent mob shot");
const mobReplay = resolveRangedReleaseIdempotently(encodeRangedCombatReceipt(mobOnce.receipt), {
  request: releaseRequest({ targetKind: "mob", targetId: "skeleton-5nb-1" }),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory: { ...inventory, heldBowDurability: 1 },
  charge,
  target: mobTarget,
  serverNow: now,
});
assert.ok(mobReplay.ok && mobReplay.replayed);
if (mobReplay.ok) {
  assert.equal(mobReplay.result.inventory.arrowCount, 2);
  assert.equal(mobReplay.result.inventory.heldBowDurability, null);
  assert.equal(mobReplay.result.targetCombat?.health, 14, "mob replay returns one damage transition");
}
assert.deepEqual(resolveRangedReleaseIdempotently("{}", {
  request: releaseRequest(),
  attackerId: "alice",
  attackerPresence: attacker,
  attackerAlive: true,
  inventory,
  charge,
  target: playerTarget,
  serverNow: now,
}), { ok: false, reason: "invalid_receipt" });
for (const invalid of [
  "{}",
  JSON.stringify({ ...firstOnce.receipt, version: 0 }),
  JSON.stringify({ ...firstOnce.receipt, result: { ...firstOnce.result, inventory: { ...firstOnce.result.inventory, arrowCount: -1 } } }),
  JSON.stringify({ ...firstOnce.receipt, result: { ...firstOnce.result, bowBroken: true } }),
  JSON.stringify({ ...firstOnce.receipt, result: { ...firstOnce.result, trajectory: { ...firstOnce.result.trajectory, damage: 100 } } }),
  JSON.stringify({ ...firstOnce.receipt, result: { ...firstOnce.result, targetCombat: { ...firstOnce.result.targetCombat, userId: "mallory" } } }),
  JSON.stringify({ ...firstOnce.receipt, extra: true }),
]) assert.equal(decodeRangedCombatReceipt(invalid), null);

const receiptRows = Array.from({ length: MAX_RANGED_COMBAT_RECEIPTS_PER_USER + 6 }, (_, index) => ({
  id: `receipt-${index}`,
  operationId: `operation-${index}`,
  fingerprint: `fingerprint-${index}`,
  receiptCreatedAt: String(now - index),
}));
const overflow = selectRangedCombatReceiptOverflow(receiptRows, "receipt-new");
assert.equal(overflow.length, 7);
assert.equal(overflow.includes("receipt-new"), false);

// Exhaust the full-charge horizontal boundary cases. A diagonal can cross 13
// 8x8 chunks, so the server's bounded probe allowance must safely cover all
// valid 64-block trajectories without accepting an unbounded read fan-out.
let maximumProbeChunks = 0;
for (let originX = 0; originX < 8; originX += 1) {
  for (let originZ = 0; originZ < 8; originZ += 1) {
    for (let step = 0; step < 720; step += 1) {
      const trajectory = authoritativeRangedTrajectory(
        pose("alice", originX, 20, originZ, (step / 720) * Math.PI * 2, 0),
        RANGED_FULL_CHARGE_MS,
      );
      assert.ok(trajectory);
      const chunks = new Set<string>();
      traceRangedTrajectory(trajectory!, null, (x, _y, z) => {
        chunks.add(worldEditChunkKey(x, z));
        return false;
      });
      maximumProbeChunks = Math.max(maximumProbeChunks, chunks.size);
    }
  }
}
assert.equal(maximumProbeChunks, 13);
assert.ok(maximumProbeChunks <= 16);

// Fixed-step traces are bounded and cheap enough for server-side validation;
// the generous threshold catches accidental unbounded stepping without flakes.
const perfStarted = performance.now();
let performanceHits = 0;
for (let index = 0; index < 5_000; index += 1) {
  if (traceRangedTrajectory(fullTrajectory, playerTarget).outcome === "hit") performanceHits += 1;
}
const perfElapsed = performance.now() - perfStarted;
assert.equal(performanceHits, 5_000);
assert.ok(perfElapsed < 2_000, `5,000 deterministic traces took ${perfElapsed.toFixed(1)}ms`);

console.log(`ranged combat authority tests passed (${perfElapsed.toFixed(1)}ms / 5,000 traces)`);
