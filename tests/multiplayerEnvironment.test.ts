import assert from "node:assert/strict";
import { permitsMultiplayerEndpoint } from "../client/multiplayerEnvironment.ts";

for (const host of ["lakecraft-production.up.railway.app", "lakecraft-creative-production.up.railway.app"]) {
  assert.equal(permitsMultiplayerEndpoint("https://craft.lakebed.app", `wss://${host}/ws`), true);
  for (const origin of ["https://review.lakebed.app", "http://localhost:3010", "https://craft.lakebed.app.evil.test"]) {
    assert.equal(permitsMultiplayerEndpoint(origin, `wss://${host}/ws`), false);
  }
}
assert.equal(permitsMultiplayerEndpoint("https://review.lakebed.app", "wss://world-development.up.railway.app/ws"), true);
assert.equal(permitsMultiplayerEndpoint("https://review.lakebed.app", "wss://secret@example.test/ws"), false);
