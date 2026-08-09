import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isHostedLakebedHostname,
  shouldShowHostedSinglePlayerTitle,
  shouldRunSinglePlayer,
  singlePlayerTitleUrl,
} from "../client/runtimeMode.ts";

for (const hostname of [
  "craft.lakebed.app",
  "quiet-garden-75f6fe48fb.lakebed.app",
  "CRAFT.LAKEBED.APP",
  "craft.lakebed.app.",
  "lakebed.app",
]) {
  assert.equal(isHostedLakebedHostname(hostname), true, `${hostname} is a hosted Lakebed origin`);
  assert.equal(shouldShowHostedSinglePlayerTitle(hostname, ""), false,
    `${hostname} uses the unified title screen`);
  assert.equal(shouldShowHostedSinglePlayerTitle(hostname, "?singleplayer=1"), false,
    `${hostname} explicit single-player route opens the world list`);
  assert.equal(shouldShowHostedSinglePlayerTitle(hostname, "?singleplayer=0"), false,
    `${hostname} no longer has a separate hosted-only title branch`);
  assert.equal(shouldRunSinglePlayer(hostname, ""), false, `${hostname} root exposes the unified Lakecraft title`);
  assert.equal(shouldRunSinglePlayer(hostname, "?multiplayer=1"), false, `${hostname} can open multiplayer`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=0&multiplayer=1"), false,
    `${hostname} stays on the unified title without the explicit single-player route`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=0&singleplayer=1"), false,
    `${hostname} follows URLSearchParams first-value behavior for duplicate route flags`);
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
  assert.equal(shouldShowHostedSinglePlayerTitle(hostname, ""), false,
    `${hostname} does not use the hosted title policy`);
  assert.equal(shouldRunSinglePlayer(hostname, ""), false, `${hostname} keeps the multiplayer development lobby`);
  assert.equal(shouldRunSinglePlayer(hostname, "?singleplayer=1"), true, `${hostname} retains explicit local single-player`);
}

assert.equal(shouldRunSinglePlayer("localhost", "?%73ingleplayer=%31"), true,
  "the local opt-in follows URLSearchParams decoding rather than a fragile substring check");
assert.equal(
  singlePlayerTitleUrl("http://localhost:3000/?singleplayer=1&debug=chunks#world-browser"),
  "http://localhost:3000/?debug=chunks",
  "local Back removes only the route flag plus stale UI hash state",
);
assert.equal(
  singlePlayerTitleUrl("http://localhost:3000/?singleplayer=0&singleplayer=1#delete-world"),
  "http://localhost:3000/",
  "local Back removes duplicate route flags and the hash deterministically",
);

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const appRoute = app.slice(app.indexOf("export function App()"));
assert.ok(appRoute.indexOf("shouldRunSinglePlayer") < appRoute.indexOf("<LakebedMultiplayerApp"),
  "the host policy runs before the Lakebed multiplayer tree can mount");
assert.equal(appRoute.match(/<LakebedMultiplayerApp\b/g)?.length, 1,
  "the unified title has one multiplayer application branch");
assert.doesNotMatch(appRoute, /hostedSinglePlayer|SinglePlayerTitleScreen|setSinglePlayerTitle/,
  "the superseded production multiplayer gate is gone");
assert.ok(appRoute.includes("setSinglePlayer(false);"),
  "Back from local worlds returns to the unified title on every host");

console.log("production unified access policy tests passed");
