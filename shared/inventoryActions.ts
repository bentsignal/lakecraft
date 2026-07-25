import {
  HOTBAR_SIZE,
  ITEMS,
  MAX_HUNGER,
  RECIPES,
  consumeFood,
  craftRecipe,
  createItemStack,
  type ArmorStack,
  type CraftingContext,
  type ItemId,
  type ItemStack,
} from "./game.ts";
import {
  PLAYER_STATE_VERSION,
  validatePlayerStateJson,
  type CanonicalPlayerState,
  type PersistedInventoryState,
  type PlayerStateValidationIssue,
} from "./chestTransfers.ts";

export const MAX_INVENTORY_ACTION_REQUEST_BYTES = 8_191;
export const MAX_INVENTORY_ACTION_RECIPE_BATCHES = 32;
export const MAX_INVENTORY_ACTION_CRAFTS = 64;
export const MAX_INVENTORY_ACTION_RECEIPTS_PER_USER = 64;
export const INVENTORY_ACTION_RECEIPT_PRUNE_LIMIT = 8;
export const INVENTORY_ACTION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;

export type InventoryRecipeBatch = { recipeId: string; crafts: number };

type InventoryActionBase = {
  operationId: string;
  expectedRevision: string;
};

export type InventoryAction =
  | { kind: "initialize" }
  | { kind: "select_hotbar"; selectedHotbar: number }
  | { kind: "eat"; sourceSlot: number; expectedItemId: ItemId }
  | {
      kind: "workspace_commit";
      playerState: CanonicalPlayerState;
      playerStateJson: string;
      recipes: InventoryRecipeBatch[];
      craftingContext: CraftingContext;
      workstationCoordKey: string;
    };

export type ValidatedInventoryActionRequest = InventoryActionBase & {
  action: InventoryAction;
  fingerprint: string;
};

export type InventoryActionRequestIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_operation_id"
  | "invalid_revision"
  | "invalid_action"
  | "invalid_player_state"
  | "invalid_recipe_batches"
  | "invalid_coordinate";

export type InventoryActionRequestValidation =
  | { ok: true; request: ValidatedInventoryActionRequest }
  | { ok: false; reason: InventoryActionRequestIssue; playerStateIssue?: PlayerStateValidationIssue };

export type InventoryActionApplyFailure =
  | "initialization_required"
  | "already_initialized"
  | "invalid_transition"
  | "unknown_recipe"
  | "requires_crafting_table"
  | "missing_ingredients"
  | "inventory_full"
  | "invalid_slot"
  | "empty_slot"
  | "not_food"
  | "hunger_full"
  | "item_mismatch";

export type InventoryActionApplyResult =
  | {
      ok: true;
      state: CanonicalPlayerState;
      playerStateJson: string;
      effect: "initialized" | "workspace_committed" | "ate" | "selected_hotbar";
      consumed?: ItemId;
      restored?: number;
      crafted?: Array<{ itemId: ItemId; count: number }>;
    }
  | { ok: false; reason: InventoryActionApplyFailure };

export type InventoryActionMutationResult =
  | {
      ok: true;
      replayed: boolean;
      effect: "initialized" | "workspace_committed" | "ate" | "selected_hotbar";
      inventory: PersistedInventoryState;
      consumed?: ItemId;
      restored?: number;
      crafted?: Array<{ itemId: ItemId; count: number }>;
    }
  | {
      ok: false;
      reason:
        | "authentication_required"
        | "invalid_request"
        | "operation_id_reused"
        | "conflict"
        | "inventory_required"
        | "duplicate_state"
        | "invalid_state"
        | "out_of_reach"
        | "crafting_table_required"
        | InventoryActionApplyFailure;
      detail?: InventoryActionRequestIssue | PlayerStateValidationIssue;
      inventory?: PersistedInventoryState | null;
    };

const OPERATION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const REVISION = /^(?:0|[1-9]\d{0,15})$/;
const COORDINATE = /^-?\d{1,7}:-?\d{1,4}:-?\d{1,7}$/;

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function canonicalFingerprint(
  operationId: string,
  expectedRevision: string,
  action: InventoryAction,
): string {
  const canonicalAction = action.kind === "workspace_commit"
    ? {
        kind: action.kind,
        playerStateJson: action.playerStateJson,
        recipes: action.recipes,
        craftingContext: action.craftingContext,
        workstationCoordKey: action.workstationCoordKey,
      }
    : action;
  return JSON.stringify([1, operationId, expectedRevision, canonicalAction]);
}

