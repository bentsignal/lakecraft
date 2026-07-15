import type { PlayerAttackResolution } from "../shared/playerCombat.ts";

export type PlayerCombatReceiptResult = Extract<PlayerAttackResolution, { ok: true }> & {
  replayed: boolean;
  serverNow: number;
};

export function encodePlayerCombatReceipt(result: PlayerCombatReceiptResult): string {
  return JSON.stringify(result);
}

/** Receipts are server-authored, but corrupt legacy rows must never be replayed. */
export function decodePlayerCombatReceipt(rawJson: string): PlayerCombatReceiptResult | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || parsed.ok !== true
      || typeof parsed.serverNow !== "number" || !Number.isFinite(parsed.serverNow)
      || typeof parsed.damage !== "number" || !Number.isInteger(parsed.damage)
      || !parsed.attackerState || typeof parsed.attackerState !== "object"
      || !parsed.targetState || typeof parsed.targetState !== "object") return null;
    return { ...(parsed as PlayerCombatReceiptResult), replayed: true };
  } catch {
    return null;
  }
}

