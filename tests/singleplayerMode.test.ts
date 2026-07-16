import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");

assert.ok(app.includes('get("singleplayer") === "1"'), "single-player route must bypass GameApp");
assert.ok(app.includes("? <SinglePlayerApp />\n    : <LakebedMultiplayerApp />"), "the route must choose exactly one app tree");
assert.equal(singleplayer.includes("lakebed/client"), false, "single-player must not import the Lakebed client runtime");
assert.equal(singleplayer.includes("useQuery"), false, "single-player must not issue Lakebed queries");
assert.equal(singleplayer.includes("useMutation"), false, "single-player must not issue Lakebed mutations");
assert.ok(singleplayer.includes("saveSinglePlayerSnapshot(localStorage"), "single-player state should persist through the verified browser journal");
assert.ok(singleplayer.includes("loadSinglePlayerSave(localStorage"), "single-player should restore the browser-local world before engine startup");
assert.ok(singleplayer.includes("createVoxelEngine"), "single-player uses the real voxel engine");
assert.ok(singleplayer.includes("const [pauseOpen, setPauseOpen] = useState(false)"), "single-player enters the world without opening the pause menu");
assert.ok(lobby.includes("Singleplayer"), "the title screen exposes single-player");

console.log("single-player offline mode tests passed");
