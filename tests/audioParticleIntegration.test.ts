import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const app = source("../client/index.tsx");
const engine = source("../client/game/voxelEngine.ts");
const engineTypes = source("../client/game/types.ts");
const gameHud = source("../client/components/GameHud.tsx");
const pauseMenu = source("../client/components/PauseMenu.tsx");
const particles = source("../client/game/blockParticles.ts");

const audioLifecycle = app.slice(
  app.indexOf("const audio = createGameAudio"),
  app.indexOf("}, []);", app.indexOf("const audio = createGameAudio")) + 7,
);
assert.ok(audioLifecycle.includes('window.addEventListener("pointerdown", unlock, true)'), "pointer gestures unlock Web Audio");
assert.ok(audioLifecycle.includes('window.addEventListener("keydown", unlock, true)'), "keyboard gestures unlock Web Audio");
assert.ok(audioLifecycle.includes('window.removeEventListener("pointerdown", unlock, true)'), "gesture listeners are removed on teardown");
assert.ok(audioLifecycle.includes("audio.destroy()"), "the AudioContext and voices are destroyed on unmount");
assert.ok(app.includes("AUDIO_MUTED_STORAGE_KEY"), "mute preference survives reloads without Lakebed traffic");
assert.ok(gameHud.includes("soundMuted={soundMuted}"), "GameHud passes the current mute state to the pause menu");
assert.ok(pauseMenu.includes('aria-pressed={soundMuted}'), "the pause-menu sound toggle exposes accessible state");
assert.ok(pauseMenu.includes('Sound: {soundMuted ? "OFF" : "ON"}'), "the sound toggle has an explicit Minecraft-style state label");

const confirmedFeedback = app.slice(
  app.indexOf("function emitConfirmedWorldBlockFeedback"),
  app.indexOf("async function submitPendingWorldBlockEdit"),
);
assert.ok(confirmedFeedback.indexOf("seen.has(result.operationId)") < confirmedFeedback.indexOf('play("blockBreak"'), "replayed receipts are deduplicated before feedback");
assert.ok(confirmedFeedback.includes('action: "break"') && confirmedFeedback.includes('action: "place"'), "confirmed edits emit both debris variants");
assert.ok(confirmedFeedback.includes('play(next === BLOCK.DOOR_OPEN ? "doorOpen" : "doorClose"'), "confirmed toggles use direction-specific door sounds");

const blockSubmission = app.slice(
  app.indexOf("async function submitPendingWorldBlockEdit"),
  app.indexOf("function handleBlockEdit"),
);
assert.ok(blockSubmission.indexOf("if (!result.ok)") < blockSubmission.indexOf("emitConfirmedWorldBlockFeedback(result)"), "break/place confirmation never runs on a rejected Lakebed edit");
assert.ok(blockSubmission.includes("if (!replayPassedByNewerChunk) emitConfirmedWorldBlockFeedback(result)"), "stale receipt replays cannot draw debris for a superseded block");

const miningFeedback = engine.slice(
  engine.indexOf("if (miningTimer && miningDurationMs > 0"),
  engine.indexOf("if (frameTimeMs > 0)", engine.indexOf("if (miningTimer && miningDurationMs > 0")),
);
assert.ok(miningFeedback.includes("now - lastMiningHitAt >= 225"), "held mining feedback is capped below five emissions per second");
assert.ok(miningFeedback.includes("options.onMiningHit?."), "the throttled engine event reaches the local feedback layer");
assert.ok(engine.includes("footstepDistance += movedHorizontally"), "footsteps are based on resolved movement distance, not frame rate");
assert.ok(engine.includes("if (grounded && movedHorizontally > 0.0001)"), "air movement cannot emit footsteps");
assert.ok(engineTypes.includes("onMiningHit?:") && engineTypes.includes("onFootstep?:"), "feedback hooks remain explicit in the engine contract");

assert.equal((engine.match(/createBlockParticleSystem\(\)/g) ?? []).length, 1, "the particle pool is allocated once per engine");
assert.equal((engine.match(/gl\.createBuffer\(\)/g) ?? []).length >= 1, true);
assert.equal((engine.match(/blockParticles\.update\(dt\)/g) ?? []).length, 1, "particle simulation advances once per rendered frame");
assert.equal((engine.match(/blockParticles\.writeGeometry\(/g) ?? []).length, 1, "particle geometry is written once per rendered frame");
assert.equal((engine.match(/gl\.drawArrays\(gl\.TRIANGLES, 0, particleVertexCount\)/g) ?? []).length, 1, "all active debris stays in one draw call");
assert.ok(engine.includes("gl.deleteBuffer(particleBuffer)"), "particle GPU storage is released with the engine");
assert.ok(particles.includes("MAX_BLOCK_PARTICLES = 192"), "the particle pool has a hard fixed ceiling");
assert.doesNotMatch(particles, /from\s+["']lakebed\//, "local particles cannot create Lakebed traffic");
assert.doesNotMatch(particles, /\bfetch\s*\(/, "local particles cannot create network traffic");

for (const successfulActionCue of [
  'play("pickup"',
  'play("craft"',
  'play("mobHurt"',
  'play("playerAttack"',
  'play("playerHurt"',
  'play("uiConfirm"',
  'play("chestOpen"',
  'play("chestClose"',
]) {
  assert.ok(app.includes(successfulActionCue), `client integration retains ${successfulActionCue}`);
}

console.log("audio and particle client integration source tests passed");
