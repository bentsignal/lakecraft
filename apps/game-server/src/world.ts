import type { JoinAuthenticator } from "./auth";
import type { ServerConfig } from "./config";
import type { ServerAccessMode, ServerAdministrationSettings, ServerRole, WorldStore } from "./database";
import type { AdminPlayerSummary, AdminState, AdminWorldControl, ServerGameMode } from "./adminPortal";
import type {
  AgentBuilderWorld,
  AgentRegionBounds,
  AgentRegionResult,
  AgentWorldMetadata,
} from "./agentBuilder";
import { applyAgentBatch, type AgentBatchInput, type AgentBatchResult } from "./agentBuilderPersistence";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  APPEARANCE_CAPABILITY,
  WORLD_CHUNKS_CAPABILITY,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeServerMessage,
  protocolError,
  type ClientMessage,
  type PublicAppearance,
  type PublicPlayer,
  type PublicDrop,
  type PlayerHit,
  type SelfDamageResult,
  type ServerMessage,
  type WorldRuntimeSettings,
} from "./protocol";
import {
  CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_SPEED,
  MAX_PLAYER_XZ,
  MAX_PLAYER_Y,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
  createTerrainAuthority,
  type TerrainAuthority,
} from "./terrain";
import {
  DROPPED_ITEM_PICKUP_DELAY_MS,
  DROPPED_ITEM_TTL_MS,
} from "../../../shared/droppedItems.ts";
import {
  FALL_PLAYER_BODY_HEIGHT,
  FALL_PLAYER_HALF_WIDTH,
} from "../../../shared/fallWorldProbe.ts";
import {
  encodeRealtimeChunkEdits,
  realtimeChunkCoordinate,
  realtimeChunkKey,
  realtimeChunkKeyForBlock,
  realtimeChunkWindow,
} from "../../../shared/realtimeWorldChunks.ts";

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
  lastSelfDamageAt: number;
  appearanceRequestWindowAt: number;
  appearanceRequestCount: number;
  appearanceRequestKeys: Set<string>;
  appearance: PublicAppearance;
  skinPixels?: string;
  clientPoseAuthority: boolean;
  lastChunkSeq: number;
  subscribedChunks: Set<string>;
}

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
const DROP_REACH = 3;
const DROP_GRAVITY = 24;
const DROP_TERMINAL_VELOCITY = -24;
const DROP_BROADCAST_INTERVAL_MS = 100;
const PLAYER_ATTACK_REACH = 6.25;
const PLAYER_ATTACK_COOLDOWN_MS = 400;
const SAFE_SPAWN_SEARCH_RADIUS = 32;
const NON_COLLIDING_SPAWN_BLOCKS = new Set([0, 8, 11, 16, 29]);
const BLOCK_CHUNK_CACHE_LIMIT = 256;
const CHUNK_BATCH_DATA_LIMIT = 128 * 1024;

const DEFAULT_APPEARANCE: PublicAppearance = Object.freeze({
  skinId: "default",
  skinModel: "wide",
  armorHead: "",
  armorChest: "",
  armorLegs: "",
  armorFeet: "",
});

export class GameWorld implements AdminWorldControl, AgentBuilderWorld {
  private readonly connections = new Map<string, ConnectionState>();
  private readonly userConnections = new Map<string, ConnectionState>();
  private tickNumber = 0;
  private visualActionSequence = 0;
  private readonly drops = new Map<string, PublicDrop>();
  private readonly dropVelocityY = new Map<string, number>();
  private readonly settledDrops = new Set<string>();
  private readonly blockChunkCache = new Map<string, Map<string, number>>();
  private readonly dropOperations = new Map<string, PublicDrop>();
  private readonly playerHitOperations = new Map<string, PlayerHit>();
  private readonly selfDamageOperations = new Map<string, SelfDamageResult>();
  private lastDropBroadcastAt = Number.NEGATIVE_INFINITY;
  private dropsDirty = false;
  private shuttingDown = false;
  readonly terrain: TerrainAuthority;

