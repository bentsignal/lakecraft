import type { JoinAuthenticator } from "./auth";
import type { ServerConfig } from "./config";
import type { WorldStore } from "./database";
import type { AdminPlayerSummary, AdminWorldControl, ServerGameMode } from "./adminPortal";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  APPEARANCE_CAPABILITY,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeServerMessage,
  protocolError,
  type ClientMessage,
  type PublicAppearance,
  type PublicPlayer,
  type PublicDrop,
  type PlayerHit,
  type ServerMessage,
} from "./protocol";
import {
  CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_SPEED,
  MAX_PLAYER_XZ,
  MAX_PLAYER_Y,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
  terrainFeetY,
} from "./terrain";

export interface Peer {
  readonly id: string;
  send(payload: string): void;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}

interface Controls {
  moveX: number;
  moveY: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
}

interface ConnectionState {
  peer: Peer;
  joined: boolean;
  joining: boolean;
  sessionId?: string;
  player?: PublicPlayer;
  resumeHash?: string;
  resumeExpiresAt?: number;
  controls: Controls;
  vy: number;
  lastInputSeq: number;
  lastActionSeq: number;
  lastAppearanceSeq: number;
  lastEditSeq: number;
  lastInputAt: number;
  rateWindowAt: number;
  rateCount: number;
  lastSavedAt: number;
  lastSkinAt: number;
  lastAttackAt: number;
  appearanceRequestWindowAt: number;
  appearanceRequestCount: number;
  appearanceRequestKeys: Set<string>;
  appearance: PublicAppearance;
  skinPixels?: string;
  clientPoseAuthority: boolean;
}

// Feet pose on the deterministic client's height-68 spawn plateau.
const SPAWN = { x: 0.5, y: terrainFeetY(0.5, 0.5), z: 0.5 };
/** Twenty-one chunks: the authority can feed the highest supported client view. */
const NEARBY_RADIUS = 21 * 16;
const EDIT_REACH = 8;
const MAX_MESSAGE_BYTES = 32 * 1024;
const SOFT_BACKPRESSURE = 64 * 1024;
const HARD_BACKPRESSURE = 256 * 1024;
export const CHAT_HISTORY_LIMIT = 80;
export const CHAT_RATE_LIMIT_MS = 900;
export const RESUME_TOKEN_TTL_MS = 10 * 60 * 1_000;
export const SKIN_CHANGE_RATE_LIMIT_MS = 3_000;
export const APPEARANCE_REQUEST_RATE_LIMIT = 4;
export const APPEARANCE_REQUEST_RATE_WINDOW_MS = 1_000;
const DROP_TTL_MS = 5 * 60_000;
const DROP_OWNER_DELAY_MS = 150;
const DROP_REACH = 3;
const PLAYER_ATTACK_REACH = 6.25;
const PLAYER_ATTACK_COOLDOWN_MS = 400;

const DEFAULT_APPEARANCE: PublicAppearance = Object.freeze({
  skinId: "default",
  skinModel: "wide",
  armorHead: "",
  armorChest: "",
  armorLegs: "",
  armorFeet: "",
});

export class GameWorld implements AdminWorldControl {
  private readonly connections = new Map<string, ConnectionState>();
  private readonly userConnections = new Map<string, ConnectionState>();
  private tickNumber = 0;
  private visualActionSequence = 0;
  private readonly drops = new Map<string, PublicDrop>();
  private readonly dropOperations = new Map<string, PublicDrop>();
  private readonly playerHitOperations = new Map<string, PlayerHit>();
  private shuttingDown = false;

  constructor(
    readonly config: ServerConfig,
    private readonly store: WorldStore,
    private readonly authenticator: JoinAuthenticator,
  ) {
    for (const drop of store.listDrops()) this.drops.set(drop.dropId, drop);
  }

