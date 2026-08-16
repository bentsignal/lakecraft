import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGameAudio,
  officialSoundAsset,
  officialSoundUrl,
  type GameAudioCue,
  type GameAudioMob,
  type GameAudioSurface,
} from "../client/game/audio.ts";
import {
  OFFICIAL_SOUND_BASE,
  OFFICIAL_SOUND_HASH_BYTES,
  OFFICIAL_SOUND_INDEXES,
} from "../client/game/generated/officialSoundAssets.ts";

const expectedProvenance = {
  format: "lakecraft.minecraft-sound-assets.v1",
  minecraftVersion: "26.2",
  assetIndexId: "32",
  assetIndexSha1: "4050401d6e5df16ef17c2d0adea6fd37937badae",
  soundsJsonSha1: "9ac006d5537ed0fa4a7bcd1eccfc505155847686",
  resourceBaseUrl: "https://resources.download.minecraft.net",
};
const soundKeys: string[] = [];
for (const surface of ["grass", "stone", "wood", "sand", "gravel", "metal", "glass"])
  for (const cue of ["footstep", "blockBreak", "blockPlace"]) soundKeys.push(`${cue}:${surface}`);
for (const mob of ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"])
  for (const cue of ["mobIdle", "mobHurt", "mobDeath"])
    if (!(mob === "creeper" && cue === "mobIdle")) soundKeys.push(`${cue}:${mob}`);
assert.equal(soundKeys.length, 44);
assert.equal(OFFICIAL_SOUND_BASE, expectedProvenance.resourceBaseUrl);
assert.equal(OFFICIAL_SOUND_INDEXES.length, soundKeys.length);
assert.equal(Buffer.from(OFFICIAL_SOUND_HASH_BYTES, "base64").length % 20, 0);
assert.equal(officialSoundAsset("mobIdle", { mob: "creeper" }), null,
  "creepers stay silent because Minecraft 26.2 defines no ambient creeper event");

const manifest = JSON.parse(readFileSync(new URL("../scripts/generated/minecraft-sound-assets-v26.2.json", import.meta.url), "utf8"));
for (const [key, value] of Object.entries(expectedProvenance)) assert.equal(manifest[key], value);
for (let index = 0; index < soundKeys.length; index += 1) {
  const key = soundKeys[index];
  const recorded = manifest.groups[key];
  const [cue, subject] = key.split(":");
  const hash = officialSoundAsset(cue as GameAudioCue,
    cue.startsWith("mob") ? { mob: subject as GameAudioMob } : { surface: subject as GameAudioSurface });
  assert.ok(recorded?.event && Array.isArray(recorded.assets), `${key} retains its source event and paths`);
  assert.equal(recorded.assets.length, 1);
  assert.equal(hash, recorded.assets[0].hash);
  if (!hash) throw new Error(`missing ${key}`);
  assert.match(hash, /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(recorded.assets[0].size) && recorded.assets[0].size > 0 && recorded.assets[0].size < 100_000);
  assert.equal(officialSoundUrl(hash), `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`);
}

class FakeMedia {
  preload = "";
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  released = false;
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void { this.paused = true; }
  removeAttribute(name: string): void { if (name === "src") this.released = true; }
  load(): void {}
}

const media: FakeMedia[] = [];
const urls: string[] = [];
const audio = createGameAudio({
  contextFactory: () => null,
  mediaFactory: (url) => {
    urls.push(url);
    const value = new FakeMedia();
    media.push(value);
    return value as unknown as HTMLAudioElement;
  },
  maxVoices: 2,
  masterGain: 0.5,
});
assert.equal(await audio.unlock(), true, "a user gesture can unlock official media even without Web Audio");
assert.equal(audio.play("blockBreak", { seed: "block:1", surface: "grass", intensity: 0.8 }), true);
assert.equal(media.at(-1)?.volume, 0.4, "official samples honor the existing master and cue volume");
audio.setLevels({ master: 0.5, blocks: 0.25 });
assert.ok(Math.abs((media.at(-1)?.volume ?? 0) - 0.05) < 1e-12,
  "live official samples immediately follow category and master decreases");
audio.setLevels({ master: 1, blocks: 1 });
assert.ok(Math.abs((media.at(-1)?.volume ?? 0) - 0.4) < 1e-12,
  "live official samples also follow volume increases without restarting");
audio.setLevels({ master: 0.5, blocks: 0.25 });
assert.equal(audio.play("blockPlace", { seed: "block:2", surface: "grass", intensity: 0.8 }), true);
assert.ok(Math.abs((media.at(-1)?.volume ?? 0) - 0.05) < 1e-12,
  "master and block category sliders multiply without affecting other categories");
assert.equal(audio.play("mobHurt", { seed: "cow:1", mob: "cow" }), true);
assert.equal(audio.play("mobDeath", { seed: "cow:1", mob: "cow" }), true,
  "distinct simultaneous combat cues do not silence each other");
assert.equal(audio.activeVoiceCount(), 2, "official samples share the configured voice cap");
assert.ok(urls.every((url) => /^https:\/\/resources\.download\.minecraft\.net\/[0-9a-f]{2}\/[0-9a-f]{40}$/.test(url)));
audio.setMuted(true);
assert.equal(audio.activeVoiceCount(), 0);
assert.equal(media.at(-1)?.released, true, "muting stops and releases remote media immediately");
audio.destroy();

const importer = readFileSync(new URL("../scripts/import-minecraft-sound-assets.mjs", import.meta.url), "utf8");
assert.ok(importer.includes(expectedProvenance.assetIndexSha1));
assert.ok(importer.includes("Minecraft sounds.json object hash mismatch"));
assert.ok(importer.includes("Missing indexed sound"));

console.log("official Minecraft sound mapping and bounded media playback tests passed");
