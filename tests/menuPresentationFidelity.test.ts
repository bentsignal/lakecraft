import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MINECRAFT_DIRT_TEXTURE_DATA_URI } from "../client/menuPresentation.ts";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const lobby = source("../client/lobby/LobbyScreen.tsx");
const lobbyStyles = source("../client/lobby/LobbyStyles.tsx");
const options = source("../client/components/OptionsDialog.tsx");
const loading = source("../client/components/WorldLoadingScreen.tsx");
const gameplaySurface = source("../client/gameplay/GameplaySessionSurface.tsx");
const localWorlds = source("../client/singleplayer/LocalWorldBrowser.tsx");
const titlePanorama = source("../client/lobby/TitlePanorama.tsx");
const app = source("../client/index.tsx");

const encodedDirt = MINECRAFT_DIRT_TEXTURE_DATA_URI.split(",", 2)[1];
assert.ok(encodedDirt, "the embedded dirt texture has a data payload");
assert.equal(
  createHash("sha256").update(Buffer.from(encodedDirt, "base64")).digest("hex"),
  "67197d5371efc3ca1638217c38349665dbd5a977b47bfb20075c858dff87d510",
  "menu dirt stays byte-identical to the owner's installed Java 26.2 dirt.png",
);

assert.ok(lobbyStyles.includes("MINECRAFT_DIRT_BACKGROUND_CSS") && lobbyStyles.includes(".lc-dirt-background"),
  "single-player and multiplayer browsers share the exact embedded dirt field");
assert.ok(localWorlds.includes('<div className="lc-dirt-background"'), "the local-world browser uses the shared dirt field");
assert.ok(options.includes("MINECRAFT_DIRT_BACKGROUND_CSS") && !options.includes("background:rgba(0,0,0,.66)"),
  "Options is a full dirt-backed menu instead of a translucent title/world overlay");
assert.ok(options.includes("grid-template-columns:300px minmax(0,1fr)") && options.includes("min-width:0;width:100%"),
  "range tracks reserve a fixed label column and may shrink without overlapping values");
assert.ok(options.includes("@media(max-width:560px)") && options.includes("grid-template-columns:minmax(0,1fr)"),
  "range controls stack cleanly at narrow widths");

assert.ok(loading.includes("@keyframes lc-world-loading__block-animation") && loading.includes("steps(2,end)"),
  "loading presents visible block-stepped motion");
assert.ok(loading.includes("prefers-reduced-motion:reduce"), "loading motion has a stable reduced-motion state");
assert.ok(gameplaySurface.includes("!ready ? <WorldLoadingScreen />"),
  "single-player and multiplayer terrain preparation share the themed loading screen");
assert.ok(lobby.includes("if (joining)") && lobby.includes("<WorldLoadingScreen detail={detail} />"),
  "multiplayer connection phases use the same themed loading screen");

assert.ok(lobby.includes("<TitlePanorama />") && titlePanorama.includes("createTitlePanoramaRenderer"),
  "the current WebGL title panorama remains the home screen behind normal title actions");
assert.equal(app.includes("MULTIPLAYER ALPHA"), false, "the obsolete multiplayer alpha build label is removed");
assert.equal(lobby.includes("props.buildLabel"), false, "footer rendering cannot append a build label");
assert.ok((lobby.match(/<span>Lakecraft<\/span>/g) ?? []).length >= 2, "home and multiplayer footers say Lakecraft exactly");
assert.ok(localWorlds.includes('<span>Lakecraft</span><span>Local worlds</span>'), "single-player title footer says Lakecraft exactly");

console.log("current-head authentic dirt menu and loading presentation tests passed");
