import assert from "node:assert/strict";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";

Object.assign(globalThis, { window: {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 1,
  clearInterval: () => undefined,
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

const snapshots: any[] = [];
const hits: any[] = [];
const phases: any[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint:"wss://mobs.test/ws",serverId:"survival",
  demo:{token:"0123456789abcdef",userId:"alex",name:"Alex"},localUserId:"alex",localUsername:"Alex",
  getPose:()=>({x:0.5,y:69.02,z:0.5,yaw:0,pitch:0}),
  onPhase:(phase,detail)=>phases.push({phase,detail}),onRemotePlayers:()=>{},onWorldEdits:()=>{},onChatEvent:()=>{},onGameMode:()=>{},
  onDrops:()=>{},onPlayerHit:()=>{},onSelfHealth:()=>{},
  onMobSnapshot:(poses,states,serverNow)=>snapshots.push({poses,states,serverNow}),
  onMobHit:(hit)=>hits.push(hit),
});
client.start();
const socket = Socket.instance;
socket.readyState = Socket.OPEN;
socket.onopen?.();
socket.receive({type:"hello",capabilities:["appearance-v1","world-chunks-v1","mobs-v1"],terrain:{preset:"default",superflatGroundY:20}});
socket.receive({type:"welcome",resumeToken:"resume",terrain:{preset:"default",superflatGroundY:20},player:{x:.5,y:69.02,z:.5,yaw:0,pitch:0,gameMode:"survival",health:20}});
const state = {mobId:"chicken-5nb-0",kind:"chicken",health:4,maxHealth:4,revision:0,sheared:false,
  deadUntil:0,lastAttackAt:0,lastAttackerId:""};
const pose = {mobId:"chicken-5nb-0",kind:"chicken",x:2.5,y:70,z:2.5,yaw:0,behavior:"idle",
  targetUserId:"",fuseStartedTick:0,fuseUntilTick:0,fuseProgress:0};
socket.receive({type:"mob_snapshot",serverNow:1000,tick:1,poses:[pose],states:[state]});
assert.deepEqual(snapshots, [{poses:[pose],states:[state],serverNow:1000}], "one validated Railway snapshot reaches presentation intact");
socket.receive({type:"mob_snapshot",serverNow:1001,tick:2,poses:[{...pose,x:Number.NaN}],states:[state]});
assert.equal(snapshots.length,1,"a malformed pose rejects the entire authority snapshot");
client.submitMobAttack("mob_attack:transport","chicken-5nb-0");
assert.deepEqual(socket.sent.at(-1),{v:1,type:"mob_attack",operationId:"mob_attack:transport",mobId:"chicken-5nb-0"});
const phasesBeforeRejectedAttack = phases.length;
socket.receive({type:"error",operationId:"mob_attack:transport",code:"rate_limited",
  message:"Mob attack is cooling down",fatal:false,retryable:true});
assert.equal(phases.length,phasesBeforeRejectedAttack,
  "an operation-scoped mob rejection never poisons the live connection phase");
const dead = {...state,health:0,revision:1,deadUntil:31_000,lastAttackAt:1_000,lastAttackerId:"alex"};
socket.receive({type:"mob_hit",operationId:"mob_attack:transport",attackerId:"alex",damage:7,killed:true,replayed:false,state:dead});
assert.deepEqual(hits.at(-1),{operationId:"mob_attack:transport",attackerId:"alex",damage:7,killed:true,replayed:false,state:dead});
socket.receive({type:"mob_hit",operationId:"bad",attackerId:"alex",damage:7,killed:false,replayed:false,state:dead});
assert.equal(hits.length,1,"inconsistent death flags never reach gameplay presentation");
client.stop();
console.log("realtime Railway mob transport: ok");
