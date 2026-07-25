
import * as BS from "./bundleStrings.ts";
export const WORLD_CLOCK_KEY = "main";
export const WORLD_CYCLE_LENGTH_MS = 8 * 60 * 1_000;
export const MORNING_PHASE = 0.25;
export const ACTIVE_PLAYER_WINDOW_MS = 90_000;
export const SLEEP_VOTE_FRESH_MS = 100_000;
export const MAX_SLEEP_PARTICIPANTS = 128;

export interface ClockRowLike {
  epochMs: string;
  epochPhase: string;
}

export interface WorldClockSnapshot {
  key: typeof WORLD_CLOCK_KEY;
  epochMs: number;
  epochPhase: number;
  cycleLengthMs: number;
  serverNow: number;
}

export type SleepInBedResult =
  | {
      ok: true;
      slept: boolean;
      activePlayers: number;
      sleepingPlayers: number;
      requiredPlayers: number;
      clock?: WorldClockSnapshot;
    }
  | {
      ok: false;
      reason: "authentication_required" | "invalid_coordinate" | "bed_required" | "active_presence_required";
    };

export interface PresenceLike {
  userId: string;
  heartbeatAt: string;
  online: boolean;
}

export interface SleepVoteLike {
  userId: string;
  votedAt: string;
}

export interface SleepVoteStatus {
  activePlayerIds: string[];
  freshVoterIds: string[];
  activePlayers: number;
  sleepingPlayers: number;
  requiredPlayers: number;
  reached: boolean;
}

export type SleepCoordinateValidation =
  | { ok: true; coordKey: string; x: number; y: number; z: number }
  | { ok: false; reason: "invalid_coordinate" };

function positiveModulo(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

export function normalizeWorldPhase(value: number): number {
  return Number.isFinite(value) ? positiveModulo(value, 1) : 0;
}

export function worldPhaseAt(
  serverNow: number,
  epochMs: number,
  epochPhase: number,
  cycleLengthMs = WORLD_CYCLE_LENGTH_MS,
): number {
  const safeCycle = Number.isFinite(cycleLengthMs) && cycleLengthMs > 0
    ? cycleLengthMs
    : WORLD_CYCLE_LENGTH_MS;
  const safeNow = Number.isFinite(serverNow) ? serverNow : 0;
  const safeEpoch = Number.isFinite(epochMs) ? epochMs : 0;
  return normalizeWorldPhase(normalizeWorldPhase(epochPhase) + (safeNow - safeEpoch) / safeCycle);
}

export function worldClockSnapshot(row: Readonly<ClockRowLike> | null, serverNow: number): WorldClockSnapshot {
  const now = Number.isFinite(serverNow) ? serverNow : 0;
  const parsedEpochMs = row ? Number(row.epochMs) : 0;
  const parsedEpochPhase = row ? Number(row.epochPhase) : 0;
  return {
    key: WORLD_CLOCK_KEY,
    epochMs: Number.isFinite(parsedEpochMs) ? parsedEpochMs : 0,
    epochPhase: normalizeWorldPhase(parsedEpochPhase),
    cycleLengthMs: WORLD_CYCLE_LENGTH_MS,
    serverNow: now,
  };
}

export function morningClockSnapshot(serverNow: number): WorldClockSnapshot {
  const now = Number.isFinite(serverNow) ? serverNow : 0;
  return {
    key: WORLD_CLOCK_KEY,
    epochMs: now,
    epochPhase: MORNING_PHASE,
    cycleLengthMs: WORLD_CYCLE_LENGTH_MS,
    serverNow: now,
  };
}

export function validateSleepCoordinate(rawCoordKey: string): SleepCoordinateValidation {
  const parts = rawCoordKey.trim().split(":");
  if (parts.length !== 3 || parts.some((part) => !/^-?\d{1,3}$/.test(part))) {
    return { ok: false, reason: BS.invalidCoordinate };
  }
  const [x, y, z] = parts.map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
    || x < -64 || x > 64 || y < -4 || y > 64 || z < -64 || z > 64) {
    return { ok: false, reason: BS.invalidCoordinate };
  }
  return { ok: true, coordKey: `${x}:${y}:${z}`, x, y, z };
}

/** Unanimity among active players, minimum one, keeps the alpha rule predictable. */
export function sleepVoteStatus(
  presences: readonly PresenceLike[],
  votes: readonly SleepVoteLike[],
  serverNow: number,
): SleepVoteStatus {
  const activeCutoff = serverNow - ACTIVE_PLAYER_WINDOW_MS;
  const voteCutoff = serverNow - SLEEP_VOTE_FRESH_MS;
  const latestPresence = new Map<string, PresenceLike>();
  for (const presence of presences.slice(0, MAX_SLEEP_PARTICIPANTS)) {
    const previous = latestPresence.get(presence.userId);
    if (!previous || Number(presence.heartbeatAt) > Number(previous.heartbeatAt)) {
      latestPresence.set(presence.userId, presence);
    }
  }
  const activePlayerIds = [...latestPresence.values()]
    .filter((presence) => presence.online
      && Number.isFinite(Number(presence.heartbeatAt))
      && Number(presence.heartbeatAt) >= activeCutoff
      && Number(presence.heartbeatAt) <= serverNow + 5_000)
    .map((presence) => presence.userId)
    .sort();
  const activePlayers = new Set(activePlayerIds);
  const latestVote = new Map<string, number>();
  for (const vote of votes.slice(0, MAX_SLEEP_PARTICIPANTS)) {
    if (!activePlayers.has(vote.userId)) continue;
    const votedAt = Number(vote.votedAt);
    if (!Number.isFinite(votedAt) || votedAt < voteCutoff || votedAt > serverNow + 5_000) continue;
    if (votedAt > (latestVote.get(vote.userId) ?? -Infinity)) latestVote.set(vote.userId, votedAt);
  }
  const freshVoterIds = [...latestVote.keys()].sort();
  const requiredPlayers = activePlayerIds.length;
  return {
    activePlayerIds,
    freshVoterIds,
    activePlayers: requiredPlayers,
    sleepingPlayers: freshVoterIds.length,
    requiredPlayers,
    reached: requiredPlayers >= 1 && freshVoterIds.length >= requiredPlayers,
  };
}
