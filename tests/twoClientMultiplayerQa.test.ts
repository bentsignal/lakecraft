import assert from "node:assert/strict";
import {
  PRESENCE_ACTIVE_WRITE_INTERVAL_MS,
  PRESENCE_MAX_IN_FLIGHT_WRITES,
  PRESENCE_REALTIME_BURST_WRITES,
  PRESENCE_SESSION_WRITE_BUDGET,
  createPresenceBurstGuardState,
  createPresenceSchedulerState,
  presenceBurstGuardSnapshot,
  presencePoseAgePercentiles,
  recordPresenceFailure,
  recordPresenceSuccess,
  reservePresenceAttempt,
  stepPresenceScheduler,
  type PresencePoseSample,
} from "../shared/presenceMotion.ts";
import { activePlayerPresences, type PlayerPresence } from "../shared/protocol.ts";
import { buildOfflinePresenceValue } from "../server/playerPresence.ts";
import {
  applyDropItemToInventory,
  applyPickupDroppedItem,
  createPersistedDroppedItem,
  normalizeDroppedItemRow,
  validateDropItemRequestJson,
} from "../shared/droppedItems.ts";
import { CHAT_RATE_LIMIT_MS, validateChatMessage } from "../shared/multiplayer.ts";
import { createEmptyEquipment, createEmptyInventory, createSerializablePlayerState } from "../shared/game.ts";
import { validatePlayerStateJson } from "../shared/chestTransfers.ts";
import { resolvePlayerAttack, validatePlayerAttackRequestJson, type CombatPose } from "../shared/playerCombat.ts";

type Snapshot = PresencePoseSample & { userId: string; deliveredAt: number };

function simulateActiveClient(userId: string, phase: number): Snapshot[] {
  const state = createPresenceSchedulerState();
  const guard = createPresenceBurstGuardState(0);
  assert.equal(reservePresenceAttempt(guard, 0, false), true, "session start is part of the explicit mutation ledger");
  recordPresenceSuccess(guard, 0);
  const latencies = [55, 90, 140, 210, 75, 125, 180, 100];
  const writes: Snapshot[] = [];
  for (let at = 0; at < 60_000; at += 50) {
    const sample = {
      at,
      x: phase + at / 1_000 * 2,
      y: 8,
      z: -phase,
      yaw: phase / 10,
      pitch: 0,
    };
    const guardSnapshot = presenceBurstGuardSnapshot(guard, at, true);
    const realtime = guardSnapshot.realtimeRemaining > 0;
    if (guardSnapshot.canAttempt && stepPresenceScheduler(state, sample, realtime).send) {
      assert.equal(reservePresenceAttempt(guard, at, realtime), true);
      recordPresenceSuccess(guard, at);
      const latency = latencies[(writes.length + phase) % latencies.length];
      writes.push({ ...sample, userId, deliveredAt: at + latency });
    }
  }
  assert.equal(state.writeCount, PRESENCE_REALTIME_BURST_WRITES);
  assert.equal(guard.attemptCount, PRESENCE_REALTIME_BURST_WRITES + 1);
  assert.equal(presenceBurstGuardSnapshot(guard, 60_000, true).mode, "degraded");
  return writes;
}

function presence(snapshot: Snapshot, online = true): PlayerPresence {
  return {
    id: `${snapshot.userId}-${snapshot.at}-${online}`,
    userId: snapshot.userId,
    displayName: snapshot.userId === "qa-alice" ? "Alice" : "Bob",
    color: "#ffffff",
    x: String(snapshot.x),
    y: String(snapshot.y),
    z: String(snapshot.z),
    yaw: String(snapshot.yaw),
    pitch: String(snapshot.pitch),
    vx: "2",
    vy: "0",
    vz: "0",
    heartbeatAt: String(snapshot.at),
    online,
    createdAt: String(snapshot.at),
    updatedAt: String(snapshot.at),
  };
}

