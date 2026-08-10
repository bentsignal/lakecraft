import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../client/MultiplayerSegmentTransport.tsx", import.meta.url), "utf8");

assert.match(app, /RealtimeMultiplayerTransport,/);
assert.match(app, /<RealtimeMultiplayerTransport/);
assert.doesNotMatch(app, /<MultiplayerSegmentTransport/,
  "the retired Lakebed motion transport is no longer reachable from the production client");
assert.match(app, /registerBlockSink=\{\(sink\) => \{ realtimeBlockSinkRef\.current = sink; \}\}/);
assert.match(app, /onReconcilePose=\{\(pose\) => engineRef\.current\?\.reconcilePose\(pose\)\}/);
assert.match(app, /LAKEBED_COMPACT_RETIRED_PRESENCE_START/);
assert.match(app, /const multiplayerPaused = multiplayerGameplayPaused\(\{/);
assert.match(app, /motionActionSinkRef\.current\?\.\("jump"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("swing"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("slot", selectedHotbar\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("bow_draw"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("bow_release"\)/);
assert.match(app, /registerActionSink=\{\(sink\) => \{ motionActionSinkRef\.current = sink; \}\}/,
  "the mounted Railway transport receives local visual actions");
assert.match(app, /getHeldItem=\{\(\) => inventoryRef\.current\[selectedRef\.current\]\?\.itemId \?\? null\}/,
  "the Railway input wire publishes the canonical selected item id");
assert.match(transport, /useMutation<\[requestJson: string\].*\("publishMotionSegments"\)/);
assert.match(transport, /useQuery<MultiplayerCompositeResult, string>\("multiplayerComposite"/);
assert.match(transport, /onMobWorldAuthority\(composite\.mobWorld\)/);
assert.match(transport, /createCompositeRequest\(replay\.known\(\), now, mobIds\)/);
assert.equal(app.includes('useQuery<RecentPlayersResult, string>\("recentPlayers"'), false);
assert.match(transport, /Pending batch is deliberately retained/);
assert.match(transport, /document\.visibilityState === "visible"/);
assert.match(transport, /!queryInFlightRef\.current && now - lastCompositeAdvanceRef\.current >= compositeInterval/);
assert.match(transport, /queryInFlightRef\.current = true/);
assert.match(transport, /queryInFlightRef\.current = false/);
assert.match(transport, /visualActions: player\.actions/);

console.log("multiplayer transport integration: Railway realtime is mounted and retired Lakebed motion is fenced");
