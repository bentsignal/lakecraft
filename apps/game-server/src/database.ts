import { Database } from "bun:sqlite";
import type { BlockEdit, PublicPlayer } from "./protocol";

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
    `);
    const playerColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(player_state)").all();
    if (!playerColumns.some((column) => column.name === "resume_expires_at")) {
      this.db.exec("ALTER TABLE player_state ADD COLUMN resume_expires_at INTEGER NOT NULL DEFAULT 0;");
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
      SELECT user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, updated_at
      FROM player_state WHERE user_id = ?
    `).get(userId);
    return row ? toStoredPlayer(row) : null;
  }

  loadPlayerByResumeHash(resumeHash: string): StoredPlayer | null {
    const row = this.db.query<PlayerRow, [string]>(`
      SELECT user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, updated_at
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
        user_id, display_name, x, y, z, yaw, pitch, resume_hash, resume_expires_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = excluded.display_name,
        x = excluded.x,
        y = excluded.y,
        z = excluded.z,
        yaw = excluded.yaw,
        pitch = excluded.pitch,
        resume_hash = excluded.resume_hash,
        resume_expires_at = excluded.resume_expires_at,
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
      updatedAt,
    );
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
