import {
  INVENTORY_SIZE,
  ITEMS,
  MAX_HEALTH,
  MAX_HUNGER,
  addItem,
  type Equipment,
  type Inventory,
  type ItemId,
} from "../../shared/game.ts";

export type LocalGameMode = "survival" | "creative";

export interface LocalCommandPermissions {
  changeGameMode: boolean;
  giveItems: boolean;
}

export const SINGLE_PLAYER_COMMAND_PERMISSIONS: LocalCommandPermissions = Object.freeze({
  changeGameMode: true,
  giveItems: true,
});

export const MAX_LOCAL_GIVE_COUNT = INVENTORY_SIZE * 64;
export const LOCAL_COMMAND_HELP = [
  "/help",
  "/gamemode <survival|creative>",
  "/give <item> [count]",
] as const;

export type ParsedLocalCommand =
  | { kind: "help" }
  | { kind: "gamemode"; mode: LocalGameMode }
  | { kind: "give"; itemId: ItemId; count: number };

export type LocalCommandParseResult =
  | { ok: true; command: ParsedLocalCommand }
  | { ok: false; code: "missing_slash" | "unknown_command" | "usage" | "unknown_item" | "invalid_count" | "permission"; message: string };

const ITEM_IDS = Object.keys(ITEMS).sort() as ItemId[];

export function canonicalLocalItemIds(): readonly ItemId[] {
  return ITEM_IDS;
}

export function parseLocalCommand(
  input: string,
  permissions: LocalCommandPermissions = SINGLE_PLAYER_COMMAND_PERMISSIONS,
): LocalCommandParseResult {
  const source = input.trim();
  if (!source.startsWith("/")) {
    return { ok: false, code: "missing_slash", message: "Commands must start with /. Try /help." };
  }
  const tokens = source.slice(1).trim().split(/\s+/).filter(Boolean);
  const name = tokens.shift()?.toLowerCase() ?? "";
  if (name === "help") {
    return tokens.length === 0
      ? { ok: true, command: { kind: "help" } }
      : { ok: false, code: "usage", message: "Usage: /help" };
  }
  if (name === "gamemode") {
    if (!permissions.changeGameMode) {
      return { ok: false, code: "permission", message: "You do not have permission to change game mode." };
    }
    if (tokens.length !== 1 || (tokens[0] !== "survival" && tokens[0] !== "creative")) {
      return { ok: false, code: "usage", message: "Usage: /gamemode <survival|creative>" };
    }
    return { ok: true, command: { kind: "gamemode", mode: tokens[0] } };
  }
  if (name === "give") {
    if (!permissions.giveItems) {
      return { ok: false, code: "permission", message: "You do not have permission to give items." };
    }
    if (tokens.length < 1 || tokens.length > 2) {
      return { ok: false, code: "usage", message: "Usage: /give <item> [count]" };
    }
    const itemId = tokens[0] as ItemId;
    if (!Object.prototype.hasOwnProperty.call(ITEMS, itemId)) {
      return { ok: false, code: "unknown_item", message: `Unknown item "${tokens[0]}". Use /help for command syntax.` };
    }
    const countSource = tokens[1] ?? "1";
    if (!/^[1-9]\d*$/.test(countSource)) {
      return { ok: false, code: "invalid_count", message: `Count must be a whole number from 1 to ${MAX_LOCAL_GIVE_COUNT}.` };
    }
    const count = Number(countSource);
    if (!Number.isSafeInteger(count) || count > MAX_LOCAL_GIVE_COUNT) {
      return { ok: false, code: "invalid_count", message: `Count must be a whole number from 1 to ${MAX_LOCAL_GIVE_COUNT}.` };
    }
    return { ok: true, command: { kind: "give", itemId, count } };
  }
  return {
    ok: false,
    code: "unknown_command",
    message: name ? `Unknown command "/${name}". Try /help.` : "Enter a command. Try /help.",
  };
}

function cloneInventory(inventory: Inventory): Inventory {
  return inventory.map((stack) => stack ? { ...stack } : null);
}

export type LocalGiveResult =
  | { ok: true; inventory: Inventory; itemId: ItemId; count: number }
  | { ok: false; inventory: Inventory; message: string };

/** Atomic grant: a command never leaves a partial stack behind when capacity is insufficient. */
export function giveLocalItem(inventory: Inventory, itemId: ItemId, count: number): LocalGiveResult {
  const original = cloneInventory(inventory);
  const added = addItem(original, itemId, count);
  if (added.remainder !== 0) {
    return {
      ok: false,
      inventory: cloneInventory(inventory),
      message: `Not enough inventory space for ${count} ${ITEMS[itemId].label}. Nothing was added.`,
    };
  }
  return { ok: true, inventory: added.inventory, itemId, count };
}

export interface LocalModeState {
  mode: LocalGameMode;
  health: number;
  hunger: number;
  inventory: Inventory;
  equipment: Equipment;
}

/** Mode changes preserve every item and only normalize the survival vitals owned by game mode. */
export function transitionLocalGameMode(
  current: LocalModeState,
  mode: LocalGameMode,
): LocalModeState {
  return {
    mode,
    health: mode === "creative" ? MAX_HEALTH : Math.max(1, Math.min(MAX_HEALTH, current.health)),
    hunger: mode === "creative" ? MAX_HUNGER : Math.max(0, Math.min(MAX_HUNGER, current.hunger)),
    inventory: cloneInventory(current.inventory),
    equipment: {
      head: current.equipment.head ? { ...current.equipment.head } : null,
      chest: current.equipment.chest ? { ...current.equipment.chest } : null,
      legs: current.equipment.legs ? { ...current.equipment.legs } : null,
      feet: current.equipment.feet ? { ...current.equipment.feet } : null,
    },
  };
}
