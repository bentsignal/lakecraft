import { Database } from "bun:sqlite";
import type { BlockEdit, PublicDrop, PublicPlayer, RealtimeChatMessage, ServerGameMode } from "./protocol";
import {
  applyInventoryAction,
  createInitializedPlayerState,
  validateInventoryActionRequestJson,
  type InventoryActionMutationResult,
} from "../../../shared/inventoryActions.ts";
import { validatePlayerStateJson, type PersistedInventoryState } from "../../../shared/chestTransfers.ts";
import { REALTIME_WORLD_CHUNK_SIZE } from "../../../shared/realtimeWorldChunks.ts";
import {
  materializeMobAuthorityState,
  resolveMobAttack,
  type MobAttackFailureReason,
  type MobAuthorityDrop,
  type MobAuthorityKind,
  type MobAuthorityState,
  type StoredMobAuthorityState,
} from "../../../shared/mobCombat.ts";
import type { MobMotionCheckpoint } from "../../../shared/mobMotionAuthority.ts";
import {
  ITEMS,
  addItemStack,
  applyConfirmedArmorDamage,
  applyConfirmedToolUse,
  areItemStacksCompatible,
  attackDamage,
  equippedArmorProtection,
  maxItemDurability,
  type ItemStack,
} from "../../../shared/game.ts";
import { mitigatedPlayerDamage } from "../../../shared/playerCombat.ts";
import { DROPPED_ITEM_PICKUP_DELAY_MS, DROPPED_ITEM_TTL_MS } from "../../../shared/droppedItems.ts";
import { planDeathDrops } from "../../../shared/deathDrops.ts";
import { BLOCK_TYPES, type BlockType } from "../../../shared/protocol.ts";
import type { WorldChunkBlockType } from "../../../shared/worldChunks.ts";
import {
  parseWorldBlockOperation,
  resolveWorldBlockOperation,
  toggledWorldBlock,
  type WorldBlockOperationFailureReason,
} from "../../../shared/worldBlockOperations.ts";

const RAILWAY_WORLD_BLOCK_BOUNDS = Object.freeze({ minXZ:-1_000_000,maxXZ:1_000_000,minY:-64,maxY:320 });

interface PlayerRow {
  user_id: string;
  display_name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  resume_hash: string;
  resume_expires_at: number;
  game_mode: string;
  health: number;
  updated_at: number;
}

interface BlockRow {
  revision: number;
  x: number;
  y: number;
  z: number;
  block: number;
  editor_id: string;
  edited_at: number;
}

export interface StoredWorldChunk {
  x: number;
  z: number;
  revision: number;
  edits: BlockEdit[];
}

export type ServerAccessMode = "token" | "public" | "password" | "whitelist" | "closed";
export type ServerRole = "operator" | "moderator";
export interface ServerAdministrationSettings {
  accessMode: ServerAccessMode;
  passwordHash: string | null;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  daylightCycle: boolean;
  dayPhase: number;
  updatedAt: number;
}
export interface ServerAccessEntry {
  username: string;
  normalizedUsername: string;
  role?: ServerRole;
  banned: boolean;
  reason?: string;
  updatedAt: number;
}

interface ChatRow {
  sequence: number;
  operation_id: string;
  user_id: string;
  username: string;
  message: string;
  sent_at: number;
}
interface DropRow {
  drop_id: string; operation_id: string; owner_user_id: string; item_id: string; count: number;
  durability: number | null; x: number; y: number; z: number; dropped_at: number; owner_pickup_at: number; expires_at: number;
}

interface PlayerInventoryRow {
  user_id: string;
  inventory_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface InventoryOperationRow {
  fingerprint: string;
  result_json: string;
}

interface MobStateRow {
  mob_id: string;
  kind: string;
  health: number;
  revision: number;
  sheared: number;
  dead_until: number;
  last_attack_at: number;
  last_attacker_id: string;
}

export type RailwayMobAttackResult =
  | { ok: true; replayed: boolean; killed: boolean; damage: number; drops: MobAuthorityDrop[]; state: MobAuthorityState; inventory: PersistedInventoryState; weaponDamaged: boolean; weaponBroken: boolean }
  | { ok: false; replayed?: boolean; reason: MobAttackFailureReason | "operation_id_reused" | "inventory_required" | "invalid_state"; state?: MobAuthorityState; retryAfterMs?: number };

export type RailwayPlayerHitAuthorityResult =
  | { ok:true; replayed:boolean; damage:number; health:number; killed:boolean; attackerInventory:PersistedInventoryState; targetInventory:PersistedInventoryState; weaponDamaged:boolean; weaponBroken:boolean }
  | { ok:false; reason:"inventory_required"|"invalid_state"|"operation_id_reused"|"attacker_dead"|"target_dead" };

export type RailwayPlayerDamageAuthorityResult =
  | { ok:true; replayed:boolean; damage:number; health:number; killed:boolean; inventory:PersistedInventoryState }
  | { ok:false; reason:"inventory_required"|"invalid_state"|"operation_id_reused"|"target_dead" };

export interface PlayerDeathLifecycle {
  userId:string;
  eventId:string;
  createdAt:number;
  settledOperationId:string|null;
  settledAt:number|null;
  respawnedAt:number|null;
}

export type RailwayBlockAuthorityResult =
  | { ok: true; replayed: boolean; edit: BlockEdit; inventory: PersistedInventoryState; drop?: PublicDrop }
  | { ok: false; reason: WorldBlockOperationFailureReason | "protected_block" | "operation_id_reused" | "inventory_required" | "world_limit" | "drop_limit" };

export type RailwayDropAuthorityResult =
  | { ok: true; replayed: boolean; drop: PublicDrop; inventory: PersistedInventoryState }
  | { ok: false; reason: "inventory_required" | "invalid_state" | "item_mismatch" | "operation_id_reused" | "drop_limit" };

export type RailwayPickupAuthorityResult =
  | { ok:true; replayed:boolean; drop:PublicDrop; inventory:PersistedInventoryState }
  | { ok:false; reason:"inventory_required"|"invalid_state"|"inventory_full"|"unavailable"|"operation_id_reused" };

export type RailwayDeathSettlementResult = Readonly<{
  result: InventoryActionMutationResult;
  /** Full immutable conservation receipt, including drops already picked up. */
  drops: readonly PublicDrop[];
  /** Persisted drops that should be present in the live world right now. */
  activeDrops: readonly PublicDrop[];
}>;

export interface StoredMobWorld {
  checkpoint: MobMotionCheckpoint;
  centerX: number;
  centerZ: number;
  nightMode: boolean;
  updatedAt: number;
}

export type RailwayMobExplosionCommitResult =
  | {
      ok: true;
      replayed: boolean;
      edits: BlockEdit[];
      terrainLimited: boolean;
      playerDamage: Array<{ userId: string; damage: number; health: number; killed: boolean }>;
      drops: PublicDrop[];
    }
  | { ok: false; reason: "event_collision" };

export interface StoredPlayer {
  player: PublicPlayer;
  resumeHash: string;
  resumeExpiresAt: number;
  updatedAt: number;
}

export class WorldStore {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO world_meta (id, revision) VALUES (1, 0);

