import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLakebedCompilerRuntime } from "../scripts/lakebed-compiler-runtime.mjs";
import { LAKEBED_VERSION } from "../scripts/lakebed-toolchain.mjs";
import { compactClientPropertyCache, COMPACT_CLIENT_PROPERTY_PATTERN } from "../scripts/client-property-compaction.mjs";

const { build } = await loadLakebedCompilerRuntime({ lakebedVersion: LAKEBED_VERSION });
const result = await build({
  stdin: { contents: `
    import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
    import { applyRealtimeChatEvent } from "../client/realtimeChat.ts";
    export function receiveHistory(wire) {
      let history = [];
      const client = new RealtimeMultiplayerClient({
        onChatEvent: event => { history = applyRealtimeChatEvent(history, event); },
      });
      client.handleMessage(JSON.parse(wire));
      return history.map(row => row.message);
    }
  `, loader: "ts", resolveDir: dirname(fileURLToPath(import.meta.url)) },
  bundle: true, format: "esm", write: false, minify: true,
  mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN,
  mangleCache: compactClientPropertyCache(), mangleQuoted: false,
});
const { receiveHistory } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
// Keep the server packet outside the compact compilation boundary.
const packet = { v: 1, type: "chat_history", messages: [{
  id: "chat:1", sequence: 1, operationId: "chat_check_1", userId: "test-player",
  username: "Tester", message: "persisted before restart", sentAt: 1000,
}] };
assert.deepEqual(receiveHistory(JSON.stringify(packet)), ["persisted before restart"]);
assert.deepEqual(receiveHistory(JSON.stringify({ ...packet, messages: [] })), []);
assert.deepEqual(receiveHistory(JSON.stringify({ ...packet, messages: [{}] })), []);
