import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(lobby.includes('useState<"title" | "multiplayer">("title")'), "the title and multiplayer directory are distinct screens");
assert.ok(lobby.includes('setPage("multiplayer")'), "the Multiplayer title button opens the server directory without authenticating first");
assert.equal(lobby.includes(">Sign In with Google<"), false, "Google branding is not presented as a main menu button");
assert.ok(lobby.includes(">Sign In</button>"), "the multiplayer account panel exposes a compact sign-in action");
assert.ok(lobby.includes(">Choose Name</button>"), "signed-in accounts without a username expose name setup in the account panel");
assert.ok(lobby.includes('role="listbox"') && lobby.includes('role="option"'), "the multiplayer screen exposes a semantic server list");
assert.ok(lobby.includes('{count} / 20'), "the Fern Hollow row displays player occupancy");
assert.ok(lobby.includes("Join Server") && lobby.includes("Direct Connection") && lobby.includes(">Back<"), "the server browser mirrors the expected Minecraft action row");
assert.ok(styles.includes(".lc-dirt-background") && styles.includes("image-rendering:pixelated"), "the server directory uses a pixelated dirt backdrop");
assert.ok(app.includes('worldDescription="Survival · Lakebed shared world"'), "the server description stays concise and player-facing");
assert.ok((app.match(/setInWorld\(true\);\s*setPauseOpen\(false\)/g) ?? []).length >= 2, "both multiplayer join paths enter without an artificial pause dialog");

console.log("lakecraft lobby refinement tests: ok");
