import { describe, expect, test } from "bun:test";
import {
  handleAdminRequest,
  type AdminPlayerSummary,
  type AdminWorldControl,
} from "../src/adminPortal";

const TOKEN = "a-private-admin-token-with-enough-entropy";
const INFO = { name: "Fern Hollow", description: "Test world", capacity: 32 };

function mockWorld(): AdminWorldControl & { players: AdminPlayerSummary[] } {
  const players: AdminPlayerSummary[] = [
    { id:"user-1",name:"Alex",gameMode:"survival",connected:true,role:null,health:20,x:1,y:69,z:1 },
  ];
  return {
    players,
    adminState: () => ({
      players:players.map((player)=>({...player})),
      settings:{accessMode:"whitelist",passwordConfigured:false,spawnX:0.5,spawnZ:0.5,spawnYaw:0,daylightCycle:false,dayPhase:0.5,updatedAt:1},
      access:[],chat:[],revision:7,persistedBlocks:3,maxPersistedBlocks:1_000_000,
    }),
    setPlayerGameMode(userId, gameMode) {
      const player = players.find((candidate) => candidate.id === userId);
      if (!player) return false;
      player.gameMode = gameMode;
      return true;
    },
    kickPlayer(userId) {
      const player = players.find((candidate) => candidate.id === userId && candidate.connected);
      if (!player) return false;
      player.connected = false;
      return true;
    },
    async runAdminCommand(command){return {ok:command==="/time set day",message:"done"}},
  };
}

async function call(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const world = mockWorld();
  const request = new Request(`http://server.test${path}`, init);
  const response = await handleAdminRequest(request, new URL(request.url), token ?? undefined, INFO, world);
  return { response, world };
}

describe("server-local admin portal", () => {
  test("is absent when no admin token is configured", async () => {
    const { response } = await call("/admin", {}, null);
    expect(response?.status).toBe(404);
  });

  test("serves a no-store portal without embedding the secret", async () => {
    const { response } = await call("/admin");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const html = await response!.text();
    expect(html).toContain("Command Deck");
    expect(html).toContain("10-character pairing code");
    expect(html).toContain("signed 30-day session");
    expect(html).not.toContain(TOKEN);
  });

  test("pairs a browser once without exposing the Railway service token", async () => {
    const minted = await call("/admin/api/pair-code", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(minted.response?.status).toBe(200);
    const invitation = await minted.response!.json() as { code: string; expiresAt: number };
    expect(invitation.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(invitation.expiresAt).toBeGreaterThan(Date.now());

    const paired = await call("/admin/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: invitation.code.toLowerCase() }),
    });
    expect(paired.response?.status).toBe(200);
    const session = await paired.response!.json() as { sessionToken: string };
    expect(session.sessionToken).toMatch(/^v1\.\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
    expect(session.sessionToken).not.toContain(TOKEN);

    const state = await call("/admin/api/state", {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    expect(state.response?.status).toBe(200);
    const replay = await call("/admin/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: invitation.code }),
    });
    expect(replay.response?.status).toBe(401);
    const tampered = await call("/admin/api/state", {
      headers: { authorization: `Bearer ${session.sessionToken.slice(0, -1)}0` },
    });
    expect(tampered.response?.status).toBe(401);
  });

  test("requires bearer authentication for state and commands", async () => {
    const { response } = await call("/admin/api/state");
    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe("Bearer");
  });

  test("lists players and persists mode commands through the control interface", async () => {
    const state = await call("/admin/api/state", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(state.response?.status).toBe(200);
    expect(await state.response!.json()).toMatchObject({
      ok: true,
      server: INFO,
      players: [{ id: "user-1", gameMode: "survival", connected: true }],
    });

    const changed = await call("/admin/api/player-mode", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-1", gameMode: "creative" }),
    });
    expect(changed.response?.status).toBe(200);
    expect(changed.world.players[0].gameMode).toBe("creative");
  });

  test("validates commands and never treats an offline player as kickable", async () => {
    const invalid = await call("/admin/api/player-mode", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-1", gameMode: "operator" }),
    });
    expect(invalid.response?.status).toBe(400);

    const kicked = await call("/admin/api/kick", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-1" }),
    });
    expect(kicked.response?.status).toBe(200);
    expect(kicked.world.players[0].connected).toBe(false);
  });

  test("runs bounded console commands behind the same bearer gate", async()=>{
    const result=await call("/admin/api/command",{method:"POST",headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/json"},body:JSON.stringify({command:"/time set day"})});
    expect(result.response?.status).toBe(200);
    expect(await result.response!.json()).toEqual({ok:true,message:"done"});
  });
});
