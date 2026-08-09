/** Minimal load/smoke harness: CLIENTS=10 WS_URL=ws://localhost:3001/ws bun run scripts/synthetic-client.ts */
import type { ServerMessage } from "../src/protocol";

const count = Math.max(1, Math.min(100, Number(Bun.env.CLIENTS || 4)));
const url = Bun.env.WS_URL || "ws://127.0.0.1:3001/ws";
const token = Bun.env.LOCAL_DEMO_TOKEN;
if (!token) throw new Error("LOCAL_DEMO_TOKEN is required by the synthetic client");

let welcomed = 0;
let snapshots = 0;
const sockets: WebSocket[] = [];

for (let index = 0; index < count; index++) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  let seq = 0;
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      v: 1,
      type: "join",
      demo: { token, userId: `synthetic-${index}`, name: `Bot ${index}` },
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "welcome") {
      welcomed++;
      const timer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return clearInterval(timer);
        const angle = (Date.now() / 1_000 + index) % (Math.PI * 2);
        socket.send(JSON.stringify({
          v: 1, type: "input", seq: ++seq, dtMs: 50,
          moveX: Math.cos(angle), moveZ: Math.sin(angle), yaw: angle, pitch: 0,
          jump: seq % 40 === 0, sprint: index % 2 === 0,
        }));
      }, 50);
    } else if (message.type === "snapshot") snapshots++;
    else if (message.type === "error") console.error(`client ${index}: ${message.code}: ${message.message}`);
  });
}

const durationMs = Math.max(1_000, Number(Bun.env.DURATION_MS || 10_000));
setTimeout(() => {
  for (const socket of sockets) socket.close();
  console.log(JSON.stringify({ clients: count, welcomed, snapshots, durationMs }, null, 2));
  process.exit(welcomed === count && snapshots > 0 ? 0 : 1);
}, durationMs);
