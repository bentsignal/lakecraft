import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const menuButton = readFileSync(new URL("../client/lobby/menuButton.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(lobby.includes("export function TitleScreen") && lobby.includes("export function LobbyScreen"),
  "the title and multiplayer directory are separate component trees");
assert.ok(lobby.includes("props.onJoinMultiplayer"), "the Multiplayer title button delegates to the URL router");
assert.ok(lobby.includes('menuButton("Continue with Google"'), "the multiplayer auth screen has a clear sign-in action");
assert.ok(lobby.includes(">Sign Out</button>"), "the authenticated server directory keeps a concise account action");
assert.ok(lobby.includes('role="listbox"') && lobby.includes('role="option"'), "the multiplayer screen exposes a semantic server list");
assert.ok(lobby.includes("props.servers") && lobby.includes("server.onlinePlayers ?? 0"),
  "the multiplayer directory renders control-plane servers and live occupancy");
assert.ok(lobby.includes("Join Server") && lobby.includes(">Back<"), "the server browser exposes the requested Join and Back actions");
assert.ok(lobby.includes("onDblClick={() => props.onJoinServer?.(server.id)}")
  && app.includes("onJoinServer={enterWorld}"), "double-click joins the exact server row without waiting for selected-state propagation");
assert.ok(lobby.includes("Direct Connect") && lobby.includes("onAddDirectServer"),
  "the server directory has a working saved-address path");
assert.ok(styles.includes(".lc-dirt-background") && styles.includes("image-rendering:pixelated"), "the server directory uses a pixelated dirt backdrop");
assert.ok(styles.includes(".lc-server-actions{display:grid;gap:8px;grid-template-columns:1fr 1fr}"), "Join and Back share the server action row");
assert.ok(app.includes('"Direct Connect · community server"')&&app.includes('"Official Lakecraft world · pinned"'),
  "direct and pinned server descriptions stay concise and player-facing");
assert.ok((app.match(/setInWorld\(true\);[\s\S]{0,100}?setPauseOpen\(false\)/g) ?? []).length >= 2, "both multiplayer join paths enter without an artificial pause dialog");
assert.ok(lobby.includes("<OptionsDialog") && lobby.includes('"lc-title-options"')
  && menuButton.includes("id={id}"), "title Options opens the shared accessible settings screen");
assert.equal(lobby.includes(">About<"), false, "the inert About action is removed from the title screen");
assert.ok(lobby.includes("<AccountPanel props={props} />"),
  "the ready server directory keeps authenticated account controls available");
assert.ok(lobby.includes('if (props.authState !== "ready") return <MultiplayerAccess props={props} />;'),
  "signed-out, loading, and unnamed players never mount the server browser");
assert.ok(app.includes("if (!bootstrapReady || !profile || !serverProbeKey) return;"),
  "server status traffic waits for the authenticated profile gate");
const titlePage = lobby.slice(lobby.indexOf("export function TitleScreen"));
assert.equal(titlePage.includes("onSignInWithGoogle"), false, "title screen has no authentication callback");
assert.equal(titlePage.includes("AccountPanel"), false, "title screen has no account UI");
assert.ok(lobby.includes("Singleplayer never needs an account."), "the auth gate explains the offline boundary");

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
