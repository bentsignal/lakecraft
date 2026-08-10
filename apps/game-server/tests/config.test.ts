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
});
