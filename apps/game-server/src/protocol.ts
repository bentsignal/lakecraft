/** Lakecraft realtime wire protocol. Keep this module runtime-agnostic/browser-safe. */

export const PROTOCOL_VERSION = 1 as const;
export const BLOCK_ID_MIN = 0;
export const BLOCK_ID_MAX = 33;
export const CHAT_MESSAGE_MAX_LENGTH = 180;
export const SKIN_PIXEL_BYTES = 64 * 64 * 4;
export const SKIN_PIXEL_BASE64_LENGTH = 21_848;
export const APPEARANCE_CAPABILITY = "appearance-v1" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type ServerGameMode = "survival" | "creative";
export type VisualActionKind = "swing" | "jump" | "crouch_on" | "crouch_off" | "use" | "slot" | "bow_draw" | "bow_release";
export type PublicVisualAction = { sequence: number; kind: VisualActionKind; value?: number };
export type SkinModel = "wide" | "slim";
export interface PublicAppearance {
  skinId: string;
  skinModel: SkinModel;
  armorHead: string;
  armorChest: string;
  armorLegs: string;
  armorFeet: string;
}
export type PlayerAppearance = PublicAppearance & { userId: string };

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
  heldItem?: string;
  crouching?: boolean;
  visualActions?: PublicVisualAction[];
  gameMode?: ServerGameMode;
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

