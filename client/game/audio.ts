/** Dependency-free, gesture-gated procedural game audio. */

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
  "mobHurt",
  "uiClick",
  "uiConfirm",
  "uiBack",
] as const;

export type GameAudioCue = (typeof GAME_AUDIO_CUES)[number];
export type GameAudioSurface = "grass" | "stone" | "wood" | "sand" | "gravel" | "metal" | "glass" | "generic";
export type GameAudioWave = "sine" | "square" | "triangle" | "sawtooth";

export interface GameAudioPlayOptions {
  /** Stable action/world identifier. The same cue and seed produce the same timbre. */
  seed?: number | string;
  /** Loudness and impact weight, clamped to 0..1. */
  intensity?: number;
  surface?: GameAudioSurface;
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
  /** Test/embedding seam. Returning null installs the safe no-audio behavior. */
  contextFactory?: () => AudioContext | null;
}

const DEFAULT_MAX_VOICES = 18;
const MIN_GAIN = 0.0001;

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

function mixSeed(left: number, right: number): number {
  let value = (left ^ right) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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

/** Pure sound-recipe generation, useful for deterministic replay tests. */
export function createGameAudioPlan(cue: GameAudioCue, options: GameAudioPlayOptions = {}): GameAudioPlan {
  const seed = mixSeed(gameAudioSeed(options.seed), gameAudioSeed(cue));
  const random = seededRandom(seed);
  const intensity = clamp(options.intensity ?? 0.72, 0, 1);
  const [surfaceFilter, surfaceRate, surfaceTone] = SURFACES[options.surface ?? "generic"];
  const layers: GameAudioLayer[] = [];
  const vary = (center: number, spread: number): number => center * (1 + (random() * 2 - 1) * spread);
  const layer = (kind: "noise" | "tone", values: Partial<GameAudioLayer>): void => {
    const frequency = Math.max(24, values.frequency ?? 120);
    layers.push({
      kind,
      delay: clamp(values.delay ?? 0, 0, 0.5),
      duration: clamp(values.duration ?? 0.08, 0.015, 0.8),
      gain: clamp((values.gain ?? 0.16) * intensity, 0, 0.5),
      frequency,
      frequencyEnd: Math.max(24, values.frequencyEnd ?? frequency),
      filterHz: clamp(values.filterHz ?? 2_000, 80, 12_000),
      filterQ: clamp(values.filterQ ?? 0.7, 0.1, 12),
      playbackRate: clamp(values.playbackRate ?? 1, 0.35, 2.5),
      noiseOffset: random() * 0.55,
      wave: values.wave ?? "triangle",
    });
  };

  switch (cue) {
    case "footstep":
      layer("noise", { duration: vary(0.075, 0.12), gain: 0.18, filterHz: vary(surfaceFilter, 0.16), playbackRate: vary(surfaceRate, 0.08) });
      layer("tone", { duration: 0.055, gain: 0.075, frequency: vary(surfaceTone, 0.1), frequencyEnd: vary(surfaceTone * 0.68, 0.06) });
      break;
    case "miningHit":
      layer("noise", { duration: 0.065, gain: 0.19, filterHz: vary(surfaceFilter * 1.35, 0.14), playbackRate: vary(surfaceRate * 1.08, 0.08) });
      layer("tone", { duration: 0.085, gain: 0.11, frequency: vary(surfaceTone * 1.2, 0.09), frequencyEnd: vary(surfaceTone * 0.72, 0.06), wave: "square" });
      break;
    case "blockBreak":
      for (let fragment = 0; fragment < 3; fragment += 1) {
        layer("noise", { delay: fragment * 0.027, duration: vary(0.105, 0.15), gain: 0.16 - fragment * 0.025, filterHz: vary(surfaceFilter * (1.25 - fragment * 0.15), 0.18), playbackRate: vary(surfaceRate, 0.13) });
      }
      layer("tone", { duration: 0.14, gain: 0.095, frequency: vary(surfaceTone, 0.08), frequencyEnd: surfaceTone * 0.48 });
      break;
    case "blockPlace":
      layer("noise", { duration: 0.09, gain: 0.18, filterHz: vary(surfaceFilter * 0.86, 0.12), playbackRate: vary(surfaceRate * 0.86, 0.06) });
      layer("tone", { duration: 0.11, gain: 0.12, frequency: vary(surfaceTone * 0.82, 0.07), frequencyEnd: surfaceTone * 0.5, wave: "square" });
      break;
    case "pickup":
      layer("tone", { duration: 0.09, gain: 0.09, frequency: vary(620, 0.05), frequencyEnd: vary(760, 0.04), wave: "sine" });
      layer("tone", { delay: 0.055, duration: 0.12, gain: 0.1, frequency: vary(930, 0.04), frequencyEnd: vary(1_160, 0.03), wave: "sine" });
      break;
    case "craft":
      layer("noise", { duration: 0.045, gain: 0.13, filterHz: vary(1_450, 0.08), playbackRate: 0.9 });
      layer("tone", { delay: 0.045, duration: 0.12, gain: 0.1, frequency: vary(520, 0.04), frequencyEnd: vary(780, 0.04), wave: "triangle" });
      layer("tone", { delay: 0.105, duration: 0.13, gain: 0.085, frequency: vary(780, 0.04), frequencyEnd: vary(1_040, 0.03), wave: "sine" });
      break;
    case "doorOpen":
    case "doorClose": {
      const opening = cue === "doorOpen";
      layer("tone", { duration: 0.28, gain: 0.13, frequency: opening ? 92 : 126, frequencyEnd: opening ? 142 : 74, filterHz: 820, filterQ: 2.4, wave: "sawtooth" });
      layer("noise", { delay: opening ? 0.19 : 0, duration: 0.065, gain: 0.14, filterHz: 980, playbackRate: 0.72 });
      break;
    }
    case "chestOpen":
    case "chestClose": {
      const opening = cue === "chestOpen";
      layer("tone", { duration: 0.22, gain: 0.11, frequency: opening ? 138 : 178, frequencyEnd: opening ? 205 : 102, filterHz: 1_150, wave: "triangle" });
      layer("noise", { delay: opening ? 0 : 0.145, duration: 0.052, gain: 0.15, filterHz: 1_380, playbackRate: 0.86 });
      break;
    }
    case "playerAttack":
      layer("noise", { duration: 0.095, gain: 0.18, filterHz: vary(2_900, 0.14), playbackRate: 1.32 });
      layer("tone", { duration: 0.12, gain: 0.08, frequency: vary(180, 0.08), frequencyEnd: 78, wave: "sawtooth" });
      break;
    case "playerHurt":
      layer("noise", { duration: 0.13, gain: 0.2, filterHz: vary(1_150, 0.12), playbackRate: 0.82 });
      layer("tone", { duration: 0.19, gain: 0.13, frequency: vary(170, 0.08), frequencyEnd: 92, wave: "square" });
      break;
    case "mobAttack":
      layer("noise", { duration: 0.12, gain: 0.19, filterHz: vary(1_700, 0.14), playbackRate: 0.94 });
      layer("tone", { duration: 0.17, gain: 0.12, frequency: vary(125, 0.12), frequencyEnd: 68, wave: "sawtooth" });
      break;
    case "mobHurt":
      layer("noise", { duration: 0.15, gain: 0.18, filterHz: vary(980, 0.14), playbackRate: 0.76 });
      layer("tone", { duration: 0.2, gain: 0.14, frequency: vary(118, 0.12), frequencyEnd: 58, wave: "square" });
      break;
    case "uiClick":
      layer("tone", { duration: 0.045, gain: 0.085, frequency: vary(650, 0.035), frequencyEnd: 520, wave: "square" });
      break;
    case "uiConfirm":
      layer("tone", { duration: 0.07, gain: 0.085, frequency: vary(620, 0.025), frequencyEnd: 760, wave: "sine" });
      layer("tone", { delay: 0.05, duration: 0.1, gain: 0.08, frequency: vary(880, 0.025), frequencyEnd: 1_020, wave: "sine" });
      break;
    case "uiBack":
      layer("tone", { duration: 0.09, gain: 0.085, frequency: vary(590, 0.03), frequencyEnd: 360, wave: "triangle" });
      break;
  }

  return { cue, seed, layers };
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
  const maxVoices = Math.round(clamp(options.maxVoices ?? DEFAULT_MAX_VOICES, 1, 32));
  const masterLevel = clamp(options.masterGain ?? 0.62, 0, 1);
  let muted = Boolean(options.muted);
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let unlocked = false;
  let destroyed = false;
  const voices: Voice[] = [];

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

  const pruneVoices = (): void => {
    if (!context) return;
    for (let index = voices.length - 1; index >= 0; index -= 1) {
      if (voices[index].endTime <= context.currentTime) cleanup(voices[index]);
    }
  };

  const setMasterLevel = (): void => {
    if (!context || !master) return;
    const value = muted ? 0 : masterLevel;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(value, context.currentTime, 0.012);
  };

  const unlock = async (): Promise<boolean> => {
    if (destroyed) return false;
    try {
      if (!context || context.state === "closed") {
        context = contextFactory();
        if (!context) return false;
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
      return unlocked;
    } catch {
      unlocked = false;
      return false;
    }
  };

  const play = (cue: GameAudioCue, playOptions: GameAudioPlayOptions = {}): boolean => {
    if (destroyed || muted || !unlocked || !context || context.state !== "running" || !master || !noise) return false;
    const plan = createGameAudioPlan(cue, playOptions);
    if (!plan.layers.some((entry) => entry.gain > 0)) return false;
    pruneVoices();
    while (voices.length >= maxVoices) stopVoice(voices[0]);

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

  return {
    unlock,
    play,
    setMuted(nextMuted: boolean): void {
      muted = Boolean(nextMuted);
      setMasterLevel();
      if (muted) {
        while (voices.length > 0) stopVoice(voices[voices.length - 1]);
      }
    },
    toggleMuted(): boolean {
      muted = !muted;
      setMasterLevel();
      if (muted) {
        while (voices.length > 0) stopVoice(voices[voices.length - 1]);
      }
      return muted;
    },
    isMuted: () => muted,
    isUnlocked: () => unlocked && context?.state === "running",
    activeVoiceCount(): number {
      pruneVoices();
      return voices.length;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unlocked = false;
      while (voices.length > 0) stopVoice(voices[voices.length - 1]);
      try { master?.disconnect(); } catch { /* already disconnected */ }
      try { void context?.close(); } catch { /* best-effort shutdown */ }
      master = null;
      noise = null;
      context = null;
    },
  };
}
