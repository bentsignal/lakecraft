import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isHostedLakebedHostname,
  shouldRunSinglePlayer,
} from "../client/runtimeMode.ts";

for (const hostname of [
  "craft.lakebed.app",
  "quiet-garden-75f6fe48fb.lakebed.app",
  "CRAFT.LAKEBED.APP",
  "craft.lakebed.app.",
  "lakebed.app",
]) {
  assert.equal(isHostedLakebedHostname(hostname), true, `${hostname} is a hosted Lakebed origin`);
  assert.equal(shouldRunSinglePlayer(hostname, ""), true, `${hostname} root is single-player-only`);
  assert.equal(shouldRunSinglePlayer(hostname, "?multiplayer=1"), true, `${hostname} cannot opt into multiplayer`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=0&multiplayer=1"), true,
    `${hostname} cannot override the production gate with query parameters`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=0&singleplayer=1"), true,
    `${hostname} cannot bypass the production gate with duplicate parameters`);
}

for (const hostname of [
  "localhost",
  "127.0.0.1",
  "::1",
  "craftlakebed.app",
  "craft.lakebed.app.evil.example",
  "lakebed.application",
]) {
  assert.equal(isHostedLakebedHostname(hostname), false, `${hostname} is not a hosted Lakebed origin`);
  assert.equal(shouldRunSinglePlayer(hostname, ""), false, `${hostname} keeps the multiplayer development lobby`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=1"), true, `${hostname} retains explicit local single-player`);
}

assert.equal(shouldRunSinglePlayer("localhost", "?%73ingleplayer=%31"), true,
  "the local opt-in follows URLSearchParams decoding rather than a fragile substring check");

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const appRoute = app.slice(app.indexOf("export function App()"));
assert.ok(appRoute.indexOf("shouldRunSinglePlayer") < appRoute.indexOf("<LakebedMultiplayerApp"),
  "the host policy runs before the Lakebed multiplayer tree can mount");
assert.equal(appRoute.match(/<LakebedMultiplayerApp\b/g)?.length, 1,
  "multiplayer remains implemented behind one unreachable hosted branch");

console.log("production single-player access policy tests passed");