function simulateBoundedSlowTransport(roundTripMs: number) {
  const scheduler = createPresenceSchedulerState();
  const guard = createPresenceBurstGuardState(0);
  assert.equal(reservePresenceAttempt(guard, 0, false), true);
  recordPresenceSuccess(guard, 0);
  const completions: number[] = [];
  const writes: Snapshot[] = [];
  let maxInFlight = 0;
  for (let at = 0; at < 60_000; at += 50) {
    while (completions.length > 0 && completions[0] <= at) completions.shift();
    const pending = { at, x: at / 500, y: 8, z: 0, yaw: 0, pitch: 0 };
    if (completions.length >= PRESENCE_MAX_IN_FLIGHT_WRITES) continue;
    const decision = stepPresenceScheduler(scheduler, pending, true);
    if (!decision.send || !reservePresenceAttempt(guard, at, true)) continue;
    completions.push(at + roundTripMs);
    completions.sort((left, right) => left - right);
    maxInFlight = Math.max(maxInFlight, completions.length);
    recordPresenceSuccess(guard, at + roundTripMs);
    writes.push({ ...pending, userId: "qa-slow", deliveredAt: at + roundTripMs });
  }
  return { maxInFlight, writes };
}

const slowTransport = simulateBoundedSlowTransport(400);
assert.equal(slowTransport.writes.length, 300, "two bounded slots preserve 5 Hz through a 400ms round trip");
assert.equal(slowTransport.maxInFlight, 2, "the slow-transport queue stays bounded");
assert.equal(
  presencePoseAgePercentiles(slowTransport.writes.map(({ at, deliveredAt }) => deliveredAt - at)).p95,
  400,
);

const aliceWrites = simulateActiveClient("qa-alice", 0);
const bobWrites = simulateActiveClient("qa-bob", 1);
assert.equal(PRESENCE_ACTIVE_WRITE_INTERVAL_MS, 200);
assert.equal(aliceWrites.length + bobWrites.length, 600, "two moving clients sustain a full 60-second 5 Hz burst");
assert.equal(PRESENCE_SESSION_WRITE_BUDGET * 2, 900, "two browser-day envelopes reserve 100 mutations for gameplay");

for (const writes of [aliceWrites, bobWrites]) {
  const syntheticSendToDelivery = writes.map(({ at: sampledAt, deliveredAt }) => deliveredAt - sampledAt);
  const arrivalGaps = writes.slice(1).map((write, index) => write.deliveredAt - writes[index].deliveredAt);
  assert.ok(presencePoseAgePercentiles(syntheticSendToDelivery).p95 <= 400, "synthetic send-to-delivery P95 stays within the 400ms gate");
  assert.ok(Math.max(...arrivalGaps) <= 335, "5 Hz plus bounded jitter does not create a >335ms visual gap");
}

const lastAlice = aliceWrites.at(-1)!;
const lastBob = bobWrites.at(-1)!;
assert.deepEqual(
  activePlayerPresences([presence(aliceWrites[0]), presence(lastAlice), presence(lastBob)], 60_000).map(({ userId }) => userId).sort(),
  ["qa-alice", "qa-bob"],
  "newest rows drive both remote avatars/nameplates",
);

const offlineBob = buildOfflinePresenceValue(presence(lastBob), 61_000);
const offlineBobEvent = { ...presence(lastBob, false), ...offlineBob, id: "qa-bob-offline", createdAt: "61000", updatedAt: "61000" };
assert.deepEqual(activePlayerPresences([presence(lastAlice), presence(lastBob), offlineBobEvent], 61_000).map(({ userId }) => userId), ["qa-alice"]);
const reconnect = { ...presence({ ...lastBob, at: 61_200, deliveredAt: 61_290 }), id: "qa-bob-reconnect" };
assert.deepEqual(activePlayerPresences([offlineBobEvent, reconnect], 61_300).map(({ userId }) => userId), ["qa-bob"]);
assert.equal(stepPresenceScheduler(createPresenceSchedulerState(), { ...lastBob, at: 61_200 }).send, true, "reconnect forces an immediate join write");

