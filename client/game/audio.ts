/** Gesture-gated official samples with a dependency-free procedural fallback. */

import {
  OFFICIAL_SOUND_BASE,
  OFFICIAL_SOUND_HASH_BYTES,
  OFFICIAL_SOUND_INDEXES,
} from "./generated/officialSoundAssets.ts";

export const GAME_AUDIO_CUES = [
  "footstep",
  "miningHit",
  "blockBreak",
  "blockPlace",
  "pickup",
  "craft",
  "doorOpen",
  "doorClose",
  "chestOpen",
  "chestClose",
  "playerAttack",
  "playerHurt",
  "mobAttack",
  "mobIdle",
  "mobHurt",
  "mobDeath",
  "creeperFuse",
  "explosion",
  "uiClick",
  "uiConfirm",
  "uiBack",
] as const;

export type GameAudioCue = (typeof GAME_AUDIO_CUES)[number];
export type GameAudioSurface = "grass" | "stone" | "wood" | "sand" | "gravel" | "metal" | "glass" | "generic";
export type GameAudioMob = "pig" | "cow" | "sheep" | "chicken" | "zombie" | "skeleton" | "creeper" | "spider";
export type GameAudioWave = "sine" | "square" | "triangle" | "sawtooth";
export type GameAudioCategory = "blocks" | "hostile" | "passive" | "players" | "ui";

export interface GameAudioLevels {
  master: number;
  blocks: number;
  hostile: number;
  passive: number;
  players: number;
  ui: number;
}

export interface GameAudioPlayOptions {
  /** Stable action/world identifier. The same cue and seed produce the same timbre. */
  seed?: number | string;
  /** Loudness and impact weight, clamped to 0..1. */
  intensity?: number;
  surface?: GameAudioSurface;
  mob?: GameAudioMob;
  /** Optional left/right position, clamped to -1..1 when StereoPanner is available. */
  pan?: number;
}

export interface GameAudioLayer {
  kind: "noise" | "tone";
  delay: number;
  duration: number;
  gain: number;
  frequency: number;
  frequencyEnd: number;
  filterHz: number;
  filterQ: number;
  playbackRate: number;
  noiseOffset: number;
  wave: GameAudioWave;
}

export interface GameAudioPlan {
  cue: GameAudioCue;
  seed: number;
  layers: readonly GameAudioLayer[];
}

export interface GameAudio {
  /** Call directly from a pointer/key event. This is the only method that creates or resumes Web Audio. */
  unlock(): Promise<boolean>;
  play(cue: GameAudioCue, options?: GameAudioPlayOptions): boolean;
  setMuted(muted: boolean): void;
  setLevels(levels: Partial<GameAudioLevels>): void;
  toggleMuted(): boolean;
  isMuted(): boolean;
  isUnlocked(): boolean;
  activeVoiceCount(): number;
  destroy(): void;
}

export interface CreateGameAudioOptions {
  muted?: boolean;
  /** Each voice is one cue, even when the cue contains several synthesis layers. */
  maxVoices?: number;
  masterGain?: number;
  levels?: Partial<GameAudioLevels>;
  /** Test/embedding seam. Returning null installs the safe no-audio behavior. */
  contextFactory?: () => AudioContext | null;
  /** Test/embedding seam. Returning null keeps the procedural fallback. */
  mediaFactory?: (url: string) => HTMLAudioElement | null;
}

const DEFAULT_MAX_VOICES = 18;
const MIN_GAIN = 0.0001;
const SAMPLE_RETRY_MS = 30_000;
const OFFICIAL_SURFACES: GameAudioSurface[] = ["grass", "stone", "wood", "sand", "gravel", "metal", "glass"];
const OFFICIAL_MOBS: GameAudioMob[] = ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"];
const OFFICIAL_SOUND_BYTES = atob(OFFICIAL_SOUND_HASH_BYTES);
const DEFAULT_AUDIO_LEVELS: Readonly<GameAudioLevels> = Object.freeze({
  master: 1, blocks: 1, hostile: 1, passive: 1, players: 1, ui: 1,
});

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;

