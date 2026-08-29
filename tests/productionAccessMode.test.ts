import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTH_CALLBACK_PATH,
  appRouteForLocation,
  isHostedLakebedHostname,
  multiplayerUrl,
  shouldShowHostedSinglePlayerTitle,
  shouldRunMultiplayer,
  shouldRunSinglePlayer,
  singlePlayerTitleUrl,
  titleUrl,
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
assert.equal(shouldRunMultiplayer("?multiplayer=1"), true, "the multiplayer directory has a stable route");
assert.equal(shouldRunMultiplayer(""), false, "the title route does not mount multiplayer");
assert.equal(appRouteForLocation("craft.lakebed.app", "/", ""), "title");
assert.equal(appRouteForLocation("craft.lakebed.app", "/", "?multiplayer=1"), "multiplayer");
assert.equal(appRouteForLocation("craft.lakebed.app", AUTH_CALLBACK_PATH, "?code=oauth-code&state=oauth-state"), "auth_callback",
  "the Lakebed callback always mounts auth so it can exchange the Google code");
assert.equal(appRouteForLocation("craft.lakebed.app", AUTH_CALLBACK_PATH, "?singleplayer=1"), "auth_callback",
  "the callback path wins over stale game-mode query flags");
assert.equal(appRouteForLocation("craft.lakebed.app", "/", "?singleplayer=1&multiplayer=1"), "singleplayer",
  "the explicit local-world route wins over a stale multiplayer flag");
assert.equal(
  multiplayerUrl("https://craft.lakebed.app/?debug=chunks&singleplayer=1#old"),
  "https://craft.lakebed.app/?debug=chunks&multiplayer=1",
  "opening multiplayer changes the path without discarding unrelated local flags",
);
assert.equal(
  titleUrl("https://craft.lakebed.app/?debug=chunks&multiplayer=1#old"),
  "https://craft.lakebed.app/?debug=chunks",
  "leaving multiplayer restores the clean title path",
);
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
assert.ok(app.includes("appRouteForLocation(window.location.hostname, window.location.pathname, window.location.search)"),
  "routing resolves before the Lakebed multiplayer tree can mount");
assert.equal(appRoute.match(/<LakebedMultiplayerApp\b/g)?.length, 2,
  "only multiplayer and its OAuth callback mount the Lakebed application tree");
assert.ok(appRoute.includes('if (route === "auth_callback") return <LakebedMultiplayerApp'),
  "the OAuth callback mounts Lakebed auth before the auth-free title fallback");
assert.ok(appRoute.includes('if (route === "multiplayer") return <LakebedMultiplayerApp'),
  "Lakebed auth mounts only for the multiplayer route");
assert.ok(app.includes("callbackPath: AUTH_CALLBACK_PATH")
  && app.includes("returnTo: multiplayerUrl(window.location.href)"),
  "Google sign-in has an explicit callback and returns to the multiplayer route");
assert.ok(appRoute.includes("return <LakecraftTitleScreen"),
  "the root fallback is an auth-free title tree");
assert.ok(appRoute.includes('window.addEventListener("popstate", syncRoute)'),
  "browser Back and Forward keep the visible screen in sync with the URL");
assert.doesNotMatch(appRoute, /hostedSinglePlayer|SinglePlayerTitleScreen|setSinglePlayerTitle/,
  "the superseded production multiplayer gate is gone");
assert.ok(appRoute.includes('setRoute("title");'),
  "Back from local worlds returns to the unified title on every host");

console.log("production unified access policy tests passed");