  get playerCount(): number {
    return this.userConnections.size;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  isJoined(peerId: string): boolean {
    return this.connections.get(peerId)?.joined ?? false;
  }

  adminPlayers(): AdminPlayerSummary[] {
    return this.store.listPlayers().map((player) => ({
      ...player,
      connected: this.userConnections.has(player.id),
    }));
  }

  setPlayerGameMode(userId: string, gameMode: ServerGameMode): boolean {
    if (!this.store.setPlayerGameMode(userId, gameMode)) return false;
    const state = this.userConnections.get(userId);
    if (state?.player) {
      state.player.gameMode = gameMode;
      state.controls.moveY = 0;
      state.vy = 0;
      state.player.vy = 0;
    }
    return true;
  }

  kickPlayer(userId: string): boolean {
    const state = this.userConnections.get(userId);
    if (!state?.player) return false;
    // Persist the latest pose/role while rotating away the browser's current
    // resume credential. Clearing the in-memory credential prevents close()
    // from writing the still-valid hash back over this revocation.
    this.store.savePlayer(state.player, `revoked:${crypto.randomUUID()}`, Date.now(), 0);
    state.resumeHash = undefined;
    state.resumeExpiresAt = undefined;
    this.close(state.peer);
    state.peer.close(4002, "Disconnected by server operator");
    return true;
  }

  open(peer: Peer, now = Date.now()): void {
    if (this.connections.has(peer.id)) return;
    this.connections.set(peer.id, {
      peer,
      joined: false,
      joining: false,
      controls: { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false },
      vy: 0,
      lastInputSeq: 0,
      lastActionSeq: 0,
      lastAppearanceSeq: 0,
      lastEditSeq: 0,
      lastInputAt: now,
      rateWindowAt: now,
      rateCount: 0,
      lastSavedAt: now,
      lastSkinAt: Number.NEGATIVE_INFINITY,
      lastAttackAt: Number.NEGATIVE_INFINITY,
      appearanceRequestWindowAt: now,
      appearanceRequestCount: 0,
      appearanceRequestKeys: new Set(),
      appearance: { ...DEFAULT_APPEARANCE },
      clientPoseAuthority: false,
    });
    this.send(peer, {
      v: PROTOCOL_VERSION,
      type: "hello",
      serverId: this.config.serverId,
      serverName: this.config.serverName,
      authMode: this.config.authMode,
      tickHz: this.config.tickHz,
      snapshotHz: this.config.snapshotHz,
      capabilities: [APPEARANCE_CAPABILITY],
    });
  }

  close(peer: Peer): void {
    const state = this.connections.get(peer.id);
    if (!state) return;
    this.connections.delete(peer.id);
    if (state.player && this.userConnections.get(state.player.id) === state) {
      this.userConnections.delete(state.player.id);
      if (state.resumeHash && state.resumeExpiresAt !== undefined && !this.shuttingDown) {
        this.store.savePlayer(state.player, state.resumeHash, Date.now(), state.resumeExpiresAt);
      }
      for (const other of this.userConnections.values()) {
        this.send(other.peer, { v: PROTOCOL_VERSION, type: "appearance_remove", userId: state.player.id });
      }
    }
  }

  async message(peer: Peer, raw: string, now = Date.now()): Promise<void> {
    const state = this.connections.get(peer.id);
    if (!state) return;
    const bytes = new TextEncoder().encode(raw).byteLength;
    if (bytes > MAX_MESSAGE_BYTES) {
      this.fail(state, "bad_message", "Message exceeds 32 KiB", true);
      return;
    }
    if (now - state.rateWindowAt >= 1_000) {
      state.rateWindowAt = now;
      state.rateCount = 0;
    }
    state.rateCount++;
    if (state.rateCount > 120) {
      this.fail(state, "rate_limited", "Message rate exceeded", true, true);
      return;
    }

    const decoded = decodeClientMessage(raw);
    if (!decoded.ok) {
      this.fail(state, decoded.code, decoded.message, decoded.code === "unsupported_version");
      return;
    }
    const message = decoded.message;
    if (message.type === "ping") {
      this.send(peer, { v: PROTOCOL_VERSION, type: "pong", t: message.t, serverTime: now });
      return;
    }
    if (message.type === "join") {
      await this.join(state, message, now);
      return;
    }
    if (!state.joined || !state.player) {
      this.fail(state, "join_required", "Authenticate with a join message first");
      return;
    }
    if (message.type === "input") this.input(state, message, now);
    else if (message.type === "action") this.action(state, message);
    else if (message.type === "block_edit") this.blockEdit(state, message, now);
    else if (message.type === "chat_send") this.chat(state, message, now);
    else if (message.type === "drop_item") this.dropItem(state, message, now);
    else if (message.type === "pickup_item") this.pickupItem(state, message, now);
    else if (message.type === "player_attack") this.playerAttack(state, message, now);
    else if (message.type === "respawn") this.respawn(state, message, now);
    else if (message.type === "appearance_set") await this.setAppearance(state, message, now);
    else this.sendAppearance(state, message, now);
  }

  tick(now = Date.now()): void {
    this.tickNumber++;
    let removedDrop = false;
    for (const [id, drop] of this.drops) if (drop.expiresAt <= now) {
      this.drops.delete(id);
      this.store.deleteDrop(id);
      removedDrop = true;
    }
    if (removedDrop) this.broadcastDrops();
    const dt = 1 / this.config.tickHz;
    for (const state of this.userConnections.values()) {
      const player = state.player!;
      if ((player.health ?? 20) <= 0) {
        player.vx = player.vy = player.vz = 0;
        state.vy = 0;
        state.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
        continue;
      }
      if (now - state.lastInputAt > 300) {
        state.controls.moveX = 0;
        state.controls.moveY = 0;
        state.controls.moveZ = 0;
        state.controls.jump = false;
      }
      const creative = player.gameMode === "creative";
      const speed = creative
        ? state.controls.sprint ? CREATIVE_FLIGHT_SPRINT_SPEED : CREATIVE_FLIGHT_SPEED
        : state.controls.sprint ? 5.6 : 4.35;
      if (state.clientPoseAuthority) {
        if (now - state.lastInputAt > 300) player.vx = player.vy = player.vz = 0;
        if (now - state.lastSavedAt >= 1_000 && state.resumeHash && state.resumeExpiresAt !== undefined) {
          this.store.savePlayer(player, state.resumeHash, now, state.resumeExpiresAt);
          state.lastSavedAt = now;
        }
        continue;
      }
      player.vx = state.controls.moveX * speed;
      player.vz = state.controls.moveZ * speed;
      const nextX = player.x + player.vx * dt;
      if (Math.abs(nextX) <= MAX_PLAYER_XZ && terrainFeetY(nextX, player.z) <= player.y + 0.0001) player.x = nextX;
      else player.vx = 0;
      const nextZ = player.z + player.vz * dt;
      if (Math.abs(nextZ) <= MAX_PLAYER_XZ && terrainFeetY(player.x, nextZ) <= player.y + 0.0001) player.z = nextZ;
      else player.vz = 0;

      const groundY = terrainFeetY(player.x, player.z);
      if (creative) {
        state.vy = state.controls.moveY * CREATIVE_FLIGHT_SPEED;
      } else {
        const grounded = player.y <= groundY + 0.0001;
        if (state.controls.jump && grounded) state.vy = PLAYER_JUMP_SPEED;
        state.vy -= PLAYER_GRAVITY * dt;
      }
      state.controls.jump = false;
      player.y += state.vy * dt;
      if (player.y > MAX_PLAYER_Y) {
        player.y = MAX_PLAYER_Y;
        state.vy = 0;
      }
      if (player.y < groundY) {
        player.y = groundY;
        state.vy = 0;
      }
      player.vy = state.vy;

      if (now - state.lastSavedAt >= 1_000 && state.resumeHash && state.resumeExpiresAt !== undefined) {
        this.store.savePlayer(player, state.resumeHash, now, state.resumeExpiresAt);
        state.lastSavedAt = now;
      }
    }
  }

  snapshots(now = Date.now()): void {
    for (const state of this.userConnections.values()) {
      if (state.peer.bufferedAmount() > SOFT_BACKPRESSURE) continue;
      const self = state.player!;
      const players = [...this.userConnections.values()]
        .filter((other) => other !== state && squaredDistance(self, other.player!) <= NEARBY_RADIUS ** 2)
        .slice(0, 32)
        .map((other) => ({ ...other.player! }));
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        serverTick: this.tickNumber,
        sentAt: now,
        inputAck: state.lastInputSeq,
        self: { ...self },
        players,
      });
    }
  }

  shutdown(): void {
    this.shuttingDown = true;
    for (const state of this.userConnections.values()) {
      if (state.player && state.resumeHash && state.resumeExpiresAt !== undefined) {
        this.store.savePlayer(state.player, state.resumeHash, Date.now(), state.resumeExpiresAt);
      }
    }
  }

  private async join(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "join" }>,
    now: number,
  ): Promise<void> {
    if (state.joined || state.joining) {
      this.fail(state, "already_joined", "Connection already joined");
      return;
    }
    state.joining = true;
    try {
      const suppliedResumeHash = message.resumeToken ? await hashToken(message.resumeToken) : "";
      const resumeRecord = suppliedResumeHash ? this.store.loadPlayerByResumeHash(suppliedResumeHash) : null;
      const validResumeRecord = resumeRecord && resumeRecord.resumeExpiresAt > now ? resumeRecord : null;
      const principal = validResumeRecord
        ? { userId: validResumeRecord.player.id, displayName: validResumeRecord.player.name }
        : await this.authenticator.authenticate(message);
      const existingForUser = this.userConnections.get(principal.userId);
      if (!existingForUser && this.playerCount >= this.config.maxPlayers) {
        this.fail(state, "server_full", "Server is full", true, true);
        return;
      }
      const stored = this.store.loadPlayer(principal.userId);
      const resumed = Boolean(stored && validResumeRecord && stored.resumeHash === suppliedResumeHash);
      const resumeToken = createResumeToken();
      const resumeHash = await hashToken(resumeToken);
      const resumeExpiresAt = now + RESUME_TOKEN_TTL_MS;
      const player: PublicPlayer = resumed
        ? { ...stored!.player, name: principal.displayName, vx: 0, vy: 0, vz: 0 }
        : {
            id: principal.userId,
            name: principal.displayName,
            ...SPAWN,
            yaw: 0,
            pitch: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            gameMode: stored?.player.gameMode === "creative" ? "creative" : "survival",
            health: stored?.player.health ?? 20,
          };
      // Older fixed-floor servers could persist players below the actual
      // deterministic surface. Heal those poses before the first welcome so a
      // reconnect cannot begin embedded in the spawn rim.
      player.x = Math.max(-MAX_PLAYER_XZ, Math.min(MAX_PLAYER_XZ, player.x));
      player.z = Math.max(-MAX_PLAYER_XZ, Math.min(MAX_PLAYER_XZ, player.z));
      player.y = Math.min(MAX_PLAYER_Y, Math.max(player.y, terrainFeetY(player.x, player.z)));

      if (existingForUser) {
        state.appearance = { ...existingForUser.appearance };
        state.skinPixels = existingForUser.skinPixels;
        existingForUser.joined = false;
        existingForUser.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
        existingForUser.peer.close(4001, "Reconnected from another socket");
      }
      state.joined = true;
      state.player = player;
      state.sessionId = crypto.randomUUID();
      state.resumeHash = resumeHash;
      state.resumeExpiresAt = resumeExpiresAt;
      state.lastInputAt = now;
      this.userConnections.set(player.id, state);
      this.store.savePlayer(player, resumeHash, now, resumeExpiresAt);
      const revision = this.store.getRevision();
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "welcome",
        sessionId: state.sessionId,
        resumeToken,
        resumed,
        player: { ...player },
        serverTick: this.tickNumber,
        inputAck: state.lastInputSeq,
        blocksRevision: revision,
      });
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "world_snapshot",
        revision,
        edits: this.store.getAllBlockEdits(),
      });
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "chat_history",
        messages: this.store.recentChat(CHAT_HISTORY_LIMIT),
      });
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_snapshot", drops: [...this.drops.values()] });
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "appearance_roster",
        players: [...this.userConnections.values()]
          .filter((other) => other !== state && other.player)
          .slice(0, 32)
          .map((other) => ({ userId: other.player!.id, ...other.appearance })),
      });
      for (const other of this.userConnections.values()) {
        if (other !== state) this.send(other.peer, {
          v: PROTOCOL_VERSION,
          type: "appearance_state",
          player: { userId: player.id, ...state.appearance },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed";
      this.fail(state, "auth_failed", message, true);
    } finally {
      state.joining = false;
    }
  }

  private input(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "input" }>,
    now: number,
  ): void {
    // A resumed browser retains its sequence counter, while a socket starts
    // without transport history. Rebase from the first input, then enforce the
    // ordinary replay and bounded-gap window for every subsequent message.
    if (state.lastInputSeq !== 0 && message.seq <= state.lastInputSeq) {
      this.fail(state, "stale_input", "Input sequence is stale");
      return;
    }
    if (state.lastInputSeq !== 0 && message.seq > state.lastInputSeq + 64) {
      this.fail(state, "input_gap", "Input sequence gap exceeds 64", false, true);
      return;
    }
    state.lastInputSeq = message.seq;
    state.lastInputAt = now;
    if ((state.player!.health ?? 20) <= 0) {
      state.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
      return;
    }
    if (message.x !== undefined && message.y !== undefined && message.z !== undefined) {
      const player = state.player!;
      const dt = Math.max(0.025, message.dtMs / 1_000);
      const dx = message.x - player.x;
      const dy = message.y - player.y;
      const dz = message.z - player.z;
      const maxStep = 1.5 + dt * (player.gameMode === "creative" ? CREATIVE_FLIGHT_SPRINT_SPEED : 8.5);
      if (Math.hypot(dx, dz) > maxStep || Math.abs(dy) > maxStep) {
        // The next ordinary snapshot acknowledges this sample while retaining
        // the last accepted pose. The browser applies that delta to its current
        // prediction, recovering without a toast or a permanently rejected gap.
        return;
      }
      player.x = message.x;
      player.y = message.y;
      player.z = message.z;
      player.vx = dx / dt;
      player.vy = dy / dt;
      player.vz = dz / dt;
      state.vy = player.vy;
      state.clientPoseAuthority = true;
    }
    state.controls = {
      moveX: message.moveX,
      // Protocol-v1 clients without moveY retain upward flight via `jump`;
      // explicit moveY adds hover/descent without changing the join contract.
      moveY: message.moveY ?? (message.jump ? 1 : 0),
      moveZ: message.moveZ,
      jump: message.jump,
      sprint: message.sprint,
    };
    state.player!.yaw = normalizeYaw(message.yaw);
    state.player!.pitch = message.pitch;
    if (message.heldItem !== undefined) state.player!.heldItem = message.heldItem;
  }

  private action(state: ConnectionState, message: Extract<ClientMessage, { type: "action" }>): void {
    if (message.seq <= state.lastActionSeq || (state.lastActionSeq !== 0 && message.seq > state.lastActionSeq + 64)) return;
    state.lastActionSeq = message.seq;
    if ((state.player!.health ?? 20) <= 0) return;
    const actions = state.player!.visualActions ?? [];
    actions.push({
      sequence: ++this.visualActionSequence,
      kind: message.kind,
      ...(message.value === undefined ? {} : { value: message.value }),
    });
    if (actions.length > 8) actions.splice(0, actions.length - 8);
    state.player!.visualActions = actions;
    if (message.kind === "crouch_on") state.player!.crouching = true;
    if (message.kind === "crouch_off") state.player!.crouching = false;
  }

  private async setAppearance(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "appearance_set" }>,
    now: number,
  ): Promise<void> {
    if (message.seq <= state.lastAppearanceSeq
      || (state.lastAppearanceSeq !== 0 && message.seq > state.lastAppearanceSeq + 64)) return;
    state.lastAppearanceSeq = message.seq;
    let skinPixels = state.skinPixels;
    if (message.appearance.skinId === "default") {
      skinPixels = undefined;
    } else if (message.skinPixels !== undefined) {
      if (now - state.lastSkinAt < SKIN_CHANGE_RATE_LIMIT_MS) {
        this.fail(state, "rate_limited", "Skin changes are rate limited", false, true);
        return;
      }
      state.lastSkinAt = now;
      const digest = await hashSkinPixels(message.skinPixels);
      if (this.connections.get(state.peer.id) !== state || !state.joined || !state.player
        || state.lastAppearanceSeq !== message.seq) return;
      if (digest !== message.appearance.skinId) {
        this.fail(state, "bad_message", "Skin hash does not match its pixels");
        return;
      }
      skinPixels = message.skinPixels;
    } else if (message.appearance.skinId !== state.appearance.skinId || !skinPixels) {
      this.fail(state, "bad_message", "Unknown skin reference");
      return;
    }
    state.appearance = { ...message.appearance };
    state.skinPixels = skinPixels;
    for (const other of this.userConnections.values()) this.send(other.peer, {
      v: PROTOCOL_VERSION,
      type: "appearance_state",
      player: { userId: state.player!.id, ...state.appearance },
    });
  }

  private sendAppearance(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "appearance_request" }>,
    now: number,
  ): void {
    const key = `${message.userId}\u0000${message.skinId}`;
    if (state.appearanceRequestKeys.has(key)) return;
    if (now - state.appearanceRequestWindowAt >= APPEARANCE_REQUEST_RATE_WINDOW_MS) {
      state.appearanceRequestWindowAt = now;
      state.appearanceRequestCount = 0;
    }
    state.appearanceRequestCount++;
    if (state.appearanceRequestCount > APPEARANCE_REQUEST_RATE_LIMIT) {
      this.fail(state, "rate_limited", "Appearance requests are rate limited", false, true);
      return;
    }
    const target = this.userConnections.get(message.userId);
    const skinPixels = target?.appearance.skinId === message.skinId ? target.skinPixels : undefined;
    if (skinPixels) {
      if (state.appearanceRequestKeys.size >= 32) {
        const oldest = state.appearanceRequestKeys.values().next().value;
        if (oldest !== undefined) state.appearanceRequestKeys.delete(oldest);
      }
      state.appearanceRequestKeys.add(key);
    }
    this.send(state.peer, {
      v: PROTOCOL_VERSION,
      type: "appearance_blob",
      userId: message.userId,
      skinId: message.skinId,
      ...(skinPixels ? { skinPixels } : {}),
    });
  }

  private blockEdit(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "block_edit" }>,
    now: number,
  ): void {
    const player = state.player!;
    const prior = this.store.getBlockOperation(player.id, message.operationId);
    if (prior) {
      this.send(state.peer, {
        v: PROTOCOL_VERSION,
        type: "block_patch",
        operationId: message.operationId,
        edit: prior,
      });
      return;
    }
    if (state.lastEditSeq !== 0
      && (message.seq <= state.lastEditSeq || message.seq > state.lastEditSeq + 64)) {
      this.fail(state, "invalid_edit", "Edit sequence is stale or has a gap", false, true, message.operationId);
      return;
    }
    // Consume the sequence even when semantic validation below rejects the
    // operation, so the established window cannot be repeatedly rebased.
    state.lastEditSeq = message.seq;
    const center = { x: message.x + 0.5, y: message.y + 0.5, z: message.z + 0.5 };
    if (squaredDistance(player, center) > EDIT_REACH ** 2) {
      this.fail(state, "edit_too_far", "Block edit exceeds server reach", false, false, message.operationId);
      return;
    }
    const result = this.store.applyBlockEdit(
      {
        operationId: message.operationId,
        x: message.x,
        y: message.y,
        z: message.z,
        block: message.block,
        editorId: player.id,
        editedAt: now,
      },
      this.config.maxPersistedBlocks,
    );
    if (!result) {
      this.fail(state, "world_limit", "This server reached its persisted block limit", false, false, message.operationId);
      return;
    }
    for (const other of this.userConnections.values()) {
      if (squaredDistance(player, other.player!) > (NEARBY_RADIUS * 2) ** 2) continue;
      this.send(other.peer, {
        v: PROTOCOL_VERSION,
        type: "block_patch",
        operationId: other === state ? message.operationId : undefined,
        edit: result.edit,
      });
    }
  }

  private chat(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "chat_send" }>,
    now: number,
  ): void {
    const player = state.player!;
    const result = this.store.appendChat({
      operationId: message.operationId,
      userId: player.id,
      username: player.name,
      message: message.message.slice(0, CHAT_MESSAGE_MAX_LENGTH),
      sentAt: now,
    }, CHAT_RATE_LIMIT_MS, CHAT_HISTORY_LIMIT);
    if (!result.ok) {
      this.fail(
        state,
        "rate_limited",
        `Chat rate exceeded; retry in ${result.retryAfterMs}ms`,
        false,
        true,
        message.operationId,
      );
      return;
    }
    if (result.duplicate) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "chat_message", message: result.message });
      return;
    }
    // The SQLite sequence is the single server-wide order. Broadcast in the
    // same turn so the sender's optimistic row is acknowledged immediately.
    for (const other of this.userConnections.values()) {
      this.send(other.peer, { v: PROTOCOL_VERSION, type: "chat_message", message: result.message });
    }
  }

  private dropItem(state: ConnectionState, message: Extract<ClientMessage, { type: "drop_item" }>, now: number): void {
    const key = `${state.player!.id}\u0000${message.operationId}`;
    const replay = this.dropOperations.get(key) ?? this.store.getDropOperation(state.player!.id, message.operationId);
    if (replay) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "drop", drop: replay });
      return;
    }
    if (this.drops.size >= 256 || squaredDistance(state.player!, message) > DROP_REACH ** 2) {
      this.fail(state, "bad_message", "Item drop is out of reach or the world drop limit is full", false, false, message.operationId);
      return;
    }
    const drop: PublicDrop = {
      dropId: `drop:${crypto.randomUUID()}`,
      ownerUserId: state.player!.id,
      itemId: message.itemId,
      count: message.count,
      ...(message.durability === undefined ? {} : { durability: message.durability }),
      x: message.x,
      y: message.y,
      z: message.z,
      droppedAt: now,
      ownerPickupAt: now + DROP_OWNER_DELAY_MS,
      expiresAt: now + DROP_TTL_MS,
    };
    this.drops.set(drop.dropId, drop);
    this.store.saveDrop(drop, message.operationId);
    this.dropOperations.set(key, drop);
    if (this.dropOperations.size > 512) this.dropOperations.delete(this.dropOperations.keys().next().value!);
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "drop", drop });
    this.broadcastDrops();
  }

  private pickupItem(state: ConnectionState, message: Extract<ClientMessage, { type: "pickup_item" }>, now: number): void {
    const replay = this.store.getPickupOperation(state.player!.id, message.operationId);
    if (replay) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "pickup", drop: replay });
      return;
    }
    const drop = this.drops.get(message.dropId);
    if (!drop || drop.expiresAt <= now || (drop.ownerUserId === state.player!.id && drop.ownerPickupAt > now)
      || squaredDistance(state.player!, drop) > DROP_REACH ** 2) {
      this.fail(state, "bad_message", "Item is unavailable or out of reach", false, false, message.operationId);
      return;
    }
    const consumed = this.store.consumeDrop(state.player!.id, message.operationId, drop.dropId, now);
    if (!consumed) {
      this.fail(state, "bad_message", "Item was already picked up", false, false, message.operationId);
      return;
    }
    this.drops.delete(drop.dropId);
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "pickup", drop: consumed });
    this.broadcastDrops();
  }

  private respawn(state: ConnectionState, message: Extract<ClientMessage, { type: "respawn" }>, now: number): void {
    const player = state.player!;
    Object.assign(player, SPAWN, { yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, health: 20 });
    player.crouching = false;
    player.visualActions = [];
    state.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
    state.vy = 0;
    state.clientPoseAuthority = false;
    state.lastInputAt = now;
    if (state.resumeHash && state.resumeExpiresAt !== undefined) {
      this.store.savePlayer(player, state.resumeHash, now, state.resumeExpiresAt);
      state.lastSavedAt = now;
    }
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "respawned", operationId: message.operationId, player: { ...player } });
  }

  private playerAttack(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "player_attack" }>,
    now: number,
  ): void {
    const attacker = state.player!;
    const operationKey = `${attacker.id}\u0000${message.operationId}`;
    const replay = this.playerHitOperations.get(operationKey);
    if (replay) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "player_hit", ...replay });
      return;
    }
    const targetState = this.userConnections.get(message.targetId);
    const target = targetState?.player;
    if (!target || target === attacker || target.gameMode === "creative" || (target.health ?? 20) <= 0
      || (attacker.health ?? 20) <= 0 || squaredDistance(attacker, target) > PLAYER_ATTACK_REACH ** 2
      || !isMeleeFacing(attacker, target)) {
      this.fail(state, "bad_message", "Player is unavailable or out of melee reach", false, false, message.operationId);
      return;
    }
    if (now - state.lastAttackAt < PLAYER_ATTACK_COOLDOWN_MS) {
      this.fail(state, "rate_limited", "Player attack is cooling down", false, true, message.operationId);
      return;
    }
    state.lastAttackAt = now;
    const damage = heldItemAttackDamage(attacker.heldItem);
    const health = Math.max(0, (target.health ?? 20) - damage);
    target.health = health;
    const hit: PlayerHit = {
      operationId: message.operationId,
      attackerId: attacker.id,
      targetId: target.id,
      damage,
      health,
      killed: health === 0,
      attackerX: attacker.x,
      attackerZ: attacker.z,
    };
    this.playerHitOperations.set(operationKey, hit);
    if (this.playerHitOperations.size > 512) this.playerHitOperations.delete(this.playerHitOperations.keys().next().value!);
    if (targetState?.resumeHash && targetState.resumeExpiresAt !== undefined) {
      this.store.savePlayer(target, targetState.resumeHash, now, targetState.resumeExpiresAt);
      targetState.lastSavedAt = now;
    }
    if (hit.killed && targetState) {
      targetState.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
      target.vx = target.vy = target.vz = 0;
      target.crouching = false;
      target.visualActions = [];
    }
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "player_hit", ...hit });
    if (targetState !== state) this.send(targetState!.peer, { v: PROTOCOL_VERSION, type: "player_hit", ...hit });
  }

  private broadcastDrops(): void {
    const message: ServerMessage = { v: PROTOCOL_VERSION, type: "drop_snapshot", drops: [...this.drops.values()] };
    for (const state of this.userConnections.values()) this.send(state.peer, message);
  }

  private send(peer: Peer, message: ServerMessage): void {
    if (peer.bufferedAmount() > HARD_BACKPRESSURE) {
      peer.send(encodeServerMessage(protocolError("backpressure", "Client is not reading messages", { fatal: true, retryable: true })));
      peer.close(1013, "Backpressure");
      return;
    }
    peer.send(encodeServerMessage(message));
  }

  private fail(
    state: ConnectionState,
    code: Parameters<typeof protocolError>[0],
    message: string,
    fatal = false,
    retryable = false,
    operationId?: string,
  ): void {
    this.send(state.peer, protocolError(code, message, { fatal, retryable, operationId }));
    if (fatal) state.peer.close(code === "rate_limited" ? 1008 : 4003, message.slice(0, 100));
  }
}

