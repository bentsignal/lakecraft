import assert from "node:assert/strict";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";

const intervals = new Map<number, () => void>();
let timerId = 0;
Object.assign(globalThis, { window: {
  setTimeout: () => ++timerId,
  clearTimeout: () => undefined,
  setInterval: (callback: () => void) => { const id = ++timerId; intervals.set(id, callback); return id; },
  clearInterval: (id: number) => intervals.delete(id),
} });

class Socket {
  static readonly OPEN = 1;
  static instance: Socket;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = "";
  constructor() { Socket.instance = this; }
  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; }
  receive(message: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify({ v:1, ...message }) }); }
}
Object.assign(globalThis, { WebSocket: Socket });

let pose = { x:0.5, y:69.02, z:0.5, yaw:0, pitch:0 };
const reconciliations: typeof pose[] = [];
let remotes: any[] = [];
let drops: any[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint:"wss://example.test/ws", serverId:"server",
  demo:{ token:"0123456789abcdef", userId:"alex", name:"Alex" },
  localUserId:"alex", localUsername:"Alex", getPose:() => pose,
  getHeldItem:() => "diamond_pickaxe",
  onPhase:() => {}, onRemotePlayers:(players) => { remotes = players; }, onWorldEdits:() => {}, onChatEvent:() => {}, onGameMode:() => {}, onDrops:(next) => { drops = next; },
  onReconcilePose:(next) => { reconciliations.push(next); pose = next; },
});
client.start();
const socket = Socket.instance;
socket.readyState = Socket.OPEN;
socket.onopen?.();
socket.receive({ type:"welcome", resumeToken:"resume", player:{ ...pose, gameMode:"survival" } });
reconciliations.length = 0;
pose = { ...pose, x:0.72, yaw:0.2 };
intervals.values().next().value?.();
const input = socket.sent.findLast((message) => message.type === "input")!;
assert.deepEqual([input.x, input.y, input.z], [0.72, 69.02, 0.5], "canonical pose rides with its input sequence");
assert.equal(input.heldItem, "diamond_pickaxe", "the selected item shares the same canonical sample");
pose = { ...pose, x:0.95 };
socket.receive({
  type:"snapshot", inputAck:input.seq, self:{ x:0.72,y:69.02,z:0.5,yaw:0.2,pitch:0,gameMode:"survival" }, players:[],
});
assert.equal(reconciliations.length, 0, "an acknowledged older snapshot never rewinds newer local movement");
client.submitAction("crouch_on");
assert.equal(socket.sent.at(-1)?.kind, "crouch_on");
socket.receive({ type:"snapshot", inputAck:input.seq, self:{ ...pose, gameMode:"survival" }, players:[{
  id:"steve",name:"Steve",x:1,y:69.02,z:1,yaw:0,pitch:0,heldItem:"iron_pickaxe",crouching:true,
  visualActions:[{ sequence:2, kind:"swing" }],
}] });
assert.deepEqual({ heldItem:remotes[0].heldItem,crouching:remotes[0].crouching,action:remotes[0].visualActions[0].kind },
  { heldItem:"iron_pickaxe",crouching:true,action:"swing" }, "third-person pose inputs survive the transport decoder");
socket.receive({ type:"snapshot", inputAck:input.seq, self:{ ...pose, gameMode:"survival" }, players:[{
  id:"malformed",name:"Malformed",x:2,y:69.02,z:2,yaw:0,pitch:0,visualActions:[null,{ sequence:3,kind:"invalid" }],
}] });
assert.doesNotThrow(() => remotes, "untrusted community-server action payloads cannot break rendering");
assert.deepEqual(remotes[0].visualActions ?? [], [], "malformed visual actions are removed at the wire boundary");
const dropPromise = client.submitDrop("drop_transport_1", { itemId:"diamond_pickaxe",count:1,durability:120 }, pose);
const dropRequest = socket.sent.at(-1)!;
socket.receive({ type:"drop_result",operationId:dropRequest.operationId,action:"drop",drop:{
  dropId:"drop:test",ownerUserId:"alex",itemId:"diamond_pickaxe",count:1,durability:120,x:pose.x,y:pose.y,z:pose.z,
  droppedAt:1,ownerPickupAt:501,expiresAt:300001,
} });
assert.equal((await dropPromise).item.durability, 120);
socket.receive({ type:"drop_snapshot",drops:[{
  dropId:"drop:test",ownerUserId:"alex",itemId:"diamond_pickaxe",count:1,durability:120,x:pose.x,y:pose.y,z:pose.z,
  droppedAt:1,ownerPickupAt:501,expiresAt:300001,
}] });
assert.equal(drops[0].item.itemId, "diamond_pickaxe", "Railway drop snapshots retain exact item metadata");
const respawnPromise = client.submitRespawn();
const respawnRequest = socket.sent.at(-1)!;
assert.equal(respawnRequest.type, "respawn");
socket.receive({ type:"respawned",operationId:respawnRequest.operationId,player:{ x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 } });
assert.deepEqual(await respawnPromise, { x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 },
  "respawn resolves only from the Railway authority response");
client.stop();
console.log("realtime acknowledged movement: ok");
