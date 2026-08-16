/** Lakecraft realtime wire protocol. Keep this module runtime-agnostic/browser-safe. */

import type { WorldTerrainDescriptor } from "../../../shared/worldPreset.ts";
import { BLOCK_TYPES } from "../../../shared/protocol.ts";
import { REALTIME_BLOCK_ID_MAX, REALTIME_WORLD_MAX_CHUNKS, REALTIME_WORLD_MAX_RADIUS } from "../../../shared/realtimeWorldChunks.ts";
import type { MobAuthorityState } from "../../../shared/mobCombat.ts";
import type { MobMotionPose } from "../../../shared/mobMotionAuthority.ts";

export const PROTOCOL_VERSION = 1 as const;
export const BLOCK_ID_MIN = 0;
export const BLOCK_ID_MAX = BLOCK_TYPES.length - 1;
if (BLOCK_ID_MAX > REALTIME_BLOCK_ID_MAX) throw new Error("Block palette exceeds the realtime chunk codec.");
export const CHAT_MESSAGE_MAX_LENGTH = 180;
export const SKIN_PIXEL_BYTES = 64 * 64 * 4;
export const SKIN_PIXEL_BASE64_LENGTH = 21_848;
export const APPEARANCE_CAPABILITY = "appearance-v1" as const;
export const WORLD_CHUNKS_CAPABILITY = "world-chunks-v1" as const;
export const MOBS_CAPABILITY = "mobs-v1" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type ServerGameMode = "survival" | "creative";
export interface WorldRuntimeSettings {
  spawn: { x: number; y: number; z: number; yaw: number };
  daylightCycle: boolean;
  dayPhase: number;
}
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
  health?: number;
}

export interface PlayerHit {
  operationId: string;
  attackerId: string;
  targetId: string;
  damage: number;
  health: number;
  killed: boolean;
  attackerX: number;
  attackerZ: number;
}

