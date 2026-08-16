export const REALTIME_CHAT_MAX_LENGTH = 180;

export type RealtimeChatDelivery = "sending" | "sent" | "failed";

export interface RealtimeChatMessage {
  id: string;
  sequence: number;
  operationId: string;
  userId: string;
  username: string;
  message: string;
  sentAt: number;
  delivery: RealtimeChatDelivery;
}

export type RealtimeChatEvent =
  | { type: "history"; messages: RealtimeChatMessage[] }
  | { type: "optimistic"; message: RealtimeChatMessage }
  | { type: "confirmed"; message: RealtimeChatMessage }
  | { type: "failed"; operationId: string };

export function normalizeRealtimeChat(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function countUnreadRealtimeChat(
  messages: readonly RealtimeChatMessage[],
  lastSeenSequence: number,
): number {
  return messages.filter((message) => message.sequence > lastSeenSequence).length;
}

/** Deterministic projection for optimistic echo, acknowledgement and reconnect history. */
export function applyRealtimeChatEvent(
  current: readonly RealtimeChatMessage[],
  event: RealtimeChatEvent,
): RealtimeChatMessage[] {
  let next: readonly RealtimeChatMessage[];
  if (event.type === "history") {
    const confirmedOperations = new Set(event.messages.map((message) => message.operationId));
    next = [
      ...event.messages,
      ...current.filter((message) => message.delivery !== "sent" && !confirmedOperations.has(message.operationId)),
    ];
  } else if (event.type === "failed") {
    next = current.map((message) => message.operationId === event.operationId
      ? { ...message, delivery: "failed" }
      : message);
  } else {
    const message = event.message;
    next = [
      ...current.filter((candidate) => candidate.id !== message.id && candidate.operationId !== message.operationId),
      message,
    ];
  }

  const deduplicated: RealtimeChatMessage[] = [];
  for (const message of next) {
    const duplicate = deduplicated.findIndex((candidate) =>
      candidate.id === message.id || candidate.operationId === message.operationId);
    if (duplicate < 0) deduplicated.push(message);
    else if (message.delivery === "sent" || deduplicated[duplicate].delivery !== "sent") deduplicated[duplicate] = message;
  }

  return deduplicated
    .sort((left, right) => {
      if (left.sequence > 0 && right.sequence > 0) return left.sequence - right.sequence;
      if (left.sequence > 0) return -1;
      if (right.sequence > 0) return 1;
      return left.sentAt - right.sentAt || left.operationId.localeCompare(right.operationId);
    })
    .slice(-80);
}
