export const CLIENT_SETTINGS_STORAGE_KEY = "lakecraft:settings:v1";
export const LEGACY_AUDIO_MUTED_STORAGE_KEY = "lakecraft:audio-muted:v1";

export const MOUSE_SENSITIVITY_MIN = 10;
export const MOUSE_SENSITIVITY_MAX = 200;
export const DEFAULT_MOUSE_LOOK_SCALE = 0.0022;

export interface ClientSettings {
  soundMuted: boolean;
  /** Mouse-look speed as a percentage; 100 preserves Lakecraft's original speed. */
  mouseSensitivity: number;
}

export interface ClientSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_CLIENT_SETTINGS: Readonly<ClientSettings> = Object.freeze({
  soundMuted: false,
  mouseSensitivity: 100,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSensitivity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CLIENT_SETTINGS.mouseSensitivity;
  return Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, value));
}

export function normalizeClientSettings(value: unknown): ClientSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    soundMuted: typeof candidate.soundMuted === "boolean" ? candidate.soundMuted : DEFAULT_CLIENT_SETTINGS.soundMuted,
    mouseSensitivity: normalizeSensitivity(candidate.mouseSensitivity),
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
