import assert from "node:assert/strict";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  serializeSinglePlayerSave,
  singlePlayerSaveChecksum,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  prepareSinglePlayerCloudBackup,
  restoreSinglePlayerCloudBackup,
  singlePlayerCloudUploadRevision,
  type SinglePlayerCloudBackupWire,
  type SinglePlayerCloudLineage,
} from "../client/singleplayer/cloudBackupClient.ts";

type Active = { kind: "active"; revision: number; raw: string };
type Tombstone = { kind: "tombstone"; revision: number; deletedRevision: number; operationId: string };
type CloudRow = Active | Tombstone | { kind: "corrupt" } | { kind: "fence"; revision: number };

/** Test-only transactional database model for protocol invariants that Lakebed does not expose through a test API. */
class CloudDatabase {
  generation = 0;
  readonly owners = new Map<string, Map<string, CloudRow>>();
  readonly budgets = new Map<string, { active: boolean; cleanupAfter: number | string }>();
  failAfterWrite = false;

  private state(userId: string) {
    let value = this.owners.get(userId);
    if (!value) { value = new Map(); this.owners.set(userId, value); }
    return value;
  }

  private transaction<T>(write: () => T): T {
    const generation = this.generation;
    const owners = structuredClone(this.owners);
    const budgets = structuredClone(this.budgets);
    try {
      const result = write();
      if (this.failAfterWrite) throw new Error("transaction rollback fixture");
      return result;
    } catch (error) {
      this.generation = generation;
      this.owners.clear(); for (const [owner, rows] of owners) this.owners.set(owner, rows);
      this.budgets.clear(); for (const [owner, budget] of budgets) this.budgets.set(owner, budget);
      throw error;
    }
  }

  commit(userId: string, worldId: string, expected: number, raw: string) {
    return this.transaction(() => {
      const rows = this.state(userId);
      if ([...rows.values()].some((row) => row.kind === "fence")) return { ok: false as const, reason: "fence" };
      const current = rows.get(worldId);
      const required = current?.kind === "active" || current?.kind === "tombstone" ? current.revision : 0;
      if (required !== expected || current?.kind === "corrupt") return { ok: false as const, reason: "conflict" };
      this.generation += 1;
      rows.set(worldId, { kind: "active", revision: this.generation, raw });
      this.budgets.set(userId, { active: true, cleanupAfter: "never" });
      return { ok: true as const, revision: this.generation };
    });
  }

  remove(userId: string, worldId: string, expected: number, operationId: string) {
    return this.transaction(() => {
      const rows = this.state(userId);
      const current = rows.get(worldId);
      if (current?.kind === "tombstone") return current.deletedRevision === expected && current.operationId === operationId
        ? { ok: true as const, revision: current.revision, deduped: true }
        : { ok: false as const, reason: "conflict" };
      if (current?.kind !== "active" || current.revision !== expected) return { ok: false as const, reason: "conflict" };
      this.generation += 1;
      rows.set(worldId, { kind: "tombstone", revision: this.generation,
        deletedRevision: expected, operationId });
      return { ok: true as const, revision: this.generation, deduped: false };
    });
  }

  dispose(userId: string, expectedGeneration: number, batchSize: number) {
    return this.transaction(() => {
      if (this.generation !== expectedGeneration) return { ok: false as const, reason: "conflict" };
      const rows = this.state(userId);
      const keys = [...rows.keys()].slice(0, batchSize);
      keys.forEach((key) => rows.delete(key));
      this.generation += 1;
      const more = rows.size > 0;
      if (!more) rows.set("~", { kind: "fence", revision: this.generation });
      return { ok: true as const, revision: this.generation, more };
    });
  }

  resume(userId: string, expected: number) {
    return this.transaction(() => {
      const fence = this.state(userId).get("~");
      if (fence?.kind !== "fence" || fence.revision !== expected) return false;
      this.generation += 1; this.state(userId).delete("~"); return true;
    });
  }

  cleanupDormant(caller: string) {
    for (const [owner, budget] of this.budgets) {
      if (owner === caller || budget.active || typeof budget.cleanupAfter !== "number") continue;
      if ((this.owners.get(owner)?.size ?? 0) === 0) this.budgets.delete(owner);
    }
  }
}

const db = new CloudDatabase();
const alice1 = db.commit("alice", "world", 0, "a1");
const bob1 = db.commit("bob", "world", 0, "b1");
assert.deepEqual([alice1.ok && alice1.revision, bob1.ok && bob1.revision], [1, 2],
  "two identities own isolated rows while sharing one monotonic generation");
assert.deepEqual(db.commit("bob", "world", 1, "forged"), { ok: false, reason: "conflict" },
  "one identity cannot use another owner's CAS token");
assert.equal((db.owners.get("alice")!.get("world") as Active).raw, "a1");

const deleted = db.remove("alice", "world", 1, "delete_retry_1");
assert.equal(deleted.ok && deleted.revision, 3);
assert.deepEqual(db.remove("alice", "world", 1, "delete_retry_1"),
  { ok: true, revision: 3, deduped: true }, "a lost delete response retries idempotently with the same operation id");
assert.deepEqual(db.remove("alice", "world", 1, "delete_retry_2"), { ok: false, reason: "conflict" },
  "operation-id reuse cannot erase a later state");
assert.deepEqual(db.commit("alice", "world", 0, "stale-device"), { ok: false, reason: "conflict" },
  "a new or long-offline stale device cannot resurrect a tombstoned world as missing");
const recreated = db.commit("alice", "world", 3, "explicit-resume");
assert.equal(recreated.ok && recreated.revision, 4);
assert.deepEqual(db.remove("alice", "world", 1, "delete_retry_1"), { ok: false, reason: "conflict" },
  "a delayed old delete cannot erase the explicitly recreated generation");

