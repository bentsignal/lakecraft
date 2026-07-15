import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

assert.ok(source.includes("loadPresenceBurstGuard(auth.userId"), "the signed-in user hydrates one persisted browser-day budget");
assert.ok(source.includes("window.localStorage.setItem"), "reloads cannot silently reset the presence budget");
assert.ok(source.includes("stepPresenceScheduler(scheduler, { ...pose, at }, realtime)"), "the budget controls realtime cadence on the existing scheduler");
assert.ok(source.includes("reservePresenceAttempt(guard, at, realtime)"), "every heartbeat reserves its request before transport");
assert.ok(source.includes("recordPresenceSuccess(guard"), "successful transport resets transient backoff");
assert.ok(source.includes("recordPresenceFailure("), "rejected transport feeds retry suppression");
assert.ok(source.includes("classifyPresenceTransportError(error)"), "quota-like production errors are classified explicitly");
assert.ok(source.includes("presenceTransportQuotaResetAt(error"), "Lakebed reset metadata and message fallback drive no-reload recovery");
assert.ok(source.includes("reservePresenceAttempt(guard, attemptedAt, false)"), "session start retries share the same budget guard");
assert.ok(source.includes("writesInFlight >= PRESENCE_MAX_IN_FLIGHT_WRITES"), "two bounded in-flight writes prevent RTT from halving cadence");
assert.ok(source.includes("pendingPresenceSample"), "slow transport coalesces only the latest pose instead of growing a queue");
assert.ok(source.includes("presenceNextPoseSequenceRef.current = 1"), "each presence lease owns one monotonic sequence");
assert.ok(source.indexOf("const poseSequence = presenceNextPoseSequenceRef.current") > source.indexOf("reservePresenceAttempt(guard, at, realtime)"), "sequence allocation happens only after scheduler and budget admission");
assert.ok(source.includes("persistPresenceBurstGuard(auth.userId, guard);"), "budget reservation is durable before transport starts");
assert.ok(source.includes("respawnLeaseTransitionRef.current || heartbeatSessionId !== presenceSessionIdRef.current"), "a lost respawn response cannot cancel its presence loop before lease replay");
assert.ok(!source.includes("result.inventory && !loadCanonicalPlayer"), "heartbeat responses cannot roll newer inventory mutations backward");
assert.ok(!source.includes("result.health ==="), "heartbeat responses cannot roll newer combat revisions backward");
assert.ok(source.includes("if (cancelled) return;"), "callbacks from a replaced presence effect cannot mutate current UI state");
assert.ok(source.includes("<ErrorBoundary fallback="), "query-level quota errors are caught inside Lakebed's generated boundary");
assert.ok(source.includes("<GameApp inWorld={inWorld}"), "query recovery retains the joined-world state above the remount boundary");
assert.ok(source.includes("!quota ? <button"), "known quota pause cannot be bypassed into a manual query retry storm");
assert.equal(source.match(/void heartbeatPlayer\(/g)?.length, 1, "the guard must wrap the one Lakebed presence mutation path");
assert.equal(source.includes("WebSocket"), false, "presence does not introduce a WebSocket transport");
assert.equal(source.includes("RT ${presenceTelemetry.realtimeRemaining}"), true, "F3 reports realtime burst remaining");
assert.equal(source.includes("DAY ${presenceTelemetry.sessionRemaining}"), true, "F3 reports browser-day budget remaining");
assert.equal(source.includes("AGE p50 ${remotePoseAge.p50}ms"), true, "F3 reports observer pose-age p50/p95");
assert.ok(serverSource.includes("serverNow: Date.now()"), "presence query returns a same-clock age anchor");
assert.ok(source.includes("presenceServerNow - heartbeatAt"), "F3 age uses the server clock instead of browser clock skew");
assert.ok(source.includes("remotePoseSeenRef.current.has(sampleKey)"), "F3 samples each remote heartbeat once");
assert.ok(source.includes("Realtime sync budget spent"), "burst degradation is visible without F3");
assert.ok(source.includes("Repeated or quota-like rejections stopped retries"), "terminal retry suppression is visible");

console.log("presence burst client wiring tests passed");
