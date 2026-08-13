import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import { ITEMS, type ItemStack } from "../shared/game.ts";
import type { NormalizedDroppedItem } from "../shared/droppedItems.ts";
import {
  decodePlayerSkinWirePixels,
  encodePlayerSkinWirePixels,
  playerSkinWireId,
  type HydratedPlayerSkin,
  type PlayerSkinModel,
} from "./game/playerSkin.ts";
import {
  REALTIME_CHAT_MAX_LENGTH,
  normalizeRealtimeChat,
  type RealtimeChatEvent,
  type RealtimeChatMessage,
} from "./realtimeChat.ts";

export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_SERVERS_STORAGE_KEY = "lakecraft:multiplayer-servers:v1";
export const MULTIPLAYER_INVITATION_TOKENS_STORAGE_KEY = "lakecraft:multiplayer-invitation-tokens:v1";

export type RealtimeConnectionPhase = "idle" | "connecting" | "online" | "reconnecting" | "offline" | "error";
export type RealtimeGameMode = "survival" | "creative";
export type RealtimePlayerHit = Readonly<{
  operationId: string; attackerId: string; targetId: string; damage: number; health: number;
  killed: boolean; attackerX: number; attackerZ: number;
}>;
export type RealtimeArmorAppearance = Readonly<{
  armorHead: string;
  armorChest: string;
  armorLegs: string;
  armorFeet: string;
}>;

export type SavedMultiplayerServer = {
  id: string;
  name: string;
  endpoint: string;
};

export type RealtimeWorldEdit = WorldEdit & {
  operationId?: string;
  revision?: number;
};

export type RealtimeClientOptions = {
  endpoint: string;
  ticket?: string;
  serverId: string;
  demo?: { token: string; userId: string; name: string };
  localUserId: string;
  localUsername: string;
  getPose: () => PlayerPose;
  getHeldItem?: () => string | null;
  getSkin?: () => Promise<HydratedPlayerSkin>;
  getArmor?: () => RealtimeArmorAppearance;
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onChatEvent: (event: RealtimeChatEvent) => void;
  onGameMode: (gameMode: RealtimeGameMode) => void;
  onDrops: (drops: NormalizedDroppedItem[]) => void;
  onPlayerHit: (hit: RealtimePlayerHit) => void;
  onSelfHealth: (health: number) => void;
  onReconcilePose?: (pose: PlayerPose) => void;
};

type PendingBlockEdit = {
  resolve: (edit: RealtimeWorldEdit) => void;
  reject: (error: Error) => void;
  timer: number;
};
type PendingDrop = { resolve: (drop: NormalizedDroppedItem) => void; reject: (error: Error) => void; timer: number };
type PendingRespawn = { resolve: (pose: PlayerPose) => void; reject: (error: Error) => void; timer: number };

type RealtimeEnvelope = Record<string, unknown> & { v: number; type: string };
type RemoteAppearance = RealtimeArmorAppearance & {
  skinId: string;
  skinModel: PlayerSkinModel;
};

const APPEARANCE_CAPABILITY = "appearance-v1";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function decodeEnvelope(data: unknown): RealtimeEnvelope | null {
  try {
    const source = typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : null;
    if (!source || source.length > 256_000) return null;
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const envelope = parsed as RealtimeEnvelope;
    return envelope.v === REALTIME_PROTOCOL_VERSION && typeof envelope.type === "string" ? envelope : null;
  } catch {
    return null;
  }
}

function decodePose(value: unknown): PlayerPose | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const x = finiteNumber(source.x);
  const y = finiteNumber(source.y);
  const z = finiteNumber(source.z);
  const yaw = finiteNumber(source.yaw);
  const pitch = finiteNumber(source.pitch);
  if (x === null || y === null || z === null || yaw === null || pitch === null) return null;
  if (Math.abs(x) > 1_000_000 || y < -64 || y > 320 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z, yaw, pitch };
}

const REMOTE_ACTION_KINDS = new Set<MotionVisualActionKind>([
  "swing", "jump", "crouch_on", "crouch_off", "use", "slot", "bow_draw", "bow_release",
]);

function decodeVisualActions(value: unknown): NonNullable<RemotePlayer["visualActions"]> {
  if (!Array.isArray(value)) return [];
  const actions: Array<NonNullable<RemotePlayer["visualActions"]>[number]> = [];
  for (const candidate of value.slice(-8)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const source = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(source.sequence) || (source.sequence as number) < 1
      || typeof source.kind !== "string" || !REMOTE_ACTION_KINDS.has(source.kind as MotionVisualActionKind)) continue;
    const kind = source.kind as MotionVisualActionKind;
    if (kind === "slot") {
      if (!Number.isSafeInteger(source.value) || (source.value as number) < 0 || (source.value as number) > 8) continue;
      actions.push({ sequence: source.sequence as number, kind, value: source.value as number });
    } else if (source.value === undefined) {
      actions.push({ sequence: source.sequence as number, kind });
    }
  }
  return actions;
}

