import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(lobby.includes('useState<"title" | "multiplayer">("title")'), "the title and multiplayer directory are distinct screens");
assert.ok(lobby.includes('setPage("multiplayer")'), "the Multiplayer title button opens the server directory without authenticating first");
assert.equal(lobby.includes(">Sign In with Google<"), false, "Google branding is not presented as a main menu button");
assert.ok(lobby.includes(">Sign In</button>"), "the multiplayer account panel exposes a compact sign-in action");
assert.ok(lobby.includes(">Set Name</button>"), "signed-in accounts without a username expose concise name setup in the account panel");
assert.ok(lobby.includes('role="listbox"') && lobby.includes('role="option"'), "the multiplayer screen exposes a semantic server list");
assert.ok(lobby.includes('{count} / 20'), "the Fern Hollow row displays player occupancy");
assert.ok(lobby.includes("Join Server") && lobby.includes(">Back<"), "the server browser exposes the requested Join and Back actions");
assert.equal(lobby.includes("Direct Connection"), false, "the one-server directory has no inert action");
assert.ok(styles.includes(".lc-dirt-background") && styles.includes("image-rendering:pixelated"), "the server directory uses a pixelated dirt backdrop");
assert.ok(styles.includes(".lc-server-actions{display:grid;gap:8px;grid-template-columns:1fr 1fr}"), "Join and Back share the server action row");
assert.ok(app.includes('worldDescription="Survival · Lakebed shared world"'), "the server description stays concise and player-facing");
assert.ok((app.match(/setInWorld\(true\);[\s\S]{0,100}?setPauseOpen\(false\)/g) ?? []).length >= 2, "both multiplayer join paths enter without an artificial pause dialog");
assert.ok(lobby.includes("<OptionsDialog") && lobby.includes('id="lc-title-options"'), "title Options opens the shared accessible settings screen");
assert.equal(lobby.includes(">About<"), false, "the inert About action is removed from the title screen");
assert.ok(lobby.includes('<AccountPanel onSignIn={() => setPage("multiplayer")}'),
  "signed-out home identity routes its small Sign In action into multiplayer context");
assert.ok(lobby.includes('<AccountPanel onSignIn={props.onSignInWithGoogle}'),
  "Google authentication remains contextual to the multiplayer server browser");
const titlePage = lobby.slice(lobby.indexOf('return (\n    <main className="lc-title-screen">'));
assert.equal(titlePage.includes("onSignInWithGoogle"), false, "title screen never invokes Google authentication directly");

const validationSource = lobby.match(/export function validateLakecraftUsername\([\s\S]*?^}/m)?.[0];
assert.ok(validationSource, "username behavior remains directly testable");
const executableValidation = validationSource
  .replace("export ", "")
  .replace(/: string/g, "")
  .replace(/: UsernameValidationResult/g, "");
const validateUsername = Function(`${executableValidation}; return validateLakecraftUsername;`)() as
  (value: string) => { valid: boolean; message: string; normalized: string };
assert.deepEqual(validateUsername("  Steve_7  "), { valid: true, message: "Username available", normalized: "steve_7" });
assert.equal(validateUsername("no spaces").valid, false, "set-name affordance preserves username validation");

console.log("lakecraft lobby refinement tests: ok");
