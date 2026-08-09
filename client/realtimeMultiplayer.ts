import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";

export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_SERVERS_STORAGE_KEY = "lakecraft:multiplayer-servers:v1";

export type RealtimeConnectionPhase = "idle" | "connecting" | "online" | "reconnecting" | "offline" | "error";

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
  getPose: () => PlayerPose;
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onReconcilePose?: (pose: PlayerPose) => void;
};

type PendingBlockEdit = {
  resolve: (edit: RealtimeWorldEdit) => void;
  reject: (error: Error) => void;
  timer: number;
};

type RealtimeEnvelope = Record<string, unknown> & { v: number; type: string };

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
  private reconnectAttempt = 0;
  private lastPose: PlayerPose | null = null;
  private lastPoseAt = 0;
  private pendingBlocks = new Map<string, PendingBlockEdit>();

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

  private open(reconnecting: boolean): void {
    const endpoint = normalizeMultiplayerEndpoint(this.options.endpoint);
    if (!endpoint) {
      this.options.onPhase("error", "The server address is not a valid WebSocket URL.");
      return;
    }
    this.options.onPhase(reconnecting ? "reconnecting" : "connecting");
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
      const nominalSpeed = 4.32;
      this.sequence += 1;
      const rawMoveX = dx / (dt * nominalSpeed);
      const rawMoveZ = dz / (dt * nominalSpeed);
      const moveMagnitude = Math.max(1, Math.hypot(rawMoveX, rawMoveZ));
      this.send({
        v: REALTIME_PROTOCOL_VERSION,
        type: "input",
        seq: this.sequence,
        dtMs: dt * 1_000,
        moveX: rawMoveX / moveMagnitude,
        moveZ: rawMoveZ / moveMagnitude,
        yaw: pose.yaw,
        pitch: pose.pitch,
        jump: dy > 0.045,
        sprint: Math.hypot(dx, dz) / dt > nominalSpeed * 1.12,
      });
      this.lastPose = pose;
      this.lastPoseAt = now;
    }, 50);
  }

  private handleMessage(message: RealtimeEnvelope | null): void {
    if (!message) return;
    if (message.type === "welcome") {
      const token = boundedText(message.resumeToken, 256);
      if (token) this.resumeToken = token;
      this.joined = true;
      this.reconnectAttempt = 0;
      const initial = Array.isArray(message.blocks) ? message.blocks.map(decodeWorldEdit).filter(Boolean) as RealtimeWorldEdit[] : [];
      if (initial.length > 0) this.options.onWorldEdits(initial, true);
      this.options.onPhase("online");
      this.beginSampling();
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
    if (message.type === "snapshot") {
      const self = decodePose(message.self);
      const local = this.options.getPose();
      if (self && Math.hypot(self.x - local.x, self.y - local.y, self.z - local.z) > 1.5) {
        this.options.onReconcilePose?.(self);
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
          players.push({
            ...pose,
            id,
            name: boundedText(source.name ?? source.username, 32) || "Player",
            ...(vx === null ? {} : { vx }),
            ...(vy === null ? {} : { vy }),
            ...(vz === null ? {} : { vz }),
          });
        }
      }
      this.options.onRemotePlayers(players);
      return;
    }
    if (message.type === "error") {
      const operationId = boundedText(message.operationId, 96);
      if (operationId) {
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