export function decodeRealtimeGameMode(value: unknown): RealtimeGameMode {
  return value === "creative" ? "creative" : "survival";
}

function decodeWorldEdit(value: unknown): RealtimeWorldEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const x = finiteNumber(source.x);
  const y = finiteNumber(source.y);
  const z = finiteNumber(source.z);
  const block = finiteNumber(source.block);
  if (x === null || y === null || z === null || block === null) return null;
  if (![x, y, z, block].every(Number.isInteger) || Math.abs(x) > 1_000_000 || y < -64 || y > 320
    || Math.abs(z) > 1_000_000 || block < 0 || block > 33) return null;
  const revision = finiteNumber(source.revision);
  return {
    x,
    y,
    z,
    block: block as WorldEdit["block"],
    ...(typeof source.operationId === "string" ? { operationId: source.operationId.slice(0, 96) } : {}),
    ...(revision !== null && Number.isSafeInteger(revision) ? { revision } : {}),
  };
}

function decodeChatMessage(value: unknown): RealtimeChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = boundedText(source.id, 96);
  const operationId = boundedText(source.operationId, 96);
  const userId = boundedText(source.userId, 128);
  const username = boundedText(source.username, 32);
  const message = boundedText(source.message, REALTIME_CHAT_MAX_LENGTH);
  const sequence = finiteNumber(source.sequence);
  const sentAt = finiteNumber(source.sentAt);
  if (!id || !operationId || !userId || !username || !message
    || sequence === null || !Number.isSafeInteger(sequence) || sequence < 1
    || sentAt === null || sentAt < 0) return null;
  return { id, operationId, userId, username, message, sequence, sentAt, delivery: "sent" };
}

function decodeAppearance(value: unknown): (RemoteAppearance & { userId: string }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const userId = boundedText(source.userId, 128);
  const skinId = boundedText(source["skinId"], 64);
  if (!userId || !/^(?:default|[a-f0-9]{64})$/.test(skinId)
    || (source["skinModel"] !== "wide" && source["skinModel"] !== "slim")) return null;
  return {
    userId,
    skinId,
    skinModel: skinId === "default" ? "wide" : source["skinModel"],
    armorHead: boundedText(source.armorHead, 64),
    armorChest: boundedText(source.armorChest, 64),
    armorLegs: boundedText(source.armorLegs, 64),
    armorFeet: boundedText(source.armorFeet, 64),
  };
}

function decodeDrop(value: unknown): NormalizedDroppedItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const dropId = boundedText(source.dropId, 96);
  const itemId = boundedText(source.itemId, 64);
  const ownerUserId = boundedText(source.ownerUserId, 128);
  const count = finiteNumber(source.count);
  const x = finiteNumber(source.x); const y = finiteNumber(source.y); const z = finiteNumber(source.z);
  const droppedAt = finiteNumber(source.droppedAt); const ownerPickupAt = finiteNumber(source.ownerPickupAt); const expiresAt = finiteNumber(source.expiresAt);
  if (!dropId || !ownerUserId || !Object.prototype.hasOwnProperty.call(ITEMS, itemId)
    || count === null || !Number.isSafeInteger(count) || count < 1 || count > ITEMS[itemId as keyof typeof ITEMS].maxStack
    || x === null || y === null || z === null || droppedAt === null || ownerPickupAt === null || expiresAt === null) return null;
  const durability = finiteNumber(source.durability);
  const item = { itemId, count, ...(durability === null ? {} : { durability }) } as ItemStack;
  return { dropId, chunkKey: `${Math.floor(x / 16)}:${Math.floor(z / 16)}`, ownerUserId, sourceUserId: ownerUserId, item, x, y, z, droppedAt, ownerPickupAt, expiresAt };
}

export function normalizeMultiplayerEndpoint(value: string): string | null {
  try {
    const candidate = value.trim();
    if (!candidate || candidate.length > 500) return null;
    const url = new URL(candidate.includes("://") ? candidate : `wss://${candidate}`);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    url.hash = "";
    url.search = "";
    if (url.pathname === "/") url.pathname = "/ws";
    return url.href;
  } catch {
    return null;
  }
}

export function multiplayerStatusUrl(endpoint: string): string | null {
  const normalized = normalizeMultiplayerEndpoint(endpoint);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/status";
  return url.href;
}

