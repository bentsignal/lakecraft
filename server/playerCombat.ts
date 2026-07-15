import { validatePlayerStateJson, type PersistedInventoryState } from "../shared/chestTransfers.ts";
import type { PlayerAttackResolution } from "../shared/playerCombat.ts";

export type PlayerCombatReceiptResult = Extract<PlayerAttackResolution, { ok: true }> & {
  replayed: boolean;
  serverNow: number;
  attackerInventory: PersistedInventoryState;
  attackerInventoryRevision: string;
  weaponDamaged: boolean;
  weaponBroken: boolean;
  targetInventoryRevision: string;
};

export function encodePlayerCombatReceipt(result: PlayerCombatReceiptResult): string {
  return JSON.stringify(result);
}

/** Receipts are server-authored, but corrupt rows must never be replayed. */
export function decodePlayerCombatReceipt(rawJson: string): PlayerCombatReceiptResult | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const attackerInventory = parsed.attackerInventory as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || parsed.ok !== true
      || typeof parsed.serverNow !== "number" || !Number.isFinite(parsed.serverNow)
      || typeof parsed.damage !== "number" || !Number.isInteger(parsed.damage)
      || !attackerInventory || typeof attackerInventory !== "object" || Array.isArray(attackerInventory)
      || typeof attackerInventory.id !== "string" || typeof attackerInventory.userId !== "string"
      || typeof attackerInventory.inventoryJson !== "string"
      || typeof attackerInventory.createdAt !== "string" || typeof attackerInventory.updatedAt !== "string"
      || typeof attackerInventory.revision !== "string" || !/^\d+$/.test(attackerInventory.revision)
      || !validatePlayerStateJson(attackerInventory.inventoryJson).ok
      || typeof parsed.attackerInventoryRevision !== "string" || !/^\d+$/.test(parsed.attackerInventoryRevision)
      || parsed.attackerInventoryRevision !== attackerInventory.revision
      || typeof parsed.weaponDamaged !== "boolean" || typeof parsed.weaponBroken !== "boolean"
      || (parsed.weaponBroken === true && parsed.weaponDamaged !== true)
      || typeof parsed.targetInventoryRevision !== "string" || !/^\d+$/.test(parsed.targetInventoryRevision)
      || !Array.isArray(parsed.armorDamaged) || !Array.isArray(parsed.brokenArmor)
      || !parsed.targetEquipment || typeof parsed.targetEquipment !== "object"
      || !parsed.attackerState || typeof parsed.attackerState !== "object"
      || !parsed.targetState || typeof parsed.targetState !== "object") return null;
    return { ...(parsed as PlayerCombatReceiptResult), replayed: true };
  } catch {
    return null;
  }
}
