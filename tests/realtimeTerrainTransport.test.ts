import assert from "node:assert/strict";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
import type { WorldTerrainDescriptor } from "../shared/worldPreset.ts";
import { WORLD_CHUNKS_CAPABILITY } from "../apps/game-server/src/protocol.ts";

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
  sent: Array<Record<string, unknown>> = [];
  constructor() { FakeWebSocket.instance = this; }
  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
  }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const terrains: WorldTerrainDescriptor[] = [];
const phases: string[] = [];
const worldEdits: Array<{x:number;y:number;z:number;block:number;revision?:number;operationId?:string}> = [];
let worldReady = 0;
const client = new RealtimeMultiplayerClient({
  endpoint: "wss://terrain.test/ws",
  serverId: "creative-flat",
  demo: { token: "0123456789abcdef", userId: "builder", name: "Builder" },
  localUserId: "builder",
  localUsername: "Builder",
  getPose: () => ({ x: 0.5, y: 21.02, z: 0.5, yaw: 0, pitch: 0 }),
  onPhase: (phase) => phases.push(phase),
  onRemotePlayers: () => {},
  onWorldEdits: (edits) => { worldEdits.push(...edits); },
  onChatEvent: () => {},
  onGameMode: () => {},
  onTerrain: (terrain) => terrains.push(terrain),
  onWorldChunksReady: () => { worldReady += 1; },
  onDrops: () => {},
  onPlayerHit: () => {},
  onSelfHealth: () => {},
});
client.start();
const socket = FakeWebSocket.instance;
socket.readyState = FakeWebSocket.OPEN;
socket.onopen?.();
assert.deepEqual(socket.sent[0]?.capabilities, [WORLD_CHUNKS_CAPABILITY],
  "a new browser declares v2 in its join before the server hello arrives");
socket.receive({
  type: "hello",
  capabilities: ["appearance-v1",WORLD_CHUNKS_CAPABILITY],
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
socket.receive({type:"world_chunks",seq:1,complete:false,chunks:[]});
assert.equal(worldReady,0,"an intermediate chunk batch keeps the opaque loading gate in place");
socket.receive({type:"world_chunks",seq:1,complete:true,chunks:[]});
assert.equal(worldReady,1,"only the final subscribed chunk batch releases the world loading gate");
socket.receive({
  type:"block_patch",
  edit:{revision:2,x:0,y:21,z:0,block:0,editorId:"builder",editedAt:2_000},
});
assert.equal(worldEdits.at(-1)?.revision,2,"a newer authoritative patch establishes the chunk watermark");
const staleOperation="stale-block-replay-0001";
const stalePending=client.submitBlockEdit(staleOperation,{x:0,y:21,z:0,block:2},{
  previousBlock:0,selectedHotbar:2,expectedHeldItem:"dirt",expectedInventoryRevision:"1",
});
socket.receive({
  type:"block_patch",operationId:staleOperation,
  edit:{revision:1,x:0,y:21,z:0,block:2,editorId:"builder",editedAt:1_000},
});
await assert.rejects(stalePending,/stale_multiplayer_block_ack/);
assert.equal(worldEdits.at(-1)?.revision,2,"a stale retry acknowledgement cannot roll the rendered chunk backward");
const currentPending=client.submitBlockEdit(staleOperation,{x:0,y:21,z:0,block:2},{
  previousBlock:0,selectedHotbar:2,expectedHeldItem:"dirt",expectedInventoryRevision:"1",
});
socket.receive({
  type:"block_patch",operationId:staleOperation,
  edit:{revision:2,x:0,y:21,z:0,block:0,editorId:"builder",editedAt:2_000},
});
assert.deepEqual(await currentPending,{
  revision:2,x:0,y:21,z:0,block:0,operationId:staleOperation,
},"the exact retry resolves against current authoritative state");
assert.equal(worldEdits.at(-1)?.block,0,"the requester reconciles to the current block without stale application");
socket.receive({type:"world_chunks",seq:1,complete:true,chunks:[{x:0,z:0,revision:1,data:"not-a-chunk"}]});
assert.equal(worldReady,1,"a malformed final batch cannot release the authoritative loading gate");
assert.equal(socket.readyState,3,"a malformed chunk batch closes the connection so a clean subscription can be retried");
client.stop();

let legacyWorldReady = 0;
const legacy = new RealtimeMultiplayerClient({
  endpoint: "wss://legacy.test/ws", serverId: "legacy",
  demo: { token: "0123456789abcdef", userId: "builder", name: "Builder" },
  localUserId: "builder", localUsername: "Builder",
  getPose: () => ({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }),
  onPhase: () => {}, onRemotePlayers: () => {}, onWorldEdits: () => {}, onChatEvent: () => {}, onGameMode: () => {},
  onWorldChunksReady: () => { legacyWorldReady += 1; }, onDrops: () => {}, onPlayerHit: () => {}, onSelfHealth: () => {},
});
legacy.start();
const legacySocket = FakeWebSocket.instance;
legacySocket.readyState = FakeWebSocket.OPEN;
legacySocket.onopen?.();
legacySocket.receive({ type: "hello", capabilities: [], terrain: { preset: "default", superflatGroundY: 20 } });
legacySocket.receive({ type: "welcome", resumeToken: "resume", terrain: { preset: "default", superflatGroundY: 20 }, player: {} });
legacySocket.receive({ type: "world_snapshot", edits: [{ x: 0, y: 69, z: 0, block: "invalid" }] });
assert.equal(legacyWorldReady, 0, "a malformed legacy snapshot cannot bypass the authoritative loading gate");
assert.equal(legacySocket.readyState, 3, "a malformed legacy snapshot reconnects instead of revealing partial terrain");
legacy.stop();

// Generator versions are part of terrain identity. Undefined remains the
// explicit legacy wire value, while a hello/welcome version change must fail
// before the client joins two different deterministic worlds.
const versionPhases: string[] = [];
const versioned = new RealtimeMultiplayerClient({
  endpoint: "wss://versioned.test/ws", serverId: "versioned",
  demo: { token: "0123456789abcdef", userId: "builder", name: "Builder" },
  localUserId: "builder", localUsername: "Builder",
  getPose: () => ({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }),
  onPhase: (phase) => versionPhases.push(phase), onRemotePlayers: () => {}, onWorldEdits: () => {},
  onChatEvent: () => {}, onGameMode: () => {}, onWorldChunksReady: () => {}, onDrops: () => {},
  onPlayerHit: () => {}, onSelfHealth: () => {},
});
versioned.start();
const versionedSocket = FakeWebSocket.instance;
versionedSocket.readyState = FakeWebSocket.OPEN;
versionedSocket.onopen?.();
versionedSocket.receive({
  type: "hello", capabilities: [],
  terrain: { preset: "default", superflatGroundY: 20, generatorVersion: 2 },
});
versionedSocket.receive({
  type: "welcome", resumeToken: "resume",
  terrain: { preset: "default", superflatGroundY: 20, generatorVersion: 3 }, player: {},
});
assert.equal(versionedSocket.readyState, 3, "a v2 hello followed by a v3 welcome is rejected");
assert.ok(versionPhases.includes("error"), "a generator-version mismatch reports the terrain join error");
assert.ok(!versionPhases.includes("online"), "a generator-version mismatch never reaches online");
versioned.stop();
console.log("realtime terrain handshake: ok");