export function loadSavedMultiplayerServers(storage: Pick<Storage, "getItem">): SavedMultiplayerServer[] {
  try {
    const parsed = JSON.parse(storage.getItem(MULTIPLAYER_SERVERS_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const servers: SavedMultiplayerServer[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const endpoint = normalizeMultiplayerEndpoint(typeof record.endpoint === "string" ? record.endpoint : "");
      if (!endpoint || seen.has(endpoint)) continue;
      seen.add(endpoint);
      servers.push({
        id: boundedText(record.id, 96) || `direct:${endpoint}`,
        name: boundedText(record.name, 48) || new URL(endpoint).host,
        endpoint,
      });
      if (servers.length >= 24) break;
    }
    return servers;
  } catch {
    return [];
  }
}

export function saveMultiplayerServers(
  storage: Pick<Storage, "setItem">,
  servers: readonly SavedMultiplayerServer[],
): void {
  const normalized = loadSavedMultiplayerServers({
    getItem: () => JSON.stringify(servers),
  } as Pick<Storage, "getItem">);
  storage.setItem(MULTIPLAYER_SERVERS_STORAGE_KEY, JSON.stringify(normalized));
}

export function loadMultiplayerInvitationTokens(
  storage: Pick<Storage, "getItem">,
): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(MULTIPLAYER_INVITATION_TOKENS_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const tokens: Record<string, string> = {};
    for (const [candidate, value] of Object.entries(parsed as Record<string, unknown>)) {
      const endpoint = normalizeMultiplayerEndpoint(candidate);
      const token = boundedText(value, 256).trim();
      if (!endpoint || token.length < 16 || tokens[endpoint]) continue;
      tokens[endpoint] = token;
      if (Object.keys(tokens).length >= 24) break;
    }
    return tokens;
  } catch {
    return {};
  }
}

export function saveMultiplayerInvitationToken(
  storage: Pick<Storage, "getItem" | "setItem">,
  endpointValue: string,
  tokenValue: string,
): boolean {
  const endpoint = normalizeMultiplayerEndpoint(endpointValue);
  const token = tokenValue.trim().slice(0, 256);
  if (!endpoint || token.length < 16) return false;
  try {
    const tokens = loadMultiplayerInvitationTokens(storage);
    storage.setItem(MULTIPLAYER_INVITATION_TOKENS_STORAGE_KEY, JSON.stringify({ ...tokens, [endpoint]: token }));
    return true;
  } catch {
    return false;
  }
}

export class RealtimeMultiplayerClient {
  readonly options: RealtimeClientOptions;
  private socket: WebSocket | null = null;
  private reconnectTimer = 0;
  private sampleTimer = 0;
  private stopped = false;
  private joined = false;
  private resumeToken = "";
  private sequence = 0;
  private blockSequence = 0;
  private actionSequence = 0;
  private appearanceSequence = 0;
  private gameMode: RealtimeGameMode = "survival";
  private reconnectAttempt = 0;
  private lastPose: PlayerPose | null = null;
  private lastPoseAt = 0;
  private pendingBlocks = new Map<string, PendingBlockEdit>();
  private pendingChat = new Map<string, string>();
  private pendingDrops = new Map<string, PendingDrop>();
  private pendingSelfDamage = new Map<string, number>();
  private pendingRespawn: PendingRespawn | null = null;
  private appearanceSupported = false;
  private localSkin: HydratedPlayerSkin | null = null;
  private localSkinLoading = false;
  private localSkinBase64 = "";
  private lastAppearanceSignature = "";
  private remoteAppearances = new Map<string, RemoteAppearance>();
  private remoteSkins = new Map<string, Uint8Array>();
  private lastSnapshotPlayers: RemotePlayer[] = [];
  private appearanceRequests: string[] = [];
  private appearanceRequestSet = new Set<string>();
  private activeAppearanceRequest = "";
  private appearanceRequestGeneration = 0;
  private appearanceDigestGeneration = 0;
  private appearanceRequestTimer = 0;
  private sentPoses = new Map<number, PlayerPose>();

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  start(): void {
    if (!this.stopped && this.socket) return;
    this.stopped = false;
    this.open(false);
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.sampleTimer);
    window.clearTimeout(this.appearanceRequestTimer);
    this.reconnectTimer = 0;
    this.sampleTimer = 0;
    this.socket?.close(1000, "client_leave");
    this.socket = null;
    this.joined = false;
    for (const pending of this.pendingBlocks.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("multiplayer_disconnected"));
    }
    this.pendingBlocks.clear();
    this.pendingChat.clear();
    for (const pending of this.pendingDrops.values()) { window.clearTimeout(pending.timer); pending.reject(new Error("multiplayer_disconnected")); }
    this.pendingDrops.clear();
    this.pendingSelfDamage.clear();
    if (this.pendingRespawn) {
      window.clearTimeout(this.pendingRespawn.timer);
      this.pendingRespawn.reject(new Error("multiplayer_disconnected"));
      this.pendingRespawn = null;
    }
    this.remoteAppearances.clear();
    this.remoteSkins.clear();
    this.lastSnapshotPlayers = [];
    this.sentPoses.clear();
    this.appearanceRequests = [];
    this.appearanceRequestSet.clear();
    this.activeAppearanceRequest = "";
    this.options.onRemotePlayers([]);
    this.options.onPhase("offline");
  }

  submitBlockEdit(operationId: string, edit: WorldEdit): Promise<RealtimeWorldEdit> {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("multiplayer_not_connected"));
    }
    if (!/^[A-Za-z0-9:_-]{8,96}$/.test(operationId) || this.pendingBlocks.has(operationId)) {
      return Promise.reject(new Error("invalid_multiplayer_operation"));
    }
    this.blockSequence += 1;
    this.send({
      v: REALTIME_PROTOCOL_VERSION,
      type: "block_edit",
      seq: this.blockSequence,
      operationId,
      x: edit.x,
      y: edit.y,
      z: edit.z,
      block: edit.block,
    });
    return new Promise<RealtimeWorldEdit>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingBlocks.delete(operationId);
        reject(new Error("multiplayer_block_timeout"));
      }, 5_000);
      this.pendingBlocks.set(operationId, { resolve, reject, timer });
    });
  }

  submitChat(rawMessage: string): Promise<void> {
    const message = normalizeRealtimeChat(rawMessage);
    if (!message) return Promise.reject(new Error("empty"));
    if (message.length > REALTIME_CHAT_MAX_LENGTH) return Promise.reject(new Error("too_long"));
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("multiplayer_not_connected"));
    }
    if (this.pendingChat.size >= 16) return Promise.reject(new Error("multiplayer_chat_backlog"));
    const operationId = `chat_${crypto.randomUUID()}`;
    const optimistic: RealtimeChatMessage = {
      id: `pending:${operationId}`,
      sequence: 0,
      operationId,
      userId: this.options.localUserId,
      username: this.options.localUsername || "Player",
      message,
      sentAt: Date.now(),
      delivery: "sending",
    };
    this.pendingChat.set(operationId, message);
    this.options.onChatEvent({ type: "optimistic", message: optimistic });
    this.send({ v: REALTIME_PROTOCOL_VERSION, type: "chat_send", operationId, message });
    return Promise.resolve();
  }

  submitAction(kind: MotionVisualActionKind, value?: number): void {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) return;
    this.actionSequence += 1;
    this.send({ v: REALTIME_PROTOCOL_VERSION, type: "action", seq: this.actionSequence, kind, ...(value === undefined ? {} : { value }) });
  }

  submitDrop(operationId: string, item: ItemStack, pose: PlayerPose): Promise<NormalizedDroppedItem> {
    return this.submitDropOperation(operationId, {
      type: "drop_item", itemId: item.itemId, count: item.count,
      ...(item.durability === undefined ? {} : { durability: item.durability }), x: pose.x, y: pose.y, z: pose.z,
    });
  }

  submitPickup(operationId: string, dropId: string): Promise<NormalizedDroppedItem> {
    return this.submitDropOperation(operationId, { type: "pickup_item", dropId });
  }

  submitPlayerAttack(operationId: string, targetId: string): void {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) return;
    this.send({ v: REALTIME_PROTOCOL_VERSION, type: "player_attack", operationId, targetId });
  }

  submitSelfDamage(operationId: string, damage: number): void {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN
      || !/^[A-Za-z0-9:_-]{8,96}$/.test(operationId)
      || !Number.isInteger(damage) || damage < 1 || damage > 20) return;
    this.pendingSelfDamage.set(operationId, damage);
    if (this.pendingSelfDamage.size > 8) this.pendingSelfDamage.delete(this.pendingSelfDamage.keys().next().value!);
    this.send({ v: REALTIME_PROTOCOL_VERSION, type: "self_damage", operationId, damage, cause: "fall" });
  }

  submitRespawn(): Promise<PlayerPose> {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN || this.pendingRespawn) {
      return Promise.reject(new Error("multiplayer_not_connected"));
    }
    const operationId = `respawn_${crypto.randomUUID()}`;
    this.send({ v: REALTIME_PROTOCOL_VERSION, type: "respawn", operationId });
    return new Promise<PlayerPose>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRespawn = null;
        reject(new Error("multiplayer_respawn_timeout"));
      }, 5_000);
      this.pendingRespawn = { resolve, reject, timer };
    });
  }

  private submitDropOperation(operationId: string, operation: Record<string, unknown>): Promise<NormalizedDroppedItem> {
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("multiplayer_not_connected"));
    this.send({ v: REALTIME_PROTOCOL_VERSION, operationId, ...operation });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pendingDrops.delete(operationId); reject(new Error("multiplayer_drop_timeout")); }, 5_000);
      this.pendingDrops.set(operationId, { resolve, reject, timer });
    });
  }

  private open(reconnecting: boolean): void {
    const endpoint = normalizeMultiplayerEndpoint(this.options.endpoint);
    if (!endpoint) {
      this.options.onPhase("error", "The server address is not a valid WebSocket URL.");
      return;
    }
    this.options.onPhase(reconnecting ? "reconnecting" : "connecting");
    this.appearanceSupported = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(endpoint);
    } catch {
      this.scheduleReconnect("The server address could not be opened.");
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      this.send({
        v: REALTIME_PROTOCOL_VERSION,
        type: "join",
        ...(this.options.demo ? {} : { serverId: this.options.serverId }),
        ...(this.resumeToken || this.options.demo ? {} : { ticket: this.options.ticket }),
        ...(!this.resumeToken && this.options.demo ? { demo: this.options.demo } : {}),
        ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      });
    };
    socket.onmessage = (event) => this.handleMessage(decodeEnvelope(event.data));
    socket.onerror = () => {
      if (this.socket === socket) this.options.onPhase("reconnecting", "Connection interrupted.");
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.joined = false;
      window.clearInterval(this.sampleTimer);
      this.sampleTimer = 0;
      window.clearTimeout(this.appearanceRequestTimer);
      this.appearanceRequestTimer = 0;
      this.activeAppearanceRequest = "";
      this.appearanceRequests = [];
      this.appearanceRequestSet.clear();
      if (!this.stopped) this.scheduleReconnect("Server connection closed.");
    };
  }

  private scheduleReconnect(detail: string): void {
    if (this.stopped || this.reconnectTimer) return;
    this.options.onPhase("reconnecting", detail);
    const delay = Math.min(8_000, 500 * 2 ** Math.min(4, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.open(true);
    }, delay);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private beginSampling(): void {
    window.clearInterval(this.sampleTimer);
    this.lastPose = this.options.getPose();
    this.lastPoseAt = performance.now();
    this.sampleTimer = window.setInterval(() => {
      if (!this.joined) return;
      const pose = this.options.getPose();
      const now = performance.now();
      const previous = this.lastPose ?? pose;
      const dt = Math.max(0.025, Math.min(0.2, (now - this.lastPoseAt) / 1_000));
      const dx = pose.x - previous.x;
      const dz = pose.z - previous.z;
      const dy = pose.y - previous.y;
      const creative = this.gameMode === "creative";
      const nominalSpeed = creative ? 7 : 4.32;
      this.sequence += 1;
      const rawMoveX = dx / (dt * nominalSpeed);
      const rawMoveZ = dz / (dt * nominalSpeed);
      const moveMagnitude = Math.max(1, Math.hypot(rawMoveX, rawMoveZ));
      const heldItem = this.options.getHeldItem?.() ?? null;
      this.send({
        v: REALTIME_PROTOCOL_VERSION,
        type: "input",
        seq: this.sequence,
        dtMs: dt * 1_000,
        moveX: rawMoveX / moveMagnitude,
        ...(creative ? { moveY: Math.max(-1, Math.min(1, dy / (dt * 7))) } : {}),
        moveZ: rawMoveZ / moveMagnitude,
        yaw: pose.yaw,
        pitch: pose.pitch,
        jump: dy > 0.045,
        sprint: Math.hypot(dx, dz) / dt > nominalSpeed * 1.12,
        heldItem: heldItem ?? "",
        x: pose.x,
        y: pose.y,
        z: pose.z,
      });
      this.sentPoses.set(this.sequence, { ...pose });
      if (this.sentPoses.size > 96) this.sentPoses.delete(this.sentPoses.keys().next().value!);
      this.publishAppearance(false);
      this.lastPose = pose;
      this.lastPoseAt = now;
    }, 50);
  }

  private prepareAppearance(): void {
    if (this.localSkin || this.localSkinLoading || !this.options.getSkin) return;
    this.localSkinLoading = true;
    void this.options.getSkin().then((skin) => {
      this.localSkin = skin;
      if (this.joined) this.publishAppearance(true);
    }).catch(() => undefined).finally(() => { this.localSkinLoading = false; });
  }

  private publishAppearance(includeSkin: boolean): void {
    if (!this.joined || !this.appearanceSupported || !this.localSkin) return;
    const armor = this.options.getArmor?.() ?? {
      armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
    };
    const appearance: RemoteAppearance = {
      skinId: this.localSkin.id,
      skinModel: this.localSkin.model,
      armorHead: armor.armorHead || "",
      armorChest: armor.armorChest || "",
      armorLegs: armor.armorLegs || "",
      armorFeet: armor.armorFeet || "",
    };
    const signature = Object.values(appearance).join("\u0000");
    if (!includeSkin && signature === this.lastAppearanceSignature) return;
    this.lastAppearanceSignature = signature;
    this.appearanceSequence += 1;
    if (includeSkin && appearance.skinId !== "default" && !this.localSkinBase64) {
      this.localSkinBase64 = encodePlayerSkinWirePixels(this.localSkin.pixels);
    }
    const wireAppearance = {
      ["skinId"]: appearance.skinId,
      ["skinModel"]: appearance.skinModel,
      armorHead: appearance.armorHead,
      armorChest: appearance.armorChest,
      armorLegs: appearance.armorLegs,
      armorFeet: appearance.armorFeet,
    };
    this.send({
      v: REALTIME_PROTOCOL_VERSION,
      type: "appearance_set",
      seq: this.appearanceSequence,
      appearance: wireAppearance,
      ...(includeSkin && appearance.skinId !== "default" ? { ["skinPixels"]: this.localSkinBase64 } : {}),
    });
  }

  private queueAppearance(userId: string, skinId: string): void {
    if (skinId === "default" || this.remoteSkins.has(skinId)) return;
    const key = `${userId}\u0000${skinId}`;
    if (this.activeAppearanceRequest === key || this.appearanceRequestSet.has(key)) return;
    if (this.appearanceRequests.length >= 32) return;
    this.appearanceRequestSet.add(key);
    this.appearanceRequests.push(key);
    this.requestNextAppearance();
  }

  private requestNextAppearance(): void {
    if (!this.joined || !this.appearanceSupported || this.activeAppearanceRequest || this.appearanceRequestTimer) return;
    const key = this.appearanceRequests.shift();
    if (!key) return;
    this.appearanceRequestSet.delete(key);
    this.activeAppearanceRequest = key;
    this.appearanceRequestGeneration += 1;
    const separator = key.indexOf("\u0000");
    this.send({
      v: REALTIME_PROTOCOL_VERSION,
      type: "appearance_request",
      userId: key.slice(0, separator),
      ["skinId"]: key.slice(separator + 1),
    });
    this.appearanceRequestTimer = window.setTimeout(() => {
      this.appearanceRequestTimer = 0;
      this.activeAppearanceRequest = "";
      this.requestNextAppearance();
    }, 2_000);
  }

  private finishAppearanceRequest(): void {
    this.activeAppearanceRequest = "";
    window.clearTimeout(this.appearanceRequestTimer);
    this.appearanceRequestTimer = window.setTimeout(() => {
      this.appearanceRequestTimer = 0;
      this.requestNextAppearance();
    }, 250);
  }

  private emitRemotePlayers(): void {
    this.options.onRemotePlayers(this.lastSnapshotPlayers.map((player) => {
      const appearance = this.remoteAppearances.get(player.id);
      return appearance ? {
        ...player,
        ...appearance,
        skinPixels: this.remoteSkins.get(appearance.skinId) ?? null,
      } : player;
    }));
  }

  private async acceptAppearanceBlob(message: RealtimeEnvelope): Promise<void> {
    const userId = boundedText(message.userId, 128);
    const skinId = boundedText(message["skinId"], 64);
    const key = `${userId}\u0000${skinId}`;
    if (!userId || !/^[a-f0-9]{64}$/.test(skinId) || key !== this.activeAppearanceRequest) return;
    const generation = this.appearanceRequestGeneration;
    if (this.appearanceDigestGeneration === generation) return;
    this.appearanceDigestGeneration = generation;
    try {
      const pixels = decodePlayerSkinWirePixels(message["skinPixels"]);
      if (!pixels || await playerSkinWireId(pixels) !== skinId) return;
      if (this.activeAppearanceRequest !== key || this.appearanceRequestGeneration !== generation) return;
      if (this.remoteSkins.size >= 32 && !this.remoteSkins.has(skinId)) {
        const referenced = new Set([...this.remoteAppearances.values()].map((appearance) => appearance.skinId));
        const stale = [...this.remoteSkins.keys()].find((id) => !referenced.has(id));
        if (!stale) return;
        this.remoteSkins.delete(stale);
      }
      this.remoteSkins.set(skinId, pixels);
      this.emitRemotePlayers();
    } finally {
      if (this.appearanceDigestGeneration === generation) this.appearanceDigestGeneration = 0;
      if (this.activeAppearanceRequest === key && this.appearanceRequestGeneration === generation) {
        this.finishAppearanceRequest();
      }
    }
  }

  private handleMessage(message: RealtimeEnvelope | null): void {
    if (!message) return;
    if (message.type === "hello") {
      this.appearanceSupported = Array.isArray(message.capabilities)
        && message.capabilities.includes(APPEARANCE_CAPABILITY);
      if (this.appearanceSupported) this.prepareAppearance();
      return;
    }
    if (message.type === "welcome") {
      const token = boundedText(message.resumeToken, 256);
      if (token) this.resumeToken = token;
      this.joined = true;
      this.reconnectAttempt = 0;
      const initial = Array.isArray(message.blocks) ? message.blocks.map(decodeWorldEdit).filter(Boolean) as RealtimeWorldEdit[] : [];
      if (initial.length > 0) this.options.onWorldEdits(initial, true);
      const welcomePlayer = message.player;
      if (welcomePlayer && typeof welcomePlayer === "object" && !Array.isArray(welcomePlayer)) {
        this.gameMode = decodeRealtimeGameMode((welcomePlayer as Record<string, unknown>).gameMode);
        this.options.onGameMode(this.gameMode);
        const welcomePose = decodePose(welcomePlayer);
        if (welcomePose) this.options.onReconcilePose?.(welcomePose);
        const health = finiteNumber((welcomePlayer as Record<string, unknown>).health);
        if (health !== null && health >= 0 && health <= 20) this.options.onSelfHealth(health);
      }
      this.sentPoses.clear();
      this.options.onPhase("online");
      this.beginSampling();
      this.prepareAppearance();
      this.publishAppearance(true);
      for (const [operationId, message] of this.pendingChat) {
        this.send({ v: REALTIME_PROTOCOL_VERSION, type: "chat_send", operationId, message });
      }
      for (const [operationId, damage] of this.pendingSelfDamage) {
        this.send({ v: REALTIME_PROTOCOL_VERSION, type: "self_damage", operationId, damage, cause: "fall" });
      }
      return;
    }
    if (message.type === "appearance_roster") {
      this.remoteAppearances.clear();
      if (Array.isArray(message.players)) for (const value of message.players.slice(0, 32)) {
        const appearance = decodeAppearance(value);
        if (!appearance) continue;
        const { userId, ...state } = appearance;
        this.remoteAppearances.set(userId, state);
        this.queueAppearance(userId, state.skinId);
      }
      this.emitRemotePlayers();
      return;
    }
    if (message.type === "appearance_state") {
      const appearance = decodeAppearance(message.player);
      if (!appearance) return;
      const { userId, ...state } = appearance;
      if (userId !== this.options.localUserId) {
        if (!this.remoteAppearances.has(userId) && this.remoteAppearances.size >= 32) return;
        this.remoteAppearances.set(userId, state);
        this.queueAppearance(userId, state.skinId);
        this.emitRemotePlayers();
      }
      return;
    }
    if (message.type === "appearance_remove") {
      const userId = boundedText(message.userId, 128);
      if (userId) {
        this.remoteAppearances.delete(userId);
        this.emitRemotePlayers();
      }
      return;
    }
    if (message.type === "appearance_blob") {
      void this.acceptAppearanceBlob(message);
      return;
    }
    if (message.type === "world_snapshot") {
      const edits = Array.isArray(message.edits) ? message.edits.map(decodeWorldEdit).filter(Boolean) as RealtimeWorldEdit[] : [];
      this.options.onWorldEdits(edits, true);
      return;
    }
    if (message.type === "block_patch") {
      const decoded = decodeWorldEdit(message.edit ?? message);
      if (!decoded) return;
      const operationId = boundedText(message.operationId, 96);
      const edit = operationId ? { ...decoded, operationId } : decoded;
      this.options.onWorldEdits([edit], false);
      if (edit.operationId) {
        const pending = this.pendingBlocks.get(edit.operationId);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pendingBlocks.delete(edit.operationId);
          pending.resolve(edit);
        }
      }
      return;
    }
    if (message.type === "chat_history") {
      const messages = Array.isArray(message.messages)
        ? message.messages.slice(-80).map(decodeChatMessage).filter(Boolean) as RealtimeChatMessage[]
        : [];
      this.options.onChatEvent({ type: "history", messages });
      for (const chat of messages) this.pendingChat.delete(chat.operationId);
      return;
    }
    if (message.type === "chat_message") {
      const chat = decodeChatMessage(message.message);
      if (!chat) return;
      this.pendingChat.delete(chat.operationId);
      this.options.onChatEvent({ type: "confirmed", message: chat });
      return;
    }
    if (message.type === "drop_snapshot") {
      this.options.onDrops(Array.isArray(message.drops) ? message.drops.slice(0, 256).map(decodeDrop).filter(Boolean) as NormalizedDroppedItem[] : []);
      return;
    }
    if (message.type === "drop_result") {
      const operationId = boundedText(message.operationId, 96);
      const pending = this.pendingDrops.get(operationId);
      const drop = decodeDrop(message.drop);
      if (!pending || !drop) return;
      window.clearTimeout(pending.timer);
      this.pendingDrops.delete(operationId);
      pending.resolve(drop);
      return;
    }
    if (message.type === "player_hit") {
      const operationId = boundedText(message.operationId, 96);
      const attackerId = boundedText(message.attackerId, 128);
      const targetId = boundedText(message.targetId, 128);
      const damage = finiteNumber(message.damage);
      const health = finiteNumber(message.health);
      const attackerX = finiteNumber(message.attackerX);
      const attackerZ = finiteNumber(message.attackerZ);
      if (!operationId || !attackerId || !targetId || damage === null || !Number.isInteger(damage)
        || damage < 1 || damage > 20 || health === null || !Number.isInteger(health) || health < 0 || health > 20
        || attackerX === null || attackerZ === null || typeof message.killed !== "boolean") return;
      this.options.onPlayerHit({ operationId, attackerId, targetId, damage, health,
        killed: message.killed, attackerX, attackerZ });
      return;
    }
    if (message.type === "self_damage_result") {
      const operationId = boundedText(message.operationId, 96);
      const damage = finiteNumber(message.damage);
      const health = finiteNumber(message.health);
      if (!this.pendingSelfDamage.has(operationId) || damage === null || !Number.isInteger(damage)
        || damage < 1 || damage > 20 || health === null || !Number.isInteger(health) || health < 0 || health > 20
        || message.cause !== "fall" || typeof message.killed !== "boolean") return;
      this.pendingSelfDamage.delete(operationId);
      this.options.onSelfHealth(health);
      return;
    }
    if (message.type === "respawned") {
      const pose = decodePose(message.player);
      const operationId = boundedText(message.operationId, 96);
      const pending = this.pendingRespawn;
      if (!pending || !pose || !operationId.startsWith("respawn_")) return;
      window.clearTimeout(pending.timer);
      this.pendingRespawn = null;
      // Rebase transport prediction before the promise callback moves the
      // engine. The next 50 ms sample is now measured from the exact server
      // spawn instead of the dead pose, so it cannot immediately undo respawn.
      this.lastPose = pose;
      this.lastPoseAt = performance.now();
      this.sentPoses.clear();
      pending.resolve(pose);
      return;
    }
    if (message.type === "snapshot") {
      const self = decodePose(message.self);
      if (message.self && typeof message.self === "object" && !Array.isArray(message.self)) {
        this.gameMode = decodeRealtimeGameMode((message.self as Record<string, unknown>).gameMode);
        this.options.onGameMode(this.gameMode);
        const health = finiteNumber((message.self as Record<string, unknown>).health);
        if (health !== null && health >= 0 && health <= 20) this.options.onSelfHealth(health);
      }
      const ack = finiteNumber(message.inputAck);
      const acknowledged = ack !== null ? this.sentPoses.get(ack) : undefined;
      if (self && acknowledged) {
        const correctionX = self.x - acknowledged.x;
        const correctionY = self.y - acknowledged.y;
        const correctionZ = self.z - acknowledged.z;
        if (Math.hypot(correctionX, correctionY, correctionZ) > 0.75) {
          const local = this.options.getPose();
          this.options.onReconcilePose?.({
            x: local.x + correctionX,
            y: local.y + correctionY,
            z: local.z + correctionZ,
            yaw: local.yaw,
            pitch: local.pitch,
          });
        }
        for (const sequence of this.sentPoses.keys()) if (sequence <= ack!) this.sentPoses.delete(sequence);
      }
      const players: RemotePlayer[] = [];
      if (Array.isArray(message.players)) {
        for (const value of message.players.slice(0, 128)) {
          const pose = decodePose(value);
          if (!pose || !value || typeof value !== "object" || Array.isArray(value)) continue;
          const source = value as Record<string, unknown>;
          const id = boundedText(source.id ?? source.userId, 128);
          if (!id) continue;
          const vx = finiteNumber(source.vx);
          const vy = finiteNumber(source.vy);
          const vz = finiteNumber(source.vz);
          const visualActions = decodeVisualActions(source.visualActions);
          const health = finiteNumber(source.health);
          players.push({
            ...pose,
            id,
            name: boundedText(source.name ?? source.username, 32) || "Player",
            ...(typeof source.heldItem === "string" ? { heldItem: boundedText(source.heldItem, 64) } : {}),
            ...(typeof source.crouching === "boolean" ? { crouching: source.crouching } : {}),
            ...(health !== null && Number.isInteger(health) && health >= 0 && health <= 20 ? { health } : {}),
            ...(visualActions.length ? { visualActions } : {}),
            ...(vx === null ? {} : { vx }),
            ...(vy === null ? {} : { vy }),
            ...(vz === null ? {} : { vz }),
          });
        }
      }
      this.lastSnapshotPlayers = players;
      this.emitRemotePlayers();
      return;
    }
    if (message.type === "error") {
      const operationId = boundedText(message.operationId, 96);
      if (operationId?.startsWith("chat_")) {
        this.pendingChat.delete(operationId);
        this.options.onChatEvent({
          type: "failed",
          operationId,
        });
        return;
      }
      if (operationId) {
        if (operationId.startsWith("attack:")) return;
        if (operationId.startsWith("fall:")) {
          this.pendingSelfDamage.delete(operationId);
          return;
        }
        if (operationId.startsWith("respawn_") && this.pendingRespawn) {
          const pending = this.pendingRespawn;
          window.clearTimeout(pending.timer);
          this.pendingRespawn = null;
          pending.reject(new Error(boundedText(message.code, 64) || "multiplayer_respawn_rejected"));
          return;
        }
        const drop = this.pendingDrops.get(operationId);
        if (drop) {
          window.clearTimeout(drop.timer);
          this.pendingDrops.delete(operationId);
          drop.reject(new Error(boundedText(message.code, 64) || "multiplayer_drop_rejected"));
          return;
        }
        const pending = this.pendingBlocks.get(operationId);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pendingBlocks.delete(operationId);
          pending.reject(new Error(boundedText(message.code, 64) || "multiplayer_block_rejected"));
        }
      }
      const detail = boundedText(message.message, 180) || "The server rejected the connection.";
      this.options.onPhase("error", detail);
      if (message.fatal === true) {
        this.stopped = true;
        this.socket?.close(4000, "fatal_server_error");
      }
    }
  }

}