/** FNV-1a gives stable variation without ambient randomness or saved state. */
export function gameAudioSeed(value: number | string | undefined): number {
  const text = value === undefined ? "0" : String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function officialSoundAsset(cue: GameAudioCue, options: GameAudioPlayOptions = {}): string | null {
  const surface = options.surface === "generic" || !options.surface ? "stone" : options.surface;
  const blockCue = cue === "footstep" ? 0 : cue === "blockBreak" ? 1 : cue === "blockPlace" ? 2 : -1;
  let index = blockCue < 0 ? -1 : OFFICIAL_SURFACES.indexOf(surface) * 3 + blockCue;
  if (index < 0 && options.mob) {
    const mob = OFFICIAL_MOBS.indexOf(options.mob);
    const action = cue === "mobIdle" ? 0 : cue === "mobHurt" ? 1 : cue === "mobDeath" ? 2 : -1;
    if (mob >= 0 && action >= 0 && !(options.mob === "creeper" && action === 0)) index = 21 + mob * 3 + action - (mob >= 6 ? 1 : 0);
  }
  if (index < 0) return null;
  const offset = Number.parseInt(OFFICIAL_SOUND_INDEXES[index], 36) * 20;
  let hash = "";
  for (let byte = offset; byte < offset + 20; byte += 1) hash += OFFICIAL_SOUND_BYTES.charCodeAt(byte).toString(16).padStart(2, "0");
  return hash;
}

export function officialSoundUrl(hash: string): string {
  return `${OFFICIAL_SOUND_BASE}/${hash.slice(0, 2)}/${hash}`;
}

export function gameAudioCategory(cue: GameAudioCue, options: GameAudioPlayOptions = {}): GameAudioCategory {
  if (cue.startsWith("ui") || cue === "craft") return "ui";
  if (cue.startsWith("mob") || cue === "creeperFuse") {
    return options.mob && ["pig", "cow", "sheep", "chicken"].includes(options.mob) ? "passive" : "hostile";
  }
  if (cue === "playerAttack" || cue === "playerHurt" || cue === "pickup") return "players";
  return "blocks";
}
const SURFACES: Record<GameAudioSurface, readonly [number, number, number]> = {
  grass: [950, 0.82, 0.82],
  stone: [1_900, 1.18, 155],
  wood: [1_280, 0.94, 118],
  sand: [620, 0.7, 84],
  gravel: [1_500, 1.08, 105],
  metal: [3_400, 1.36, 310],
  glass: [4_800, 1.52, 520],
  generic: [1_240, 1, 125],
};

/** Compact deterministic synthesis used whenever an official object is unavailable. */
export function createGameAudioPlan(cue: GameAudioCue, options: GameAudioPlayOptions = {}): GameAudioPlan {
  const seed = gameAudioSeed(`${cue}:${options.seed ?? 0}`);
  const intensity = clamp(options.intensity ?? .72, 0, 1);
  const [filterHz, rate, surfaceTone] = SURFACES[options.surface ?? "generic"];
  const variation = (seed % 1001 / 1000 - .5) * .16;
  const ui = cue.startsWith("ui") || cue === "pickup" || cue === "craft";
  const mob = cue.startsWith("mob");
  const heavy = cue === "explosion" || cue === "creeperFuse" || cue === "mobDeath";
  const duration = heavy ? .48 : mob ? .22 : ui ? .11 : .13;
  const base = ui ? 520 + GAME_AUDIO_CUES.indexOf(cue) * 24 : mob ? 118 : surfaceTone;
  const tone: GameAudioLayer = {
    kind: "tone", delay: 0, duration, gain: clamp((heavy ? .22 : .12) * intensity, 0, .5),
    frequency: Math.max(24, base * (1 + variation)), frequencyEnd: Math.max(24, base * (heavy ? .4 : .68)),
    filterHz: clamp(ui ? 3_200 : filterHz, 80, 12_000), filterQ: .7, playbackRate: 1,
    noiseOffset: seed % 997 / 997, wave: ui ? "sine" : mob ? "square" : "triangle",
  };
  if (ui) return { cue, seed, layers: [tone] };
  const noise: GameAudioLayer = {
    ...tone, kind: "noise", duration: Math.min(.8, duration * (heavy ? 1.45 : .7)),
    gain: clamp((heavy ? .32 : .16) * intensity, 0, .5), filterHz: clamp(filterHz * (1 + variation), 80, 12_000),
    playbackRate: clamp(rate * (1 + variation), .35, 2.5), wave: "triangle",
  };
  return { cue, seed, layers: [noise, tone] };
}

function defaultContextFactory(): AudioContext | null {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: new () => AudioContext;
  };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return null;
  try {
    return new Context();
  } catch {
    return null;
  }
}

