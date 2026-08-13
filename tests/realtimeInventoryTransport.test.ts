import assert from "node:assert/strict";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
import { createInitializedPlayerState } from "../shared/inventoryActions.ts";

type Timer = { callback: () => void; interval: boolean };
const timers = new Map<number, Timer>();
let timerId = 0;
Object.assign(globalThis, { window: {
  setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, { callback, interval:false }); return id; },
  clearTimeout(id: number) { timers.delete(id); },
  setInterval(callback: () => void) { const id = ++timerId; timers.set(id, { callback, interval:true }); return id; },
  clearInterval(id: number) { timers.delete(id); },
} });

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly endpoint: string) { FakeWebSocket.instances.push(this); }
  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(message: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify({ v:1,...message }) }); }
  disconnect() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const state = createInitializedPlayerState();
const inventoryJson = JSON.stringify(state);
const received: string[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint:"wss://example.test/ws",
  serverId:"server",
  demo:{ token:"0123456789abcdef",userId:"alex",name:"Alex" },
  localUserId:"alex",
  localUsername:"Alex",
  getPose:() => ({ x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 }),
  getInitialInventoryJson:() => inventoryJson,
  onPhase:() => {},onRemotePlayers:() => {},onWorldEdits:() => {},onChatEvent:() => {},
  onGameMode:() => {},onDrops:() => {},onPlayerHit:() => {},onSelfHealth:() => {},
  onInventoryState:(inventory) => received.push(inventory.revision),
});

client.start();
const first = FakeWebSocket.instances[0]!;
first.open();
const join = first.sent.find((message) => message.type === "join")!;
assert.equal((join.demo as { inventoryJson?: string }).inventoryJson, inventoryJson,
  "a first trusted-demo join seeds Railway with the already validated shared pack");
first.receive({ type:"welcome",resumeToken:"resume",player:{ gameMode:"survival",health:20,x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 } });
first.receive({ type:"inventory_state",inventory:{
  id:"railway:alex",userId:"alex",inventoryJson,revision:"1",createdAt:"1000",updatedAt:"1000",
} });
assert.deepEqual(received,["1"]);

const requestJson = JSON.stringify({
  operationId:"inventory_place_0001",expectedRevision:"1",kind:"place_block",sourceSlot:2,expectedItemId:"dirt",
});
const pending = client.submitInventoryAction(requestJson);
assert.equal(first.sent.findLast((message) => message.type === "inventory_action")?.requestJson,requestJson);
first.disconnect();
const reconnectTimer = [...timers.values()].filter((timer) => !timer.interval).at(-1)!;
timers.clear();
reconnectTimer.callback();
const second = FakeWebSocket.instances[1]!;
second.open();
second.receive({ type:"welcome",resumeToken:"resume-2",player:{ gameMode:"survival",health:20,x:0.5,y:69.02,z:0.5,yaw:0,pitch:0 } });
assert.equal(second.sent.find((message) => message.type === "inventory_action")?.requestJson,requestJson,
  "an ambiguous disconnect replays the identical idempotent pack operation");
const nextInventory = JSON.stringify({ ...state,inventory:state.inventory.map((stack,index) =>
  index === 2 && stack ? { ...stack,count:stack.count - 1 } : stack) });
second.receive({ type:"inventory_result",operationId:"inventory_place_0001",result:{
  ok:true,replayed:true,effect:"placed_block",inventory:{
    id:"railway:alex",userId:"alex",inventoryJson:nextInventory,revision:"2",createdAt:"1000",updatedAt:"1010",
  },
} });
const result = await pending;
assert.equal(result.ok && result.inventory.revision,"2");
client.stop();
