import { createAuthenticator } from "./auth";
import { handleAgentBuilderRequest } from "./agentBuilder";
import { handleAdminRequest } from "./adminPortal";
import { loadConfig } from "./config";
import { WorldStore } from "./database";
import { PROTOCOL_VERSION } from "./protocol";
import { GameWorld, type Peer } from "./world";

interface SocketData {
  id: string;
  peer?: Peer;
  joinTimer?: ReturnType<typeof setTimeout>;
}

const config = loadConfig();
const mkdir = Bun.spawnSync(["mkdir", "-p", "--", config.dataDir]);
if (mkdir.exitCode !== 0) {
  throw new Error(`Could not create DATA_DIR ${config.dataDir}: ${mkdir.stderr.toString().trim()}`);
}
const databasePath = `${config.dataDir.replace(/\/$/, "")}/lakecraft.sqlite`;
const store = new WorldStore(databasePath);
const world = new GameWorld(config, store, createAuthenticator(config, store));

let tickTimer: ReturnType<typeof setInterval> | undefined;
let snapshotTimer: ReturnType<typeof setInterval> | undefined;
let suspendTimer: ReturnType<typeof setTimeout> | undefined;
let lastActivityAt = Date.now();
let stopping = false;

function activate(): void {
  lastActivityAt = Date.now();
  if (suspendTimer) {
    clearTimeout(suspendTimer);
    suspendTimer = undefined;
  }
  if (!tickTimer) tickTimer = setInterval(() => world.tick(), 1_000 / config.tickHz);
  if (!snapshotTimer) snapshotTimer = setInterval(() => world.snapshots(), 1_000 / config.snapshotHz);
}

function considerSuspend(): void {
  if (world.playerCount > 0 || suspendTimer) return;
  const wait = Math.max(0, config.idleSuspendMs - (Date.now() - lastActivityAt));
  suspendTimer = setTimeout(() => {
    suspendTimer = undefined;
    if (world.playerCount > 0) return;
    if (tickTimer) clearInterval(tickTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    tickTimer = undefined;
    snapshotTimer = undefined;
  }, wait);
}

const server = Bun.serve<SocketData>({
  hostname: config.host,
  port: config.port,
  async fetch(request, bunServer) {
    const url = new URL(request.url);
    const agentResponse = await handleAgentBuilderRequest(request, url, config.agentToken, world);
    if (agentResponse) return agentResponse;
    const adminResponse = await handleAdminRequest(request, url, config.adminToken, {
      name: config.serverName,
      description: config.serverDescription,
      capacity: config.maxPlayers,
    }, world);
    if (adminResponse) return adminResponse;
    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json(
        {
          ok: true,
          name: config.serverName,
          description: config.serverDescription,
          players: world.playerCount,
          capacity: config.maxPlayers,
          protocolVersion: PROTOCOL_VERSION,
          status: "online",
          adminEnabled: Boolean(config.adminToken),
          agentBuilderEnabled: Boolean(config.agentToken),
          terrain: world.terrain.descriptor,
          defaultGameMode: config.defaultGameMode,
        },
        { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
      );
    }
    if (request.method === "OPTIONS" && url.pathname === "/status") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/ws") {
      if (!originAllowed(request.headers.get("origin"), config.allowedOrigins)) {
        return new Response("WebSocket origin is not allowed", { status: 403 });
      }
      if (world.connectionCount >= config.maxPlayers + 16) {
        return new Response("Too many pending connections", { status: 503 });
      }
      const upgraded = bunServer.upgrade(request, { data: { id: crypto.randomUUID() } });
      return upgraded ? undefined : new Response("WebSocket upgrade required", { status: 426 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(socket) {
      const peer: Peer = {
        id: socket.data.id,
        send(payload) {
          socket.send(payload, true);
        },
        close(code, reason) {
          socket.close(code, reason);
        },
        bufferedAmount() {
          return socket.getBufferedAmount();
        },
      };
      socket.data.peer = peer;
      world.open(peer);
      activate();
      socket.data.joinTimer = setTimeout(() => {
        if (!world.isJoined(peer.id)) peer.close(4008, "Join timeout");
      }, 10_000);
    },
    message(socket, payload) {
      const peer = socket.data.peer;
      if (!peer) return;
      activate();
      if (typeof payload !== "string") {
        peer.close(1003, "JSON text messages only");
        return;
      }
      void world.message(peer, payload).then(() => {
        if (world.isJoined(peer.id) && socket.data.joinTimer) {
          clearTimeout(socket.data.joinTimer);
          socket.data.joinTimer = undefined;
        }
        considerSuspend();
      });
    },
    close(socket) {
      if (socket.data.joinTimer) clearTimeout(socket.data.joinTimer);
      if (socket.data.peer) world.close(socket.data.peer);
      considerSuspend();
    },
    drain() {},
    maxPayloadLength: 32 * 1024,
    idleTimeout: 120,
  },
});

console.log(`Lakecraft realtime server listening on http://${config.host}:${server.port}`);
console.log(`Server id=${config.serverId} auth=${config.authMode} database=${databasePath}`);
considerSuspend();

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; saving world and stopping`);
  if (tickTimer) clearInterval(tickTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (suspendTimer) clearTimeout(suspendTimer);
  world.shutdown();
  store.close();
  server.stop(true);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0 || origin === null) return true;
  return allowed.includes(origin);
}
