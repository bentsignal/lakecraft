import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const deathScreen = source("../client/components/DeathScreen.tsx");
const gameHud = source("../client/components/GameHud.tsx");
const exportsSource = source("../client/components/index.ts");
const styles = source("../client/components/HudStyles.tsx");

assert.ok(deathScreen.includes('role="dialog"'), "death view is exposed as a dialog");
assert.ok(deathScreen.includes('aria-modal="true"'), "death dialog blocks the game behind it");
assert.ok(deathScreen.includes('aria-labelledby="lc-death-title"'), "death dialog has an accessible title relationship");
assert.ok(deathScreen.includes('aria-describedby="lc-death-cause lc-death-score"'), "cause and score describe the death dialog");
assert.ok(deathScreen.includes("You Died!") && deathScreen.includes("Respawn") && deathScreen.includes("Title Screen"), "core Minecraft death actions are present");
assert.ok(deathScreen.includes("disabled={respawning || !onRespawn}"), "duplicate respawn clicks are fenced while authorization is pending");
assert.ok(deathScreen.includes("Number.isFinite(score)"), "untrusted score display is normalized");
assert.ok(deathScreen.includes("respawnError || respawnStatus"), "an error takes precedence over ordinary respawn progress");
assert.ok(deathScreen.includes('aria-live={respawnError ? "assertive" : "polite"}'), "errors interrupt while progress updates remain polite");
assert.ok(deathScreen.includes('role={respawnError ? "alert" : "status"}') && deathScreen.includes('aria-atomic="true"'), "the complete active respawn message is exposed as one live update");

assert.ok(gameHud.includes("deathScreenOpen = false"), "death UI visibility is explicit rather than inferred from client health");
assert.ok(gameHud.includes("<DeathScreen"), "GameHud owns the blocking death modal seam");
assert.ok(gameHud.includes("pauseOpen && !deathScreenOpen"), "pause menu cannot overlap death UI");
assert.ok(gameHud.includes("inventoryOpen && !deathScreenOpen"), "inventory cannot overlap death UI");
assert.ok(gameHud.includes("mobileUnsupported || deathScreenOpen"), "first-person held art is removed under the death UI");
assert.ok(gameHud.includes("!deathScreenOpen ? <ToastSurface"), "gameplay notifications do not show through the translucent death tint");
assert.match(gameHud, /<DeathScreen[^>]*respawnError=\{respawnError\}[^>]*respawnStatus=\{respawnStatus\}/, "GameHud forwards both optional feedback channels into the blocking modal");
assert.ok(exportsSource.includes("DeathScreenProps"), "death screen is exported for focused reuse and testing");

assert.ok(styles.includes("background: rgba(128,0,0,.58)"), "death state applies the recognizable translucent red world tint");
assert.ok(styles.includes("color: #ffff55"), "score uses Minecraft's yellow highlight");
assert.ok(styles.includes("z-index: 90"), "death dialog layers above normal HUD and pause UI");
assert.ok(styles.includes(".lc-death-screen button:focus-visible"), "keyboard focus has a visible Minecraft-style highlight");
assert.match(styles, /\.lc-death-screen__status \{[^}]*background: rgba\(48,0,0,\.78\);[^}]*font: 12px\/1\.35 var\(--lc-pixel-font\);[^}]*padding: 6px 8px;/, "respawn feedback is a compact dark-red pixel panel");
assert.ok(styles.includes(".lc-death-screen__status.is-error { border-color: #ff5555; color: #ffaaaa; }"), "errors receive a readable Minecraft-red edge and text treatment");

console.log("Minecraft death screen UI tests passed");
