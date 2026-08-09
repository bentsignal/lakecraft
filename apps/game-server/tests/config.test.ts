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
});
