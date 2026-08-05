import * as BS from "../shared/bundleStrings.ts";
import { newestByIndex, type IndexedTable } from "./queryOrder.ts";

type ReceiptRow = { id: string };
type ReceiptTable<Row extends ReceiptRow> = IndexedTable<Row> & {
  delete(id: string): Promise<unknown>;
};

export function userOperationReceiptRows<Row>(
  table: IndexedTable<Row>,
  userId: string,
  operationId: string,
): Promise<Row[]> {
  return newestByIndex(table, BS.byUserOperation, (q) => q
    .eq(BS.userId, userId)
    .eq(BS.operationId, operationId)).take(2);
}

export function newestUserOperationReceipt<Row>(
  table: IndexedTable<Row>,
  userId: string,
  operationId: string,
): Promise<Row | null> {
  return newestByIndex(table, BS.byUserOperation, (q) => q
    .eq(BS.userId, userId)
    .eq(BS.operationId, operationId)).first();
}

/** Shared mechanics for user-scoped receipts; policy stays explicit per caller. */
export async function maintainUserReceipts<Row extends ReceiptRow>(
  table: ReceiptTable<Row>,
  userId: string,
  committedReceiptId: string,
  now: number,
  maximum: number,
  pruneLimit: number,
  ttlMs: number,
  selectOverflow: (rows: readonly Row[], committedReceiptId: string) => string[],
): Promise<void> {
  const newestRows = await newestByIndex(table, BS.byUserCreated, (q) => q.eq(BS.userId, userId))
    .take(maximum + pruneLimit);
  for (const receiptId of selectOverflow(newestRows, committedReceiptId)) await table.delete(receiptId);
  const staleRows = await table
    .withIndex(BS.byUserCreated, (q) => q.eq(BS.userId, userId).lt(BS.receiptCreatedAt, String(now - ttlMs)))
    .order("asc")
    .take(pruneLimit);
  for (const row of staleRows) await table.delete(row.id);
}
