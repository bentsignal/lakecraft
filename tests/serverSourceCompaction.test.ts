import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

assert.match(server, /function signedIn\(ctx:[\s\S]*?return ctx\.auth\.isAuthenticated && !ctx\.auth\.isGuest;\n\}/);
assert.equal((server.match(/signedIn\(ctx\)/g) ?? []).length, 31, "every authority gate uses the shared exact predicate");
assert.equal((server.match(/!ctx\.auth\.isAuthenticated \|\| ctx\.auth\.isGuest/g) ?? []).length, 0);

assert.match(server, /function failure\(reason: string\) \{\n  return \{ ok: false as const, reason \};\n\}/);
assert.match(server, /function failureAt\(reason: string, serverNow: number\) \{\n  return \{ ok: false as const, reason, serverNow \};\n\}/);
assert.equal((server.match(/return \{ ok: false, reason \};/g) ?? []).length, 0, "two-key failures stay centralized");
assert.equal((server.match(/return \{ ok: false, reason, serverNow \};/g) ?? []).length, 0, "timestamped failures stay centralized");

assert.match(server, /function userOperationReceiptTable\(\)[\s\S]*?\.index\(BS\.byUserOperation, \[BS\.userId, BS\.operationId\]\)[\s\S]*?\.index\(BS\.byUserCreated, \[BS\.userId, BS\.receiptCreatedAt\]\);/);
assert.equal((server.match(/userOperationReceiptTable\(\)/g) ?? []).length, 10, "nine user receipt tables plus the factory remain");
assert.match(server, /function globalEventReceiptTable\(\)[\s\S]*?\.index\("by_event", \["eventId"\]\)[\s\S]*?\.index\("by_created", \[BS\.receiptCreatedAt\]\);/);
assert.equal((server.match(/globalEventReceiptTable\(\)/g) ?? []).length, 3, "two event receipt tables plus the factory remain");

assert.equal((server.match(/activePlayerTarget\(/g) ?? []).length, 5, "four target decoders plus the helper remain");
assert.equal((server.match(/activePlayerTarget\([^\n]*true\)/g) ?? []).length, 1, "only the original fuse path permits future heartbeats");
assert.match(server, /allowFuture \|\| heartbeatAt <= serverNow \+ 5_000/);
assert.match(server, /serverNow - heartbeatAt >= 0 && serverNow - heartbeatAt <= ACTIVE_PLAYER_WINDOW_MS/);

for (const helper of ["newestUserRows", "newestCoordRows", "newestMobRows", "newestAuthorityRows", "activePresenceRows", "newestOperationRows"]) {
  assert.ok(server.includes(`function ${helper}<Row>`), `missing typed descending-index helper: ${helper}`);
}

console.log("server source compaction invariants: ok");
