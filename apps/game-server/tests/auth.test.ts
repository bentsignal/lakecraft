import { describe, expect, test } from "bun:test";
import { createAuthenticator } from "../src/auth";
import type { ServerConfig } from "../src/config";
import { WorldStore } from "../src/database";

describe("Lakebed ticket redemption", () => {
  test("uses the registration credential, server scope, expiry, and one-use receipt", async () => {
    let observedAuthorization = "";
    let observedBody: unknown;
    const redeem = Bun.serve({
      port: 0,
      async fetch(request) {
        observedAuthorization = request.headers.get("authorization") || "";
        observedBody = await request.json();
        return Response.json({
          userId: "lakebed-user-1",
          displayName: "Authenticated Alex",
          ticketId: "one-time-ticket-id",
          serverId: "server-a",
          expiresAt: Date.now() + 45_000,
        });
      },
    });
    const store = new WorldStore(":memory:");
    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 1,
      serverId: "server-a",
      serverName: "Test",
      serverDescription: "Test",
      authMode: "lakebed",
      ticketRedeemUrl: `http://127.0.0.1:${redeem.port}/redeem`,
      registrationCredential: "registration-secret",
      dataDir: ".",
      tickHz: 20,
      snapshotHz: 10,
      idleSuspendMs: 100,
      maxPlayers: 8,
      maxPersistedBlocks: 100,
      allowedOrigins: [],
    };
    const auth = createAuthenticator(config, store);
    const join = { v: 1 as const, type: "join" as const, ticket: "opaque-ticket", serverId: "server-a" };
    await expect(auth.authenticate(join)).resolves.toEqual({
      userId: "lakebed-user-1",
      displayName: "Authenticated Alex",
    });
    expect(observedAuthorization).toBe("Bearer registration-secret");
    expect(observedBody).toEqual({ ticket: "opaque-ticket", serverId: "server-a" });
    await expect(auth.authenticate(join)).rejects.toThrow("already used");
    await expect(auth.authenticate({ ...join, serverId: "other" })).rejects.toThrow("wrong server");
    redeem.stop(true);
    store.close();
  });
});
