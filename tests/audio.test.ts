import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAME_AUDIO_CUES,
  createGameAudio,
  createGameAudioPlan,
  gameAudioSeed,
  type GameAudioCue,
} from "../client/game/audio.ts";

const expectedCues: GameAudioCue[] = [
  "footstep", "miningHit", "blockBreak", "blockPlace", "pickup", "craft",
  "doorOpen", "doorClose", "chestOpen", "chestClose",
  "playerAttack", "playerHurt", "mobAttack", "mobHurt",
  "uiClick", "uiConfirm", "uiBack",
];
assert.deepEqual(GAME_AUDIO_CUES, expectedCues, "all required gameplay and UI variants remain available");

for (const cue of GAME_AUDIO_CUES) {
  const plan = createGameAudioPlan(cue, { seed: "world:4/action:19", intensity: 0.8, surface: "stone" });
  assert.equal(plan.cue, cue);
  assert.ok(plan.layers.length > 0 && plan.layers.length <= 4, `${cue} has a compact bounded synthesis plan`);
  for (const layer of plan.layers) {
    assert.ok(layer.duration >= 0.015 && layer.duration <= 0.8, `${cue} layer lifetime is bounded`);
    assert.ok(layer.delay >= 0 && layer.delay <= 0.5, `${cue} layer delay is bounded`);
    assert.ok(layer.gain >= 0 && layer.gain <= 0.5, `${cue} layer gain is bounded`);
    assert.ok(Number.isFinite(layer.frequency) && Number.isFinite(layer.frequencyEnd));
  }
}

const firstPlan = createGameAudioPlan("footstep", { seed: 42, surface: "grass" });
const replayPlan = createGameAudioPlan("footstep", { seed: 42, surface: "grass" });
const variedPlan = createGameAudioPlan("footstep", { seed: 43, surface: "grass" });
assert.deepEqual(firstPlan, replayPlan, "a stable action seed exactly replays the timbre");
assert.notDeepEqual(firstPlan, variedPlan, "different action seeds vary the timbre");
assert.notDeepEqual(
  createGameAudioPlan("miningHit", { seed: 42, surface: "wood" }),
  createGameAudioPlan("miningHit", { seed: 42, surface: "glass" }),
  "material surfaces affect mining feedback",
);
assert.equal(gameAudioSeed("same"), gameAudioSeed("same"));
assert.notEqual(gameAudioSeed("same"), gameAudioSeed("different"));

const silentPlan = createGameAudioPlan("blockBreak", { intensity: Number.NaN });
assert.ok(silentPlan.layers.every((layer) => layer.gain === 0), "invalid intensity fails silent");

let factoryCalls = 0;
const noWebAudio = createGameAudio({
  contextFactory: () => {
    factoryCalls += 1;
    return null;
  },
});
assert.equal(factoryCalls, 0, "construction does not touch Web Audio before a gesture");
assert.equal(noWebAudio.play("uiClick"), false, "play before unlock is a safe no-op");
assert.equal(factoryCalls, 0, "play cannot implicitly create an AudioContext");
assert.equal(await noWebAudio.unlock(), false, "missing Web Audio safely declines unlock");
assert.equal(factoryCalls, 1, "only explicit unlock asks for an AudioContext");
assert.equal(noWebAudio.toggleMuted(), true);
assert.equal(noWebAudio.isMuted(), true);
noWebAudio.setMuted(false);
assert.equal(noWebAudio.isMuted(), false);
noWebAudio.destroy();
assert.equal(await noWebAudio.unlock(), false, "destroyed controllers stay inert");

class FakeParam {
  value = 0;
  cancelScheduledValues(): void {}
  setTargetAtTime(value: number): void { this.value = value; }
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number): void { this.value = value; }
  exponentialRampToValueAtTime(value: number): void { this.value = value; }
}

class FakeNode {
  disconnected = false;
  connect(): FakeNode { return this; }
  disconnect(): void { this.disconnected = true; }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  playbackRate = new FakeParam();
  frequency = new FakeParam();
  buffer: unknown = null;
  type = "sine";
  start(): void {}
  stop(scheduledTime?: number): void {
    if (scheduledTime === undefined) this.onended?.();
  }
}

class FakeContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8_000;
  destination = new FakeNode();
  createGain(): FakeNode & { gain: FakeParam } { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam; Q: FakeParam } {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam() });
  }
  createBufferSource(): FakeSource { return new FakeSource(); }
  createOscillator(): FakeSource { return new FakeSource(); }
  createStereoPanner(): FakeNode & { pan: FakeParam } { return Object.assign(new FakeNode(), { pan: new FakeParam() }); }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const samples = new Float32Array(length);
    return { getChannelData: () => samples };
  }
  resume(): Promise<void> { this.state = "running"; return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
}

const fakeContext = new FakeContext();
const boundedAudio = createGameAudio({ maxVoices: 3, contextFactory: () => fakeContext as unknown as AudioContext });
assert.equal(await boundedAudio.unlock(), true);
for (let index = 0; index < 20; index += 1) boundedAudio.play("blockBreak", { seed: index });
assert.equal(boundedAudio.activeVoiceCount(), 3, "rapid layered cues evict old voices at the configured cap");
boundedAudio.setMuted(true);
assert.equal(boundedAudio.activeVoiceCount(), 0, "muting eagerly releases every active voice");
boundedAudio.setMuted(false);
boundedAudio.play("craft");
fakeContext.currentTime = 2;
assert.equal(boundedAudio.activeVoiceCount(), 0, "elapsed voices are pruned even if a browser omits onended");
boundedAudio.destroy();

const source = readFileSync(new URL("../client/game/audio.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /from\s+["']lakebed\//, "audio has no Lakebed dependency");
assert.doesNotMatch(source, /\bfetch\s*\(/, "audio cannot generate network traffic");
assert.equal((source.match(/new Context\(\)/g) ?? []).length, 1, "there is one guarded context construction site");
assert.ok(source.includes("while (voices.length >= maxVoices)"), "runtime polyphony is explicitly capped");
assert.ok(source.includes("source.onended"), "native audio nodes have end-of-life cleanup");

console.log("lakecraft procedural game audio tests: ok");