function defaultMediaFactory(url: string): HTMLAudioElement | null {
  if (typeof Audio !== "function") return null;
  try {
    const media = new Audio(url);
    media.preload = "auto";
    return media;
  } catch {
    return null;
  }
}

interface Voice {
  endTime: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  cleaned: boolean;
}

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 0x51f15e5d;
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    const white = ((state >>> 0) / 2147483648) - 1;
    previous = white * 0.72 + previous * 0.28;
    samples[index] = previous;
  }
  return buffer;
}

export function createGameAudio(options: CreateGameAudioOptions = {}): GameAudio {
  const contextFactory = options.contextFactory ?? defaultContextFactory;
  const mediaFactory = options.mediaFactory ?? defaultMediaFactory;
  const maxVoices = Math.round(clamp(options.maxVoices ?? DEFAULT_MAX_VOICES, 1, 32));
  const levels: GameAudioLevels = { ...DEFAULT_AUDIO_LEVELS, ...options.levels };
  for (const category of Object.keys(levels) as (keyof GameAudioLevels)[]) levels[category] = clamp(levels[category], 0, 1);
  let masterLevel = clamp(options.masterGain ?? 0.62, 0, 1) * levels.master;
  let muted = Boolean(options.muted);
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let unlocked = false;
  let destroyed = false;
  const voices: Voice[] = [];
  const sampleVoices: HTMLAudioElement[] = [];
  const sampleVoiceMix = new Map<HTMLAudioElement, { category: GameAudioCategory; intensity: number }>();
  const lastSampleAt = new Map<GameAudioCue, number>();
  let sampleUnlocked = false;
  let sampleRetryAt = 0;

  const categoryLevel = (cue: GameAudioCue, playOptions: GameAudioPlayOptions): number =>
    levels[gameAudioCategory(cue, playOptions)];

  const cleanup = (voice: Voice): void => {
    if (voice.cleaned) return;
    voice.cleaned = true;
    const index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
  };

  const stopVoice = (voice: Voice): void => {
    if (voice.cleaned) return;
    for (const source of voice.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    cleanup(voice);
  };

  const cleanupSample = (media: HTMLAudioElement, release = false): void => {
    const index = sampleVoices.indexOf(media);
    if (index < 0) return;
    sampleVoices.splice(index, 1);
    sampleVoiceMix.delete(media);
    media.onended = null;
    media.onerror = null;
    if (release) try {
      media.pause(); media.removeAttribute("src"); media.load();
    } catch { /* best-effort media release */ }
  };

  const pruneVoices = (): void => {
    if (!context) return;
    for (let index = voices.length - 1; index >= 0; index -= 1) {
      if (voices[index].endTime <= context.currentTime) cleanup(voices[index]);
    }
  };

  const trimVoices = (): void => {
    pruneVoices();
    while (voices.length + sampleVoices.length >= maxVoices) {
      if (sampleVoices.length) cleanupSample(sampleVoices[0], true);
      else stopVoice(voices[0]);
    }
  };

  const setMasterLevel = (): void => {
    if (!context || !master) return;
    const value = muted ? 0 : masterLevel;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(value, context.currentTime, 0.012);
  };

  const unlockSamples = (): boolean => {
    if (destroyed || sampleUnlocked || Date.now() < sampleRetryAt) return sampleUnlocked;
    const asset = officialSoundAsset("footstep", { surface: "grass", seed: 0 });
    const media = asset ? mediaFactory(officialSoundUrl(asset)) : null;
    if (!media) return false;
    media.volume = 0; media.preload = "auto"; sampleUnlocked = true;
    sampleVoices.push(media);
    try { void media.play().then(() => cleanupSample(media, true)).catch(() => {
      cleanupSample(media, true);
      sampleUnlocked = false;
      sampleRetryAt = Date.now() + SAMPLE_RETRY_MS;
    }); } catch {
      cleanupSample(media, true); sampleUnlocked = false; sampleRetryAt = Date.now() + SAMPLE_RETRY_MS;
    }
    return sampleUnlocked;
  };

  const unlock = async (): Promise<boolean> => {
    if (destroyed) return false;
    const samplesReady = unlockSamples();
    try {
      if (!context || context.state === "closed") {
        context = contextFactory();
        if (!context) return samplesReady;
        master = null;
        noise = null;
      }
      if (!master || !noise) {
        master = context.createGain();
        master.gain.value = muted ? 0 : masterLevel;
        master.connect(context.destination);
        noise = createNoiseBuffer(context);
      }
      if (context.state === "suspended") await context.resume();
      unlocked = context.state === "running";
      return samplesReady || unlocked;
    } catch {
      unlocked = false;
      return samplesReady;
    }
  };

  const playProcedural = (cue: GameAudioCue, playOptions: GameAudioPlayOptions = {}): boolean => {
    if (destroyed || muted || !unlocked || !context || context.state !== "running" || !master || !noise) return false;
    const mix = categoryLevel(cue, playOptions);
    if (mix <= 0) return false;
    const plan = createGameAudioPlan(cue, { ...playOptions, intensity: (playOptions.intensity ?? .72) * mix });
    if (!plan.layers.some((entry) => entry.gain > 0)) return false;
    trimVoices();

    const now = context.currentTime + 0.003;
    const voice: Voice = { endTime: now, sources: [], nodes: [], cleaned: false };
    const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = clamp(playOptions.pan ?? 0, -1, 1);
      panner.connect(master);
      voice.nodes.push(panner);
    }
    const output: AudioNode = panner ?? master;
    let remaining = 0;

    for (const entry of plan.layers) {
      if (entry.gain <= 0) continue;
      const start = now + entry.delay;
      const end = start + entry.duration;
      const envelope = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = entry.kind === "noise" ? "lowpass" : "bandpass";
      filter.frequency.value = entry.filterHz;
      filter.Q.value = entry.filterQ;
      envelope.gain.setValueAtTime(MIN_GAIN, start);
      envelope.gain.linearRampToValueAtTime(entry.gain, start + Math.min(0.008, entry.duration * 0.18));
      envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
      filter.connect(envelope);
      envelope.connect(output);
      voice.nodes.push(filter, envelope);

      let source: AudioScheduledSourceNode;
      if (entry.kind === "noise") {
        const bufferSource = context.createBufferSource();
        bufferSource.buffer = noise;
        bufferSource.playbackRate.value = entry.playbackRate;
        bufferSource.connect(filter);
        bufferSource.start(start, entry.noiseOffset, entry.duration);
        source = bufferSource;
      } else {
        const oscillator = context.createOscillator();
        oscillator.type = entry.wave;
        oscillator.frequency.setValueAtTime(entry.frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(entry.frequencyEnd, end);
        oscillator.connect(filter);
        oscillator.start(start);
        oscillator.stop(end + 0.002);
        source = oscillator;
      }
      remaining += 1;
      source.onended = () => {
        remaining -= 1;
        if (remaining === 0) cleanup(voice);
      };
      voice.sources.push(source);
      voice.nodes.push(source);
      voice.endTime = Math.max(voice.endTime, end + 0.01);
    }
    if (voice.sources.length === 0) {
      cleanup(voice);
      return false;
    }
    voices.push(voice);
    return true;
  };

  const play = (cue: GameAudioCue, playOptions: GameAudioPlayOptions = {}): boolean => {
    if (destroyed || muted) return false;
    const asset = sampleUnlocked && Date.now() >= sampleRetryAt ? officialSoundAsset(cue, playOptions) : null;
    if (!asset) return playProcedural(cue, playOptions);
    const now = performance.now();
    const cooldown = cue === "footstep" ? 70 : cue.startsWith("mob") ? 90 : 35;
    if (now - (lastSampleAt.get(cue) ?? Number.NEGATIVE_INFINITY) < cooldown) return false;
    const media = mediaFactory(officialSoundUrl(asset));
    if (!media) return playProcedural(cue, playOptions);
    trimVoices();
    const seed = gameAudioSeed(playOptions.seed);
    const intensity = clamp(playOptions.intensity ?? 0.72, 0, 1);
    media.preload = "auto";
    media.volume = clamp(masterLevel * categoryLevel(cue, playOptions) * intensity, 0, 1);
    media.playbackRate = 0.9 + seed % 21 / 100;
    let failed = false;
    const fail = (): void => {
      if (failed || !sampleVoices.includes(media)) return;
      failed = true;
      cleanupSample(media, true);
      sampleUnlocked = false;
      sampleRetryAt = Date.now() + SAMPLE_RETRY_MS;
      playProcedural(cue, playOptions);
    };
    media.onended = () => cleanupSample(media);
    media.onerror = fail;
    sampleVoiceMix.set(media, { category: gameAudioCategory(cue, playOptions), intensity });
    sampleVoices.push(media);
    lastSampleAt.set(cue, now);
    try {
      void media.play().catch(fail);
      return true;
    } catch {
      fail();
      return false;
    }
  };

  return {
    unlock,
    play,
    setMuted(nextMuted: boolean): void {
      muted = Boolean(nextMuted);
      setMasterLevel();
      if (muted) {
        while (voices.length > 0) stopVoice(voices[voices.length - 1]);
        while (sampleVoices.length > 0) cleanupSample(sampleVoices[sampleVoices.length - 1], true);
      }
    },
    setLevels(nextLevels): void {
      for (const category of Object.keys(DEFAULT_AUDIO_LEVELS) as (keyof GameAudioLevels)[]) {
        const value = nextLevels[category];
        if (value !== undefined) levels[category] = clamp(value, 0, 1);
      }
      masterLevel = clamp(options.masterGain ?? 0.62, 0, 1) * levels.master;
      setMasterLevel();
      for (const media of sampleVoices) {
        const mix = sampleVoiceMix.get(media);
        if (mix) media.volume = clamp(masterLevel * levels[mix.category] * mix.intensity, 0, 1);
      }
    },
    toggleMuted(): boolean {
      muted = !muted;
      setMasterLevel();
      if (muted) {
        while (voices.length > 0) stopVoice(voices[voices.length - 1]);
        while (sampleVoices.length > 0) cleanupSample(sampleVoices[sampleVoices.length - 1], true);
      }
      return muted;
    },
    isMuted: () => muted,
    isUnlocked: () => sampleUnlocked || unlocked && context?.state === "running",
    activeVoiceCount(): number {
      pruneVoices();
      return voices.length + sampleVoices.length;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unlocked = false;
      sampleUnlocked = false;
      while (voices.length > 0) stopVoice(voices[voices.length - 1]);
      while (sampleVoices.length > 0) cleanupSample(sampleVoices[sampleVoices.length - 1], true);
      try { master?.disconnect(); } catch { /* already disconnected */ }
      try { void context?.close(); } catch { /* best-effort shutdown */ }
      master = null;
      noise = null;
      context = null;
    },
  };
}
