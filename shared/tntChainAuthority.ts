import type { BlockType } from "./protocol.ts";
import { TNT_MAX_ACTIVE_FUSES, type TntFuse } from "./tntAuthority.ts";

export const TNT_CHAIN_MIN_FUSE_MS = 500;
export const TNT_CHAIN_MAX_FUSE_MS = 1_500;
export const TNT_CHAIN_MAX_PER_EXPLOSION = 8;
export const TNT_CHAIN_MAX_DEPTH = 8;

export type AuthoritativeTntBlastCell = {
  x: number;
  y: number;
  z: number;
  coordKey: string;
  distanceSquared: number;
  previousBlock: BlockType;
  blockInstanceToken: string | null;
};

export type TntChainSource = {
  eventId: string;
  sourceCoordKey: string | null;
  explodedAt: number;
  igniterUserId: string;
  cascadeDepth: number;
};

export type TntChainFuse = TntFuse & {
  parentEventId: string;
  cascadeDepth: number;
};

export type ActiveTntFuse = TntFuse & Partial<Pick<TntChainFuse, "parentEventId" | "cascadeDepth">>;

export type TntChainSkipReason = "source" | "already_primed" | "event_collision" | "cascade_cap" | "active_cap";

export type TntChainPrimingPlan =
  | { ok: false; reason: "invalid_source" | "invalid_authoritative_cell" | "invalid_active_fuse" }
  | {
    ok: true;
    creates: TntChainFuse[];
    replays: TntChainFuse[];
    skipped: Array<{ coordKey: string; reason: TntChainSkipReason }>;
    /** Every TNT in the settled terrain plan is suppressed from ordinary blast drops. */
    suppressedDropCoordKeys: string[];
  };

const EVENT_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const TNT_EVENT_PATTERN = /^tnt_[0-9a-z]{1,16}_[0-9a-z]{1,16}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CHAIN_OPERATION_PATTERN = /^chain_[0-9a-z]{7}_[0-9a-z]{7}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,160}:\d{1,16}$/;

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToken(value: string): string {
  return hashText(value).toString(36).padStart(7, "0");
}

