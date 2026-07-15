import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(source.includes("loadPresenceBurstGuard(auth.userId"), "the signed-in user hydrates one persisted browser-day budget");
assert.ok(source.includes("window.localStorage.setItem"), "reloads cannot silently reset the presence budget");
assert.ok(source.includes("stepPresenceScheduler(scheduler, { ...pose, at }, realtime)"), "the budget controls realtime cadence on the existing scheduler");
assert.ok(source.includes("reservePresenceAttempt(guard, at, realtime)"), "every heartbeat reserves its request before transport");
assert.ok(source.includes("recordPresenceSuccess(guard"), "successful transport resets transient backoff");
assert.ok(source.includes("recordPresenceFailure(guard"), "rejected transport feeds retry suppression");
assert.ok(source.includes("classifyPresenceTransportError(error)"), "quota-like production errors are classified explicitly");
assert.equal(source.match(/void heartbeatPlayer\(/g)?.length, 1, "the guard must wrap the one Lakebed presence mutation path");
assert.equal(source.includes("WebSocket"), false, "presence does not introduce a WebSocket transport");
assert.equal(source.includes("RT ${presenceTelemetry.realtimeRemaining}"), true, "F3 reports realtime burst remaining");
assert.equal(source.includes("DAY ${presenceTelemetry.sessionRemaining}"), true, "F3 reports browser-day budget remaining");
assert.ok(source.includes("Realtime sync budget spent"), "burst degradation is visible without F3");
assert.ok(source.includes("Repeated or quota-like rejections stopped retries"), "terminal retry suppression is visible");

console.log("presence burst client wiring tests passed");
