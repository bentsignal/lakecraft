const IDENTIFIER = "__lakecraftSharedBundleStrings";

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isModuleSpecifier(source, offset) {
  return /(?:\bfrom|\bimport)\s*(?:\(\s*)?$/.test(source.slice(Math.max(0, offset - 24), offset));
}

/**
 * Hoists an explicit allowlist of repeated string values after bundling.
 * Property keys and module specifiers are deliberately ineligible, keeping the
 * transform semantic instead of treating JavaScript as arbitrary text.
 */
export function hoistRepeatedBundleStrings(source, candidates) {
  if (source.includes(IDENTIFIER)) throw new Error("Reserved bundle string identifier already exists.");
  let output = source;
  const chosen = [];
  for (const candidate of [...new Set(candidates)]) {
    if (typeof candidate !== "string" || candidate.length < 8 || /["\\\n\r]/.test(candidate)) continue;
    const literal = JSON.stringify(candidate);
    const pattern = new RegExp(`${escapedPattern(literal)}(?!\\s*:)`, "g");
    const matches = [...output.matchAll(pattern)].filter((match) => !isModuleSpecifier(output, match.index)).length;
    const reference = `${IDENTIFIER}[${chosen.length}]`;
    if (matches < 3 || matches * (literal.length - 4) <= literal.length + 4) continue;
    output = output.replace(pattern, (match, offset) => isModuleSpecifier(output, offset) ? match : reference);
    chosen.push(candidate);
  }
  return chosen.length
    ? `const ${IDENTIFIER}=${JSON.stringify(chosen)};${output}`
    : source;
}

export const CLIENT_BUNDLE_SHARED_STRINGS = Object.freeze([
  "crafting_table", "invalid_snapshot", "invalid_coordinate", "stone_bricks",
  "stone_brick_slab", "cobblestone", "invalid_inventory", "inventory_action_pending",
  "invalid_slot", "no_capacity", "oak_fence_gate", "invalid_state", "iron_ingot",
  "flint_and_steel", "invalid_action", "diamond_ore", "gunpowder", "empty_source",
  "storage_read_failed", "incompatible_stack", "visibilitychange", "aria-labelledby",
  "aria-hidden", "aria-label", "aria-modal", "aria-live",
  "durability", "oak_fence_gate_open", "gold_ingot", "oak_fence_gate_closed",
  "cooked_chicken", "selectedHotbar", "iron_ore", "gold_ore", "coal_ore",
  "oak_fence", "inventory", "previousX", "previousY", "previousZ", "door_open",
  "raw_iron", "raw_gold", "door_closed",
]);

export const SERVER_BUNDLE_SHARED_STRINGS = Object.freeze([
  "operation_id_reused", "authentication_required", "active_presence_required",
  "conservation_failure", "invalid_request", "duplicate_state", "inventory_required",
  "invalid_server_state", "invalid_world_state", "invalid_receipt", "invalid_operation_id",
  "authority_unavailable", "invalid_chunk_keys", "combat_revision_exhausted",
  "invalid_player_state", "inventory_invalid", "replay_state_unavailable",
  "invalid_growth_plan", "invalid_checkpoint", "invalid_coordinate", "invalid_shape",
  "stone_brick_slab", "oak_fence_gate_closed", "oak_fence_gate_open", "oak_fence_gate",
  "crafting_table", "cobblestone", "stone_bricks",
  "receiptCreatedAt", "operationId", "by_user_created", "expectedRevision",
  "expectedInventoryUpdatedAt", "door_open", "selectedHotbar", "by_user_operation",
  "playerStateJson", "diamond_ore", "coordKey", "expiresAt", "iron_ingot",
  "gold_ingot", "coal_ore", "iron_ore", "gold_ore", "cooked_chicken",
  "sourceSlot", "out_of_reach",
]);
