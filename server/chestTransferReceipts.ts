import { validatePlayerStateJson } from "../shared/chestTransfers.ts";

export const MAX_CHEST_TRANSFER_RECEIPTS_PER_USER = 16;
export const CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT = 8;

export type StoredPlayerStateDecision = "match" | "mismatch" | "invalid";

/** Canonical comparison prevents a valid CAS token from authorizing fabricated item contents. */
export function compareStoredPlayerState(
  storedPlayerStateJson: string,
  submittedCanonicalPlayerStateJson: string,
): StoredPlayerStateDecision {
  const stored = validatePlayerStateJson(storedPlayerStateJson);
  if (!stored.ok) return "invalid";
  return stored.playerStateJson === submittedCanonicalPlayerStateJson ? "match" : "mismatch";
}

export function encodeChestTransferReceipt(result: Record<string, unknown>): string {
  return JSON.stringify(result);
}

/** Receipts are server-authored, but validate their minimum shape before replaying a stored value. */
export function decodeChestTransferReceipt(rawResultJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawResultJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result = parsed as Record<string, unknown>;
    if (result.ok !== true || result.replayed !== false) return null;
    if (!result.moved || typeof result.moved !== "object" || Array.isArray(result.moved)) return null;
    if (!result.player || typeof result.player !== "object" || Array.isArray(result.player)) return null;
    if (!result.chest || typeof result.chest !== "object" || Array.isArray(result.chest)) return null;
    return { ...result, replayed: true };
  } catch {
    return null;
  }
}

/**
 * Accepts newest-first rows and returns a bounded overflow batch while always
 * retaining the just-committed receipt, even if multiple rows share a timestamp.
 */
export function selectChestTransferReceiptOverflow(
  newestFirstRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const retained = new Set<string>([committedReceiptId]);
  for (const receipt of newestFirstRows) {
    if (retained.size >= MAX_CHEST_TRANSFER_RECEIPTS_PER_USER) break;
    retained.add(receipt.id);
  }
  return newestFirstRows
    .filter((receipt) => !retained.has(receipt.id))
    .slice(0, CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT)
    .map((receipt) => receipt.id);
}