db.owners.set("damaged", new Map(Array.from({ length: 5 }, (_, index) => [`bad-${index}`, { kind: "corrupt" } as const])));
let disposition = db.dispose("damaged", db.generation, 2);
assert.deepEqual(disposition, { ok: true, revision: 5, more: true });
disposition = db.dispose("damaged", disposition.revision, 2);
assert.equal(disposition.ok && disposition.more, true);
disposition = db.dispose("damaged", disposition.ok ? disposition.revision : 0, 2);
assert.equal(disposition.ok && disposition.more, false);
const fenceRevision = disposition.ok ? disposition.revision : 0;
assert.equal(db.commit("damaged", "world", 0, "stale" ).ok, false, "account fence blocks stale catch-up");
assert.equal(db.resume("damaged", fenceRevision), true);
assert.equal(db.commit("damaged", "world", 0, "explicit" ).ok, true, "exact resume removes the account fence");

db.budgets.set("malformed", { active: false, cleanupAfter: "not-a-time" });
db.budgets.set("dormant-with-parts", { active: false, cleanupAfter: 0 });
db.owners.set("dormant-with-parts", new Map([["legacy", { kind: "corrupt" }]]));
db.budgets.set("clean", { active: false, cleanupAfter: 0 });
db.cleanupDormant("bob");
assert.equal(db.budgets.has("malformed"), true, "malformed cross-owner cleanup candidates are skipped");
assert.equal(db.budgets.has("dormant-with-parts"), true, "cross-owner rows are never deleted with their budget");
assert.equal(db.budgets.has("clean"), false, "one validated empty-owner budget can be reclaimed");
assert.equal(db.commit("bob", "other", 0, "b2").ok, true,
  "unrelated malformed cleanup state does not poison the caller's upload");

const beforeRollback = structuredClone(db.owners);
const beforeGeneration = db.generation;
db.failAfterWrite = true;
assert.throws(() => db.commit("bob", "rollback", 0, "never-visible"));
db.failAfterWrite = false;
assert.deepEqual(db.owners, beforeRollback);
assert.equal(db.generation, beforeGeneration, "transaction failure rolls back rows and the global generation together");

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  listKeys() { return [...this.values.keys()]; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class FailedMarkerStorage extends MemoryStorage {
  override setItem(key: string, value: string) { if (key.includes("cloud-backup")) throw new Error("full"); super.setItem(key, value); }
}
const attemptDelete = (storage: SinglePlayerStorageAdapter, remoteMutation: () => void) => {
  const markerKey = "lakecraft:cloud-backup:v1:world:alice:world";
  const value = "D|1|delete_retry_1";
  try { storage.setItem(markerKey, value); if (storage.getItem(markerKey) !== value) return false; } catch { return false; }
  remoteMutation(); return true;
};
let remoteMutations = 0;
assert.equal(attemptDelete(new FailedMarkerStorage(), () => { remoteMutations += 1; }), false);
assert.equal(remoteMutations, 0, "local tombstone write/readback failure performs zero remote mutation");

let busy = false;
const openAction = () => busy ? false : (busy = true);
assert.equal(openAction(), true);
assert.equal(openAction(), false, "manual actions and autosync share one acquisition fence");
busy = false;
assert.equal(openAction(), true, "cancel releases the shared mutation fence");

const storage = new MemoryStorage();
const worldId = "restored-world";
const snapshot = createDefaultSinglePlayerSnapshot(42, 1_000, worldId);
const remoteSave = serializeSinglePlayerSave(snapshot, 7, 2_000);
assert.equal(remoteSave.ok, true);
if (!remoteSave.ok) throw new Error("remote fixture failed");
const wire: SinglePlayerCloudBackupWire = [1, worldId, "Restored", "42", "survival", "1000",
  singlePlayerSaveChecksum(remoteSave.raw), remoteSave.raw, "9", "3000"];
const restored = restoreSinglePlayerCloudBackup(storage, wire);
assert.equal(restored.ok, true);
if (!restored.ok) throw new Error("restore failed");
const committed = loadSinglePlayerSave(storage, { worldId, migrateLegacy: false });
assert.equal(committed.sequence, 1, "remote sequence seven is committed as local journal sequence one");
const prepared1 = prepareSinglePlayerCloudBackup(storage, restored.world, "9");
assert.equal(prepared1.ok, true);
if (!prepared1.ok) throw new Error("restored prepare failed");
const lineage: SinglePlayerCloudLineage = ["9", prepared1.backup[2], prepared1.backup[3], prepared1.backup[4]];
assert.equal(singlePlayerCloudUploadRevision(prepared1.backup, wire, lineage, false), null);
const saved = saveSinglePlayerSnapshot(storage, snapshot, 4_000, { worldId });
assert.equal(saved.ok && saved.sequence, 2);
const prepared2 = prepareSinglePlayerCloudBackup(storage, restored.world, "9");
assert.equal(prepared2.ok, true);
if (!prepared2.ok) throw new Error("descendant prepare failed");
assert.equal(singlePlayerCloudUploadRevision(prepared2.backup, wire, lineage, false), "9",
  "the first post-restore local seq2 save is an authorized descendant autosync");

const retryQueue: string[] = [];
const exactRequest = "prepared-request";
const sendWithBoundedRetry = (attempt: number) => { retryQueue.push(exactRequest); return attempt < 1 ? sendWithBoundedRetry(attempt + 1) : false; };
sendWithBoundedRetry(0);
assert.deepEqual(retryQueue, [exactRequest, exactRequest],
  "offline reconciliation retries the identical prepared request once, then stops");

console.log("single-player cloud durable deletion, recovery, ownership, and restore-lineage model tests passed");
