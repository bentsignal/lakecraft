import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");

assert.ok(app.includes("createSurvivalTickState(hungerRef.current, healthRef.current)"));
assert.ok(presentation.includes('canSprint: () => context.getGameMode() === "creative" || context.getHunger() > 6'), "six hunger points disable survival sprint");
assert.ok(app.includes("onMovementModeChange: (_mode, activityMultiplier)"));
assert.ok(app.includes("tickSurvival(survivalStateRef.current, elapsedSeconds, survivalActivityRef.current)"));
assert.ok(app.includes("const elapsedSeconds = active ?"), "paused intervals advance survival by zero seconds");
assert.ok(app.includes("engineRef.current?.setPlayerHealth(survival.state.health)"));
assert.ok(app.includes("survivalStateRef.current = { ...survivalStateRef.current, hunger: result.hunger }"), "eating reconciles the survival reducer");
assert.ok(app.includes("}, FIRST_PERSON_FOOD_ACTION_MS);"), "food is consumed only after the shared one-second use cycle");
assert.ok(app.includes("foodUseTimer !== null"), "a pending eating cycle cannot consume a second item concurrently");
assert.ok(app.includes("survivalStateRef.current = createSurvivalTickState(MAX_HUNGER, MAX_HEALTH)"), "respawn resets survival state");
assert.equal(app.includes("lakebed/client"), false, "offline survival never mounts Lakebed");

console.log("lakecraft single-player survival integration tests: ok");