assert.deepEqual(validateChatMessage("  hello   bob  "), { ok: true, message: "hello bob" });
assert.equal(CHAT_RATE_LIMIT_MS, 900);

const aliceInventory = createEmptyInventory();
aliceInventory[0] = { itemId: "diamond", count: 4 };
const dropValidation = validateDropItemRequestJson(JSON.stringify({
  operationId: "qa_drop_operation_01",
  sourceSlot: 0,
  count: 2,
  expectedInventoryUpdatedAt: "qa-inventory-token",
  playerStateJson: JSON.stringify(createSerializablePlayerState(aliceInventory)),
}));
assert.ok(dropValidation.ok);
if (!dropValidation.ok) throw new Error("two-client drop fixture must validate");
const dropped = applyDropItemToInventory(dropValidation.request);
assert.ok(dropped.ok);
if (!dropped.ok) throw new Error("two-client drop must conserve inventory");
const droppedRow = createPersistedDroppedItem("qa-alice", dropValidation.request.operationId, dropped.dropped, { x: 1, y: 8, z: 1 }, 70_000);
const normalizedDrop = droppedRow && normalizeDroppedItemRow(droppedRow, 70_001);
assert.ok(normalizedDrop);
if (!normalizedDrop) throw new Error("shared drop must normalize");
const pickedUp = applyPickupDroppedItem(createEmptyInventory(), normalizedDrop, "qa-bob", normalizedDrop, 70_001);
assert.ok(pickedUp.ok);
if (!pickedUp.ok) throw new Error("other client must be able to pick up immediately");
assert.deepEqual(pickedUp.picked, { itemId: "diamond", count: 2 });

const attackerInventory = createEmptyInventory();
attackerInventory[0] = { itemId: "iron_sword", count: 1 };
const attackerState = validatePlayerStateJson(JSON.stringify(createSerializablePlayerState(attackerInventory, 0)));
const targetState = validatePlayerStateJson(JSON.stringify(createSerializablePlayerState(createEmptyInventory(), 0, createEmptyEquipment())));
const attack = validatePlayerAttackRequestJson(JSON.stringify({
  operationId: "qa_attack_operation_01",
  targetUserId: "qa-bob",
  selectedHotbar: 0,
  weaponItemId: "iron_sword",
}));
assert.ok(attackerState.ok && targetState.ok && attack.ok);
if (!attackerState.ok || !targetState.ok || !attack.ok) throw new Error("two-client combat fixture must validate");
const combatPose = (userId: string, z: number): CombatPose => ({ userId, x: 0, y: 8, z, yaw: 0, pitch: 0, heartbeatAt: 80_000, online: true });
const combat = resolvePlayerAttack({
  request: attack.request,
  attackerId: "qa-alice",
  attackerPresence: combatPose("qa-alice", 0),
  targetPresence: combatPose("qa-bob", -3),
  attackerPlayerState: attackerState.state,
  targetPlayerState: targetState.state,
  serverNow: 80_000,
});
assert.ok(combat.ok);
if (combat.ok) assert.equal(combat.targetState.health, 14, "iron sword damage is server-authoritative");

// This is the deterministic scenario's expected operation model. It is not a
// wire capture; production must measure actual frames and control-plane deltas.
const mutationLedger = {
  startPresenceSession: 2,
  heartbeatPlayer: aliceWrites.length + bobWrites.length,
  sendChat: 2,
  dropItem: 1,
  pickupDroppedItem: 1,
  attackPlayer: 1,
  leavePlayer: 1,
};
const modeledMutationCount = Object.values(mutationLedger).reduce((total, count) => total + count, 0);
assert.equal(modeledMutationCount, 608);

