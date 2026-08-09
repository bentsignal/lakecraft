import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { WorldStore } from "../src/database";

const paths: string[] = [];

afterEach(async () => {
  for (const path of paths.splice(0)) {
    await Bun.file(path).delete().catch(() => {});
    await Bun.file(`${path}-wal`).delete().catch(() => {});
    await Bun.file(`${path}-shm`).delete().catch(() => {});
  }
});

describe("SQLite world persistence", () => {
  test("uses WAL and recovers player state, revisions, and idempotent operations", () => {
    const path = `/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const first = new WorldStore(path);
    expect(first.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    first.savePlayer(
      { id: "u1", name: "Alex", x: 1, y: 72, z: 3, yaw: 0.5, pitch: 0 },
      "resume-hash",
      10,
      10_000,
    );
    const accepted = first.applyBlockEdit({
      operationId: "op-1", x: 1, y: 72, z: 2, block: 4, editorId: "u1", editedAt: 20,
    }, 10);
    const duplicate = first.applyBlockEdit({
      operationId: "op-1", x: 9, y: 72, z: 9, block: 5, editorId: "u1", editedAt: 30,
    }, 10);
    expect(accepted?.duplicate).toBe(false);
    expect(duplicate).toEqual({ ...accepted, duplicate: true });
    first.close();

    const restarted = new WorldStore(path);
    expect(restarted.loadPlayer("u1")).toMatchObject({
      player: { id: "u1", name: "Alex", x: 1, y: 72, z: 3 },
      resumeHash: "resume-hash",
      resumeExpiresAt: 10_000,
    });
    expect(restarted.getRevision()).toBe(1);
    expect(restarted.getAllBlockEdits()).toEqual([
      { revision: 1, x: 1, y: 72, z: 2, block: 4, editorId: "u1", editedAt: 20 },
    ]);
    restarted.close();
  });

  test("migrates pre-expiry player databases without losing poses", () => {
    const path = `/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE player_state (
        user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
        yaw REAL NOT NULL, pitch REAL NOT NULL,
        resume_hash TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO player_state VALUES ('u1', 'Alex', 1, 2, 3, 0, 0, 'legacy-hash', 9);
    `);
    legacy.close();

    const migrated = new WorldStore(path);
    expect(migrated.loadPlayer("u1")).toMatchObject({
      player: { id: "u1", x: 1, y: 2, z: 3 },
      resumeHash: "legacy-hash",
      resumeExpiresAt: 0,
    });
    migrated.close();
  });

  test("enforces the unique persisted block cap but permits replacing a coordinate", () => {
    const store = new WorldStore(":memory:");
    expect(store.applyBlockEdit({ operationId: "a", x: 0, y: 72, z: 0, block: 1, editorId: "u", editedAt: 1 }, 1)).not.toBeNull();
    expect(store.applyBlockEdit({ operationId: "b", x: 1, y: 72, z: 0, block: 1, editorId: "u", editedAt: 2 }, 1)).toBeNull();
    expect(store.applyBlockEdit({ operationId: "c", x: 0, y: 72, z: 0, block: 2, editorId: "u", editedAt: 3 }, 1)?.edit.revision).toBe(2);
    store.close();
  });
});