  constructor(
    readonly config: ServerConfig,
    private readonly store: WorldStore,
    private readonly authenticator: JoinAuthenticator,
  ) {
    store.assertTerrainConfiguration(config.worldPreset, config.superflatGroundY);
    this.terrain = createTerrainAuthority({
      preset: config.worldPreset,
      superflatGroundY: config.superflatGroundY,
    });
    store.initializeAdministration({
      accessMode: config.accessMode ?? "token",
      spawnX: config.spawnX,
      spawnZ: config.spawnZ,
      spawnYaw: config.spawnYaw,
      daylightCycle: config.daylightCycle ?? true,
      dayPhase: config.dayPhase ?? 0.25,
    });
    for (const username of config.initialWhitelist ?? []) store.setWhitelisted(username, true);
    for (const drop of store.listDrops()) {
      this.drops.set(drop.dropId, drop);
      this.dropVelocityY.set(drop.dropId, 0);
    }
  }

  get playerCount(): number {
    return this.userConnections.size;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  runtimeStatus(): { accessMode:ServerAccessMode;daylightCycle:boolean;dayPhase:number;spawn:Pick<PublicPlayer,"x"|"y"|"z"|"yaw"|"pitch"|"vx"|"vy"|"vz"> } {
    const settings=this.store.administrationSettings();
    return {accessMode:settings.accessMode,daylightCycle:settings.daylightCycle,dayPhase:this.effectiveDayPhase(settings),spawn:this.safeSpawn()};
  }

  isJoined(peerId: string): boolean {
    return this.connections.get(peerId)?.joined ?? false;
  }

  agentMetadata(): AgentWorldMetadata {
    return {
      serverId: this.config.serverId,
      name: this.config.serverName,
      description: this.config.serverDescription,
      revision: this.store.getRevision(),
      persistedBlocks: this.store.blockCount(),
      maxPersistedBlocks: this.config.maxPersistedBlocks,
      worldPreset: this.terrain.descriptor.preset,
      ...(this.terrain.descriptor.preset === "superflat"
        ? { groundY: this.terrain.descriptor.superflatGroundY }
        : {}),
      defaultGameMode: this.config.defaultGameMode,
      connectedPlayers: this.playerCount,
      spawn: this.safeSpawn(),
    };
  }

  agentEditsSince(sinceRevision: number, limit: number): import("./protocol").BlockEdit[] {
    return this.store.getBlockEditsSince(sinceRevision, limit);
  }

  agentReadRegion(bounds: AgentRegionBounds): AgentRegionResult {
    const blocks: number[] = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) blocks.push(this.agentBlockAt(x, y, z));
      }
    }
    return {
      revision: this.store.getRevision(),
      bounds,
      size: {
        x: bounds.maxX - bounds.minX + 1,
        y: bounds.maxY - bounds.minY + 1,
        z: bounds.maxZ - bounds.minZ + 1,
      },
      order: "x,z,y",
      blocks,
    };
  }

  agentBlockAt(x: number, y: number, z: number): number {
    const chunkX = realtimeChunkCoordinate(x);
    const chunkZ = realtimeChunkCoordinate(z);
    const overrides = this.cachedBlockChunk(chunkX, chunkZ);
    return overrides.get(blockKey(x, y, z)) ?? this.terrain.blockAt(x, y, z);
  }

  private cachedBlockChunk(chunkX: number, chunkZ: number): Map<string, number> {
    const key = realtimeChunkKey(chunkX, chunkZ);
    const existing = this.blockChunkCache.get(key);
    if (existing) {
      this.blockChunkCache.delete(key);
      this.blockChunkCache.set(key, existing);
      return existing;
    }
    const loaded = new Map(this.store.getWorldChunk(chunkX, chunkZ).edits
      .map((edit) => [blockKey(edit.x, edit.y, edit.z), edit.block] as const));
    this.blockChunkCache.set(key, loaded);
    while (this.blockChunkCache.size > BLOCK_CHUNK_CACHE_LIMIT) {
      const oldest = this.blockChunkCache.keys().next().value;
      if (oldest === undefined) break;
      this.blockChunkCache.delete(oldest);
    }
    return loaded;
  }

  private updateCachedBlock(edit: import("./protocol").BlockEdit): void {
    const key = realtimeChunkKeyForBlock(edit.x, edit.z);
    this.blockChunkCache.get(key)?.set(blockKey(edit.x, edit.y, edit.z), edit.block);
  }

  private poseObstructed(x: number, y: number, z: number): boolean {
    const minX = Math.floor(x - FALL_PLAYER_HALF_WIDTH);
    const maxX = Math.floor(x + FALL_PLAYER_HALF_WIDTH);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + FALL_PLAYER_BODY_HEIGHT - 0.01);
    const minZ = Math.floor(z - FALL_PLAYER_HALF_WIDTH);
    const maxZ = Math.floor(z + FALL_PLAYER_HALF_WIDTH);
    for (let blockX = minX; blockX <= maxX; blockX++) {
      for (let blockY = minY; blockY <= maxY; blockY++) {
        for (let blockZ = minZ; blockZ <= maxZ; blockZ++) {
          if (!NON_COLLIDING_SPAWN_BLOCKS.has(this.agentBlockAt(blockX, blockY, blockZ))) return true;
          const lower = this.agentBlockAt(blockX, blockY - 1, blockZ);
          if (lower === 10 || lower === 27 || lower === 28) return true;
        }
      }
    }
    return false;
  }

  private safeSpawn(): Pick<PublicPlayer, "x" | "y" | "z" | "yaw" | "pitch" | "vx" | "vy" | "vz"> {
    const settings = this.store.administrationSettings();
    for (let radius = 0; radius <= SAFE_SPAWN_SEARCH_RADIUS; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          const x = settings.spawnX + dx;
          const z = settings.spawnZ + dz;
          const y = this.terrain.feetY(x, z);
          if (!this.poseObstructed(x, y, z)) {
            return { x, y, z, yaw: settings.spawnYaw, pitch: 0, vx: 0, vy: 0, vz: 0 };
          }
        }
      }
    }
    const x = settings.spawnX;
    const z = settings.spawnZ;
    return { x, y: Math.min(MAX_PLAYER_Y, this.terrain.feetY(x, z) + 3), z, yaw: settings.spawnYaw, pitch: 0, vx: 0, vy: 0, vz: 0 };
  }

  private worldRuntimeSettings(): WorldRuntimeSettings {
    const settings = this.store.administrationSettings();
    return {
      spawn: { x: settings.spawnX, y: this.terrain.feetY(settings.spawnX, settings.spawnZ), z: settings.spawnZ, yaw: settings.spawnYaw },
      daylightCycle: settings.daylightCycle,
      dayPhase: this.effectiveDayPhase(settings),
    };
  }

  private effectiveDayPhase(settings:ServerAdministrationSettings,now=Date.now()):number {
    if(!settings.daylightCycle)return settings.dayPhase;
    return ((settings.dayPhase+(now-settings.updatedAt)/(20*60*1000))%1+1)%1;
  }

  private async assertPlayerAccess(
    username: string,
    message: Extract<ClientMessage, { type: "join" }>,
    resumed: boolean,
  ): Promise<void> {
    const ban = this.store.banFor(username);
    if (ban) throw new Error(`You are banned from this server${ban.reason ? `: ${ban.reason}` : ""}`);
    const role = this.store.roleFor(username);
    const settings = this.store.administrationSettings();
    if (role === "operator") return;
    if (settings.accessMode === "public") return;
    if (settings.accessMode === "closed") throw new Error("This server is closed");
    if (settings.accessMode === "whitelist") {
      if (this.store.isWhitelisted(username) || role === "moderator") return;
      throw new Error("You are not on this server's whitelist");
    }
    if (resumed) return;
    if (settings.accessMode === "token") {
      if (this.config.localDemoToken && timingSafeEqual(message.demo?.token ?? "", this.config.localDemoToken)) return;
      throw new Error("The server invitation token is invalid");
    }
    const password = message.password ?? "";
    const valid = settings.passwordHash
      ? await Bun.password.verify(password, settings.passwordHash)
      : Boolean(this.config.serverPassword && timingSafeEqual(password, this.config.serverPassword));
    if (!valid) throw new Error("The server password is invalid");
  }

  agentApplyBatch(input: AgentBatchInput): AgentBatchResult {
    const result = applyAgentBatch(this.store, input, this.config.maxPersistedBlocks);
    if (!result.ok || result.replayed) return result;
    for (const edit of result.edits) {
      this.updateCachedBlock(edit);
      for (const drop of this.drops.values()) {
        if (Math.floor(drop.x) === edit.x && Math.floor(drop.z) === edit.z) this.settledDrops.delete(drop.dropId);
      }
      this.broadcastBlockPatch(edit);
    }
    return result;
  }

  adminPlayers(): AdminPlayerSummary[] {
    return this.store.listAdminPlayers().map((player) => ({
      ...player,
      connected: this.userConnections.has(player.id),
      role: this.store.roleFor(player.name),
    }));
  }

  adminState(): AdminState {
    const {passwordHash,...settings}=this.store.administrationSettings();
    return {
      players: this.adminPlayers(),
      settings:{...settings,dayPhase:this.effectiveDayPhase({...settings,passwordHash}),passwordConfigured:Boolean(passwordHash||this.config.serverPassword)},
      access: this.store.listAccessEntries(),
      chat: this.store.recentChat(CHAT_HISTORY_LIMIT),
      revision: this.store.getRevision(),
      persistedBlocks: this.store.blockCount(),
      maxPersistedBlocks: this.config.maxPersistedBlocks,
    };
  }

  async runAdminCommand(rawCommand: string, issuer?: ConnectionState): Promise<{ ok:boolean;message:string }> {
    const command = rawCommand.trim();
    const source = command.startsWith("/") ? command.slice(1) : command;
    const [verbRaw, ...args] = source.split(/\s+/);
    const verb = (verbRaw ?? "").toLowerCase();
    const username = args[0] ?? "";
    try {
      if (verb === "say") {
        const message = source.slice(4).trim();
        if (!message) return { ok:false,message:"Usage: /say <message>" };
        this.serverAnnouncement(message);
        return { ok:true,message:"Server message sent." };
      }
      if (verb === "whitelist" && (args[0] === "add" || args[0] === "remove") && args[1]) {
        this.store.setWhitelisted(args.slice(1).join(" "), args[0] === "add");
        return { ok:true,message:`Whitelist ${args[0] === "add" ? "added" : "removed"}: ${args.slice(1).join(" ")}` };
      }
      if (["op","deop","mod","demod"].includes(verb) && username) {
        const role: ServerRole | null = verb === "op" ? "operator" : verb === "mod" ? "moderator" : null;
        const targetName = args.join(" ");
        this.store.setRole(targetName, role);
        if (role) this.store.setWhitelisted(targetName, true);
        const target = [...this.userConnections.values()].find((candidate) =>
          candidate.player?.name.toLocaleLowerCase("en-US") === targetName.toLocaleLowerCase("en-US"));
        if (target) this.privateNotice(target, role === "operator"
          ? "You have been granted operator privileges."
          : role === "moderator" ? "You have been granted moderator privileges."
            : "Your server privileges have been removed.");
        return { ok:true,message:`${targetName} is now ${role ?? "a regular player"}.` };
      }
      if (verb === "kick" && username) {
        const target = this.findPlayer(username);
        if (!target || !this.kickPlayer(target.id)) return { ok:false,message:"That player is not connected." };
        return { ok:true,message:`Kicked ${target.name}.` };
      }
      if (verb === "ban" && username) {
        const target = this.findPlayer(username);
        const name = target?.name ?? username;
        const reason = args.slice(1).join(" ") || "Banned by a server operator";
        this.store.setBanned(name, reason);
        if (target) this.kickPlayer(target.id);
        return { ok:true,message:`Banned ${name}: ${reason}` };
      }
      if ((verb === "pardon" || verb === "unban") && username) {
        this.store.setBanned(args.join(" "), null);
        return { ok:true,message:`Pardoned ${args.join(" ")}.` };
      }
      if (verb === "gamemode" && (args[0] === "creative" || args[0] === "survival")) {
        const target = args[1] ? this.findPlayer(args.slice(1).join(" ")) : issuer?.player;
        if (!args[1] && !issuer) return {ok:false,message:"Usage: /gamemode <creative|survival> <player>"};
        if (!target || !this.setPlayerGameMode(target.id, args[0])) return { ok:false,message:"Player not found." };
        const connection = this.userConnections.get(target.id);
        if (connection) this.privateNotice(connection, `Your game mode was set to ${args[0]}.`);
        return { ok:true,message:`Set ${target.name} to ${args[0]}.` };
      }
      if (verb === "setworldspawn" && args.length >= 2) {
        const x=Number(args[0]),z=Number(args[1]),yaw=args[2]===undefined?0:Number(args[2])*Math.PI/180;
        if (![x,z,yaw].every(Number.isFinite)||Math.abs(x)>1_000_000||Math.abs(z)>1_000_000) return {ok:false,message:"Usage: /setworldspawn <x> <z> [yaw degrees]"};
        this.store.updateAdministration({spawnX:x,spawnZ:z,spawnYaw:yaw});this.broadcastWorldSettings();
        return {ok:true,message:`World spawn set to ${x}, ${z}.`};
      }
      if (verb === "time" && args[0] === "set" && args[1]) {
        const phases:Record<string,number>={midnight:0,dawn:.25,day:.5,noon:.5,dusk:.75,night:0};
        const phase=phases[args[1].toLowerCase()] ?? Number(args[1]);
        if (!Number.isFinite(phase)) return {ok:false,message:"Usage: /time set day|noon|night|midnight|<0..1>"};
        this.store.updateAdministration({dayPhase:((phase%1)+1)%1});this.broadcastWorldSettings();
        return {ok:true,message:`Time set to ${args[1]}.`};
      }
      if (verb === "gamerule" && args[0]?.toLowerCase() === "dodaylightcycle" && ["true","false"].includes(args[1])) {
        const settings=this.store.administrationSettings();
        this.store.updateAdministration({dayPhase:this.effectiveDayPhase(settings),daylightCycle:args[1]==="true"});this.broadcastWorldSettings();
        return {ok:true,message:`Daylight cycle ${args[1]==="true"?"enabled":"disabled"}.`};
      }
      if (verb === "open") { this.store.updateAdministration({accessMode:"public"});return {ok:true,message:"Server opened to the public."}; }
      if (verb === "close") { this.store.updateAdministration({accessMode:"closed"});return {ok:true,message:"Server closed to new players."}; }
      if (verb === "access" && ["token","public","password","whitelist","closed"].includes(args[0])) {
        const accessMode=args[0] as ServerAccessMode;
        if (accessMode === "password") {
          const password=args.slice(1).join(" ");if(password.length<8)return {ok:false,message:"Usage: /access password <at least 8 characters>"};
          this.store.updateAdministration({accessMode,passwordHash:await Bun.password.hash(password)});
        } else this.store.updateAdministration({accessMode});
        return {ok:true,message:`Server access is now ${accessMode}.`};
      }
      return {ok:false,message:"Unknown command. Try /say, /whitelist, /op, /mod, /kick, /ban, /pardon, /gamemode, /setworldspawn, /time, /gamerule, or /access."};
    } catch (error) {
      return {ok:false,message:error instanceof Error?error.message:"Command failed."};
    }
  }

  private findPlayer(identity:string) {
    const needle=identity.trim().toLocaleLowerCase("en-US");
    return this.store.listPlayers().find((player)=>player.id.toLocaleLowerCase("en-US")===needle||player.name.toLocaleLowerCase("en-US")===needle);
  }

  private serverAnnouncement(message:string): void {
    const result=this.store.appendChat({operationId:`server_${crypto.randomUUID()}`,userId:"server",username:"[Server]",message:message.slice(0,CHAT_MESSAGE_MAX_LENGTH),sentAt:Date.now()},0,CHAT_HISTORY_LIMIT);
    if (!result.ok) return;
    for (const state of this.userConnections.values()) this.send(state.peer,{v:PROTOCOL_VERSION,type:"chat_message",message:result.message});
  }

  private privateNotice(state: ConnectionState, message: string): void {
    this.send(state.peer,{v:PROTOCOL_VERSION,type:"private_notice",message:message.slice(0,CHAT_MESSAGE_MAX_LENGTH),sentAt:Date.now()});
  }

  private broadcastWorldSettings(): void {
    const settings=this.worldRuntimeSettings();
    for (const state of this.userConnections.values()) this.send(state.peer,{v:PROTOCOL_VERSION,type:"world_settings",settings});
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
      lastSelfDamageAt: Number.NEGATIVE_INFINITY,
      appearanceRequestWindowAt: now,
      appearanceRequestCount: 0,
      appearanceRequestKeys: new Set(),
      appearance: { ...DEFAULT_APPEARANCE },
      clientPoseAuthority: false,
      lastChunkSeq: 0,
      subscribedChunks: new Set(),
    });
    this.send(peer, {
      v: PROTOCOL_VERSION,
      type: "hello",
      serverId: this.config.serverId,
      serverName: this.config.serverName,
      authMode: this.config.authMode,
      tickHz: this.config.tickHz,
      snapshotHz: this.config.snapshotHz,
      terrain: this.terrain.descriptor,
      defaultGameMode: this.config.defaultGameMode,
      worldSettings: this.worldRuntimeSettings(),
      capabilities: [APPEARANCE_CAPABILITY, WORLD_CHUNKS_CAPABILITY],
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
    if (message.type === "chunk_subscribe") this.subscribeChunks(state, message);
    else if (message.type === "input") this.input(state, message, now);
    else if (message.type === "action") this.action(state, message);
    else if (message.type === "block_edit") this.blockEdit(state, message, now);
    else if (message.type === "inventory_action") this.inventoryAction(state, message, now);
    else if (message.type === "chat_send") this.chat(state, message, now);
    else if (message.type === "drop_item") this.dropItem(state, message, now);
    else if (message.type === "pickup_item") this.pickupItem(state, message, now);
    else if (message.type === "player_attack") this.playerAttack(state, message, now);
    else if (message.type === "self_damage") this.selfDamage(state, message, now);
    else if (message.type === "respawn") this.respawn(state, message, now);
    else if (message.type === "appearance_set") await this.setAppearance(state, message, now);
    else this.sendAppearance(state, message, now);
  }

  tick(now = Date.now()): void {
    this.tickNumber++;
    let dropsChanged = false;
    for (const [id, drop] of this.drops) if (drop.expiresAt <= now) {
      this.drops.delete(id);
      this.dropVelocityY.delete(id);
      this.settledDrops.delete(id);
      this.store.deleteDrop(id);
      dropsChanged = true;
    }
    const dt = 1 / this.config.tickHz;
    for (const drop of this.drops.values()) {
      if (this.settledDrops.has(drop.dropId)) continue;
      const velocity = Math.max(DROP_TERMINAL_VELOCITY, (this.dropVelocityY.get(drop.dropId) ?? 0) - DROP_GRAVITY * dt);
      const nextY = drop.y + velocity * dt;
      const supportY = this.dropSupportY(drop.x, drop.z, drop.y);
      if (nextY <= supportY) {
        drop.y = supportY;
        this.dropVelocityY.set(drop.dropId, 0);
        this.settledDrops.add(drop.dropId);
      } else {
        drop.y = nextY;
        this.dropVelocityY.set(drop.dropId, velocity);
      }
      this.store.updateDropState(drop);
      dropsChanged = true;
    }
    this.dropsDirty ||= dropsChanged;
    if (this.dropsDirty && now - this.lastDropBroadcastAt >= DROP_BROADCAST_INTERVAL_MS) {
      this.lastDropBroadcastAt = now;
      this.dropsDirty = false;
      this.broadcastDrops();
    }
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
      if (Math.abs(nextX) <= MAX_PLAYER_XZ && this.terrain.feetY(nextX, player.z) <= player.y + 0.0001) player.x = nextX;
      else player.vx = 0;
      const nextZ = player.z + player.vz * dt;
      if (Math.abs(nextZ) <= MAX_PLAYER_XZ && this.terrain.feetY(player.x, nextZ) <= player.y + 0.0001) player.z = nextZ;
      else player.vz = 0;

      const groundY = this.terrain.feetY(player.x, player.z);
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
      await this.assertPlayerAccess(principal.displayName, message, Boolean(validResumeRecord));
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
      const spawn = this.safeSpawn();
      const player: PublicPlayer = resumed
        ? { ...stored!.player, name: principal.displayName, vx: 0, vy: 0, vz: 0 }
        : {
            id: principal.userId,
            name: principal.displayName,
            ...spawn,
            gameMode: stored?.player.gameMode === "creative" || stored?.player.gameMode === "survival"
              ? stored.player.gameMode
              : this.config.defaultGameMode,
            health: stored?.player.health ?? 20,
          };
      // Older fixed-floor servers could persist players below the actual
      // deterministic surface. Heal those poses before the first welcome so a
      // reconnect cannot begin embedded in the spawn rim.
      player.x = Math.max(-MAX_PLAYER_XZ, Math.min(MAX_PLAYER_XZ, player.x));
      player.z = Math.max(-MAX_PLAYER_XZ, Math.min(MAX_PLAYER_XZ, player.z));
      player.y = Math.min(MAX_PLAYER_Y, Math.max(player.y, this.terrain.feetY(player.x, player.z)));
      if (this.poseObstructed(player.x, player.y, player.z)) Object.assign(player, spawn);

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
      const inventory = this.store.ensurePlayerInventory(player.id, principal.initialInventoryJson, now);
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
        terrain: this.terrain.descriptor,
        defaultGameMode: this.config.defaultGameMode,
        worldSettings: this.worldRuntimeSettings(),
      });
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "inventory_state", inventory });
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

  private subscribeChunks(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "chunk_subscribe" }>,
  ): void {
    if (message.seq <= state.lastChunkSeq) return;
    state.lastChunkSeq = message.seq;
    const target = realtimeChunkWindow(message.centerX, message.centerZ, message.radius);
    const targetKeys = new Set(target.map((chunk) => realtimeChunkKey(chunk.x, chunk.z)));
    const unloaded = [...state.subscribedChunks]
      .filter((key) => !targetKeys.has(key))
      .map((key) => {
        const comma = key.indexOf(",");
        return { x: Number(key.slice(0, comma)), z: Number(key.slice(comma + 1)) };
      });
    state.subscribedChunks = targetKeys;
    if (unloaded.length) this.send(state.peer, {
      v: PROTOCOL_VERSION, type: "world_chunks_unload", seq: message.seq, chunks: unloaded,
    });

    const known = new Map(message.known.map((chunk) => [realtimeChunkKey(chunk.x, chunk.z), chunk.revision]));
    let batch: Array<{ x: number; z: number; revision: number; data: string }> = [];
    let batchBytes = 0;
    const flush = (complete = false) => {
      if (!batch.length && !complete) return;
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "world_chunks", seq: message.seq, complete, chunks: batch });
      batch = [];
      batchBytes = 0;
    };
    for (const chunk of target) {
      const stored = this.store.getWorldChunk(chunk.x, chunk.z);
      if (known.get(realtimeChunkKey(chunk.x, chunk.z)) === stored.revision) continue;
      const data = encodeRealtimeChunkEdits(chunk.x, chunk.z, stored.edits);
      if (batch.length && batchBytes + data.length > CHUNK_BATCH_DATA_LIMIT) flush();
      batch.push({ x: chunk.x, z: chunk.z, revision: stored.revision, data });
      batchBytes += data.length + 48;
      if (batch.length >= 64) flush();
    }
    flush(true);
  }

  private broadcastBlockPatch(
    edit: import("./protocol").BlockEdit,
    author?: ConnectionState,
    operationId?: string,
  ): void {
    const owner = realtimeChunkKeyForBlock(edit.x, edit.z);
    for (const connection of this.userConnections.values()) {
      if (connection !== author && !connection.subscribedChunks.has(owner)) continue;
      this.send(connection.peer, {
        v: PROTOCOL_VERSION,
        type: "block_patch",
        operationId: connection === author ? operationId : undefined,
        edit,
      });
    }
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
    this.updateCachedBlock(result.edit);
    for (const drop of this.drops.values()) {
      if (Math.floor(drop.x) === result.edit.x && Math.floor(drop.z) === result.edit.z) {
        this.settledDrops.delete(drop.dropId);
      }
    }
    this.broadcastBlockPatch(result.edit, state, message.operationId);
  }

  private inventoryAction(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "inventory_action" }>,
    now: number,
  ): void {
    let operationId = "";
    try {
      const parsed = JSON.parse(message.requestJson) as { operationId?: unknown };
      if (typeof parsed.operationId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(parsed.operationId)) {
        operationId = parsed.operationId;
      }
    } catch {
      // The shared validator below returns the canonical invalid_request result.
    }
    if (!operationId) {
      this.fail(state, "bad_message", "Inventory operation ID is invalid", false, false);
      return;
    }
    const result = this.store.applyPlayerInventoryAction(state.player!.id, message.requestJson, now);
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "inventory_result", operationId, result });
  }

  private chat(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "chat_send" }>,
    now: number,
  ): void {
    const player = state.player!;
    if (message.message.startsWith("/") && this.store.roleFor(player.name) === "operator") {
      void this.runAdminCommand(message.message, state).then((result) => this.privateNotice(state, result.message));
      return;
    }
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
      ownerPickupAt: now + DROPPED_ITEM_PICKUP_DELAY_MS,
      expiresAt: now + DROPPED_ITEM_TTL_MS,
    };
    this.drops.set(drop.dropId, drop);
    this.dropVelocityY.set(drop.dropId, 0);
    this.store.saveDrop(drop, message.operationId);
    this.dropOperations.set(key, drop);
    if (this.dropOperations.size > 512) this.dropOperations.delete(this.dropOperations.keys().next().value!);
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "drop", drop });
    this.lastDropBroadcastAt = now;
    this.dropsDirty = false;
    this.broadcastDrops();
  }

  private pickupItem(state: ConnectionState, message: Extract<ClientMessage, { type: "pickup_item" }>, now: number): void {
    const replay = this.store.getPickupOperation(state.player!.id, message.operationId);
    if (replay) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "pickup", drop: replay });
      return;
    }
    const drop = this.drops.get(message.dropId);
    if ((state.player!.health ?? 20) <= 0 || !drop || drop.expiresAt <= now
      || drop.ownerPickupAt > now
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
    this.dropVelocityY.delete(drop.dropId);
    this.settledDrops.delete(drop.dropId);
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "drop_result", operationId: message.operationId, action: "pickup", drop: consumed });
    this.lastDropBroadcastAt = now;
    this.dropsDirty = false;
    this.broadcastDrops();
  }

  private respawn(state: ConnectionState, message: Extract<ClientMessage, { type: "respawn" }>, now: number): void {
    const player = state.player!;
    Object.assign(player, {
      ...this.safeSpawn(), health: 20,
    });
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

  private selfDamage(
    state: ConnectionState,
    message: Extract<ClientMessage, { type: "self_damage" }>,
    now: number,
  ): void {
    const player = state.player!;
    const operationKey = `${player.id}\u0000${message.operationId}`;
    const replay = this.selfDamageOperations.get(operationKey);
    if (replay) {
      this.send(state.peer, { v: PROTOCOL_VERSION, type: "self_damage_result", ...replay });
      return;
    }
    if (player.gameMode === "creative" || (player.health ?? 20) <= 0) {
      this.fail(state, "bad_message", "Player cannot take fall damage", false, false, message.operationId);
      return;
    }
    if (now - state.lastSelfDamageAt < 100) {
      this.fail(state, "rate_limited", "Fall damage is cooling down", false, true, message.operationId);
      return;
    }
    state.lastSelfDamageAt = now;
    const damage = Math.min(player.health ?? 20, message.damage);
    const health = Math.max(0, (player.health ?? 20) - damage);
    player.health = health;
    const result: SelfDamageResult = {
      operationId: message.operationId,
      damage,
      health,
      killed: health === 0,
      cause: "fall",
    };
    this.selfDamageOperations.set(operationKey, result);
    if (this.selfDamageOperations.size > 512) this.selfDamageOperations.delete(this.selfDamageOperations.keys().next().value!);
    if (result.killed) {
      state.controls = { moveX: 0, moveY: 0, moveZ: 0, jump: false, sprint: false };
      player.vx = player.vy = player.vz = 0;
      player.crouching = false;
      player.visualActions = [];
    }
    if (state.resumeHash && state.resumeExpiresAt !== undefined) {
      this.store.savePlayer(player, state.resumeHash, now, state.resumeExpiresAt);
      state.lastSavedAt = now;
    }
    this.send(state.peer, { v: PROTOCOL_VERSION, type: "self_damage_result", ...result });
  }

  private broadcastDrops(): void {
    const message: ServerMessage = { v: PROTOCOL_VERSION, type: "drop_snapshot", drops: [...this.drops.values()] };
    for (const state of this.userConnections.values()) this.send(state.peer, message);
  }

  private dropSupportY(x: number, z: number, fromY: number): number {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    for (let y = Math.floor(fromY); y >= -64; y -= 1) {
      const block = this.agentBlockAt(blockX, y, blockZ);
      if (dropSupportingBlock(block)) return y + 1;
    }
    return -64;
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

function blockKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function dropSupportingBlock(block: number): boolean {
  return block !== 0 && block !== 8 && block !== 11 && block !== 16 && block !== 25 && block !== 29;
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