export function validateInventoryActionRequestJson(rawJson: string): InventoryActionRequestValidation {
  if (typeof rawJson !== "string" || rawJson.length > MAX_INVENTORY_ACTION_REQUEST_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid_shape" };
  const record = parsed as Record<string, unknown>;
  if (typeof record.operationId !== "string" || !OPERATION_ID.test(record.operationId)) {
    return { ok: false, reason: "invalid_operation_id" };
  }
  if (typeof record.expectedRevision !== "string" || !REVISION.test(record.expectedRevision)) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (typeof record.kind !== "string") return { ok: false, reason: "invalid_action" };
  let action: InventoryAction;
  if (record.kind === "initialize") {
    if (!hasOnlyKeys(record, ["operationId", "expectedRevision", "kind"], ["operationId", "expectedRevision", "kind"])) {
      return { ok: false, reason: "invalid_shape" };
    }
    action = { kind: "initialize" };
  } else if (record.kind === "select_hotbar") {
    if (!hasOnlyKeys(record, ["operationId", "expectedRevision", "kind", "selectedHotbar"], ["operationId", "expectedRevision", "kind", "selectedHotbar"])
      || typeof record.selectedHotbar !== "number" || !Number.isInteger(record.selectedHotbar)
      || record.selectedHotbar < 0 || record.selectedHotbar >= HOTBAR_SIZE) {
      return { ok: false, reason: "invalid_action" };
    }
    action = { kind: "select_hotbar", selectedHotbar: record.selectedHotbar };
  } else if (record.kind === "eat") {
    if (!hasOnlyKeys(record, ["operationId", "expectedRevision", "kind", "sourceSlot", "expectedItemId"], ["operationId", "expectedRevision", "kind", "sourceSlot", "expectedItemId"])
      || typeof record.sourceSlot !== "number" || !Number.isInteger(record.sourceSlot)
      || record.sourceSlot < 0 || record.sourceSlot >= 36
      || typeof record.expectedItemId !== "string"
      || !Object.prototype.hasOwnProperty.call(ITEMS, record.expectedItemId)) {
      return { ok: false, reason: "invalid_action" };
    }
    action = { kind: "eat", sourceSlot: record.sourceSlot, expectedItemId: record.expectedItemId as ItemId };
  } else if (record.kind === "workspace_commit") {
    if (!hasOnlyKeys(
      record,
      ["operationId", "expectedRevision", "kind", "playerStateJson", "recipes", "craftingContext", "workstationCoordKey"],
      ["operationId", "expectedRevision", "kind", "playerStateJson", "recipes", "craftingContext", "workstationCoordKey"],
    ) || typeof record.playerStateJson !== "string") return { ok: false, reason: "invalid_shape" };
    const state = validatePlayerStateJson(record.playerStateJson);
    if (!state.ok) return { ok: false, reason: "invalid_player_state", playerStateIssue: state.reason };
    // This pre-launch capsule accepts only its one current canonical envelope.
    if (record.playerStateJson !== state.playerStateJson || state.state.version !== PLAYER_STATE_VERSION) {
      return { ok: false, reason: "invalid_player_state" };
    }
    if (!Array.isArray(record.recipes) || record.recipes.length > MAX_INVENTORY_ACTION_RECIPE_BATCHES) {
      return { ok: false, reason: "invalid_recipe_batches" };
    }
    let craftTotal = 0;
    const recipes: InventoryRecipeBatch[] = [];
    for (const value of record.recipes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_recipe_batches" };
      const batch = value as Record<string, unknown>;
      if (!hasOnlyKeys(batch, ["recipeId", "crafts"], ["recipeId", "crafts"])
        || typeof batch.recipeId !== "string" || batch.recipeId.length < 1 || batch.recipeId.length > 64
        || typeof batch.crafts !== "number" || !Number.isInteger(batch.crafts) || batch.crafts < 1) {
        return { ok: false, reason: "invalid_recipe_batches" };
      }
      craftTotal += batch.crafts;
      if (craftTotal > MAX_INVENTORY_ACTION_CRAFTS) return { ok: false, reason: "invalid_recipe_batches" };
      recipes.push({ recipeId: batch.recipeId, crafts: batch.crafts });
    }
    if (record.craftingContext !== "field" && record.craftingContext !== "crafting_table") {
      return { ok: false, reason: "invalid_action" };
    }
    if (typeof record.workstationCoordKey !== "string"
      || (record.craftingContext === "field"
        ? record.workstationCoordKey !== ""
        : !COORDINATE.test(record.workstationCoordKey))) {
      return { ok: false, reason: "invalid_coordinate" };
    }
    action = {
      kind: "workspace_commit",
      playerState: state.state,
      playerStateJson: state.playerStateJson,
      recipes,
      craftingContext: record.craftingContext,
      workstationCoordKey: record.workstationCoordKey,
    };
  } else {
    return { ok: false, reason: "invalid_action" };
  }
  return {
    ok: true,
    request: {
      operationId: record.operationId,
      expectedRevision: record.expectedRevision,
      action,
      fingerprint: canonicalFingerprint(record.operationId, record.expectedRevision, action),
    },
  };
}

function ledgerKey(stack: ItemStack | ArmorStack): string {
  return `${stack.itemId}:${stack.durability ?? ""}`;
}

export function inventoryActionLedger(state: CanonicalPlayerState): Map<string, number> {
  const ledger = new Map<string, number>();
  for (const stack of state.inventory) {
    if (stack) ledger.set(ledgerKey(stack), (ledger.get(ledgerKey(stack)) ?? 0) + stack.count);
  }
  for (const stack of Object.values(state.equipment) as Array<ArmorStack | null>) {
    if (stack) ledger.set(ledgerKey(stack), (ledger.get(ledgerKey(stack)) ?? 0) + 1);
  }
  return ledger;
}

function sameLedger(left: CanonicalPlayerState, right: CanonicalPlayerState): boolean {
  const a = inventoryActionLedger(left);
  const b = inventoryActionLedger(right);
  if (a.size !== b.size) return false;
  for (const [key, count] of a) if (b.get(key) !== count) return false;
  return true;
}

function sameRespawnPoint(left: CanonicalPlayerState, right: CanonicalPlayerState): boolean {
  return JSON.stringify(left.respawnPoint) === JSON.stringify(right.respawnPoint);
}

function canonicalStateJson(state: CanonicalPlayerState): string {
  return JSON.stringify(state);
}

export function applyInventoryAction(
  previous: CanonicalPlayerState | null,
  action: InventoryAction,
): InventoryActionApplyResult {
  if (!previous) return action.kind === "initialize"
    ? { ok: false, reason: "initialization_required" }
    : { ok: false, reason: "initialization_required" };
  if (action.kind === "initialize") return { ok: false, reason: "already_initialized" };
  if (action.kind === "select_hotbar") {
    const state = { ...previous, selectedHotbar: action.selectedHotbar };
    return { ok: true, state, playerStateJson: canonicalStateJson(state), effect: "selected_hotbar" };
  }
  if (action.kind === "eat") {
    const stack = previous.inventory[action.sourceSlot];
    if (stack?.itemId !== action.expectedItemId) return { ok: false, reason: "item_mismatch" };
    const result = consumeFood(previous.inventory, action.sourceSlot, previous.hunger);
    if (!result.ok) return { ok: false, reason: result.reason };
    const state = { ...previous, inventory: result.inventory, hunger: result.hunger };
    return {
      ok: true,
      state,
      playerStateJson: canonicalStateJson(state),
      effect: "ate",
      consumed: result.consumed,
      restored: result.restored,
    };
  }

  const desired = action.playerState;
  if (desired.hunger !== previous.hunger || desired.selectedHotbar !== previous.selectedHotbar
    || !sameRespawnPoint(desired, previous)) return { ok: false, reason: "invalid_transition" };
  let replayed: CanonicalPlayerState = previous;
  const crafted = new Map<ItemId, number>();
  for (const batch of action.recipes) {
    const recipe = RECIPES.find(({ id }) => id === batch.recipeId);
    if (!recipe) return { ok: false, reason: "unknown_recipe" };
    if (recipe.craftingContext === "crafting_table" && action.craftingContext !== "crafting_table") {
      return { ok: false, reason: "requires_crafting_table" };
    }
    for (let count = 0; count < batch.crafts; count += 1) {
      const result = craftRecipe(replayed.inventory, recipe, action.craftingContext);
      if (!result.ok) return { ok: false, reason: result.reason };
      replayed = { ...replayed, inventory: result.inventory };
      crafted.set(recipe.output.itemId, (crafted.get(recipe.output.itemId) ?? 0) + recipe.output.count);
    }
  }
  // The server replays economic deltas. The client may choose any final slot
  // layout or equip a crafted armor piece only when the exact durable ledger
  // is identical to that replayed result.
  if (!sameLedger(replayed, desired)) return { ok: false, reason: "invalid_transition" };
  return {
    ok: true,
    state: desired,
    playerStateJson: action.playerStateJson,
    effect: "workspace_committed",
    crafted: [...crafted].map(([itemId, count]) => ({ itemId, count })),
  };
}

export function createInitializedPlayerState(): CanonicalPlayerState {
  const validation = validatePlayerStateJson(JSON.stringify({
    version: PLAYER_STATE_VERSION,
    inventory: [
      createItemStack("wooden_pickaxe"),
      createItemStack("wooden_axe"),
      { itemId: "dirt", count: 16 },
      { itemId: "planks", count: 8 },
    ],
    selectedHotbar: 2,
    equipment: { head: null, chest: null, legs: null, feet: null },
    respawnPoint: null,
    hunger: MAX_HUNGER,
  }));
  if (!validation.ok) throw new Error("Unable to create the canonical starter inventory.");
  return validation.state;
}

export function decideInventoryActionReplay(
  storedFingerprint: string | null,
  requestFingerprint: string,
): "new" | "replay" | "operation_id_reused" {
  return storedFingerprint === null ? "new" : storedFingerprint === requestFingerprint ? "replay" : "operation_id_reused";
}

export type InventoryActionReceiptPayload = {
  effect: "initialized" | "workspace_committed" | "ate" | "selected_hotbar";
  consumed?: ItemId;
  restored?: number;
  crafted?: Array<{ itemId: ItemId; count: number }>;
};

export function encodeInventoryActionReceipt(payload: InventoryActionReceiptPayload): string {
  return JSON.stringify(payload);
}

export function decodeInventoryActionReceipt(rawJson: string): InventoryActionReceiptPayload | null {
  if (typeof rawJson !== "string" || rawJson.length > 4_096) return null;
  try {
    const value = JSON.parse(rawJson) as Record<string, unknown>;
    if (!value || !hasOnlyKeys(value, ["effect", "consumed", "restored", "crafted"], ["effect"])
      || !["initialized", "workspace_committed", "ate", "selected_hotbar"].includes(String(value.effect))) {
      return null;
    }
    if (value.consumed !== undefined && (typeof value.consumed !== "string"
      || !Object.prototype.hasOwnProperty.call(ITEMS, value.consumed))) return null;
    if (value.restored !== undefined && (!Number.isInteger(value.restored)
      || Number(value.restored) < 0 || Number(value.restored) > MAX_HUNGER)) return null;
    if (value.crafted !== undefined) {
      if (!Array.isArray(value.crafted) || value.crafted.length > MAX_INVENTORY_ACTION_RECIPE_BATCHES) return null;
      for (const item of value.crafted) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        if (!hasOnlyKeys(record, ["itemId", "count"], ["itemId", "count"])
          || typeof record.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, record.itemId)
          || !Number.isInteger(record.count) || Number(record.count) < 1 || Number(record.count) > 4_096) return null;
      }
    }
    return value as InventoryActionReceiptPayload;
  } catch {
    return null;
  }
}

export function selectInventoryActionReceiptOverflow(
  newestRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const kept = new Set<string>([committedReceiptId]);
  for (const row of newestRows) {
    if (kept.size >= MAX_INVENTORY_ACTION_RECEIPTS_PER_USER) break;
    kept.add(row.id);
  }
  return newestRows
    .filter((row) => !kept.has(row.id))
    .slice(0, INVENTORY_ACTION_RECEIPT_PRUNE_LIMIT)
    .map((row) => row.id);
}
