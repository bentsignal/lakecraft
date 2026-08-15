import type { BlockEdit } from "./protocol";
import type { WorldStore } from "./database";
import { REALTIME_WORLD_CHUNK_SIZE } from "../../../shared/realtimeWorldChunks.ts";

export interface AgentBatchInput {
  operationId: string;
  editorId: string;
  edits: Array<{ x: number; y: number; z: number; block: number }>;
  editedAt: number;
}

export type AgentBatchResult =
  | { ok: true; operationId: string; replayed: boolean; revision: number; edits: BlockEdit[] }
  | { ok: false; operationId: string; reason: "operation_id_reused" | "world_limit" };

interface ReceiptRow {
  fingerprint: string;
  result_json: string;
}

/**
 * Persists an agent-authored batch as one SQLite transaction. The receipt and
 * every block revision commit together, so retrying a timed-out request cannot
 * duplicate or partially apply a build.
 */
export function applyAgentBatch(
  store: WorldStore,
  input: AgentBatchInput,
  maxUniqueBlocks: number,
): AgentBatchResult {
  const fingerprint = JSON.stringify({ editorId: input.editorId, edits: input.edits });
  return store.db.transaction(() => {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_builder_operations (
        operation_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const receipt = store.db.query<ReceiptRow, [string]>(`
      SELECT fingerprint, result_json FROM agent_builder_operations WHERE operation_id = ?
    `).get(input.operationId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        return { ok: false, operationId: input.operationId, reason: "operation_id_reused" } as const;
      }
      const result = JSON.parse(receipt.result_json) as Extract<AgentBatchResult, { ok: true }>;
      return { ...result, replayed: true };
    }

    let newCoordinates = 0;
    const coordinateExists = store.db.query<{ found: number }, [number, number, number]>(
      "SELECT 1 AS found FROM block_edits WHERE x = ? AND y = ? AND z = ?",
    );
    for (const edit of input.edits) {
      if (!coordinateExists.get(edit.x, edit.y, edit.z)) newCoordinates++;
    }
    if (store.blockCount() + newCoordinates > maxUniqueBlocks) {
      return { ok: false, operationId: input.operationId, reason: "world_limit" } as const;
    }

    const persisted: BlockEdit[] = [];
    const insertEdit = store.db.query(`
      INSERT INTO block_edits (x, y, z, chunk_x, chunk_z, block, revision, editor_id, edited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (x, y, z) DO UPDATE SET
        block = excluded.block,
        revision = excluded.revision,
        editor_id = excluded.editor_id,
        edited_at = excluded.edited_at
    `);
    for (const edit of input.edits) {
      store.db.query("UPDATE world_meta SET revision = revision + 1 WHERE id = 1").run();
      const revision = store.getRevision();
      insertEdit.run(
        edit.x, edit.y, edit.z,
        Math.floor(edit.x / REALTIME_WORLD_CHUNK_SIZE), Math.floor(edit.z / REALTIME_WORLD_CHUNK_SIZE),
        edit.block, revision, input.editorId, input.editedAt,
      );
      persisted.push({ ...edit, revision, editorId: input.editorId, editedAt: input.editedAt });
    }
    const result: Extract<AgentBatchResult, { ok: true }> = {
      ok: true,
      operationId: input.operationId,
      replayed: false,
      revision: store.getRevision(),
      edits: persisted,
    };
    store.db.query(`
      INSERT INTO agent_builder_operations (operation_id, fingerprint, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.operationId, fingerprint, JSON.stringify(result), input.editedAt);
    // Bound worst-case receipt storage while keeping a generous replay window.
    // A full 512-edit result is intentionally retained so a timed-out CLI can
    // recover the exact authoritative revisions without reading the world.
    store.db.query(`
      DELETE FROM agent_builder_operations WHERE operation_id NOT IN (
        SELECT operation_id FROM agent_builder_operations ORDER BY created_at DESC, rowid DESC LIMIT 512
      )
    `).run();
    return result;
  })();
}