function squaredDistance(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;
}

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  return ((yaw + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

function isMeleeFacing(attacker: PublicPlayer, target: PublicPlayer): boolean {
  const dx = target.x - attacker.x;
  const dy = target.y + 0.925 - (attacker.y + 1.62);
  const dz = target.z - attacker.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.01) return true;
  const cosPitch = Math.cos(attacker.pitch);
  const dot = (dx * Math.sin(attacker.yaw) * cosPitch + dy * Math.sin(attacker.pitch)
    - dz * Math.cos(attacker.yaw) * cosPitch) / distance;
  return dot >= 0.55;
}

function createResumeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashSkinPixels(base64: string): Promise<string> {
  const pixels = Buffer.from(base64, "base64");
  const bytes = await crypto.subtle.digest("SHA-256", pixels);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function heldItemAttackDamage(itemId: string | undefined): number {
  if (!itemId) return 1;
  const tier = itemId.startsWith("diamond_") ? 3
    : itemId.startsWith("iron_") ? 2
      : itemId.startsWith("stone_") ? 1 : 0;
  if (itemId.endsWith("_sword")) return 4 + tier;
  if (itemId.endsWith("_axe")) return 3 + tier;
  if (itemId.endsWith("_pickaxe")) return 2 + tier;
  if (itemId.endsWith("_shovel")) return 1 + tier;
  return 1;
}
