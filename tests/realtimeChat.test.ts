import assert from "node:assert/strict";
import { applyRealtimeChatEvent, countUnreadRealtimeChat, type RealtimeChatMessage } from "../client/realtimeChat.ts";

const confirmed = (
  sequence: number,
  operationId: string,
  userId = "other",
): RealtimeChatMessage => ({
  id: `chat:${sequence}`,
  sequence,
  operationId,
  userId,
  username: userId,
  message: `message ${sequence}`,
  sentAt: 1_000 + sequence,
  delivery: "sent",
});

const optimistic: RealtimeChatMessage = {
  id: "pending:chat_self_0001",
  sequence: 0,
  operationId: "chat_self_0001",
  userId: "self",
  username: "Alex",
  message: "hello",
  sentAt: 2_000,
  delivery: "sending",
};

let state = applyRealtimeChatEvent([], { type: "optimistic", message: optimistic });
assert.equal(state[0].delivery, "sending", "sender sees its message before a server round trip");
state = applyRealtimeChatEvent(state, { type: "confirmed", message: { ...confirmed(2, optimistic.operationId, "self"), message: "hello" } });
assert.deepEqual(state.map(({ id, delivery }) => ({ id, delivery })), [{ id: "chat:2", delivery: "sent" }],
  "ack replaces optimistic row instead of duplicating it");
state = applyRealtimeChatEvent(state, { type: "confirmed", message: confirmed(1, "chat_other_001") });
state = applyRealtimeChatEvent(state, { type: "confirmed", message: confirmed(1, "chat_other_001") });
assert.deepEqual(state.map(({ sequence }) => sequence), [1, 2], "duplicates collapse and server sequence controls order");

state = applyRealtimeChatEvent([
  ...state,
  { ...optimistic, operationId: "chat_pending_01", id: "pending:chat_pending_01" },
], { type: "history", messages: [confirmed(1, "chat_other_001"), confirmed(2, optimistic.operationId, "self")] });
assert.deepEqual(state.map(({ operationId }) => operationId), ["chat_other_001", "chat_self_0001", "chat_pending_01"],
  "reconnect history replaces confirmed rows while retaining an unacknowledged outgoing message");

state = applyRealtimeChatEvent(state, { type: "failed", operationId: "chat_pending_01" });
assert.equal(state.at(-1)?.delivery, "failed");

state = applyRealtimeChatEvent([], { type: "history", messages: [
  confirmed(3, "chat_3"), confirmed(1, "chat_1"), confirmed(2, "chat_2"),
  { ...confirmed(2, "chat_2"), id: "duplicate-wire-id" },
] });
assert.deepEqual(state.map(({ sequence }) => sequence), [1, 2, 3],
  "unordered reconnect history is sorted and duplicate operation receipts collapse");

const fullWindow = Array.from({ length: 80 }, (_, index) => confirmed(index + 21, `chat_window_${index}`));
assert.equal(countUnreadRealtimeChat(fullWindow, 98), 2,
  "unread messages remain sequence-based after the bounded 80-row window has already filled");

console.log("realtime chat reducer: ok");
