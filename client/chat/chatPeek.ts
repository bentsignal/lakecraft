export interface TimedChatMessage {
  sentAt: number | string;
}

export const CHAT_PEEK_FADE_MS = 1_000;

function sentAtMs(message: Readonly<TimedChatMessage>): number {
  if (typeof message.sentAt === "number") return message.sentAt;
  return Date.parse(message.sentAt);
}

/** Full history remains untouched; only the three-line closed HUD view ages out. */
export function visibleChatPeekMessages<T extends TimedChatMessage>(
  messages: readonly T[],
  nowMs: number,
  maxAgeMs = Number.POSITIVE_INFINITY,
): readonly T[] {
  const bounded = Number.isFinite(maxAgeMs) && maxAgeMs >= 0;
  return (bounded
    ? messages.filter((message) => {
      const sentAt = sentAtMs(message);
      return Number.isFinite(sentAt) && nowMs - sentAt < maxAgeMs;
    })
    : messages).slice(-3);
}

export function nextChatPeekExpiryDelay(
  messages: readonly TimedChatMessage[],
  nowMs: number,
  maxAgeMs: number,
): number | null {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return null;
  let delay = Number.POSITIVE_INFINITY;
  for (const message of messages) {
    const sentAt = sentAtMs(message);
    const expiresIn = sentAt + maxAgeMs - nowMs;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) continue;
    const fadeStartsIn = expiresIn - Math.min(CHAT_PEEK_FADE_MS, maxAgeMs);
    const refreshIn = fadeStartsIn > 0 ? fadeStartsIn : expiresIn;
    if (refreshIn < delay) delay = refreshIn;
  }
  return Number.isFinite(delay) ? Math.max(1, Math.ceil(delay)) : null;
}

export function chatPeekMessageFading(message: Readonly<TimedChatMessage>, nowMs: number, maxAgeMs: number): boolean {
  const age = nowMs - sentAtMs(message);
  return Number.isFinite(age) && Number.isFinite(maxAgeMs)
    && age >= Math.max(0, maxAgeMs - CHAT_PEEK_FADE_MS) && age < maxAgeMs;
}
