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

assert.ok(gameHud.includes("deathScreenOpen = false"), "death UI visibility is explicit rather than inferred from client health");
assert.ok(gameHud.includes("<DeathScreen"), "GameHud owns the blocking death modal seam");
assert.ok(gameHud.includes("pauseOpen && !deathScreenOpen"), "pause menu cannot overlap death UI");
assert.ok(gameHud.includes("inventoryOpen && !deathScreenOpen"), "inventory cannot overlap death UI");
assert.ok(gameHud.includes("mobileUnsupported || deathScreenOpen"), "first-person held art is removed under the death UI");
assert.ok(gameHud.includes("!deathScreenOpen ? <ToastSurface"), "gameplay notifications do not show through the translucent death tint");
assert.ok(exportsSource.includes("DeathScreenProps"), "death screen is exported for focused reuse and testing");

assert.ok(styles.includes("background: rgba(128,0,0,.58)"), "death state applies the recognizable translucent red world tint");
assert.ok(styles.includes("color: #ffff55"), "score uses Minecraft's yellow highlight");
assert.ok(styles.includes("z-index: 90"), "death dialog layers above normal HUD and pause UI");
assert.ok(styles.includes(".lc-death-screen button:focus-visible"), "keyboard focus has a visible Minecraft-style highlight");

console.log("Minecraft death screen UI tests passed");
