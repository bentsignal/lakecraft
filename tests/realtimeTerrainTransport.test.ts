import assert from "node:assert/strict";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
import type { WorldTerrainDescriptor } from "../shared/worldPreset.ts";

Object.assign(globalThis, { window: {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 1,
  clearInterval: () => undefined,
} });

class FakeWebSocket {
  static readonly OPEN = 1;
  static instance: FakeWebSocket;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeWebSocket.instance = this; }
  send(_payload: string) {}
  close() { this.readyState = 3; }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
  }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const terrains: WorldTerrainDescriptor[] = [];
const phases: string[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint: "wss://terrain.test/ws",
  serverId: "creative-flat",
  demo: { token: "0123456789abcdef", userId: "builder", name: "Builder" },
  localUserId: "builder",
  localUsername: "Builder",
  getPose: () => ({ x: 0.5, y: 21.02, z: 0.5, yaw: 0, pitch: 0 }),
  onPhase: (phase) => phases.push(phase),
  onRemotePlayers: () => {},
  onWorldEdits: () => {},
  onChatEvent: () => {},
  onGameMode: () => {},
  onTerrain: (terrain) => terrains.push(terrain),
  onDrops: () => {},
  onPlayerHit: () => {},
  onSelfHealth: () => {},
});
client.start();
const socket = FakeWebSocket.instance;
socket.readyState = FakeWebSocket.OPEN;
socket.onopen?.();
socket.receive({
  type: "hello",
  capabilities: ["appearance-v1"],
  terrain: { preset: "superflat", superflatGroundY: 20 },
  defaultGameMode: "creative",
});
socket.receive({
  type: "welcome",
  resumeToken: "resume",
  terrain: { preset: "superflat", superflatGroundY: 20 },
  defaultGameMode: "creative",
  player: { id: "builder", name: "Builder", x: 0.5, y: 21.02, z: 0.5, yaw: 0, pitch: 0, gameMode: "creative" },
});
assert.deepEqual(terrains, [
  { preset: "superflat", superflatGroundY: 20 },
  { preset: "superflat", superflatGroundY: 20 },
], "the browser receives the exact server terrain before and during join");
assert.ok(phases.includes("online"), "a matching preset completes the join");
client.stop();
console.log("realtime terrain handshake: ok");