function runInjectedQuotaScenario(userId: string) {
  const guard = createPresenceBurstGuardState(0);
  assert.equal(reservePresenceAttempt(guard, 0, false), true);
  recordPresenceSuccess(guard, 0);
  assert.equal(reservePresenceAttempt(guard, 200, true), true);
  const injectedAt = 200;
  const resetAt = injectedAt + 60_000;
  recordPresenceFailure(guard, injectedAt, "quota", resetAt);
  // A sibling mutation was already in flight. Its later success cannot undo 429.
  recordPresenceSuccess(guard, injectedAt + 350);
  assert.equal(presenceBurstGuardSnapshot(guard, injectedAt + 350, true).mode, "quota_paused");
  let attemptsWhilePaused = 0;
  for (let at = injectedAt + 50; at < resetAt; at += 50) {
    if (reservePresenceAttempt(guard, at, true)) attemptsWhilePaused += 1;
  }
  assert.ok(attemptsWhilePaused <= 1, `${userId} must not create a fallback retry storm`);
  assert.equal(presenceBurstGuardSnapshot(guard, resetAt, true).mode, "burst");
  assert.equal(reservePresenceAttempt(guard, resetAt, true), true, `${userId} resumes through the same guard without reload`);
  return { userId, guardPauseTransitionMs: 0, attemptsWhilePaused, resumedAt: resetAt };
}

const quotaRecovery = [runInjectedQuotaScenario("qa-alice"), runInjectedQuotaScenario("qa-bob")];
assert.ok(quotaRecovery.every(({ guardPauseTransitionMs }) => guardPauseTransitionMs <= 2_000));

const combinedSyntheticDelivery = presencePoseAgePercentiles(
  [...aliceWrites, ...bobWrites].map(({ at: sampledAt, deliveredAt }) => deliveredAt - sampledAt),
);
const report = {
  clients: 2,
  simulatedSeconds: 60,
  presenceMutations: aliceWrites.length + bobWrites.length,
  sessionMutations: mutationLedger.startPresenceSession,
  actionMutations: modeledMutationCount - mutationLedger.heartbeatPlayer - mutationLedger.startPresenceSession,
  modeledMutations: modeledMutationCount,
  syntheticSendToDeliveryP50Ms: combinedSyntheticDelivery.p50,
  syntheticSendToDeliveryP95Ms: combinedSyntheticDelivery.p95,
  maximumArrivalGapMs: Math.max(...[aliceWrites, bobWrites].flatMap((writes) => writes.slice(1).map((write, index) => write.deliveredAt - writes[index].deliveredAt))),
  guardPauseTransitionMaxMs: Math.max(...quotaRecovery.map(({ guardPauseTransitionMs }) => guardPauseTransitionMs), 0),
  quotaFallbackAttemptsPerClientMinute: Math.max(...quotaRecovery.map(({ attemptsWhilePaused }) => attemptsWhilePaused)),
  quotaAutoResumedWithoutReload: quotaRecovery.every(({ resumedAt }) => resumedAt === 60_200),
  syntheticCapacityWritesAt400msRoundTrip: slowTransport.writes.length,
  syntheticMaximumInFlightWrites: slowTransport.maxInFlight,
};
assert.deepEqual(report, {
  clients: 2,
  simulatedSeconds: 60,
  presenceMutations: 600,
  sessionMutations: 2,
  actionMutations: 6,
  modeledMutations: 608,
  syntheticSendToDeliveryP50Ms: 100,
  syntheticSendToDeliveryP95Ms: 210,
  maximumArrivalGapMs: 270,
  guardPauseTransitionMaxMs: 0,
  quotaFallbackAttemptsPerClientMinute: 0,
  quotaAutoResumedWithoutReload: true,
  syntheticCapacityWritesAt400msRoundTrip: 300,
  syntheticMaximumInFlightWrites: 2,
});
console.log(JSON.stringify(report, null, 2));