function validCoordinate(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validSource(source: Readonly<TntChainSource>): boolean {
  return EVENT_PATTERN.test(source.eventId)
    && (source.sourceCoordKey === null || /^-?\d+:-?\d+:-?\d+$/.test(source.sourceCoordKey))
    && Number.isSafeInteger(source.explodedAt) && source.explodedAt >= 0
    && source.igniterUserId.length > 0 && source.igniterUserId.length <= 256
    && Number.isInteger(source.cascadeDepth) && source.cascadeDepth >= 0
    && source.cascadeDepth <= TNT_CHAIN_MAX_DEPTH;
}

function validCell(cell: Readonly<AuthoritativeTntBlastCell>): boolean {
  return validCoordinate(cell.x, -1_000_000, 1_000_000)
    && validCoordinate(cell.y, -24, 128)
    && validCoordinate(cell.z, -1_000_000, 1_000_000)
    && cell.coordKey === `${cell.x}:${cell.y}:${cell.z}`
    && Number.isFinite(cell.distanceSquared) && cell.distanceSquared >= 0
    && (cell.previousBlock !== "tnt"
      || (typeof cell.blockInstanceToken === "string" && TOKEN_PATTERN.test(cell.blockInstanceToken)));
}

function makeChainFuse(
  source: Readonly<TntChainSource>,
  cell: Readonly<AuthoritativeTntBlastCell> & { blockInstanceToken: string },
): TntChainFuse | null {
  const identity = `${source.eventId}:${cell.coordKey}:${cell.blockInstanceToken}`;
  const eventHash = hashToken(`event:${identity}`);
  const ignitionHash = hashToken(`ignition:${identity}`);
  const delaySpan = TNT_CHAIN_MAX_FUSE_MS - TNT_CHAIN_MIN_FUSE_MS + 1;
  const delay = TNT_CHAIN_MIN_FUSE_MS + hashText(`delay:${identity}`) % delaySpan;
  const dueAt = source.explodedAt + delay;
  if (!Number.isSafeInteger(dueAt)) return null;
  return {
    eventId: `tnt_${source.explodedAt.toString(36)}_${eventHash}`,
    ignitionId: `chain_${eventHash}_${ignitionHash}`,
    coordKey: cell.coordKey,
    x: cell.x,
    y: cell.y,
    z: cell.z,
    blockInstanceToken: cell.blockInstanceToken,
    igniterUserId: source.igniterUserId,
    ignitedAt: source.explodedAt,
    dueAt,
    parentEventId: source.eventId,
    cascadeDepth: source.cascadeDepth + 1,
  };
}

function activeFuseIsValid(fuse: Readonly<ActiveTntFuse>): boolean {
  const duration = fuse.dueAt - fuse.ignitedAt;
  const chainMetadata = fuse.parentEventId !== undefined || fuse.cascadeDepth !== undefined;
  return TNT_EVENT_PATTERN.test(fuse.eventId) && OPERATION_PATTERN.test(fuse.ignitionId)
    && fuse.coordKey === `${fuse.x}:${fuse.y}:${fuse.z}`
    && validCoordinate(fuse.x, -1_000_000, 1_000_000)
    && validCoordinate(fuse.y, -24, 128) && validCoordinate(fuse.z, -1_000_000, 1_000_000)
    && TOKEN_PATTERN.test(fuse.blockInstanceToken)
    && fuse.igniterUserId.length > 0 && fuse.igniterUserId.length <= 256
    && Number.isSafeInteger(fuse.ignitedAt) && fuse.ignitedAt >= 0 && Number.isSafeInteger(fuse.dueAt)
    && (chainMetadata
      ? typeof fuse.parentEventId === "string" && EVENT_PATTERN.test(fuse.parentEventId)
        && typeof fuse.cascadeDepth === "number" && Number.isInteger(fuse.cascadeDepth)
        && fuse.cascadeDepth >= 1 && fuse.cascadeDepth <= TNT_CHAIN_MAX_DEPTH
        && CHAIN_OPERATION_PATTERN.test(fuse.ignitionId)
        && duration >= TNT_CHAIN_MIN_FUSE_MS && duration <= TNT_CHAIN_MAX_FUSE_MS
      : duration === 4_000);
}

function sameChainFuse(active: Readonly<ActiveTntFuse>, expected: Readonly<TntChainFuse>): boolean {
  return active.eventId === expected.eventId && active.ignitionId === expected.ignitionId
    && active.coordKey === expected.coordKey && active.blockInstanceToken === expected.blockInstanceToken
    && active.igniterUserId === expected.igniterUserId && active.ignitedAt === expected.ignitedAt
    && active.dueAt === expected.dueAt && active.parentEventId === expected.parentEventId
    && active.cascadeDepth === expected.cascadeDepth;
}

/**
 * Derives secondary fuses only from the server's settled blast cells. The API
 * intentionally accepts no client center, radius, fuse duration, event ID or
 * due time. Sorting makes the bounded result independent of database row order.
 */
export function deriveTntChainPrimingPlan(input: Readonly<{
  source: Readonly<TntChainSource>;
  authoritativeCells: readonly Readonly<AuthoritativeTntBlastCell>[];
  activeFuses: readonly Readonly<ActiveTntFuse>[];
}>): TntChainPrimingPlan {
  if (!validSource(input.source)) return { ok: false, reason: "invalid_source" };
  if (input.authoritativeCells.some((cell) => !validCell(cell))) {
    return { ok: false, reason: "invalid_authoritative_cell" };
  }
  if (input.activeFuses.some((fuse) => !activeFuseIsValid(fuse))) {
    return { ok: false, reason: "invalid_active_fuse" };
  }
  if (new Set(input.activeFuses.map((fuse) => fuse.coordKey)).size !== input.activeFuses.length) {
    return { ok: false, reason: "invalid_active_fuse" };
  }

  const tntByCoord = new Map<string, Readonly<AuthoritativeTntBlastCell>>();
  for (const cell of input.authoritativeCells) {
    if (cell.previousBlock !== "tnt") continue;
    const previous = tntByCoord.get(cell.coordKey);
    if (previous && previous.blockInstanceToken !== cell.blockInstanceToken) {
      return { ok: false, reason: "invalid_authoritative_cell" };
    }
    tntByCoord.set(cell.coordKey, cell);
  }
  const tntCells = [...tntByCoord.values()].sort((left, right) => left.distanceSquared - right.distanceSquared
    || left.y - right.y || left.x - right.x || left.z - right.z);
  const suppressedDropCoordKeys = tntCells.map((cell) => cell.coordKey).sort();
  const activeByCoord = new Map(input.activeFuses.map((fuse) => [fuse.coordKey, fuse]));
  const creates: TntChainFuse[] = [];
  const replays: TntChainFuse[] = [];
  const skipped: Array<{ coordKey: string; reason: TntChainSkipReason }> = [];

  for (const cell of tntCells) {
    if (cell.coordKey === input.source.sourceCoordKey) {
      skipped.push({ coordKey: cell.coordKey, reason: "source" });
      continue;
    }
    if (input.source.cascadeDepth >= TNT_CHAIN_MAX_DEPTH) {
      skipped.push({ coordKey: cell.coordKey, reason: "cascade_cap" });
      continue;
    }
    const expected = makeChainFuse(input.source, cell as typeof cell & { blockInstanceToken: string });
    if (!expected) return { ok: false, reason: "invalid_source" };
    const active = activeByCoord.get(cell.coordKey);
    if (active) {
      if (sameChainFuse(active, expected)) replays.push(expected);
      else skipped.push({ coordKey: cell.coordKey, reason: active.eventId === expected.eventId
        ? "event_collision" : "already_primed" });
      continue;
    }
    if (creates.length + replays.length >= TNT_CHAIN_MAX_PER_EXPLOSION) {
      skipped.push({ coordKey: cell.coordKey, reason: "cascade_cap" });
      continue;
    }
    if (input.activeFuses.length + creates.length >= TNT_MAX_ACTIVE_FUSES) {
      skipped.push({ coordKey: cell.coordKey, reason: "active_cap" });
      continue;
    }
    creates.push(expected);
  }
  return { ok: true, creates, replays, skipped, suppressedDropCoordKeys };
}

/** Normalizes the string-backed Lakebed row for a secondary fuse. */
export function normalizeStoredTntChainFuse(row: Readonly<Record<string, unknown>>): TntChainFuse | null {
  const signed = (value: unknown) => typeof value === "string" && /^-?\d{1,16}$/.test(value)
    ? Number(value) : Number.NaN;
  const unsigned = (value: unknown) => typeof value === "string" && /^\d{1,16}$/.test(value)
    ? Number(value) : Number.NaN;
  const x = signed(row.x); const y = signed(row.y); const z = signed(row.z);
  const ignitedAt = unsigned(row.ignitedAt); const dueAt = unsigned(row.dueAt);
  const cascadeDepth = unsigned(row.cascadeDepth);
  const candidate: ActiveTntFuse = {
    eventId: typeof row.eventId === "string" ? row.eventId : "",
    ignitionId: typeof row.ignitionId === "string" ? row.ignitionId : "",
    coordKey: typeof row.coordKey === "string" ? row.coordKey : "",
    x, y, z,
    blockInstanceToken: typeof row.blockInstanceToken === "string" ? row.blockInstanceToken : "",
    igniterUserId: typeof row.igniterUserId === "string" ? row.igniterUserId : "",
    ignitedAt, dueAt,
    parentEventId: typeof row.parentEventId === "string" ? row.parentEventId : undefined,
    cascadeDepth,
  };
  return activeFuseIsValid(candidate) && candidate.parentEventId !== undefined
    && candidate.cascadeDepth !== undefined
    ? candidate as TntChainFuse : null;
}
