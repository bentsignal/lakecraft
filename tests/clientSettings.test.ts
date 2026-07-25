import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_SETTINGS_STORAGE_KEY,
  DEFAULT_CLIENT_SETTINGS,
  LEGACY_AUDIO_MUTED_STORAGE_KEY,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  loadClientSettings,
  mouseLookScale,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettingsStorage,
} from "../client/settings.ts";

class MemoryStorage implements ClientSettingsStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const missing = new MemoryStorage();
assert.deepEqual(loadClientSettings(missing), DEFAULT_CLIENT_SETTINGS, "missing preferences use deterministic defaults");
assert.equal(missing.values.size, 0, "loading missing preferences never writes storage");

missing.values.set(CLIENT_SETTINGS_STORAGE_KEY, "not json");
assert.deepEqual(loadClientSettings(missing), DEFAULT_CLIENT_SETTINGS, "corrupt JSON fails safely to defaults");

missing.values.set(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 2, soundMuted: true, mouseSensitivity: 170 }));
assert.deepEqual(loadClientSettings(missing), DEFAULT_CLIENT_SETTINGS, "unknown versions are not interpreted as the current contract");

assert.deepEqual(
  normalizeClientSettings({ soundMuted: true, mouseSensitivity: -1 }),
  { soundMuted: true, mouseSensitivity: MOUSE_SENSITIVITY_MIN },
  "low finite sensitivity is clamped without discarding a valid sound preference",
);
assert.deepEqual(
  normalizeClientSettings({ soundMuted: "true", mouseSensitivity: 9_000 }),
  { soundMuted: false, mouseSensitivity: MOUSE_SENSITIVITY_MAX },
  "invalid field types fall back independently while finite sensitivity is clamped",
);
assert.deepEqual(
  normalizeClientSettings({ soundMuted: true, mouseSensitivity: Number.NaN }),
  { soundMuted: true, mouseSensitivity: 100 },
  "non-finite sensitivity falls back to its default",
);

const legacy = new MemoryStorage();
legacy.values.set(LEGACY_AUDIO_MUTED_STORAGE_KEY, "true");
assert.deepEqual(loadClientSettings(legacy), { soundMuted: true, mouseSensitivity: 100 }, "legacy audio preference remains honored");
assert.equal(legacy.values.has(CLIENT_SETTINGS_STORAGE_KEY), false, "legacy reads do not silently migrate or write");

const roundTrip = new MemoryStorage();
assert.equal(saveClientSettings(roundTrip, { soundMuted: true, mouseSensitivity: 137.5 }), true);
assert.deepEqual(loadClientSettings(roundTrip), { soundMuted: true, mouseSensitivity: 137.5 });
assert.deepEqual(
  JSON.parse(roundTrip.values.get(CLIENT_SETTINGS_STORAGE_KEY) ?? "null"),
  { version: 1, soundMuted: true, mouseSensitivity: 137.5 },
  "save emits only the canonical versioned fields",
);

assert.equal(mouseLookScale(100), 0.0022, "100% exactly preserves the original mouse-look coefficient");
assert.ok(Math.abs(mouseLookScale(-100) - 0.00022) < 1e-12, "look scaling uses the same lower clamp as persistence");
assert.ok(Math.abs(mouseLookScale(10_000) - 0.0044) < 1e-12, "look scaling uses the same upper clamp as persistence");

const readFailure = { getItem(): string | null { throw new Error("denied"); }, setItem(): void {} };
assert.deepEqual(loadClientSettings(readFailure), DEFAULT_CLIENT_SETTINGS, "unavailable storage cannot prevent startup");
const writeFailure = { getItem(): string | null { return null; }, setItem(): void { throw new Error("full"); } };
assert.equal(saveClientSettings(writeFailure, DEFAULT_CLIENT_SETTINGS), false, "storage write failures are reported without throwing");

const source = readFileSync(new URL("../client/settings.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /from\s+["']lakebed\//, "settings remain independent of Lakebed");
assert.doesNotMatch(source, /\bfetch\s*\(/, "settings cannot generate network traffic");
assert.doesNotMatch(source, /localStorage/, "storage is injected so the contract stays deterministic and reusable");

console.log("client settings persistence, validation, clamping, and look-scale tests passed");
