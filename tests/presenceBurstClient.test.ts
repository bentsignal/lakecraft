import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.equal(source.includes("heartbeatPlayer"), false,
  "Railway gameplay never publishes motion through Lakebed mutations");
assert.equal(source.includes("publishMotionSegments"), false,
  "the retired Lakebed segment publisher is unreachable from the playable client");
assert.equal(source.includes("multiplayerComposite"), false,
  "the retired Lakebed world composite query is unreachable from the playable client");
assert.equal(source.includes("presenceSampleRef"), false,
  "the local pose loop has no second Lakebed authority sink");
assert.match(source, /<RealtimeMultiplayerTransport/);
assert.match(source, /getPose=\{\(\) => engineRef\.current\?\.getPose\(\) \?\? poseRef\.current\}/);
assert.match(source,
  /onReconcilePose=\{\(pose\) => \{\s*poseRef\.current = pose;\s*engineRef\.current\?\.reconcilePose\(pose\);\s*\}\}/,
  "Railway reconciliation updates both the transport fallback pose and the live engine");
assert.match(source, /const worldConnected = transportReady/);
assert.match(source, /<LobbyBootstrapQuery/,
  "Lakebed remains a bounded lobby/account bootstrap rather than gameplay motion transport");

console.log("Railway-only gameplay motion wiring tests passed");