      CREATE TABLE IF NOT EXISTS world_configuration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        preset TEXT NOT NULL CHECK (preset IN ('default', 'superflat')),
        superflat_ground_y INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_state (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        yaw REAL NOT NULL,
        pitch REAL NOT NULL,
        resume_hash TEXT NOT NULL,
        resume_expires_at INTEGER NOT NULL DEFAULT 0,
        game_mode TEXT NOT NULL DEFAULT 'survival' CHECK (game_mode IN ('survival', 'creative')),
        health INTEGER NOT NULL DEFAULT 20,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS player_state_resume_hash ON player_state (resume_hash);

      CREATE TABLE IF NOT EXISTS block_edits (
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER NOT NULL,
        chunk_x INTEGER NOT NULL DEFAULT 0,
        chunk_z INTEGER NOT NULL DEFAULT 0,
        block INTEGER NOT NULL,
        revision INTEGER NOT NULL UNIQUE,
        editor_id TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        PRIMARY KEY (x, y, z)
      );
      CREATE INDEX IF NOT EXISTS block_edits_revision ON block_edits (revision);

      CREATE TABLE IF NOT EXISTS block_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER NOT NULL,
        block INTEGER NOT NULL,
        edited_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS redeemed_tickets (
        ticket_id TEXT PRIMARY KEY,
        redeemed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS redeemed_tickets_age ON redeemed_tickets (redeemed_at);

      CREATE TABLE IF NOT EXISTS chat_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        UNIQUE (user_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS chat_messages_sent_at ON chat_messages (sent_at);

      CREATE TABLE IF NOT EXISTS dropped_items (
        drop_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        durability INTEGER,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        dropped_at INTEGER NOT NULL,
        owner_pickup_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE (owner_user_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS dropped_items_expiry ON dropped_items (expires_at);

      CREATE TABLE IF NOT EXISTS pickup_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        drop_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        durability INTEGER,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        dropped_at INTEGER NOT NULL,
        owner_pickup_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        picked_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS player_inventory (
        user_id TEXT PRIMARY KEY,
        inventory_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS death_settlement_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        drops_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS player_deaths (
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        settled_operation_id TEXT,
        settled_at INTEGER,
        respawned_at INTEGER,
        PRIMARY KEY (user_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS player_deaths_current ON player_deaths(user_id, respawned_at, created_at);

      CREATE TABLE IF NOT EXISTS player_hit_operations (
        attacker_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (attacker_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS player_damage_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS block_authority_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS drop_authority_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        drop_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS mob_state (
        mob_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        health INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        sheared INTEGER NOT NULL DEFAULT 0,
        dead_until INTEGER NOT NULL,
        last_attack_at INTEGER NOT NULL,
        last_attacker_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mob_attack_operations (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
      );

      CREATE TABLE IF NOT EXISTS mob_world_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        checkpoint_json TEXT NOT NULL,
        center_x INTEGER NOT NULL,
        center_z INTEGER NOT NULL,
        night_mode INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mob_explosion_events (
        event_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS server_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_mode TEXT NOT NULL CHECK (access_mode IN ('token','public','password','whitelist','closed')),
        password_hash TEXT,
        spawn_x REAL NOT NULL,
        spawn_z REAL NOT NULL,
        spawn_yaw REAL NOT NULL,
        daylight_cycle INTEGER NOT NULL DEFAULT 1,
        day_phase REAL NOT NULL DEFAULT 0.25,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS server_whitelist (
        normalized_username TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS server_roles (
        normalized_username TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('operator','moderator')),
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS server_bans (
        normalized_username TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        reason TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const playerColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(player_state)").all();
    if (!playerColumns.some((column) => column.name === "resume_expires_at")) {
      this.db.exec("ALTER TABLE player_state ADD COLUMN resume_expires_at INTEGER NOT NULL DEFAULT 0;");
    }
    if (!playerColumns.some((column) => column.name === "game_mode")) {
      this.db.exec("ALTER TABLE player_state ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'survival';");
    }
    if (!playerColumns.some((column) => column.name === "health")) {
      this.db.exec("ALTER TABLE player_state ADD COLUMN health INTEGER NOT NULL DEFAULT 20;");
    }
    const blockColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(block_edits)").all();
    let migratedChunks = false;
    if (!blockColumns.some((column) => column.name === "chunk_x")) {
      this.db.exec("ALTER TABLE block_edits ADD COLUMN chunk_x INTEGER NOT NULL DEFAULT 0;");
      migratedChunks = true;
    }
    if (!blockColumns.some((column) => column.name === "chunk_z")) {
      this.db.exec("ALTER TABLE block_edits ADD COLUMN chunk_z INTEGER NOT NULL DEFAULT 0;");
      migratedChunks = true;
    }
    if (migratedChunks) this.db.exec(`
      UPDATE block_edits SET
        chunk_x = CASE WHEN x >= 0 THEN CAST(x / ${REALTIME_WORLD_CHUNK_SIZE} AS INTEGER)
          ELSE -CAST((-x + ${REALTIME_WORLD_CHUNK_SIZE - 1}) / ${REALTIME_WORLD_CHUNK_SIZE} AS INTEGER) END,
        chunk_z = CASE WHEN z >= 0 THEN CAST(z / ${REALTIME_WORLD_CHUNK_SIZE} AS INTEGER)
          ELSE -CAST((-z + ${REALTIME_WORLD_CHUNK_SIZE - 1}) / ${REALTIME_WORLD_CHUNK_SIZE} AS INTEGER) END;
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS block_edits_chunk_revision ON block_edits (chunk_x, chunk_z, revision);");
  }

  close(): void {
    this.db.close();
  }

  /** Pins terrain identity to this SQLite world so an env edit cannot reinterpret existing blocks. */
  assertTerrainConfiguration(preset: "default" | "superflat", superflatGroundY: number): void {
    const existing = this.db.query<{ preset: string; superflat_ground_y: number }, []>(`
      SELECT preset, superflat_ground_y FROM world_configuration WHERE id = 1
    `).get();
    if (!existing) {
      this.db.query(`
        INSERT INTO world_configuration (id, preset, superflat_ground_y) VALUES (1, ?, ?)
      `).run(preset, superflatGroundY);
      return;
    }
    if (existing.preset !== preset || existing.superflat_ground_y !== superflatGroundY) {
      throw new Error(
        `World terrain is pinned to ${existing.preset}:${existing.superflat_ground_y}; refusing ${preset}:${superflatGroundY}`,
      );
    }
  }

  ensurePlayerInventory(userId: string, initialInventoryJson?: string, now = Date.now()): PersistedInventoryState {
    return this.db.transaction(() => {
      const existing = this.playerInventoryRow(userId);
      if (existing) return toPersistedInventory(existing);
      const validated = initialInventoryJson ? validatePlayerStateJson(initialInventoryJson) : null;
      const state = validated?.ok ? validated.state : createInitializedPlayerState();
      const inventoryJson = JSON.stringify(state);
      this.db.query(`
        INSERT INTO player_inventory (user_id, inventory_json, revision, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(userId, inventoryJson, now, now);
      return toPersistedInventory(this.playerInventoryRow(userId)!);
    })();
  }

  loadPlayerInventory(userId: string): PersistedInventoryState | null {
    const row = this.playerInventoryRow(userId);
    return row ? toPersistedInventory(row) : null;
  }

  applyPlayerInventoryAction(userId: string, requestJson: string, now = Date.now(), creative = false): InventoryActionMutationResult {
    const validation = validateInventoryActionRequestJson(requestJson);
    if (!validation.ok) return {
      ok: false,
      reason: "invalid_request",
      detail: validation.playerStateIssue ?? validation.reason,
    };
    const request = validation.request;
    return this.db.transaction(() => {
      const receipt = this.db.query<InventoryOperationRow, [string, string]>(`
        SELECT fingerprint, result_json FROM inventory_operations
        WHERE user_id = ? AND operation_id = ?
      `).get(userId, request.operationId);
      if (receipt) {
        if (receipt.fingerprint !== request.fingerprint) return { ok: false, reason: "operation_id_reused" };
        const replay = JSON.parse(receipt.result_json) as InventoryActionMutationResult;
        return replay.ok ? { ...replay, replayed: true } : replay;
      }
      const row = this.playerInventoryRow(userId);
      if (!row) return { ok: false, reason: "inventory_required", inventory: null };
      const inventory = toPersistedInventory(row);
      if (String(row.revision) !== request.expectedRevision) {
        return { ok: false, reason: "conflict", inventory };
      }
      const previous = validatePlayerStateJson(row.inventory_json);
      if (!previous.ok) return { ok: false, reason: "invalid_state", inventory };
      const effect = creative && request.action.kind === "workspace_commit"
        ? {
            ok: true as const,
            state: request.action.playerState,
            playerStateJson: request.action.playerStateJson,
            effect: "workspace_committed" as const,
            crafted: [],
          }
        : applyInventoryAction(previous.state, request.action);
      if (!effect.ok) return { ok: false, reason: effect.reason, inventory };
      const revision = row.revision + 1;
      this.db.query(`
        UPDATE player_inventory SET inventory_json = ?, revision = ?, updated_at = ? WHERE user_id = ?
      `).run(effect.playerStateJson, revision, now, userId);
      const persisted = toPersistedInventory(this.playerInventoryRow(userId)!);
      const result: InventoryActionMutationResult = {
        ok: true,
        replayed: false,
        effect: effect.effect,
        inventory: persisted,
        ...(effect.consumed === undefined ? {} : { consumed: effect.consumed }),
        ...(effect.restored === undefined ? {} : { restored: effect.restored }),
        ...(effect.crafted === undefined ? {} : { crafted: effect.crafted }),
      };
      this.db.query(`
        INSERT INTO inventory_operations (user_id, operation_id, fingerprint, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, request.operationId, request.fingerprint, JSON.stringify(result), now);
      this.db.query(`
        DELETE FROM inventory_operations WHERE user_id = ? AND operation_id NOT IN (
          SELECT operation_id FROM inventory_operations WHERE user_id = ? ORDER BY created_at DESC LIMIT 64
        )
      `).run(userId, userId);
      return result;
    })();
  }

  currentPlayerDeath(userId: string): PlayerDeathLifecycle | null {
    const row = this.db.query<{
      user_id:string;event_id:string;created_at:number;settled_operation_id:string|null;
      settled_at:number|null;respawned_at:number|null;
    },[string]>(`SELECT user_id,event_id,created_at,settled_operation_id,settled_at,respawned_at
      FROM player_deaths WHERE user_id=? AND respawned_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(userId);
    return row ? {userId:row.user_id,eventId:row.event_id,createdAt:row.created_at,
      settledOperationId:row.settled_operation_id,settledAt:row.settled_at,respawnedAt:row.respawned_at} : null;
  }

  private recordPlayerDeath(userId:string,eventId:string,now:number):PlayerDeathLifecycle {
    const current=this.currentPlayerDeath(userId);
    if(current)return current;
    this.db.query(`INSERT INTO player_deaths(user_id,event_id,created_at,settled_operation_id,settled_at,respawned_at)
      VALUES(?,?,?,NULL,NULL,NULL)`).run(userId,eventId.slice(0,128),now);
    return this.currentPlayerDeath(userId)!;
  }

  saveDeadPlayer(player:PublicPlayer,resumeHash:string,eventId:string,updatedAt:number,resumeExpiresAt:number):void {
    this.db.transaction(()=>{this.savePlayer(player,resumeHash,updatedAt,resumeExpiresAt);this.recordPlayerDeath(player.id,eventId,updatedAt);})();
  }

  commitPlayerRespawn(player:PublicPlayer,resumeHash:string,updatedAt:number,resumeExpiresAt:number):
    {ok:true}|{ok:false;reason:"alive"|"death_unsettled"} {
    return this.db.transaction(()=>{
      const stored=this.loadPlayer(player.id);
      if(!stored || (stored.player.health??20)>0)return {ok:false as const,reason:"alive" as const};
      const death=this.currentPlayerDeath(player.id);
      if(!death?.settledOperationId)return {ok:false as const,reason:"death_unsettled" as const};
      this.savePlayer(player,resumeHash,updatedAt,resumeExpiresAt);
      this.db.query("UPDATE player_deaths SET respawned_at=? WHERE user_id=? AND event_id=? AND respawned_at IS NULL")
        .run(updatedAt,player.id,death.eventId);
      return {ok:true as const};
    })();
  }

  /** Clears a dead player's authoritative pack and creates every death drop in one transaction. */
  applyAuthoritativeDeathSettlement(
    userId: string,
    requestJson: string,
    deathPose: Readonly<{x:number;y:number;z:number}>,
    now = Date.now(),
  ): RailwayDeathSettlementResult {
    const validation = validateInventoryActionRequestJson(requestJson);
    if (!validation.ok || validation.request.action.kind !== "death_settle") {
      return {result:{ok:false,reason:"invalid_request",detail:validation.ok ? "invalid_action" : validation.reason},drops:[],activeDrops:[]};
    }
    const request = validation.request;
    return this.db.transaction((): RailwayDeathSettlementResult => {
      const historical=this.db.query<{fingerprint:string;result_json:string;drops_json:string;event_id:string},[string,string]>(`
        SELECT d.fingerprint,d.result_json,d.drops_json,p.event_id FROM death_settlement_operations d
        JOIN player_deaths p ON p.user_id=d.user_id AND p.settled_operation_id=d.operation_id
        WHERE d.user_id=? AND d.operation_id=?
      `).get(userId,request.operationId);
      if(historical){
        const fingerprint=JSON.stringify([request.fingerprint,historical.event_id,deathPose.x,deathPose.y,deathPose.z]);
        if(historical.fingerprint!==fingerprint)return {result:{ok:false,reason:"operation_id_reused"},drops:[],activeDrops:[]};
        const result=JSON.parse(historical.result_json) as InventoryActionMutationResult;
        const drops=JSON.parse(historical.drops_json) as PublicDrop[];
        const activeIds=new Set(this.listDrops(now).map((drop)=>drop.dropId));
        return {result:result.ok?{...result,replayed:true}:result,drops,activeDrops:drops.filter((drop)=>activeIds.has(drop.dropId))};
      }
      const death=this.currentPlayerDeath(userId);
      if(!death)return {result:{ok:false,reason:"invalid_state"},drops:[],activeDrops:[]};
      if(death.settledOperationId && death.settledOperationId!==request.operationId){
        const settled=this.db.query<{result_json:string;drops_json:string},[string,string]>(`
          SELECT result_json,drops_json FROM death_settlement_operations WHERE user_id=? AND operation_id=?
        `).get(userId,death.settledOperationId);
        if(!settled)return {result:{ok:false,reason:"invalid_state"},drops:[],activeDrops:[]};
        const result=JSON.parse(settled.result_json) as InventoryActionMutationResult;
        const drops=JSON.parse(settled.drops_json) as PublicDrop[];
        const activeIds=new Set(this.listDrops(now).map((drop)=>drop.dropId));
        return {result:result.ok?{...result,replayed:true}:result,drops,activeDrops:drops.filter((drop)=>activeIds.has(drop.dropId))};
      }
      const fingerprint = JSON.stringify([request.fingerprint,death.eventId,deathPose.x,deathPose.y,deathPose.z]);
      const receipt = this.db.query<{fingerprint:string;result_json:string;drops_json:string},[string,string]>(`
        SELECT fingerprint,result_json,drops_json FROM death_settlement_operations
        WHERE user_id=? AND operation_id=?
      `).get(userId,request.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          return {result:{ok:false,reason:"operation_id_reused"},drops:[],activeDrops:[]};
        }
        const stored = JSON.parse(receipt.result_json) as InventoryActionMutationResult;
        const drops = JSON.parse(receipt.drops_json) as PublicDrop[];
        const activeIds = new Set(this.listDrops(now).map((drop)=>drop.dropId));
        return {
          result:stored.ok ? {...stored,replayed:true} : stored,
          drops,
          activeDrops:drops.filter((drop)=>activeIds.has(drop.dropId)),
        };
      }
      const legacyReceipt = this.db.query<InventoryOperationRow,[string,string]>(`
        SELECT fingerprint,result_json FROM inventory_operations WHERE user_id=? AND operation_id=?
      `).get(userId,request.operationId);
      if (legacyReceipt) return {result:{ok:false,reason:"operation_id_reused"},drops:[],activeDrops:[]};
      const row = this.playerInventoryRow(userId);
      if (!row) return {result:{ok:false,reason:"inventory_required",inventory:null},drops:[],activeDrops:[]};
      const inventory = toPersistedInventory(row);
      if (String(row.revision) !== request.expectedRevision) {
        return {result:{ok:false,reason:"conflict",inventory},drops:[],activeDrops:[]};
      }
      const previous = validatePlayerStateJson(row.inventory_json);
      if (!previous.ok) return {result:{ok:false,reason:"invalid_state",inventory},drops:[],activeDrops:[]};
      const plan = planDeathDrops({
        identity:{userId,eventId:death.eventId},
        inventory:previous.state.inventory,
        equipment:previous.state.equipment,
        deathPose,
      });
      if (!plan.ok) return {result:{ok:false,reason:"invalid_state",inventory},drops:[],activeDrops:[]};
      const activeCount = this.db.query<{count:number},[number]>(
        "SELECT COUNT(*) AS count FROM dropped_items WHERE expires_at>?",
      ).get(now)?.count ?? 0;
      if (activeCount + plan.drops.length > 256) {
        return {result:{ok:false,reason:"inventory_full",inventory},drops:[],activeDrops:[]};
      }
      const effect = applyInventoryAction(previous.state,request.action);
      if (!effect.ok) return {result:{ok:false,reason:effect.reason,inventory},drops:[],activeDrops:[]};
      const revision = row.revision + 1;
      this.db.query("UPDATE player_inventory SET inventory_json=?,revision=?,updated_at=? WHERE user_id=?")
        .run(effect.playerStateJson,revision,now,userId);
      const persisted = toPersistedInventory(this.playerInventoryRow(userId)!);
      const result: InventoryActionMutationResult = {
        ok:true,replayed:false,effect:"death_settled",inventory:persisted,
      };
      const drops = plan.drops.map((planned):PublicDrop=>({
        dropId:`drop:${planned.operationId}`.slice(0,96),ownerUserId:userId,
        itemId:planned.stack.itemId,count:planned.stack.count,
        ...(planned.stack.durability === undefined ? {} : {durability:planned.stack.durability}),
        ...planned.position,droppedAt:now,ownerPickupAt:now+DROPPED_ITEM_PICKUP_DELAY_MS,
        expiresAt:now+DROPPED_ITEM_TTL_MS,
      }));
      for (let index=0;index<drops.length;index+=1) this.saveDrop(drops[index],plan.drops[index].operationId);
      this.db.query(`INSERT INTO inventory_operations(user_id,operation_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?,?)`).run(userId,request.operationId,request.fingerprint,JSON.stringify(result),now);
      this.db.query(`INSERT INTO death_settlement_operations(user_id,operation_id,fingerprint,result_json,drops_json,created_at)
        VALUES(?,?,?,?,?,?)`).run(userId,request.operationId,fingerprint,JSON.stringify(result),JSON.stringify(drops),now);
      this.db.query(`UPDATE player_deaths SET settled_operation_id=?,settled_at=?
        WHERE user_id=? AND event_id=? AND settled_operation_id IS NULL`).run(request.operationId,now,userId,death.eventId);
      this.db.query(`DELETE FROM inventory_operations WHERE user_id=? AND operation_id NOT IN (
        SELECT operation_id FROM inventory_operations WHERE user_id=? ORDER BY created_at DESC LIMIT 64
      )`).run(userId,userId);
      this.db.query(`DELETE FROM death_settlement_operations WHERE rowid NOT IN (
        SELECT rowid FROM death_settlement_operations ORDER BY created_at DESC LIMIT 512
      )`).run();
      return {result,drops,activeDrops:drops};
    })();
  }

  private playerInventoryRow(userId: string): PlayerInventoryRow | null {
    return this.db.query<PlayerInventoryRow, [string]>(`
      SELECT user_id, inventory_json, revision, created_at, updated_at
      FROM player_inventory WHERE user_id = ?
    `).get(userId) ?? null;
  }

  getRevision(): number {
    return (this.db.query<{ revision: number }, []>("SELECT revision FROM world_meta WHERE id = 1").get()?.revision ?? 0);
  }

  blockCount(): number {
    return this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM block_edits").get()?.count ?? 0;
  }

  initializeAdministration(input: Omit<ServerAdministrationSettings, "passwordHash" | "updatedAt">): void {
    const now = Date.now();
    this.db.query(`
      INSERT OR IGNORE INTO server_settings
        (id, access_mode, password_hash, spawn_x, spawn_z, spawn_yaw, daylight_cycle, day_phase, updated_at)
      VALUES (1, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(input.accessMode, input.spawnX, input.spawnZ, input.spawnYaw, input.daylightCycle ? 1 : 0, input.dayPhase, now);
  }

  administrationSettings(): ServerAdministrationSettings {
    const row = this.db.query<{
      access_mode: ServerAccessMode; password_hash: string | null; spawn_x: number; spawn_z: number;
      spawn_yaw: number; daylight_cycle: number; day_phase: number; updated_at: number;
    }, []>(`SELECT access_mode,password_hash,spawn_x,spawn_z,spawn_yaw,daylight_cycle,day_phase,updated_at
      FROM server_settings WHERE id=1`).get();
    if (!row) throw new Error("Server administration settings are not initialized");
    return {
      accessMode: row.access_mode, passwordHash: row.password_hash, spawnX: row.spawn_x, spawnZ: row.spawn_z,
      spawnYaw: row.spawn_yaw, daylightCycle: row.daylight_cycle === 1, dayPhase: row.day_phase, updatedAt: row.updated_at,
    };
  }

  updateAdministration(patch: Partial<Pick<ServerAdministrationSettings,
    "accessMode" | "passwordHash" | "spawnX" | "spawnZ" | "spawnYaw" | "daylightCycle" | "dayPhase">>): ServerAdministrationSettings {
    const current = this.administrationSettings();
    const touchesClock = patch.dayPhase !== undefined || patch.daylightCycle !== undefined;
    const next = { ...current, ...patch, updatedAt: touchesClock ? Date.now() : current.updatedAt };
    this.db.query(`UPDATE server_settings SET access_mode=?,password_hash=?,spawn_x=?,spawn_z=?,spawn_yaw=?,
      daylight_cycle=?,day_phase=?,updated_at=? WHERE id=1`).run(
      next.accessMode, next.passwordHash, next.spawnX, next.spawnZ, next.spawnYaw,
      next.daylightCycle ? 1 : 0, next.dayPhase, next.updatedAt,
    );
    return next;
  }

  listAccessEntries(): ServerAccessEntry[] {
    const whitelist = this.db.query<{ normalized_username:string;username:string;updated_at:number }, []>(
      "SELECT normalized_username,username,updated_at FROM server_whitelist",
    ).all();
    const roles = new Map(this.db.query<{ normalized_username:string;username:string;role:ServerRole;updated_at:number }, []>(
      "SELECT normalized_username,username,role,updated_at FROM server_roles",
    ).all().map((row) => [row.normalized_username, row] as const));
    const bans = new Map(this.db.query<{ normalized_username:string;username:string;reason:string;updated_at:number }, []>(
      "SELECT normalized_username,username,reason,updated_at FROM server_bans",
    ).all().map((row) => [row.normalized_username, row] as const));
    const names = new Set([...whitelist.map((row) => row.normalized_username), ...roles.keys(), ...bans.keys()]);
    return [...names].map((normalizedUsername) => {
      const white = whitelist.find((row) => row.normalized_username === normalizedUsername);
      const role = roles.get(normalizedUsername);
      const ban = bans.get(normalizedUsername);
      return {
        username: white?.username ?? role?.username ?? ban!.username,
        normalizedUsername,
        ...(role ? { role: role.role } : {}),
        banned: Boolean(ban),
        ...(ban ? { reason: ban.reason } : {}),
        updatedAt: Math.max(white?.updated_at ?? 0, role?.updated_at ?? 0, ban?.updated_at ?? 0),
      };
    }).sort((a, b) => a.username.localeCompare(b.username));
  }

  isWhitelisted(username: string): boolean {
    const normalized = tryNormalizeServerUsername(username);
    return normalized === null ? false : Boolean(this.db.query("SELECT 1 FROM server_whitelist WHERE normalized_username=?").get(normalized));
  }

  roleFor(username: string): ServerRole | null {
    const normalized = tryNormalizeServerUsername(username);
    if (normalized === null) return null;
    return this.db.query<{ role: ServerRole }, [string]>("SELECT role FROM server_roles WHERE normalized_username=?")
      .get(normalized)?.role ?? null;
  }

  banFor(username: string): { reason:string } | null {
    const normalized = tryNormalizeServerUsername(username);
    if (normalized === null) return null;
    return this.db.query<{ reason:string }, [string]>("SELECT reason FROM server_bans WHERE normalized_username=?")
      .get(normalized) ?? null;
  }

  setWhitelisted(username: string, allowed: boolean): void {
    const normalized = normalizeServerUsername(username);
    if (allowed) this.db.query(`INSERT INTO server_whitelist(normalized_username,username,updated_at) VALUES(?,?,?)
      ON CONFLICT(normalized_username) DO UPDATE SET username=excluded.username,updated_at=excluded.updated_at`)
      .run(normalized, username.trim(), Date.now());
    else this.db.query("DELETE FROM server_whitelist WHERE normalized_username=?").run(normalized);
  }

  setRole(username: string, role: ServerRole | null): void {
    const normalized = normalizeServerUsername(username);
    if (role) this.db.query(`INSERT INTO server_roles(normalized_username,username,role,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(normalized_username) DO UPDATE SET username=excluded.username,role=excluded.role,updated_at=excluded.updated_at`)
      .run(normalized, username.trim(), role, Date.now());
    else this.db.query("DELETE FROM server_roles WHERE normalized_username=?").run(normalized);
  }

  setBanned(username: string, reason: string | null): void {
    const normalized = normalizeServerUsername(username);
    if (reason !== null) this.db.query(`INSERT INTO server_bans(normalized_username,username,reason,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(normalized_username) DO UPDATE SET username=excluded.username,reason=excluded.reason,updated_at=excluded.updated_at`)
      .run(normalized, username.trim(), reason.slice(0, 160), Date.now());
    else this.db.query("DELETE FROM server_bans WHERE normalized_username=?").run(normalized);
  }

  getAllBlockEdits(): BlockEdit[] {
    const rows = this.db.query<BlockRow, []>(`
      SELECT revision, x, y, z, block, editor_id, edited_at
      FROM block_edits ORDER BY revision ASC
    `).all();
    return rows.map(toBlockEdit);
  }

  getBlockEditsSince(sinceRevision: number, limit: number): BlockEdit[] {
    const bounded = Math.max(1, Math.min(512, Math.floor(limit)));
    return this.db.query<BlockRow, [number, number]>(`
      SELECT revision, x, y, z, block, editor_id, edited_at
      FROM block_edits WHERE revision > ? ORDER BY revision ASC LIMIT ?
    `).all(sinceRevision, bounded).map(toBlockEdit);
  }

  getWorldChunk(chunkX: number, chunkZ: number): StoredWorldChunk {
    const rows = this.db.query<BlockRow, [number, number]>(`
      SELECT revision, x, y, z, block, editor_id, edited_at
      FROM block_edits WHERE chunk_x = ? AND chunk_z = ? ORDER BY revision ASC
    `).all(chunkX, chunkZ);
    return {
      x: chunkX,
      z: chunkZ,
      revision: rows.reduce((latest, row) => Math.max(latest, row.revision), 0),
      edits: rows.map(toBlockEdit),
    };
  }

  recentChat(limit: number): RealtimeChatMessage[] {
    const boundedLimit = Math.max(1, Math.min(256, Math.floor(limit)));
    const rows = this.db.query<ChatRow, [number]>(`
      SELECT sequence, operation_id, user_id, username, message, sent_at
      FROM chat_messages ORDER BY sequence DESC LIMIT ?
    `).all(boundedLimit);
    return rows.reverse().map(toChatMessage);
  }

  listDrops(now = Date.now()): PublicDrop[] {
    this.db.query("DELETE FROM dropped_items WHERE expires_at <= ?").run(now);
    return this.db.query<DropRow, []>(`
      SELECT drop_id, operation_id, owner_user_id, item_id, count, durability, x, y, z, dropped_at, owner_pickup_at, expires_at
      FROM dropped_items ORDER BY dropped_at ASC LIMIT 256
    `).all().map(toPublicDrop);
  }

  getDropOperation(ownerUserId: string, operationId: string): PublicDrop | null {
    const row = this.db.query<DropRow, [string, string]>(`
      SELECT drop_id, operation_id, owner_user_id, item_id, count, durability, x, y, z, dropped_at, owner_pickup_at, expires_at
      FROM dropped_items WHERE owner_user_id = ? AND operation_id = ?
    `).get(ownerUserId, operationId);
    return row ? toPublicDrop(row) : null;
  }

  saveDrop(drop: PublicDrop, operationId: string): void {
    this.db.query(`
      INSERT INTO dropped_items (drop_id, operation_id, owner_user_id, item_id, count, durability, x, y, z, dropped_at, owner_pickup_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(drop.dropId, operationId, drop.ownerUserId, drop.itemId, drop.count, drop.durability ?? null,
      drop.x, drop.y, drop.z, drop.droppedAt, drop.ownerPickupAt, drop.expiresAt);
  }

  /** Debits the exact canonical stack and publishes its world drop in one transaction. */
  applyAuthoritativeDrop(
    userId: string,
    operationId: string,
    sourceSlot: number | undefined,
    stack: ItemStack,
    drop: PublicDrop,
    now: number,
    gameMode: ServerGameMode = "survival",
  ): RailwayDropAuthorityResult {
    const fingerprint = JSON.stringify([stack, sourceSlot ?? null, drop.x, drop.y, drop.z,gameMode]);
    return this.db.transaction((): RailwayDropAuthorityResult => {
      const replay = this.db.query<{ fingerprint: string; drop_json: string }, [string, string]>(`
        SELECT fingerprint,drop_json FROM drop_authority_operations WHERE user_id=? AND operation_id=?
      `).get(userId, operationId);
      if (replay) {
        if (replay.fingerprint !== fingerprint) return { ok: false, reason: "operation_id_reused" };
        const inventory = this.loadPlayerInventory(userId);
        return inventory ? { ok: true, replayed: true, drop: JSON.parse(replay.drop_json) as PublicDrop, inventory }
          : { ok: false, reason: "inventory_required" };
      }
      const activeDrops = this.db.query<{ count: number }, [number]>(
        "SELECT COUNT(*) AS count FROM dropped_items WHERE expires_at>?",
      ).get(now)?.count ?? 0;
      if (activeDrops >= 256) return { ok: false, reason: "drop_limit" };
      const inventoryRow = this.playerInventoryRow(userId);
      if (!inventoryRow) return { ok: false, reason: "inventory_required" };
      const state = validatePlayerStateJson(inventoryRow.inventory_json);
      if (!state.ok) return { ok: false, reason: "invalid_state" };
      const definition=ITEMS[stack.itemId];
      if(!definition)return {ok:false,reason:"item_mismatch"};
      const maximum=maxItemDurability(stack.itemId);
      if(!Number.isInteger(stack.count) || stack.count<1 || stack.count>definition.maxStack
        || (maximum===null ? stack.durability!==undefined
          : stack.count!==1 || stack.durability===undefined || !Number.isInteger(stack.durability)
            || stack.durability<1 || stack.durability>maximum))return {ok:false,reason:"item_mismatch"};
      const inventory = [...state.state.inventory];
      if(gameMode === "creative") {
        // Creative publishes a bounded catalog item without mutating the stored survival pack.
      } else if (sourceSlot === undefined) {
        const legacyId = `drop_${operationId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
        const legacy = this.db.query<{ fingerprint: string; result_json: string }, [string, string]>(`
          SELECT fingerprint,result_json FROM inventory_operations WHERE user_id=? AND operation_id=?
        `).get(userId, legacyId);
        let paid = false;
        if (legacy) try {
          const fingerprintValue = JSON.parse(legacy.fingerprint) as unknown[];
          const action = fingerprintValue[3] as { kind?: unknown; stack?: unknown } | undefined;
          const result = JSON.parse(legacy.result_json) as { ok?: unknown; effect?: unknown };
          paid = action?.kind === "world_debit" && JSON.stringify(action.stack) === JSON.stringify(stack)
            && result.ok === true && result.effect === "world_debited";
        } catch { paid = false; }
        if (!paid) return { ok: false, reason: "item_mismatch" };
      } else {
        const current = inventory[sourceSlot];
        if (!current || !areItemStacksCompatible(current, stack) || current.count < stack.count) {
          return { ok: false, reason: "item_mismatch" };
        }
        inventory[sourceSlot] = current.count === stack.count ? null : { ...current, count: current.count - stack.count };
        const inventoryJson = JSON.stringify({ ...state.state, inventory });
        this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
          .run(inventoryJson, now, userId);
      }
      this.saveDrop(drop, operationId);
      this.db.query(`INSERT INTO drop_authority_operations(user_id,operation_id,fingerprint,drop_json,created_at)
        VALUES(?,?,?,?,?)`).run(userId, operationId, fingerprint, JSON.stringify(drop), now);
      const persisted = this.loadPlayerInventory(userId);
      return persisted ? { ok: true, replayed: false, drop, inventory: persisted }
        : { ok: false, reason: "inventory_required" };
    })();
  }

  updateDropState(drop: PublicDrop): void {
    this.db.query("UPDATE dropped_items SET y = ? WHERE drop_id = ?").run(drop.y, drop.dropId);
  }

  deleteDrop(dropId: string): boolean {
    return this.db.query("DELETE FROM dropped_items WHERE drop_id = ?").run(dropId).changes > 0;
  }

  getPickupOperation(userId: string, operationId: string): PublicDrop | null {
    const row = this.db.query<DropRow, [string, string]>(`
      SELECT drop_id, '' AS operation_id, owner_user_id, item_id, count, durability,
        x, y, z, dropped_at, owner_pickup_at, expires_at
      FROM pickup_operations WHERE user_id = ? AND operation_id = ?
    `).get(userId, operationId);
    return row ? toPublicDrop(row) : null;
  }

  consumeDrop(userId: string, operationId: string, dropId: string, pickedAt: number): PublicDrop | null {
    return this.db.transaction(() => {
      const replay = this.getPickupOperation(userId, operationId);
      if (replay) return replay.dropId===dropId ? replay : null;
      const row = this.db.query<DropRow, [string]>(`
        SELECT drop_id, operation_id, owner_user_id, item_id, count, durability,
          x, y, z, dropped_at, owner_pickup_at, expires_at
        FROM dropped_items WHERE drop_id = ?
      `).get(dropId);
      if (!row) return null;
      this.db.query(`
        INSERT INTO pickup_operations (user_id, operation_id, drop_id, owner_user_id, item_id, count,
          durability, x, y, z, dropped_at, owner_pickup_at, expires_at, picked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, operationId, row.drop_id, row.owner_user_id, row.item_id, row.count,
        row.durability, row.x, row.y, row.z, row.dropped_at, row.owner_pickup_at, row.expires_at, pickedAt);
      this.db.query("DELETE FROM dropped_items WHERE drop_id = ?").run(dropId);
      this.db.query(`
        DELETE FROM pickup_operations WHERE rowid NOT IN (
          SELECT rowid FROM pickup_operations ORDER BY picked_at DESC LIMIT 512
        )
      `).run();
      return toPublicDrop(row);
    })();
  }

  consumeDropIntoInventory(
    userId: string,
    operationId: string,
    dropId: string,
    pickedAt: number,
  ): RailwayPickupAuthorityResult {
    return this.db.transaction((): RailwayPickupAuthorityResult => {
      const replay = this.getPickupOperation(userId, operationId);
      if (replay) {
        if (replay.dropId !== dropId) return {ok:false,reason:"operation_id_reused"};
        const inventory = this.loadPlayerInventory(userId);
        return inventory ? {ok:true,replayed:true,drop:replay,inventory}
          : {ok:false,reason:"inventory_required"};
      }
      const row = this.db.query<DropRow, [string]>(`
        SELECT drop_id,operation_id,owner_user_id,item_id,count,durability,x,y,z,dropped_at,owner_pickup_at,expires_at
        FROM dropped_items WHERE drop_id=?
      `).get(dropId);
      if (!row) return {ok:false,reason:"unavailable"};
      const inventoryRow = this.playerInventoryRow(userId);
      if (!inventoryRow) return {ok:false,reason:"inventory_required"};
      const state = validatePlayerStateJson(inventoryRow.inventory_json);
      if (!state.ok) return {ok:false,reason:"invalid_state"};
      const stack: ItemStack = {itemId:row.item_id as ItemStack["itemId"],count:row.count,
        ...(row.durability === null ? {} : {durability:row.durability})};
      const added = addItemStack(state.state.inventory,stack);
      if (added.remainder) return {ok:false,reason:"inventory_full"};
      const inventoryJson = JSON.stringify({...state.state,inventory:added.inventory});
      this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
        .run(inventoryJson,pickedAt,userId);
      this.db.query(`INSERT INTO pickup_operations(user_id,operation_id,drop_id,owner_user_id,item_id,count,
        durability,x,y,z,dropped_at,owner_pickup_at,expires_at,picked_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(userId,operationId,row.drop_id,row.owner_user_id,row.item_id,row.count,
        row.durability,row.x,row.y,row.z,row.dropped_at,row.owner_pickup_at,row.expires_at,pickedAt);
      this.db.query("DELETE FROM dropped_items WHERE drop_id=?").run(dropId);
      this.db.query(`DELETE FROM pickup_operations WHERE rowid NOT IN (
        SELECT rowid FROM pickup_operations ORDER BY picked_at DESC LIMIT 512
      )`).run();
      const inventory = this.loadPlayerInventory(userId);
      return inventory ? {ok:true,replayed:false,drop:toPublicDrop(row),inventory}
        : {ok:false,reason:"inventory_required"};
    })();
  }

  appendChat(
    input: { operationId: string; userId: string; username: string; message: string; sentAt: number },
    rateLimitMs: number,
    historyLimit: number,
  ): { ok: true; message: RealtimeChatMessage; duplicate: boolean } | { ok: false; retryAfterMs: number } {
    return this.db.transaction(() => {
      const duplicate = this.db.query<ChatRow, [string, string]>(`
        SELECT sequence, operation_id, user_id, username, message, sent_at
        FROM chat_messages WHERE user_id = ? AND operation_id = ?
      `).get(input.userId, input.operationId);
      if (duplicate) return { ok: true as const, message: toChatMessage(duplicate), duplicate: true };

      const previous = this.db.query<{ sent_at: number }, [string]>(`
        SELECT sent_at FROM chat_messages WHERE user_id = ? ORDER BY sequence DESC LIMIT 1
      `).get(input.userId);
      const elapsed = previous ? input.sentAt - previous.sent_at : rateLimitMs;
      if (elapsed < rateLimitMs) {
        return { ok: false as const, retryAfterMs: Math.max(1, rateLimitMs - elapsed) };
      }

      const inserted = this.db.query(`
        INSERT INTO chat_messages (operation_id, user_id, username, message, sent_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.operationId, input.userId, input.username, input.message, input.sentAt);
      const sequence = Number(inserted.lastInsertRowid);
      this.db.query(`
        DELETE FROM chat_messages WHERE sequence NOT IN (
          SELECT sequence FROM chat_messages ORDER BY sequence DESC LIMIT ?
        )
      `).run(Math.max(1, Math.min(256, Math.floor(historyLimit))));
      return {
        ok: true as const,
        duplicate: false,
        message: {
          id: `chat:${sequence}`,
          sequence,
          operationId: input.operationId,
          userId: input.userId,
          username: input.username,
          message: input.message,
          sentAt: input.sentAt,
        },
      };
    })();
  }

  getBlockOperation(userId: string, operationId: string): BlockEdit | null {
    const row = this.db.query<BlockRow, [string, string]>(`
      SELECT revision, x, y, z, block, user_id AS editor_id, edited_at
      FROM block_operations WHERE user_id = ? AND operation_id = ?
    `).get(userId, operationId);
    return row ? toBlockEdit(row) : null;
  }

  /** Current coordinate value plus the chunk's monotonic revision watermark for safe retry acknowledgement. */
  currentBlockReplayAck(x: number, y: number, z: number): BlockEdit | null {
    const row = this.db.query<BlockRow, [number, number, number]>(`
      SELECT revision, x, y, z, block, editor_id, edited_at
      FROM block_edits WHERE x = ? AND y = ? AND z = ?
    `).get(x,y,z);
    if (!row) return null;
    const chunkX = Math.floor(x / REALTIME_WORLD_CHUNK_SIZE);
    const chunkZ = Math.floor(z / REALTIME_WORLD_CHUNK_SIZE);
    const revision = this.db.query<{ revision: number }, [number, number]>(`
      SELECT COALESCE(MAX(revision), 0) AS revision
      FROM block_edits WHERE chunk_x = ? AND chunk_z = ?
    `).get(chunkX, chunkZ)?.revision ?? row.revision;
    return { ...toBlockEdit(row), revision };
  }

  hasLegacyPlacementDebit(userId: string, operationId: string, expectedItemId: string): boolean {
    const receiptId = `place_${operationId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
    const row = this.db.query<{ fingerprint: string; result_json: string }, [string, string]>(`
      SELECT fingerprint,result_json FROM inventory_operations WHERE user_id=? AND operation_id=?
    `).get(userId, receiptId);
    if (!row) return false;
    try {
      const fingerprint = JSON.parse(row.fingerprint) as unknown[];
      const action = fingerprint[3] as { kind?: unknown; expectedItemId?: unknown } | undefined;
      const result = JSON.parse(row.result_json) as { ok?: unknown; effect?: unknown; consumed?: unknown };
      return action?.kind === "place_block" && action.expectedItemId === expectedItemId
        && result.ok === true && result.effect === "placed_block" && result.consumed === expectedItemId;
    } catch { return false; }
  }

  replayAuthoritativeBlockOperation(
    userId: string,
    operationId: string,
    requestJson: string,
    block: number,
    gameMode: ServerGameMode,
  ): RailwayBlockAuthorityResult | null {
    let raw: unknown;
    try { raw = JSON.parse(requestJson); } catch { return { ok: false, reason: "invalid_request" }; }
    const parsed = parseWorldBlockOperation(raw, RAILWAY_WORLD_BLOCK_BOUNDS);
    if (!parsed.ok || parsed.request.operationId !== operationId) return { ok: false, reason: "invalid_request" };
    const fingerprint = JSON.stringify([parsed.fingerprint, block, gameMode]);
    const receipt = this.db.query<{ fingerprint: string; result_json: string }, [string, string]>(`
      SELECT fingerprint,result_json FROM block_authority_operations WHERE user_id=? AND operation_id=?
    `).get(userId, operationId);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) return { ok: false, reason: "operation_id_reused" };
    return { ...(JSON.parse(receipt.result_json) as Extract<RailwayBlockAuthorityResult, { ok: true }>), replayed: true };
  }

  /** One SQLite conservation boundary for current multiplayer block actions. */
  applyAuthoritativeBlockOperation(input: {
    userId: string;
    requestJson: string;
    block: number;
    baseBlock: number;
    gameMode: ServerGameMode;
    editedAt: number;
    maxUniqueBlocks: number;
  }): RailwayBlockAuthorityResult {
    let raw: unknown;
    try { raw = JSON.parse(input.requestJson); } catch { return { ok: false, reason: "invalid_request" }; }
    const parsed = parseWorldBlockOperation(raw, RAILWAY_WORLD_BLOCK_BOUNDS);
    if (!parsed.ok) return { ok: false, reason: "invalid_request" };
    const request = parsed.request;
    const requestedNext = request.kind === "mine" ? "air"
      : request.kind === "toggle" ? toggledWorldBlock(request.expectedBlock)
      : request.placedBlock;
    if (request.x !== (raw as { x: number }).x || request.y !== (raw as { y: number }).y
      || request.z !== (raw as { z: number }).z || BLOCK_TYPES[input.block] !== requestedNext) {
      return { ok: false, reason: "invalid_request" };
    }
    const fingerprint = JSON.stringify([parsed.fingerprint, input.block, input.gameMode]);
    return this.db.transaction((): RailwayBlockAuthorityResult => {
      const receipt = this.db.query<{ fingerprint: string; result_json: string }, [string, string]>(`
        SELECT fingerprint,result_json FROM block_authority_operations WHERE user_id=? AND operation_id=?
      `).get(input.userId, request.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) return { ok: false, reason: "operation_id_reused" };
        return { ...(JSON.parse(receipt.result_json) as Extract<RailwayBlockAuthorityResult, { ok: true }>), replayed: true };
      }
      const legacyReceipt = this.db.query<{ found: number }, [string, string]>(`
        SELECT 1 AS found FROM block_operations WHERE user_id=? AND operation_id=?
      `).get(input.userId, request.operationId);
      if (legacyReceipt) return { ok: false, reason: "operation_id_reused" };
      const inventoryRow = this.playerInventoryRow(input.userId);
      if (!inventoryRow) return { ok: false, reason: "inventory_required" };
      const playerState = validatePlayerStateJson(inventoryRow.inventory_json);
      if (!playerState.ok) return { ok: false, reason: "invalid_state" };
      const chunkX = Math.floor(request.x / REALTIME_WORLD_CHUNK_SIZE);
      const chunkZ = Math.floor(request.z / REALTIME_WORLD_CHUNK_SIZE);
      const chunkRevision = this.db.query<{ revision: number }, [number, number]>(`
        SELECT COALESCE(MAX(revision),0) AS revision FROM block_edits WHERE chunk_x=? AND chunk_z=?
      `).get(chunkX, chunkZ)?.revision ?? 0;
      const currentRow = this.db.query<{ block: number }, [number, number, number]>(`
        SELECT block FROM block_edits WHERE x=? AND y=? AND z=?
      `).get(request.x, request.y, request.z);
      const currentBlockId = currentRow?.block ?? input.baseBlock;
      const currentBlock = BLOCK_TYPES[currentBlockId] as BlockType | undefined;
      if (!currentBlock) return { ok: false, reason: "invalid_state" };
      if (currentBlock === "bedrock" || request.y === -64) return { ok: false, reason: "protected_block" };
      if (request.expectedBlock !== currentBlock) return { ok: false, reason: "block_mismatch" };
      const authoritativeBlock = currentBlock as WorldChunkBlockType;
      if (request.expectedChunkRevision !== String(chunkRevision)) return { ok: false, reason: "stale_chunk_revision" };

      let nextInventoryJson = inventoryRow.inventory_json;
      let nextInventoryRevision = inventoryRow.revision;
      let minedDrop: PublicDrop | undefined;
      if (input.gameMode === "survival") {
        const resolution = resolveWorldBlockOperation(request, {
          currentBlock: authoritativeBlock,
          inventory: playerState.state.inventory,
          inventoryRevision: String(inventoryRow.revision),
          chunkRevision: String(chunkRevision),
        }, RAILWAY_WORLD_BLOCK_BOUNDS, {miningDropDestination:"world"});
        if (!resolution.ok) return { ok: false, reason: resolution.reason };
        if (resolution.effect.kind === "mine") {
          const toolInventory = resolution.effect.toolUse.inventory;
          const inventoryChanged = JSON.stringify(toolInventory) !== JSON.stringify(playerState.state.inventory);
          nextInventoryJson = JSON.stringify({ ...playerState.state, inventory: toolInventory });
          nextInventoryRevision = inventoryChanged ? inventoryRow.revision + 1 : inventoryRow.revision;
          if (resolution.effect.drop) {
            const activeDrops = this.db.query<{ count: number }, [number]>(
              "SELECT COUNT(*) AS count FROM dropped_items WHERE expires_at>?",
            ).get(input.editedAt)?.count ?? 0;
            if (activeDrops >= 256) return { ok: false, reason: "drop_limit" };
            minedDrop = {
              dropId:`drop:mine:${request.operationId}`.slice(0,96),ownerUserId:input.userId,
              itemId:resolution.effect.drop.itemId,count:resolution.effect.drop.count,
              x:request.x+0.5,y:request.y+0.45,z:request.z+0.5,droppedAt:input.editedAt,
              ownerPickupAt:input.editedAt+DROPPED_ITEM_PICKUP_DELAY_MS,
              expiresAt:input.editedAt+DROPPED_ITEM_TTL_MS,
            };
          }
        } else {
          nextInventoryJson = JSON.stringify({ ...playerState.state, inventory: resolution.effect.inventory });
          nextInventoryRevision = Number(resolution.effect.inventoryRevision);
        }
      }

      const exists = currentRow !== null && currentRow !== undefined;
      if (!exists && this.blockCount() >= input.maxUniqueBlocks) return { ok: false, reason: "world_limit" };
      this.db.query("UPDATE world_meta SET revision=revision+1 WHERE id=1").run();
      const revision = this.getRevision();
      this.db.query(`INSERT INTO block_edits(x,y,z,chunk_x,chunk_z,block,revision,editor_id,edited_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(x,y,z) DO UPDATE SET block=excluded.block,
        revision=excluded.revision,editor_id=excluded.editor_id,edited_at=excluded.edited_at
      `).run(request.x, request.y, request.z, chunkX, chunkZ, input.block, revision, input.userId, input.editedAt);
      if (nextInventoryRevision !== inventoryRow.revision) {
        this.db.query("UPDATE player_inventory SET inventory_json=?,revision=?,updated_at=? WHERE user_id=?")
          .run(nextInventoryJson, nextInventoryRevision, input.editedAt, input.userId);
      }
      if (minedDrop) this.saveDrop(minedDrop, `mine:${request.operationId}`.slice(0,96));
      this.db.query(`INSERT INTO block_operations(user_id,operation_id,revision,x,y,z,block,edited_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(input.userId, request.operationId, revision, request.x, request.y, request.z, input.block, input.editedAt);
      const edit: BlockEdit = {
        revision, x: request.x, y: request.y, z: request.z, block: input.block,
        editorId: input.userId, editedAt: input.editedAt,
      };
      const inventory = toPersistedInventory(this.playerInventoryRow(input.userId)!);
      const result = { ok: true as const, replayed: false, edit, inventory, ...(minedDrop ? { drop:minedDrop } : {}) };
      this.db.query(`INSERT INTO block_authority_operations(user_id,operation_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?,?)`).run(input.userId, request.operationId, fingerprint, JSON.stringify(result), input.editedAt);
      this.db.query(`DELETE FROM block_authority_operations WHERE user_id=? AND operation_id NOT IN (
        SELECT operation_id FROM block_authority_operations WHERE user_id=? ORDER BY created_at DESC LIMIT 256
      )`).run(input.userId, input.userId);
      return result;
    })();
  }

  applyBlockEdit(
    input: {
      operationId: string;
      x: number;
      y: number;
      z: number;
      block: number;
      editorId: string;
      editedAt: number;
    },
    maxUniqueBlocks: number,
  ): { edit: BlockEdit; duplicate: boolean } | null {
    return this.db.transaction(() => {
      const duplicate = this.db.query<BlockRow, [string, string]>(`
        SELECT revision, x, y, z, block, user_id AS editor_id, edited_at
        FROM block_operations WHERE user_id = ? AND operation_id = ?
      `).get(input.editorId, input.operationId);
      if (duplicate) return { edit: toBlockEdit(duplicate), duplicate: true };

      const exists = this.db.query<{ found: number }, [number, number, number]>(
        "SELECT 1 AS found FROM block_edits WHERE x = ? AND y = ? AND z = ?",
      ).get(input.x, input.y, input.z);
      if (!exists && this.blockCount() >= maxUniqueBlocks) return null;

      this.db.query("UPDATE world_meta SET revision = revision + 1 WHERE id = 1").run();
      const revision = this.getRevision();
      this.db.query(`
        INSERT INTO block_edits (x, y, z, chunk_x, chunk_z, block, revision, editor_id, edited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (x, y, z) DO UPDATE SET
          block = excluded.block,
          revision = excluded.revision,
          editor_id = excluded.editor_id,
          edited_at = excluded.edited_at
      `).run(
        input.x, input.y, input.z,
        Math.floor(input.x / REALTIME_WORLD_CHUNK_SIZE), Math.floor(input.z / REALTIME_WORLD_CHUNK_SIZE),
        input.block, revision, input.editorId, input.editedAt,
      );
      this.db.query(`
        INSERT INTO block_operations (user_id, operation_id, revision, x, y, z, block, edited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.editorId,
        input.operationId,
        revision,
        input.x,
        input.y,
        input.z,
        input.block,
        input.editedAt,
      );
      this.db.query(`
        DELETE FROM block_operations WHERE user_id = ? AND operation_id NOT IN (
          SELECT operation_id FROM block_operations WHERE user_id = ? ORDER BY revision DESC LIMIT 256
        )
      `).run(input.editorId, input.editorId);
      return {
        edit: {
          revision,
          x: input.x,
          y: input.y,
          z: input.z,
          block: input.block,
          editorId: input.editorId,
          editedAt: input.editedAt,
        },
        duplicate: false,
      };
    })();
  }

  loadPlayer(userId: string): StoredPlayer | null {
    const row = this.db.query<PlayerRow, [string]>(`
      SELECT user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, game_mode, health, updated_at
      FROM player_state WHERE user_id = ?
    `).get(userId);
    return row ? toStoredPlayer(row) : null;
  }

  loadPlayerByResumeHash(resumeHash: string): StoredPlayer | null {
    const row = this.db.query<PlayerRow, [string]>(`
      SELECT user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, game_mode, health, updated_at
      FROM player_state WHERE resume_hash = ?
    `).get(resumeHash);
    return row ? toStoredPlayer(row) : null;
  }

  savePlayer(
    player: PublicPlayer,
    resumeHash: string,
    updatedAt = Date.now(),
    resumeExpiresAt = updatedAt,
  ): void {
    this.db.query(`
      INSERT INTO player_state (
        user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, game_mode, health, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = excluded.display_name,
        x = excluded.x,
        y = excluded.y,
        z = excluded.z,
        yaw = excluded.yaw,
        pitch = excluded.pitch,
        resume_hash = excluded.resume_hash,
        resume_expires_at = excluded.resume_expires_at,
        game_mode = excluded.game_mode,
        health = excluded.health,
        updated_at = excluded.updated_at
    `).run(
      player.id,
      player.name,
      player.x,
      player.y,
      player.z,
      player.yaw,
      player.pitch,
      resumeHash,
      resumeExpiresAt,
      player.gameMode === "creative" ? "creative" : "survival",
      Math.max(0, Math.min(20, Math.floor(player.health ?? 20))),
      updatedAt,
    );
  }

  listPlayers(): Array<{ id: string; name: string; gameMode: ServerGameMode }> {
    return this.db.query<{ user_id:string;display_name:string;game_mode:string }, []>(`
      SELECT user_id, display_name, game_mode FROM player_state ORDER BY updated_at DESC
    `).all().map((row) => ({
      id: row.user_id,
      name: row.display_name,
      gameMode: row.game_mode === "creative" ? "creative" : "survival",
    }));
  }

  listAdminPlayers(): Array<{ id:string;name:string;gameMode:ServerGameMode;health:number;x:number;y:number;z:number }> {
    return this.db.query<{ user_id:string;display_name:string;game_mode:string;health:number;x:number;y:number;z:number }, []>(`
      SELECT user_id,display_name,game_mode,health,x,y,z FROM player_state ORDER BY updated_at DESC
    `).all().map((row)=>({id:row.user_id,name:row.display_name,gameMode:row.game_mode==="creative"?"creative":"survival",health:row.health,x:row.x,y:row.y,z:row.z}));
  }

  setPlayerGameMode(userId: string, gameMode: ServerGameMode): boolean {
    const result = this.db.query("UPDATE player_state SET game_mode = ?, updated_at = ? WHERE user_id = ?")
      .run(gameMode, Date.now(), userId);
    return result.changes === 1;
  }

  applyAuthoritativePlayerAttack(
    attackerId:string,operationId:string,targetId:string,serverNow:number,
  ):RailwayPlayerHitAuthorityResult {
    const fingerprint=JSON.stringify([targetId]);
    return this.db.transaction(():RailwayPlayerHitAuthorityResult=>{
      const prior=this.db.query<{fingerprint:string;result_json:string},[string,string]>(`
        SELECT fingerprint,result_json FROM player_hit_operations WHERE attacker_id=? AND operation_id=?
      `).get(attackerId,operationId);
      if(prior){
        if(prior.fingerprint!==fingerprint)return {ok:false,reason:"operation_id_reused"};
        return {...JSON.parse(prior.result_json) as Extract<RailwayPlayerHitAuthorityResult,{ok:true}>,replayed:true};
      }
      const attacker=this.db.query<{health:number},[string]>("SELECT health FROM player_state WHERE user_id=?").get(attackerId);
      const target=this.db.query<{health:number},[string]>("SELECT health FROM player_state WHERE user_id=?").get(targetId);
      if(!attacker || attacker.health<=0)return {ok:false,reason:"attacker_dead"};
      if(!target || target.health<=0)return {ok:false,reason:"target_dead"};
      const attackerRow=this.playerInventoryRow(attackerId),targetRow=this.playerInventoryRow(targetId);
      if(!attackerRow||!targetRow)return {ok:false,reason:"inventory_required"};
      const attackerState=validatePlayerStateJson(attackerRow.inventory_json);
      const targetState=validatePlayerStateJson(targetRow.inventory_json);
      if(!attackerState.ok||!targetState.ok)return {ok:false,reason:"invalid_state"};
      const selected=attackerState.state.inventory[attackerState.state.selectedHotbar]??null;
      const damage=mitigatedPlayerDamage(attackDamage(selected?.itemId),equippedArmorProtection(targetState.state.equipment));
      const weaponUse=applyConfirmedToolUse(attackerState.state.inventory,attackerState.state.selectedHotbar,"attack",selected?.itemId??null);
      const armorUse=applyConfirmedArmorDamage(targetState.state.equipment);
      const health=Math.max(0,target.health-damage),killed=health===0;
      if(weaponUse.used)this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
        .run(JSON.stringify({...attackerState.state,inventory:weaponUse.inventory}),serverNow,attackerId);
      if(armorUse.damaged.length)this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
        .run(JSON.stringify({...targetState.state,equipment:armorUse.equipment}),serverNow,targetId);
      this.db.query("UPDATE player_state SET health=?,updated_at=? WHERE user_id=?").run(health,serverNow,targetId);
      if(killed)this.recordPlayerDeath(targetId,`pvp:${operationId}:${targetId}`,serverNow);
      const result={ok:true as const,replayed:false,damage,health,killed,
        attackerInventory:toPersistedInventory(this.playerInventoryRow(attackerId)!),
        targetInventory:toPersistedInventory(this.playerInventoryRow(targetId)!),
        weaponDamaged:weaponUse.used,weaponBroken:weaponUse.broke};
      this.db.query(`INSERT INTO player_hit_operations(attacker_id,operation_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?,?)`).run(attackerId,operationId,fingerprint,JSON.stringify(result),serverNow);
      this.db.query(`DELETE FROM player_hit_operations WHERE attacker_id=? AND operation_id NOT IN (
        SELECT operation_id FROM player_hit_operations WHERE attacker_id=? ORDER BY created_at DESC LIMIT 256
      )`).run(attackerId,attackerId);
      return result;
    })();
  }

  replayAuthoritativePlayerAttack(attackerId:string,operationId:string,targetId:string):RailwayPlayerHitAuthorityResult|null {
    const row=this.db.query<{fingerprint:string;result_json:string},[string,string]>(`
      SELECT fingerprint,result_json FROM player_hit_operations WHERE attacker_id=? AND operation_id=?
    `).get(attackerId,operationId);
    if(!row)return null;
    if(row.fingerprint!==JSON.stringify([targetId]))return {ok:false,reason:"operation_id_reused"};
    return {...JSON.parse(row.result_json) as Extract<RailwayPlayerHitAuthorityResult,{ok:true}>,replayed:true};
  }

  applyAuthoritativePlayerDamage(
    userId:string,operationId:string,sourceId:string,baseDamage:number,armorApplies:boolean,serverNow:number,
  ):RailwayPlayerDamageAuthorityResult {
    const fingerprint=JSON.stringify([sourceId,baseDamage,armorApplies]);
    return this.db.transaction(():RailwayPlayerDamageAuthorityResult=>{
      const prior=this.db.query<{fingerprint:string;result_json:string},[string,string]>(`
        SELECT fingerprint,result_json FROM player_damage_operations WHERE user_id=? AND operation_id=?
      `).get(userId,operationId);
      if(prior){
        if(prior.fingerprint!==fingerprint)return {ok:false,reason:"operation_id_reused"};
        return {...JSON.parse(prior.result_json) as Extract<RailwayPlayerDamageAuthorityResult,{ok:true}>,replayed:true};
      }
      const player=this.db.query<{health:number},[string]>("SELECT health FROM player_state WHERE user_id=?").get(userId);
      if(!player||player.health<=0)return {ok:false,reason:"target_dead"};
      const row=this.playerInventoryRow(userId);
      if(!row)return {ok:false,reason:"inventory_required"};
      const state=validatePlayerStateJson(row.inventory_json);
      if(!state.ok)return {ok:false,reason:"invalid_state"};
      const armor=armorApplies?applyConfirmedArmorDamage(state.state.equipment):null;
      const damage=Math.min(player.health,armorApplies
        ? mitigatedPlayerDamage(baseDamage,equippedArmorProtection(state.state.equipment))
        : Math.max(1,Math.floor(baseDamage)));
      const health=player.health-damage,killed=health===0;
      if(armor?.damaged.length)this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
        .run(JSON.stringify({...state.state,equipment:armor.equipment}),serverNow,userId);
      this.db.query("UPDATE player_state SET health=?,updated_at=? WHERE user_id=?").run(health,serverNow,userId);
      if(killed)this.recordPlayerDeath(userId,`${sourceId}:${operationId}`,serverNow);
      const result={ok:true as const,replayed:false,damage,health,killed,inventory:toPersistedInventory(this.playerInventoryRow(userId)!)};
      this.db.query(`INSERT INTO player_damage_operations(user_id,operation_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?,?)`).run(userId,operationId,fingerprint,JSON.stringify(result),serverNow);
      this.db.query(`DELETE FROM player_damage_operations WHERE user_id=? AND operation_id NOT IN (
        SELECT operation_id FROM player_damage_operations WHERE user_id=? ORDER BY created_at DESC LIMIT 256
      )`).run(userId,userId);
      return result;
    })();
  }

  replayAuthoritativePlayerDamage(userId:string,operationId:string,sourceId:string,baseDamage:number,armorApplies:boolean):
    RailwayPlayerDamageAuthorityResult|null {
    const row=this.db.query<{fingerprint:string;result_json:string},[string,string]>(`
      SELECT fingerprint,result_json FROM player_damage_operations WHERE user_id=? AND operation_id=?
    `).get(userId,operationId);
    if(!row)return null;
    if(row.fingerprint!==JSON.stringify([sourceId,baseDamage,armorApplies]))return {ok:false,reason:"operation_id_reused"};
    return {...JSON.parse(row.result_json) as Extract<RailwayPlayerDamageAuthorityResult,{ok:true}>,replayed:true};
  }

  mobAuthorityState(mobId: string, kind: MobAuthorityKind, serverNow: number): MobAuthorityState {
    return materializeMobAuthorityState(this.mobStoredState(mobId), mobId, kind, serverNow);
  }

  mobAuthorityStates(
    mobs: readonly { mobId: string; kind: MobAuthorityKind }[],
    serverNow: number,
  ): MobAuthorityState[] {
    return mobs.map((mob) => this.mobAuthorityState(mob.mobId, mob.kind, serverNow));
  }

  applyMobAttack(
    userId: string,
    operationId: string,
    mobId: string,
    kind: MobAuthorityKind,
    damageOrServerNow: number,
    legacyServerNow?:number,
  ): RailwayMobAttackResult {
    const serverNow=legacyServerNow??damageOrServerNow;
    return this.db.transaction(() => {
      const fingerprint = `${mobId}\u0000${kind}`;
      const prior = this.db.query<{ fingerprint: string; result_json: string }, [string, string]>(`
        SELECT fingerprint,result_json FROM mob_attack_operations WHERE user_id=? AND operation_id=?
      `).get(userId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) return { ok: false as const, reason: "operation_id_reused" as const };
        return { ...(JSON.parse(prior.result_json) as RailwayMobAttackResult), replayed: true };
      }
      this.ensurePlayerInventory(userId,undefined,serverNow);
      const inventoryRow=this.playerInventoryRow(userId);
      if(!inventoryRow)return {ok:false as const,reason:"inventory_required" as const};
      const playerState=validatePlayerStateJson(inventoryRow.inventory_json);
      if(!playerState.ok)return {ok:false as const,reason:"invalid_state" as const};
      const selected=playerState.state.inventory[playerState.state.selectedHotbar]??null;
      const damage=attackDamage(selected?.itemId);
      const resolved = resolveMobAttack({
        stored: this.mobStoredState(mobId),
        rawMobId: mobId,
        rawKind: kind,
        rawDamage: damage,
        attackerId: userId,
        serverNow,
      });
      const failure: RailwayMobAttackResult = resolved.ok
        ? { ok:false,reason:"invalid_state" }
        : {
            ok: false,
            reason: resolved.reason,
            ...(resolved.state ? { state: resolved.state } : {}),
            ...(resolved.retryAfterMs === undefined ? {} : { retryAfterMs: resolved.retryAfterMs }),
          };
      if (resolved.ok) {
        const row = resolved.nextRow;
        this.db.query(`INSERT INTO mob_state
          (mob_id,kind,health,revision,sheared,dead_until,last_attack_at,last_attacker_id)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(mob_id) DO UPDATE SET kind=excluded.kind,health=excluded.health,
            revision=excluded.revision,sheared=excluded.sheared,dead_until=excluded.dead_until,
            last_attack_at=excluded.last_attack_at,last_attacker_id=excluded.last_attacker_id
        `).run(row.mobId, row.kind, Number(row.health), Number(row.revision), row.sheared === "true" ? 1 : 0,
          Number(row.deadUntil), Number(row.lastAttackAt), row.lastAttackerId);
        const weaponUse=applyConfirmedToolUse(playerState.state.inventory,playerState.state.selectedHotbar,"attack",selected?.itemId??null);
        if(weaponUse.used)this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
          .run(JSON.stringify({...playerState.state,inventory:weaponUse.inventory}),serverNow,userId);
        const result: RailwayMobAttackResult={ok:true,replayed:false,killed:resolved.killed,damage,drops:resolved.drops,state:resolved.state,
          inventory:toPersistedInventory(this.playerInventoryRow(userId)!),weaponDamaged:weaponUse.used,weaponBroken:weaponUse.broke};
        this.db.query(`INSERT INTO mob_attack_operations(user_id,operation_id,fingerprint,result_json,created_at)
          VALUES(?,?,?,?,?)`).run(userId, operationId, fingerprint, JSON.stringify(result), serverNow);
        this.db.query(`DELETE FROM mob_attack_operations WHERE rowid NOT IN (
          SELECT rowid FROM mob_attack_operations ORDER BY created_at DESC LIMIT 1024
        )`).run();
        return result;
      }
      this.db.query(`INSERT INTO mob_attack_operations(user_id,operation_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?,?)`).run(userId, operationId, fingerprint, JSON.stringify(failure), serverNow);
      this.db.query(`DELETE FROM mob_attack_operations WHERE rowid NOT IN (
        SELECT rowid FROM mob_attack_operations ORDER BY created_at DESC LIMIT 1024
      )`).run();
      return failure;
    })();
  }

  replayMobAttack(userId:string,operationId:string,mobId:string,kind:MobAuthorityKind):RailwayMobAttackResult|null {
    const row=this.db.query<{fingerprint:string;result_json:string},[string,string]>(`
      SELECT fingerprint,result_json FROM mob_attack_operations WHERE user_id=? AND operation_id=?
    `).get(userId,operationId);
    if(!row)return null;
    if(row.fingerprint!==`${mobId}\u0000${kind}`)return {ok:false,reason:"operation_id_reused"};
    return {...JSON.parse(row.result_json) as Extract<RailwayMobAttackResult,{ok:true}>,replayed:true};
  }

  saveMobWorld(world: StoredMobWorld): void {
    this.db.query(`INSERT INTO mob_world_state(id,checkpoint_json,center_x,center_z,night_mode,updated_at)
      VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json,
      center_x=excluded.center_x,center_z=excluded.center_z,night_mode=excluded.night_mode,updated_at=excluded.updated_at`)
      .run(JSON.stringify(world.checkpoint), world.centerX, world.centerZ, world.nightMode ? 1 : 0, world.updatedAt);
  }

  loadMobWorld(): StoredMobWorld | null {
    const row = this.db.query<{
      checkpoint_json: string; center_x: number; center_z: number; night_mode: number; updated_at: number;
    }, []>(`SELECT checkpoint_json,center_x,center_z,night_mode,updated_at FROM mob_world_state WHERE id=1`).get();
    if (!row) return null;
    try {
      return {
        checkpoint: JSON.parse(row.checkpoint_json) as MobMotionCheckpoint,
        centerX: row.center_x,
        centerZ: row.center_z,
        nightMode: row.night_mode === 1,
        updatedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  /** Atomically consumes one server-owned creeper and commits its complete crater. */
  applyMobExplosion(input: {
    eventId: string;
    fingerprint: string;
    mobId: string;
    edits: readonly { x: number; y: number; z: number; block: number }[];
    playerDamage: readonly { userId: string; damage: number }[];
    drops: readonly PublicDrop[];
    editedAt: number;
    maxUniqueBlocks: number;
  }): RailwayMobExplosionCommitResult {
    return this.db.transaction(() => {
      const prior = this.db.query<{ fingerprint: string; result_json: string }, [string]>(`
        SELECT fingerprint,result_json FROM mob_explosion_events WHERE event_id=?
      `).get(input.eventId);
      if (prior) {
        if (prior.fingerprint !== input.fingerprint) return { ok: false as const, reason: "event_collision" as const };
        const result = JSON.parse(prior.result_json) as Extract<RailwayMobExplosionCommitResult, { ok: true }>;
        return { ...result, replayed: true };
      }
      const unique = new Map(input.edits.map((edit) => [`${edit.x}:${edit.y}:${edit.z}`, edit] as const));
      let additions = 0;
      for (const edit of unique.values()) {
        const exists = this.db.query<{ found: number }, [number, number, number]>(
          "SELECT 1 AS found FROM block_edits WHERE x=? AND y=? AND z=?",
        ).get(edit.x, edit.y, edit.z);
        if (!exists) additions += 1;
      }
      const terrainLimited = this.blockCount() + additions > input.maxUniqueBlocks;

      const edits: BlockEdit[] = [];
      for (const edit of terrainLimited ? [] : unique.values()) {
        this.db.query("UPDATE world_meta SET revision=revision+1 WHERE id=1").run();
        const revision = this.getRevision();
        this.db.query(`INSERT INTO block_edits
          (x,y,z,chunk_x,chunk_z,block,revision,editor_id,edited_at)
          VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(x,y,z) DO UPDATE SET block=excluded.block,revision=excluded.revision,
            editor_id=excluded.editor_id,edited_at=excluded.edited_at
        `).run(edit.x, edit.y, edit.z, Math.floor(edit.x / REALTIME_WORLD_CHUNK_SIZE),
          Math.floor(edit.z / REALTIME_WORLD_CHUNK_SIZE), edit.block, revision, input.mobId, input.editedAt);
        edits.push({ ...edit, revision, editorId: input.mobId, editedAt: input.editedAt });
      }
      const stored = this.mobStoredState(input.mobId);
      const revision = Math.max(1, Number(stored?.revision ?? 0) + 1);
      this.db.query(`INSERT INTO mob_state
        (mob_id,kind,health,revision,sheared,dead_until,last_attack_at,last_attacker_id)
        VALUES(?,?,0,?,0,?,?,?)
        ON CONFLICT(mob_id) DO UPDATE SET health=0,revision=excluded.revision,
          dead_until=excluded.dead_until,last_attack_at=excluded.last_attack_at,
          last_attacker_id=excluded.last_attacker_id
      `).run(input.mobId, "creeper", revision, input.editedAt + 30_000, input.editedAt, input.mobId);
      const playerDamage: Array<{ userId: string; damage: number; health: number; killed: boolean }> = [];
      for (const request of input.playerDamage) {
        const row = this.db.query<{ health: number; game_mode: string }, [string]>(`
          SELECT health,game_mode FROM player_state WHERE user_id=?
        `).get(request.userId);
        if (!row || row.game_mode === "creative" || row.health <= 0) continue;
        this.ensurePlayerInventory(request.userId,undefined,input.editedAt);
        const inventoryRow=this.playerInventoryRow(request.userId);
        const inventoryState=inventoryRow?validatePlayerStateJson(inventoryRow.inventory_json):null;
        if(!inventoryRow||!inventoryState?.ok)continue;
        const armor=applyConfirmedArmorDamage(inventoryState.state.equipment);
        const damage = Math.max(0, Math.min(row.health,
          mitigatedPlayerDamage(Math.floor(request.damage),equippedArmorProtection(inventoryState.state.equipment))));
        if (damage <= 0) continue;
        const health = row.health - damage;
        if(armor.damaged.length)this.db.query("UPDATE player_inventory SET inventory_json=?,revision=revision+1,updated_at=? WHERE user_id=?")
          .run(JSON.stringify({...inventoryState.state,equipment:armor.equipment}),input.editedAt,request.userId);
        this.db.query("UPDATE player_state SET health=?,updated_at=? WHERE user_id=?")
          .run(health, input.editedAt, request.userId);
        if(health===0)this.recordPlayerDeath(request.userId,`creeper:${input.eventId}:${request.userId}`,input.editedAt);
        playerDamage.push({ userId: request.userId, damage, health, killed: health === 0 });
      }
      const drops = (terrainLimited ? [] : input.drops).slice(0, 8).map((drop) => ({ ...drop }));
      for (let index = 0; index < drops.length; index += 1) {
        const drop = drops[index]!;
        this.db.query(`INSERT INTO dropped_items
          (drop_id,operation_id,owner_user_id,item_id,count,durability,x,y,z,dropped_at,owner_pickup_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(drop.dropId, `${input.eventId}:${index}`, drop.ownerUserId, drop.itemId, drop.count,
          drop.durability ?? null, drop.x, drop.y, drop.z, drop.droppedAt, drop.ownerPickupAt, drop.expiresAt);
      }
      const result = { ok: true as const, replayed: false, edits, terrainLimited, playerDamage, drops };
      this.db.query(`INSERT INTO mob_explosion_events(event_id,fingerprint,result_json,created_at)
        VALUES(?,?,?,?)`).run(input.eventId, input.fingerprint, JSON.stringify(result), input.editedAt);
      this.db.query(`DELETE FROM mob_explosion_events WHERE event_id NOT IN (
        SELECT event_id FROM mob_explosion_events ORDER BY created_at DESC LIMIT 512
      )`).run();
      return result;
    })();
  }

  private mobStoredState(mobId: string): StoredMobAuthorityState | null {
    const row = this.db.query<MobStateRow, [string]>(`SELECT mob_id,kind,health,revision,sheared,
      dead_until,last_attack_at,last_attacker_id FROM mob_state WHERE mob_id=?`).get(mobId);
    return row ? {
      mobId: row.mob_id,
      kind: row.kind,
      health: String(row.health),
      revision: String(row.revision),
      sheared: row.sheared === 1 ? "true" : "false",
      deadUntil: String(row.dead_until),
      lastAttackAt: String(row.last_attack_at),
      lastAttackerId: row.last_attacker_id,
    } : null;
  }

  /** Returns false for a replayed ticket id. */
  consumeTicket(ticketId: string, now = Date.now()): boolean {
    return this.db.transaction(() => {
      this.db.query("DELETE FROM redeemed_tickets WHERE redeemed_at < ?").run(now - 24 * 60 * 60 * 1000);
      const result = this.db.query(
        "INSERT OR IGNORE INTO redeemed_tickets (ticket_id, redeemed_at) VALUES (?, ?)",
      ).run(ticketId, now);
      return result.changes === 1;
    })();
  }
}

function toStoredPlayer(row: PlayerRow): StoredPlayer {
  return {
    player: {
      id: row.user_id,
      name: row.display_name,
      x: row.x,
      y: row.y,
      z: row.z,
      yaw: row.yaw,
      pitch: row.pitch,
      gameMode: row.game_mode === "creative" ? "creative" : "survival",
      health: Math.max(0, Math.min(20, row.health)),
    },
    resumeHash: row.resume_hash,
    resumeExpiresAt: row.resume_expires_at,
    updatedAt: row.updated_at,
  };
}

function toBlockEdit(row: BlockRow): BlockEdit {
  return {
    revision: row.revision,
    x: row.x,
    y: row.y,
    z: row.z,
    block: row.block,
    editorId: row.editor_id,
    editedAt: row.edited_at,
  };
}

function toChatMessage(row: ChatRow): RealtimeChatMessage {
  return {
    id: `chat:${row.sequence}`,
    sequence: row.sequence,
    operationId: row.operation_id,
    userId: row.user_id,
    username: row.username,
    message: row.message,
    sentAt: row.sent_at,
  };
}

function toPublicDrop(row: DropRow): PublicDrop {
  return {
    dropId: row.drop_id,
    ownerUserId: row.owner_user_id,
    itemId: row.item_id,
    count: row.count,
    ...(row.durability === null ? {} : { durability: row.durability }),
    x: row.x,
    y: row.y,
    z: row.z,
    droppedAt: row.dropped_at,
    ownerPickupAt: row.owner_pickup_at,
    expiresAt: row.expires_at,
  };
}

export function normalizeServerUsername(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) throw new Error("Username is invalid");
  return normalized;
}

function tryNormalizeServerUsername(value: string): string | null {
  try {
    return normalizeServerUsername(value);
  } catch {
    return null;
  }
}

function toPersistedInventory(row: PlayerInventoryRow): PersistedInventoryState {
  return {
    id: `railway:${row.user_id}`,
    userId: row.user_id,
    inventoryJson: row.inventory_json,
    revision: String(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