export interface RealtimeChatMessage {
  id: string;
  sequence: number;
  operationId: string;
  userId: string;
  username: string;
  message: string;
  sentAt: number;
}
export interface PublicDrop {
  dropId: string;
  ownerUserId: string;
  itemId: string;
  count: number;
  durability?: number;
  x: number;
  y: number;
  z: number;
  droppedAt: number;
  ownerPickupAt: number;
  expiresAt: number;
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
      moveY?: number;
      moveZ: number;
      yaw: number;
      pitch: number;
      jump: boolean;
      sprint: boolean;
      heldItem?: string;
      x?: number;
      y?: number;
      z?: number;
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
  | {
      v: ProtocolVersion;
      type: "chat_send";
      operationId: string;
      message: string;
    }
  | {
      v: ProtocolVersion;
      type: "drop_item";
      operationId: string;
      itemId: string;
      count: number;
      durability?: number;
      x: number;
      y: number;
      z: number;
    }
  | { v: ProtocolVersion; type: "pickup_item"; operationId: string; dropId: string }
  | { v: ProtocolVersion; type: "respawn"; operationId: string }
  | {
      v: ProtocolVersion;
      type: "action";
      seq: number;
      kind: VisualActionKind;
      value?: number;
    }
  | {
      v: ProtocolVersion;
      type: "appearance_set";
      seq: number;
      appearance: PublicAppearance;
      skinPixels?: string;
    }
  | {
      v: ProtocolVersion;
      type: "appearance_request";
      userId: string;
      skinId: string;
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
      capabilities: readonly [typeof APPEARANCE_CAPABILITY];
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
      type: "chat_history";
      messages: RealtimeChatMessage[];
    }
  | {
      v: ProtocolVersion;
      type: "chat_message";
      message: RealtimeChatMessage;
    }
  | { v: ProtocolVersion; type: "drop_snapshot"; drops: PublicDrop[] }
  | { v: ProtocolVersion; type: "drop_result"; operationId: string; action: "drop" | "pickup"; drop?: PublicDrop }
  | { v: ProtocolVersion; type: "respawned"; operationId: string; player: PublicPlayer }
  | { v: ProtocolVersion; type: "appearance_roster"; players: PlayerAppearance[] }
  | { v: ProtocolVersion; type: "appearance_state"; player: PlayerAppearance }
  | { v: ProtocolVersion; type: "appearance_blob"; userId: string; skinId: string; skinPixels?: string }
  | { v: ProtocolVersion; type: "appearance_remove"; userId: string }
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
const VISUAL_ACTIONS = new Set<VisualActionKind>(["swing", "jump", "crouch_on", "crouch_off", "use", "slot", "bow_draw", "bow_release"]);
const SKIN_ID = /^(?:default|[a-f0-9]{64})$/;
const SKIN_PIXELS = /^[A-Za-z0-9+/]{21846}==$/;
const ARMOR = Object.freeze({
  armorHead: /^(?:|(?:leather|iron|golden|diamond)_helmet)$/,
  armorChest: /^(?:|(?:leather|iron|golden|diamond)_chestplate)$/,
  armorLegs: /^(?:|(?:leather|iron|golden|diamond)_leggings)$/,
  armorFeet: /^(?:|(?:leather|iron|golden|diamond)_boots)$/,
});

function appearance(value: unknown): PublicAppearance | null {
  if (!object(value) || !SKIN_ID.test(String(value.skinId ?? ""))
    || (value.skinModel !== "wide" && value.skinModel !== "slim")
    || typeof value.armorHead !== "string" || !ARMOR.armorHead.test(value.armorHead)
    || typeof value.armorChest !== "string" || !ARMOR.armorChest.test(value.armorChest)
    || typeof value.armorLegs !== "string" || !ARMOR.armorLegs.test(value.armorLegs)
    || typeof value.armorFeet !== "string" || !ARMOR.armorFeet.test(value.armorFeet)) return null;
  return {
    skinId: value.skinId as string,
    skinModel: value.skinId === "default" ? "wide" : value.skinModel,
    armorHead: value.armorHead,
    armorChest: value.armorChest,
    armorLegs: value.armorLegs,
    armorFeet: value.armorFeet,
  };
}

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
    if (value.moveY !== undefined && (!finite(value.moveY) || Math.abs(value.moveY) > 1.001)) {
      return invalid("vertical movement axis exceeds unit length");
    }
    if (!finite(value.yaw) || Math.abs(value.yaw) > 1e6) return invalid("yaw is invalid");
    if (!finite(value.pitch) || value.pitch < -Math.PI / 2 || value.pitch > Math.PI / 2) return invalid("pitch is invalid");
    if (typeof value.jump !== "boolean" || typeof value.sprint !== "boolean") return invalid("input flags are invalid");
    if (value.heldItem !== undefined
      && (typeof value.heldItem !== "string" || !/^(?:|[a-z0-9_]{1,64})$/.test(value.heldItem))) {
      return invalid("heldItem is invalid");
    }
    const hasPose = value.x !== undefined || value.y !== undefined || value.z !== undefined;
    if (hasPose && (!finite(value.x) || !finite(value.y) || !finite(value.z)
      || Math.abs(value.x) > 1_000_000 || value.y < -64 || value.y > 320 || Math.abs(value.z) > 1_000_000)) {
      return invalid("input pose is invalid");
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

  if (value.type === "chat_send") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)) {
      return invalid("chat operationId is invalid");
    }
    if (typeof value.message !== "string") return invalid("chat message must be a string");
    const message = value.message.trim().replace(/\s+/g, " ");
    if (!message) return invalid("chat message is empty");
    if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
      return invalid(`chat message exceeds ${CHAT_MESSAGE_MAX_LENGTH} characters`);
    }
    return {
      ok: true,
      message: { v: PROTOCOL_VERSION, type: "chat_send", operationId: value.operationId, message },
    };
  }

  if (value.type === "drop_item") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)
      || typeof value.itemId !== "string" || !/^[a-z0-9_]{1,64}$/.test(value.itemId)
      || !integer(value.count) || value.count < 1 || value.count > 64
      || (value.durability !== undefined && (!integer(value.durability) || value.durability < 1 || value.durability > 65535))
      || !finite(value.x) || !finite(value.y) || !finite(value.z)
      || Math.abs(value.x) > 1_000_000 || value.y < -64 || value.y > 320 || Math.abs(value.z) > 1_000_000) {
      return invalid("drop item is invalid");
    }
    return { ok: true, message: value as unknown as ClientMessage };
  }

  if (value.type === "pickup_item") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)
      || !shortString(value.dropId, 96)) return invalid("pickup item is invalid");
    return { ok: true, message: value as unknown as ClientMessage };
  }

  if (value.type === "respawn") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)) {
      return invalid("respawn operationId is invalid");
    }
    return { ok: true, message: { v: PROTOCOL_VERSION, type: "respawn", operationId: value.operationId } };
  }

  if (value.type === "action") {
    if (!integer(value.seq) || value.seq < 1) return invalid("action seq must be a positive integer");
    if (typeof value.kind !== "string" || !VISUAL_ACTIONS.has(value.kind as VisualActionKind)) {
      return invalid("action kind is invalid");
    }
    if (value.kind === "slot" && (!integer(value.value) || value.value < 0 || value.value > 8)) {
      return invalid("slot action value is invalid");
    }
    if (value.kind !== "slot" && value.value !== undefined) return invalid("action value is not supported");
    return { ok: true, message: value as unknown as ClientMessage };
  }

  if (value.type === "appearance_set") {
    if (!integer(value.seq) || value.seq < 1) return invalid("appearance seq must be a positive integer");
    const normalized = appearance(value.appearance);
    if (!normalized) return invalid("appearance is invalid");
    if (value.skinPixels !== undefined && (typeof value.skinPixels !== "string"
      || value.skinPixels.length !== SKIN_PIXEL_BASE64_LENGTH || !SKIN_PIXELS.test(value.skinPixels))) {
      return invalid("skinPixels must be exact 64x64 RGBA base64");
    }
    if (normalized.skinId === "default" && value.skinPixels !== undefined) return invalid("default skin cannot include pixels");
    return { ok: true, message: {
      v: PROTOCOL_VERSION,
      type: "appearance_set",
      seq: value.seq,
      appearance: normalized,
      ...(value.skinPixels === undefined ? {} : { skinPixels: value.skinPixels }),
    } };
  }

  if (value.type === "appearance_request") {
    if (!shortString(value.userId, 128) || !SKIN_ID.test(String(value.skinId ?? ""))) {
      return invalid("appearance request is invalid");
    }
    return { ok: true, message: {
      v: PROTOCOL_VERSION, type: "appearance_request", userId: value.userId, skinId: value.skinId,
    } };
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
