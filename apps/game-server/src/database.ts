import { Database } from "bun:sqlite";
import type { BlockEdit, PublicDrop, PublicPlayer, RealtimeChatMessage, ServerGameMode } from "./protocol";

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
  }

  close(): void {
    this.db.close();
  }

  getRevision(): number {
    return (this.db.query<{ revision: number }, []>("SELECT revision FROM world_meta WHERE id = 1").get()?.revision ?? 0);
  }

  blockCount(): number {
    return this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM block_edits").get()?.count ?? 0;
  }

  getAllBlockEdits(): BlockEdit[] {
    const rows = this.db.query<BlockRow, []>(`
      SELECT revision, x, y, z, block, editor_id, edited_at
      FROM block_edits ORDER BY revision ASC
    `).all();
    return rows.map(toBlockEdit);
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
      if (replay) return replay;
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
        INSERT INTO block_edits (x, y, z, block, revision, editor_id, edited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (x, y, z) DO UPDATE SET
          block = excluded.block,
          revision = excluded.revision,
          editor_id = excluded.editor_id,
          edited_at = excluded.edited_at
      `).run(input.x, input.y, input.z, input.block, revision, input.editorId, input.editedAt);
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
    return this.db.query<{ user_id: string; display_name: string; game_mode: string }, []>(`
      SELECT user_id, display_name, game_mode FROM player_state ORDER BY updated_at DESC
    `).all().map((row) => ({
      id: row.user_id,
      name: row.display_name,
      gameMode: row.game_mode === "creative" ? "creative" : "survival",
    }));
  }

  setPlayerGameMode(userId: string, gameMode: ServerGameMode): boolean {
    const result = this.db.query("UPDATE player_state SET game_mode = ?, updated_at = ? WHERE user_id = ?")
      .run(gameMode, Date.now(), userId);
    return result.changes === 1;
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
