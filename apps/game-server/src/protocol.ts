/** Lakecraft realtime wire protocol. Keep this module runtime-agnostic/browser-safe. */

export const PROTOCOL_VERSION = 1 as const;
export const BLOCK_ID_MIN = 0;
export const BLOCK_ID_MAX = 33;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface PublicPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx?: number;
  vy?: number;
  vz?: number;
  heldItem?: number;
}

export interface BlockEdit {
  revision: number;
  x: number;
  y: number;
  z: number;
  block: number;
  editorId: string;
  editedAt: number;
}

export type ClientMessage =
  | {
      v: ProtocolVersion;
      type: "join";
      ticket?: string;
      serverId?: string;
      resumeToken?: string;
      demo?: { token: string; userId: string; name: string };
    }
  | {
      v: ProtocolVersion;
      type: "input";
      seq: number;
      dtMs: number;
      moveX: number;
      moveZ: number;
      yaw: number;
      pitch: number;
      jump: boolean;
      sprint: boolean;
      heldItem?: number;
    }
  | {
      v: ProtocolVersion;
      type: "block_edit";
      operationId: string;
      seq: number;
      x: number;
      y: number;
      z: number;
      block: number;
    }
  | { v: ProtocolVersion; type: "ping"; t: number };

export type ServerMessage =
  | {
      v: ProtocolVersion;
      type: "hello";
      serverId: string;
      serverName: string;
      authMode: "lakebed" | "local-demo";
      tickHz: number;
      snapshotHz: number;
    }
  | {
      v: ProtocolVersion;
      type: "welcome";
      sessionId: string;
      resumeToken: string;
      resumed: boolean;
      player: PublicPlayer;
      serverTick: number;
      inputAck: number;
      blocksRevision: number;
    }
  | {
      v: ProtocolVersion;
      type: "world_snapshot";
      revision: number;
      edits: BlockEdit[];
    }
  | {
      v: ProtocolVersion;
      type: "snapshot";
      serverTick: number;
      sentAt: number;
      inputAck: number;
      self: PublicPlayer;
      players: PublicPlayer[];
    }
  | {
      v: ProtocolVersion;
      type: "block_patch";
      operationId?: string;
      edit: BlockEdit;
    }
  | {
      v: ProtocolVersion;
      type: "error";
      code: ErrorCode;
      message: string;
      fatal: boolean;
      retryable: boolean;
      operationId?: string;
    }
  | { v: ProtocolVersion; type: "pong"; t: number; serverTime: number };

export type ErrorCode =
  | "bad_message"
  | "unsupported_version"
  | "join_required"
  | "already_joined"
  | "auth_failed"
  | "server_full"
  | "rate_limited"
  | "stale_input"
  | "input_gap"
  | "invalid_edit"
  | "edit_too_far"
  | "world_limit"
  | "backpressure";

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: "bad_message" | "unsupported_version"; message: string };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const shortString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

function invalid(message: string): DecodeResult {
  return { ok: false, code: "bad_message", message };
}

export function decodeClientMessage(raw: string): DecodeResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid("Message must be valid JSON");
  }
  if (!object(value)) return invalid("Message must be an object");
  if (value.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "unsupported_version",
      message: `Protocol v${String(value.v)} is unsupported; expected v${PROTOCOL_VERSION}`,
    };
  }

  if (value.type === "join") {
    if (value.ticket !== undefined && !shortString(value.ticket, 4096)) {
      return invalid("ticket must be a non-empty string");
    }
    if (value.serverId !== undefined && !shortString(value.serverId, 128)) {
      return invalid("serverId is invalid");
    }
    if (value.resumeToken !== undefined && !shortString(value.resumeToken, 256)) {
      return invalid("resumeToken is invalid");
    }
    let demo: { token: string; userId: string; name: string } | undefined;
    if (value.demo !== undefined) {
      if (
        !object(value.demo) ||
        !shortString(value.demo.token, 256) ||
        !shortString(value.demo.userId, 128) ||
        !shortString(value.demo.name, 32)
      ) return invalid("demo credentials are invalid");
      demo = { token: value.demo.token, userId: value.demo.userId, name: value.demo.name };
    }
    return {
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: "join",
        ticket: value.ticket as string | undefined,
        serverId: value.serverId as string | undefined,
        resumeToken: value.resumeToken as string | undefined,
        demo,
      },
    };
  }

  if (value.type === "input") {
    if (!integer(value.seq) || value.seq < 1) return invalid("input seq must be a positive integer");
    if (!finite(value.dtMs) || value.dtMs < 0 || value.dtMs > 250) return invalid("input dtMs is out of range");
    if (!finite(value.moveX) || !finite(value.moveZ)) return invalid("movement axes must be finite");
    if (Math.hypot(value.moveX, value.moveZ) > 1.001) return invalid("movement axes exceed unit length");
    if (!finite(value.yaw) || Math.abs(value.yaw) > 1e6) return invalid("yaw is invalid");
    if (!finite(value.pitch) || value.pitch < -Math.PI / 2 || value.pitch > Math.PI / 2) return invalid("pitch is invalid");
    if (typeof value.jump !== "boolean" || typeof value.sprint !== "boolean") return invalid("input flags are invalid");
    if (value.heldItem !== undefined && (!integer(value.heldItem) || value.heldItem < 0 || value.heldItem > 255)) {
      return invalid("heldItem is invalid");
    }
    return { ok: true, message: value as unknown as ClientMessage };
  }

  if (value.type === "block_edit") {
    if (!shortString(value.operationId, 96)) return invalid("operationId is invalid");
    if (!integer(value.seq) || value.seq < 1) return invalid("edit seq must be a positive integer");
    if (!integer(value.x) || !integer(value.y) || !integer(value.z)) return invalid("block coordinates must be integers");
    if (Math.abs(value.x) > 1_000_000 || Math.abs(value.z) > 1_000_000 || value.y < -64 || value.y > 320) {
      return invalid("block coordinates are out of range");
    }
    if (!integer(value.block) || value.block < BLOCK_ID_MIN || value.block > BLOCK_ID_MAX) {
      return invalid(`block must be an integer from ${BLOCK_ID_MIN} to ${BLOCK_ID_MAX}`);
    }
    return { ok: true, message: value as unknown as ClientMessage };
  }

  if (value.type === "ping") {
    if (!finite(value.t)) return invalid("ping timestamp is invalid");
    return { ok: true, message: { v: PROTOCOL_VERSION, type: "ping", t: value.t } };
  }
  return invalid("Unknown message type");
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function protocolError(
  code: ErrorCode,
  message: string,
  options: { fatal?: boolean; retryable?: boolean; operationId?: string } = {},
): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "error",
    code,
    message,
    fatal: options.fatal ?? false,
    retryable: options.retryable ?? false,
    operationId: options.operationId,
  };
}
