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
let selfHealth = 20;
const playerHits: any[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint:"wss://example.test/ws", serverId:"server",
  demo:{ token:"0123456789abcdef", userId:"alex", name:"Alex" },
  localUserId:"alex", localUsername:"Alex", getPose:() => pose,
  getHeldItem:() => "diamond_pickaxe",
  onPhase:() => {}, onRemotePlayers:(players) => { remotes = players; }, onWorldEdits:() => {}, onChatEvent:() => {}, onGameMode:() => {}, onDrops:(next) => { drops = next; },
  onSelfHealth:(health) => { selfHealth = health; }, onPlayerHit:(hit) => { playerHits.push(hit); },
  onReconcilePose:(next) => { reconciliations.push(next); pose = next; },
});
client.start();
const socket = Socket.instance;
socket.readyState = Socket.OPEN;
socket.onopen?.();
socket.receive({ type:"welcome", resumeToken:"resume", player:{ ...pose, gameMode:"survival", health:20 } });
assert.equal(selfHealth, 20);
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
  health:0,visualActions:[{ sequence:2, kind:"swing" }],
}] });
assert.deepEqual({ heldItem:remotes[0].heldItem,crouching:remotes[0].crouching,action:remotes[0].visualActions[0].kind },
  { heldItem:"iron_pickaxe",crouching:true,action:"swing" }, "third-person pose inputs survive the transport decoder");
assert.equal(remotes[0].health, 0, "remote fatal health survives the bounded snapshot decoder");
socket.receive({ type:"snapshot", inputAck:input.seq, self:{ ...pose, gameMode:"survival" }, players:[{
  id:"malformed",name:"Malformed",x:2,y:69.02,z:2,yaw:0,pitch:0,visualActions:[null,{ sequence:3,kind:"invalid" }],
}] });
assert.doesNotThrow(() => remotes, "untrusted community-server action payloads cannot break rendering");
assert.deepEqual(remotes[0].visualActions ?? [], [], "malformed visual actions are removed at the wire boundary");
const dropPromise = client.submitDrop("drop_transport_1", { itemId:"diamond_pickaxe",count:1,durability:120 }, pose, true);
const dropRequest = socket.sent.at(-1)!;
assert.equal(dropRequest.ownerMustLeave, true, "manual Q-tosses carry the owner leave-radius rule over the literal wire key");
socket.receive({ type:"drop_result",operationId:dropRequest.operationId,action:"drop",drop:{
  dropId:"drop:test",ownerUserId:"alex",itemId:"diamond_pickaxe",count:1,durability:120,x:pose.x,y:pose.y,z:pose.z,
  droppedAt:1,ownerPickupAt:501,ownerPickupBlocked:true,expiresAt:300001,
} });
const confirmedDrop = await dropPromise;
assert.deepEqual([confirmedDrop.item.durability, confirmedDrop.ownerPickupBlocked], [120, true]);
socket.receive({ type:"drop_snapshot",drops:[{
  dropId:"drop:test",ownerUserId:"alex",itemId:"diamond_pickaxe",count:1,durability:120,x:pose.x,y:pose.y,z:pose.z,
  droppedAt:1,ownerPickupAt:501,ownerPickupBlocked:true,expiresAt:300001,
}] });
assert.equal(drops[0].item.itemId, "diamond_pickaxe", "Railway drop snapshots retain exact item metadata");
assert.equal(drops[0].ownerPickupBlocked, true, "the owner cannot recollect a toss before leaving its radius");
client.submitPlayerAttack("attack:transport", "steve");
assert.deepEqual(socket.sent.at(-1), { v:1,type:"player_attack",operationId:"attack:transport",targetId:"steve" });
socket.receive({ type:"player_hit",operationId:"attack:transport",attackerId:"alex",targetId:"steve",
  damage:7,health:13,killed:false,attackerX:pose.x,attackerZ:pose.z });
assert.deepEqual(playerHits.at(-1), { operationId:"attack:transport",attackerId:"alex",targetId:"steve",
  damage:7,health:13,killed:false,attackerX:pose.x,attackerZ:pose.z });
client.submitSelfDamage("fall:transport", 6);
assert.deepEqual(socket.sent.at(-1), { v:1,type:"self_damage",operationId:"fall:transport",damage:6,cause:"fall" });
socket.receive({ type:"self_damage_result",operationId:"fall:transport",damage:6,health:14,killed:false,cause:"fall" });
assert.equal(selfHealth, 14, "fall damage health only changes after Railway acknowledges and persists it");
const respawnPromise = client.submitRespawn();
const respawnRequest = socket.sent.at(-1)!;
assert.equal(respawnRequest.type, "respawn");
socket.receive({ type:"respawned",operationId:respawnRequest.operationId,player:{ x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 } });
const respawnPose = await respawnPromise;
assert.deepEqual(respawnPose, { x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 },
  "respawn resolves only from the Railway authority response");
pose = respawnPose;
intervals.values().next().value?.();
const rebasedInput = socket.sent.findLast((message) => message.type === "input")!;
assert.deepEqual([rebasedInput.moveX, rebasedInput.moveZ, rebasedInput.jump], [0, 0, false],
  "the first post-respawn sample is rebased at spawn instead of replaying dead-pose movement");
client.stop();
console.log("realtime acknowledged movement: ok");
