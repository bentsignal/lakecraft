import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { singlePlayerDeathMessage, singlePlayerStartsDead } from "../client/singleplayer/deathPresentation.ts";

assert.equal(singlePlayerStartsDead(0), true, "a valid persisted zero-health runtime reopens the death screen");
assert.equal(singlePlayerStartsDead(1), false);
assert.equal(singlePlayerStartsDead(20), false);
assert.equal(singlePlayerStartsDead(null), false, "a new world without runtime state starts alive");
assert.equal(singlePlayerStartsDead(undefined), false);

assert.equal(singlePlayerDeathMessage("mob"), "Slain by a hostile mob");
assert.equal(singlePlayerDeathMessage("creeper"), "Blown up by a Creeper");
assert.equal(singlePlayerDeathMessage("tnt"), "Blown up by TNT");
assert.equal(singlePlayerDeathMessage("fall"), "Hit the ground too hard");
assert.equal(singlePlayerDeathMessage("starvation"), "Starved to death");
assert.equal(singlePlayerDeathMessage("unknown"), "You died");

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.ok(app.includes("useState(() => singlePlayerStartsDead(initialSnapshot.runtime?.playerHealth))"),
  "the death modal derives its first render from validated persisted health without waiting for an engine callback");
const healthStart = app.indexOf("onPlayerHealthChange:");
const damageStart = app.indexOf("onPlayerDamage:", healthStart);
const hotbarStart = app.indexOf("onHandAction:", damageStart);
const healthFlow = app.slice(healthStart, damageStart);
const damageFlow = app.slice(damageStart, hotbarStart);
assert.ok(healthStart >= 0 && damageStart > healthStart && hotbarStart > damageStart);
assert.ok(damageFlow.includes("if (amount > 0) pendingDeathCauseRef.current = cause"),
  "accepted engine damage records its cause before health reconciliation");
assert.ok(healthFlow.indexOf("setDeathCause(singlePlayerDeathMessage(pendingDeathCauseRef.current))")
  < healthFlow.indexOf("setDeathScreenOpen(true)"), "the contextual cause is committed before opening the death screen");
assert.ok(healthFlow.includes('pendingDeathCauseRef.current = "unknown"'),
  "nonlethal reconciliation and completed deaths cannot leak a stale cause into the next death");

const survivalStart = app.indexOf("const survival = tickSurvival");
const survivalEnd = app.indexOf("const next = sampleSaveCadence", survivalStart);
const survivalFlow = app.slice(survivalStart, survivalEnd);
assert.ok(survivalFlow.indexOf('pendingDeathCauseRef.current = "starvation"')
  < survivalFlow.indexOf("engineRef.current?.setPlayerHealth"),
"starvation records its cause before the engine emits the zero-health edge");

const respawnStart = app.indexOf("function respawnLocally");
const respawnEnd = app.indexOf("useEffect(() =>", respawnStart);
const respawnFlow = app.slice(respawnStart, respawnEnd);
assert.ok(respawnFlow.includes('setDeathStatus("Respawn failed. Your carried items were left untouched.")'));
assert.ok(respawnFlow.includes('setDeathStatus("Respawn blocked. Too many saved items are already lying in this world; your pack was not changed.")'));
assert.equal(respawnFlow.includes("setMessages("), false,
  "respawn failures remain visible on the modal instead of entering the death-suppressed toast surface");
assert.ok(respawnFlow.indexOf("engine.respawn()") < respawnFlow.lastIndexOf('setDeathStatus("")'),
  "successful respawn clears the prior modal status only after the conserved settlement succeeds");

assert.ok(app.includes("deathCause={deathCause}"));
assert.ok(app.includes("respawnError={deathStatus}"));

console.log("single-player contextual death lifecycle tests passed");
