import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");

assert.ok(app.includes("shouldRunSinglePlayer(window.location.hostname, window.location.search)"),
  "the route must apply the tested host policy before choosing an app tree");
assert.ok(app.includes("? <SinglePlayerApp onExit={leaveSingleplayer} />\n    : <LakebedMultiplayerApp onJoinSingleplayer={joinSingleplayer} />"),
  "the route must choose exactly one app tree");
assert.equal(app.includes("requestDocumentPointerLockHandoff"), false,
  "entering the world browser does not transiently capture the pointer before Play");
assert.equal(singleplayer.includes("lakebed/client"), false, "single-player must not import the Lakebed client runtime");
assert.equal(singleplayer.includes("useQuery"), false, "single-player must not issue Lakebed queries");
assert.equal(singleplayer.includes("useMutation"), false, "single-player must not issue Lakebed mutations");
assert.ok(singleplayer.includes("saveSinglePlayerSnapshot(storage"), "single-player state should persist through the verified browser journal");
assert.ok(singleplayer.includes("loadSinglePlayerSave(storage"), "single-player should restore the browser-local world before engine startup");
assert.ok(singleplayer.includes("createVoxelEngine"), "single-player uses the real voxel engine");
assert.ok(singleplayer.includes("const [pauseOpen, setPauseOpen] = useState(SINGLE_PLAYER_INITIAL_PAUSE_OPEN)"), "single-player enters the world without opening the pause menu");
assert.ok(singleplayer.includes("const [optionsOpen, setOptionsOpen] = useState(false)"), "single-player never enters behind Options");
assert.ok(singleplayer.includes("engine.setPaused(initiallyPaused);\n    setLocalFusesPausedRef.current(initiallyPaused);\n    engine.start();"),
  "the initial active/modal state reaches the engine before its first frame");
assert.ok(singleplayer.includes('canvas aria-label="Lakecraft single-player voxel world" ref={canvasRef} tabIndex={0}'),
  "the active single-player canvas is immediately focusable and pointer-ready");
assert.ok(lobby.includes("Singleplayer"), "the title screen exposes single-player");

console.log("single-player offline mode tests passed");
