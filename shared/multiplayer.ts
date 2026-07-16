import { sleepVoteStatus, type PresenceLike } from "./sleep.ts";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 16;
export const CHAT_MESSAGE_MAX_LENGTH = 180;
export const CHAT_RATE_LIMIT_MS = 900;
export const RECENT_CHAT_LIMIT = 80;
export const FERN_HOLLOW_PLAYER_CAPACITY = 20;

export type FernHollowServerStatus = {
  status: "online";
  onlinePlayers: number;
  capacity: typeof FERN_HOLLOW_PLAYER_CAPACITY;
  sampledAt: number;
};

/** Bounded server-list projection over the same active lease used by shared sleep authority. */
export function fernHollowServerStatus(
  presences: readonly PresenceLike[],
  serverNow: number,
): FernHollowServerStatus {
  const sampledAt = Number.isFinite(serverNow) ? Math.max(0, Math.floor(serverNow)) : 0;
  return {
    status: "online",
    onlinePlayers: Math.min(
      FERN_HOLLOW_PLAYER_CAPACITY,
      sleepVoteStatus(presences, [], sampledAt).activePlayers,
    ),
    capacity: FERN_HOLLOW_PLAYER_CAPACITY,
    sampledAt,
  };
}

export type UsernameIssue = "required" | "too_short" | "too_long" | "invalid_characters";

export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; reason: UsernameIssue };

export type Profile = {
  id: string;
  userId: string;
  username: string;
  normalizedUsername: string;
  claimedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type UsernameAvailability =
  | { available: true; username: string }
  | { available: false; username: string; reason: UsernameIssue | "taken" };

export type ClaimUsernameResult =
  | { ok: true; profile: Profile }
  | {
      ok: false;
      reason: UsernameIssue | "authentication_required" | "taken" | "username_locked";
    };

export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  message: string;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SendChatResult =
  | { ok: true; message: ChatMessage }
  | {
      ok: false;
      reason: "authentication_required" | "profile_required" | "empty" | "too_long" | "rate_limited";
      retryAfterMs?: number;
    };

/** Usernames are canonicalized before validation, storage, lookup, and display. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): UsernameValidation {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, reason: "required" };
  if (username.length < USERNAME_MIN_LENGTH) return { ok: false, reason: "too_short" };
  if (username.length > USERNAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!/^[a-z0-9_]+$/.test(username)) return { ok: false, reason: "invalid_characters" };
  return { ok: true, username };
}

/** Chat is deliberately single-line so it stays readable over gameplay. */
export function normalizeChatMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateChatMessage(
  value: string
): { ok: true; message: string } | { ok: false; reason: "empty" | "too_long" } {
  const message = normalizeChatMessage(value);
  if (!message) return { ok: false, reason: "empty" };
  if (message.length > CHAT_MESSAGE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, message };
}

/** Collapse append-only profile events to the newest event for each Lakebed user. */
export function latestProfilesByUser(events: readonly Profile[]): Profile[] {
  const latest = new Map<string, Profile>();
  for (const event of events) {
    const previous = latest.get(event.userId);
    if (
      !previous ||
      event.claimedAt > previous.claimedAt ||
      (event.claimedAt === previous.claimedAt && event.id > previous.id)
    ) {
      latest.set(event.userId, event);
    }
  }
  return [...latest.values()];
}
