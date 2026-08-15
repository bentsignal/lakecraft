import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
import type { RealtimeChatEvent } from "../client/realtimeChat.ts";

type Timer = { callback: () => void; interval: boolean };
const timers = new Map<number, Timer>();
let timerId = 0;
const fakeWindow = {
  setTimeout(callback: () => void) {
    const id = ++timerId;
    timers.set(id, { callback, interval: false });
    return id;
  },
  clearTimeout(id: number) { timers.delete(id); },
  setInterval(callback: () => void) {
    const id = ++timerId;
    timers.set(id, { callback, interval: true });
    return id;
  },
  clearInterval(id: number) { timers.delete(id); },
};
Object.assign(globalThis, { window: fakeWindow });

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
  readonly endpoint: string;

  constructor(endpoint: string) { this.endpoint = endpoint; FakeWebSocket.instances.push(this); }
  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(message: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) }); }
  disconnect() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const events: RealtimeChatEvent[] = [];
const client = new RealtimeMultiplayerClient({
  endpoint: "wss://example.test/ws",
  serverId: "server",
  demo: { token: "0123456789abcdef", userId: "alex", name: "Alex" },
  localUserId: "alex",
  localUsername: "Alex",
  getPose: () => ({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }),
  onPhase: () => {},
  onRemotePlayers: () => {},
  onWorldEdits: () => {},
  onChatEvent: (event) => events.push(event),
  onGameMode: () => {},
  onDrops: () => {},
});

const welcome = {
  type: "welcome",
  resumeToken: "resume-token",
  player: { gameMode: "survival" },
};
client.start();
const first = FakeWebSocket.instances[0]!;
first.open();
first.receive(welcome);
first.receive({type:"private_notice",message:"You have been granted operator privileges.",sentAt:999});
assert.deepEqual(events.at(-1),{type:"confirmed",message:{
  id:"notice_1_999",sequence:0,operationId:"notice_1_999",userId:"server",username:"[Server]",
  message:"You have been granted operator privileges.",sentAt:999,delivery:"sent",
}},"private server administration feedback appears only in the recipient's normal chat projection");
await client.submitChat("  survives reconnect  ");
const original = first.sent.find((message) => message.type === "chat_send")!;
assert.equal(events.at(-1)?.type, "optimistic", "sender is updated before an acknowledgement");

first.disconnect();
const reconnect = [...timers.values()].find((timer) => !timer.interval)!;
timers.clear();
reconnect.callback();
const second = FakeWebSocket.instances[1]!;
second.open();
second.receive(welcome);
const replay = second.sent.find((message) => message.type === "chat_send")!;
assert.deepEqual(replay, original, "ambiguous delivery resends the exact operation id and normalized payload");

second.receive({
  type: "chat_message",
  message: {
    id: "chat:1",
    sequence: 1,
    operationId: original.operationId,
    userId: "alex",
    username: "Alex",
    message: original.message,
    sentAt: 1_000,
  },
});
second.disconnect();
const nextReconnect = [...timers.values()].find((timer) => !timer.interval)!;
timers.clear();
nextReconnect.callback();
const third = FakeWebSocket.instances[2]!;
third.open();
third.receive(welcome);
assert.equal(third.sent.some((message) => message.type === "chat_send"), false,
  "confirmed operations leave the pending replay set");

await client.submitChat("rejected");
const rejected = third.sent.findLast((message) => message.type === "chat_send")!;
third.receive({
  type: "error",
  code: "rate_limited",
  operationId: rejected.operationId,
  message: "retry later",
  fatal: false,
  retryable: true,
});
third.disconnect();
const finalReconnect = [...timers.values()].find((timer) => !timer.interval)!;
timers.clear();
finalReconnect.callback();
const fourth = FakeWebSocket.instances[3]!;
fourth.open();
fourth.receive(welcome);
assert.equal(fourth.sent.some((message) => message.type === "chat_send"), false,
  "correlated rejection also clears the pending replay set");
for (let index = 0; index < 16; index += 1) await client.submitChat(`pending ${index}`);
await assert.rejects(client.submitChat("overflow"), /multiplayer_chat_backlog/,
  "the ambiguity replay set is bounded under a non-acknowledging server");

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.match(app, /setRealtimeChatMessages\(\[\]\);[\s\S]{0,240}\[realtimeSession\?\.endpoint\]/,
  "chat projection resets whenever the realtime endpoint changes");
assert.match(app, /const \[transportReady, setTransportReady\] = useState\(false\)/);
assert.match(app, /const worldConnected = transportReady/,
  "the Railway gameplay surface uses only Railway readiness");
const realtimeTransport = app.slice(app.indexOf("<RealtimeMultiplayerTransport"), app.indexOf("<GameHud"));
assert.match(realtimeTransport, /setTransportReady\(phase === "online"\)/,
  "Railway lifecycle exclusively updates the realtime connection channel");
assert.doesNotMatch(realtimeTransport, /setConnected\(phase === "online"\)/,
  "Railway lifecycle cannot overwrite Lakebed mutation health");
const chatOverlay = app.slice(app.indexOf("<ChatOverlay"), app.indexOf("/>\n\n      {engineError"));
assert.match(chatOverlay, /connected=\{worldConnected\}/,
  "chat availability follows the active world transport rather than Lakebed mutations");

client.stop();
console.log("realtime chat transport reconnect: ok");
