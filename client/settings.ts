import {
  DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
  normalizeGameplayControlBindings,
  type GameplayControlBindings,
} from "./gameplay/controlBindings.ts";

export const CLIENT_SETTINGS_STORAGE_KEY = "lakecraft:settings:v1";
export const LEGACY_AUDIO_MUTED_STORAGE_KEY = "lakecraft:audio-muted:v1";

export const MOUSE_SENSITIVITY_MIN = 10;
export const MOUSE_SENSITIVITY_MAX = 200;
export const DEFAULT_MOUSE_LOOK_SCALE = 0.0022;
export const RENDER_DISTANCE_MIN = 2;
export const RENDER_DISTANCE_MAX = 12;
export const FOV_DEGREES_MIN = 30;
export const FOV_DEGREES_MAX = 110;
export type HudSize = "small" | "medium" | "large";

export interface ClientSettings {
  soundMuted: boolean;
  /** Independent 0..100 mix controls, persisted browser-locally. */
  masterVolume: number;
  musicVolume: number;
  blocksVolume: number;
  hostileVolume: number;
  passiveVolume: number;
  playersVolume: number;
  uiVolume: number;
  /** Mouse-look speed as a percentage; 100 preserves Lakecraft's original speed. */
  mouseSensitivity: number;
  /** Client-selected horizontal chunk radius for either gameplay authority. */
  renderDistance: number;
  /** Vertical camera field of view in degrees. */
  fovDegrees: number;
  /** One shared scale for the hotbar, chat, and both inventory screens. */
  hudSize: HudSize;
  keyBindings: GameplayControlBindings;
}

export interface ClientSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_CLIENT_SETTINGS: Readonly<ClientSettings> = Object.freeze({
  soundMuted: false,
  masterVolume: 100,
  musicVolume: 100,
  blocksVolume: 100,
  hostileVolume: 100,
  passiveVolume: 100,
  playersVolume: 100,
  uiVolume: 100,
  mouseSensitivity: 100,
  renderDistance: 6,
  fovDegrees: 90,
  hudSize: "large",
  keyBindings: { ...DEFAULT_GAMEPLAY_CONTROL_BINDINGS },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSensitivity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CLIENT_SETTINGS.mouseSensitivity;
  return Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, value));
}

function normalizeRenderDistance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CLIENT_SETTINGS.renderDistance;
  return Math.min(RENDER_DISTANCE_MAX, Math.max(RENDER_DISTANCE_MIN, Math.floor(value)));
}

function normalizeFovDegrees(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CLIENT_SETTINGS.fovDegrees;
  return Math.min(FOV_DEGREES_MAX, Math.max(FOV_DEGREES_MIN, Math.round(value)));
}

function normalizeVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeHudSize(value: unknown): HudSize {
  return value === "small" || value === "medium" || value === "large" ? value : DEFAULT_CLIENT_SETTINGS.hudSize;
}

export function normalizeClientSettings(value: unknown): ClientSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    soundMuted: typeof candidate.soundMuted === "boolean" ? candidate.soundMuted : DEFAULT_CLIENT_SETTINGS.soundMuted,
    masterVolume: normalizeVolume(candidate.masterVolume),
    musicVolume: normalizeVolume(candidate.musicVolume),
    blocksVolume: normalizeVolume(candidate.blocksVolume),
    hostileVolume: normalizeVolume(candidate.hostileVolume),
    passiveVolume: normalizeVolume(candidate.passiveVolume),
    playersVolume: normalizeVolume(candidate.playersVolume),
    uiVolume: normalizeVolume(candidate.uiVolume),
    mouseSensitivity: normalizeSensitivity(candidate.mouseSensitivity),
    renderDistance: normalizeRenderDistance(candidate.renderDistance),
    fovDegrees: normalizeFovDegrees(candidate.fovDegrees),
    hudSize: normalizeHudSize(candidate.hudSize),
    keyBindings: normalizeGameplayControlBindings(candidate.keyBindings),
  };
}

export function loadClientSettings(storage: ClientSettingsStorage | null | undefined): ClientSettings {
  if (!storage) return { ...DEFAULT_CLIENT_SETTINGS };
  try {
    const raw = storage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    if (raw !== null) {
      const envelope = JSON.parse(raw) as unknown;
      return isRecord(envelope) && envelope.version === 1
        ? normalizeClientSettings(envelope)
        : { ...DEFAULT_CLIENT_SETTINGS };
    }
    const legacyMuted = storage.getItem(LEGACY_AUDIO_MUTED_STORAGE_KEY);
    return {
      ...DEFAULT_CLIENT_SETTINGS,
      soundMuted: legacyMuted === "true" ? true : legacyMuted === "false" ? false : DEFAULT_CLIENT_SETTINGS.soundMuted,
    };
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

export function saveClientSettings(storage: ClientSettingsStorage | null | undefined, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, ...normalizeClientSettings(value) }));
    return true;
  } catch {
    return false;
  }
}

export function mouseLookScale(mouseSensitivity: unknown): number {
  return DEFAULT_MOUSE_LOOK_SCALE * normalizeSensitivity(mouseSensitivity) / DEFAULT_CLIENT_SETTINGS.mouseSensitivity;
}

export function fieldOfViewRadians(fovDegrees: unknown): number {
  return normalizeFovDegrees(fovDegrees) * Math.PI / 180;
}

export function clientAudioLevels(settings: Readonly<ClientSettings>) {
  return {
    master: settings.masterVolume / 100,
    music: settings.musicVolume / 100,
    blocks: settings.blocksVolume / 100,
    hostile: settings.hostileVolume / 100,
    passive: settings.passiveVolume / 100,
    players: settings.playersVolume / 100,
    ui: settings.uiVolume / 100,
  };
}