export interface SelfDamageResult {
  operationId: string;
  damage: number;
  health: number;
  killed: boolean;
  cause: "fall";
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
  /** Backward-compatible wire name for the universal pickup deadline. */
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
      password?: string;
      demo?: { token: string; userId: string; name: string; inventoryJson?: string };
    }
  | {
      v: ProtocolVersion;
      type: "chunk_subscribe";
      seq: number;
      centerX: number;
      centerZ: number;
      radius: number;
      known: Array<{ x: number; z: number; revision: number }>;
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
  | { v: ProtocolVersion; type: "inventory_action"; requestJson: string }
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
  | { v: ProtocolVersion; type: "player_attack"; operationId: string; targetId: string }
  | { v: ProtocolVersion; type: "mob_attack"; operationId: string; mobId: string }
  | { v: ProtocolVersion; type: "self_damage"; operationId: string; damage: number; cause: "fall" }
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
      terrain: WorldTerrainDescriptor;
      defaultGameMode: ServerGameMode;
      worldSettings: WorldRuntimeSettings;
      capabilities: readonly [typeof APPEARANCE_CAPABILITY, typeof WORLD_CHUNKS_CAPABILITY, typeof MOBS_CAPABILITY];
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
      terrain: WorldTerrainDescriptor;
      defaultGameMode: ServerGameMode;
      worldSettings: WorldRuntimeSettings;
    }
  | { v: ProtocolVersion; type: "world_settings"; settings: WorldRuntimeSettings }
  | {
      v: ProtocolVersion;
      type: "world_snapshot";
      revision: number;
      edits: BlockEdit[];
    }
  | {
      v: ProtocolVersion;
      type: "world_chunks";
      seq: number;
      complete?: boolean;
      chunks: Array<{ x: number; z: number; revision: number; data: string }>;
    }
  | {
      v: ProtocolVersion;
      type: "world_chunks_unload";
      seq: number;
      chunks: Array<{ x: number; z: number }>;
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
  | { v: ProtocolVersion; type: "private_notice"; message: string; sentAt: number }
  | { v: ProtocolVersion; type: "drop_snapshot"; drops: PublicDrop[] }
  | { v: ProtocolVersion; type: "mob_snapshot"; serverNow: number; tick: number; poses: MobMotionPose[]; states: MobAuthorityState[] }
  | { v: ProtocolVersion; type: "mob_hit"; operationId: string; attackerId: string; damage: number; killed: boolean; replayed: boolean; state: MobAuthorityState }
  | { v: ProtocolVersion; type: "drop_result"; operationId: string; action: "drop" | "pickup"; drop?: PublicDrop }
  | { v: ProtocolVersion; type: "inventory_state"; inventory: Record<string, unknown> }
  | { v: ProtocolVersion; type: "inventory_result"; operationId: string; result: Record<string, unknown> }
  | ({ v: ProtocolVersion; type: "player_hit" } & PlayerHit)
  | ({ v: ProtocolVersion; type: "self_damage_result" } & SelfDamageResult)
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
    if (value.password !== undefined && (typeof value.password !== "string" || value.password.length > 128)) {
      return invalid("password is invalid");
    }
    let demo: { token: string; userId: string; name: string; inventoryJson?: string } | undefined;
    if (value.demo !== undefined) {
      if (
        !object(value.demo) ||
        typeof value.demo.token !== "string" || value.demo.token.length > 256 ||
        !shortString(value.demo.userId, 128) ||
        !shortString(value.demo.name, 32) ||
        (value.demo.inventoryJson !== undefined
          && (typeof value.demo.inventoryJson !== "string" || value.demo.inventoryJson.length > 16_384))
      ) return invalid("demo credentials are invalid");
      demo = {
        token: value.demo.token,
        userId: value.demo.userId,
        name: value.demo.name,
        ...(value.demo.inventoryJson === undefined ? {} : { inventoryJson: value.demo.inventoryJson }),
      };
    }
    return {
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: "join",
        ticket: value.ticket as string | undefined,
        serverId: value.serverId as string | undefined,
        resumeToken: value.resumeToken as string | undefined,
        password: value.password as string | undefined,
        demo,
      },
    };
  }

  if (value.type === "chunk_subscribe") {
    if (!integer(value.seq) || value.seq < 1
      || !integer(value.centerX) || Math.abs(value.centerX) > 125_000
      || !integer(value.centerZ) || Math.abs(value.centerZ) > 125_000
      || !integer(value.radius) || value.radius < 1 || value.radius > REALTIME_WORLD_MAX_RADIUS
      || !Array.isArray(value.known) || value.known.length > REALTIME_WORLD_MAX_CHUNKS) {
      return invalid("chunk subscription is invalid");
    }
    const known: Array<{ x: number; z: number; revision: number }> = [];
    const keys = new Set<string>();
    for (const candidate of value.known) {
      if (!object(candidate) || !integer(candidate.x) || !integer(candidate.z)
        || Math.abs(candidate.x) > 125_000 || Math.abs(candidate.z) > 125_000
        || !integer(candidate.revision) || candidate.revision < 0) return invalid("known chunk is invalid");
      const key = `${candidate.x},${candidate.z}`;
      if (keys.has(key)) return invalid("known chunks must be unique");
      keys.add(key);
      known.push({ x: candidate.x, z: candidate.z, revision: candidate.revision });
    }
    return { ok: true, message: {
      v: PROTOCOL_VERSION,
      type: "chunk_subscribe",
      seq: value.seq,
      centerX: value.centerX,
      centerZ: value.centerZ,
      radius: value.radius,
      known,
    } };
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

  if (value.type === "inventory_action") {
    if (typeof value.requestJson !== "string" || value.requestJson.length < 2 || value.requestJson.length > 8_191) {
      return invalid("inventory action is invalid");
    }
    return { ok: true, message: {
      v: PROTOCOL_VERSION,
      type: "inventory_action",
      requestJson: value.requestJson,
    } };
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

  if (value.type === "player_attack") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)
      || !shortString(value.targetId, 128)) return invalid("player attack is invalid");
    return { ok: true, message: {
      v: PROTOCOL_VERSION, type: "player_attack", operationId: value.operationId, targetId: value.targetId,
    } };
  }

  if (value.type === "mob_attack") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)
      || !shortString(value.mobId, 40)
      || !/^(?:pig|cow|sheep|chicken|zombie|skeleton|creeper|spider)-5nb-[0-9a-z]{1,3}$/.test(value.mobId)) {
      return invalid("mob attack is invalid");
    }
    return { ok: true, message: {
      v: PROTOCOL_VERSION, type: "mob_attack", operationId: value.operationId, mobId: value.mobId,
    } };
  }

  if (value.type === "self_damage") {
    if (!shortString(value.operationId, 96) || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.operationId)
      || value.cause !== "fall" || !integer(value.damage) || value.damage < 1 || value.damage > 20) {
      return invalid("self damage is invalid");
    }
    return { ok: true, message: {
      v: PROTOCOL_VERSION, type: "self_damage", operationId: value.operationId, damage: value.damage, cause: "fall",
    } };
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
