import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const lakebedEnvironment = {
  AUTH_MODE: "lakebed",
  SERVER_ID: "registered-server-row-id",
  LAKEBED_TICKET_REDEEM_URL: "https://craft.lakebed.app/api/multiplayer/redeem-join-ticket",
  LAKEBED_REGISTRATION_CREDENTIAL: "registration-secret",
};

describe("server configuration", () => {
  test("fails closed when Lakebed browser origins are not configured", () => {
    expect(() => loadConfig(lakebedEnvironment)).toThrow("ALLOWED_ORIGINS is required");
  });

  test("accepts an explicit Lakebed browser origin", () => {
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
    }).allowedOrigins).toEqual(["https://craft.lakebed.app"]);
  });

  test("keeps the admin portal opt-in and rejects weak admin tokens", () => {
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
    }).adminToken).toBeUndefined();
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      ADMIN_TOKEN: "too-short",
    })).toThrow("ADMIN_TOKEN must be at least 24 characters");
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      ADMIN_TOKEN: "a-private-admin-token-with-enough-entropy",
    }).adminToken).toBe("a-private-admin-token-with-enough-entropy");
  });

  test("keeps the agent builder opt-in with a dedicated high-entropy credential", () => {
    const base = { ...lakebedEnvironment, ALLOWED_ORIGINS: "https://craft.lakebed.app" };
    expect(loadConfig(base).agentToken).toBeUndefined();
    expect(() => loadConfig({ ...base, AGENT_TOKEN: "too-short" })).toThrow(
      "AGENT_TOKEN must be at least 32 characters",
    );
    const agentToken = "a-distinct-agent-builder-token-with-enough-entropy";
    expect(loadConfig({ ...base, AGENT_TOKEN: agentToken }).agentToken).toBe(agentToken);
    expect(() => loadConfig({
      ...base,
      ADMIN_TOKEN: agentToken,
      AGENT_TOKEN: agentToken,
    })).toThrow("AGENT_TOKEN must be distinct");
    expect(() => loadConfig({
      ...base,
      LAKEBED_REGISTRATION_CREDENTIAL: agentToken,
      AGENT_TOKEN: agentToken,
    })).toThrow("AGENT_TOKEN must be distinct");
  });

  test("caps configured capacity at the 32-player protocol and renderer bound", () => {
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      MAX_PLAYERS: "32",
    }).maxPlayers).toBe(32);
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      MAX_PLAYERS: "33",
    })).toThrow("MAX_PLAYERS must be an integer from 1 to 32");
  });

  test("keeps survival terrain as the zero-configuration default", () => {
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
    })).toMatchObject({
      worldPreset: "default",
      superflatGroundY: 20,
      defaultGameMode: "survival",
      spawnX: 0.5,
      spawnZ: 0.5,
      spawnYaw: 0,
    });
  });

  test("strictly validates a Creative superflat world", () => {
    expect(loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      WORLD_PRESET: "superflat",
      SUPERFLAT_GROUND_Y: "20",
      DEFAULT_GAME_MODE: "creative",
      SPAWN_X: "-23.5",
      SPAWN_Z: "-23.5",
      SPAWN_YAW_DEGREES: "135",
    })).toMatchObject({
      worldPreset: "superflat",
      superflatGroundY: 20,
      defaultGameMode: "creative",
      spawnX: -23.5,
      spawnZ: -23.5,
      spawnYaw: 3 * Math.PI / 4,
    });
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      WORLD_PRESET: "flat",
    })).toThrow("WORLD_PRESET must be default or superflat");
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      SUPERFLAT_GROUND_Y: "10",
    })).toThrow("SUPERFLAT_GROUND_Y must be an integer from 11 to 64");
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      DEFAULT_GAME_MODE: "operator",
    })).toThrow("DEFAULT_GAME_MODE must be survival or creative");
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      SPAWN_X: "NaN",
    })).toThrow("SPAWN_X must be a finite number");
    expect(() => loadConfig({
      ...lakebedEnvironment,
      ALLOWED_ORIGINS: "https://craft.lakebed.app",
      SPAWN_YAW_DEGREES: "361",
    })).toThrow("SPAWN_YAW_DEGREES must be a finite number from -360 to 360");
  });
});
