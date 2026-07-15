import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../client/MultiplayerSegmentTransport.tsx", import.meta.url), "utf8");

assert.match(app, /authorityLeaseTransportEnabled = true/);
assert.match(app, /<MultiplayerSegmentTransport/);
assert.match(app, /paused=\{!transportForeground \|\| deathScreenOpen \|\| pauseOpen \|\| inventoryOpen \|\| chatOpen/);
assert.match(app, /motionActionSinkRef\.current\?\.\("jump"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("swing"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("slot", selectedHotbar\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("bow_draw"\)/);
assert.match(app, /motionActionSinkRef\.current\?\.\("bow_release"\)/);
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

console.log("multiplayer segment client integration: old heartbeat fenced, transport gates/actions/API wired");
