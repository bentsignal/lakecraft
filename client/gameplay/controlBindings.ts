export const GAMEPLAY_CONTROL_ACTIONS = [
  "moveForward", "moveBackward", "strafeLeft", "strafeRight", "jump", "sprint", "sneak",
  "inventory", "drop", "perspective", "screenshot", "debug", "toggleHud", "fullscreen", "openChat", "openCommand", "playerList",
  "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6", "hotbar7", "hotbar8", "hotbar9",
  "attack", "use",
] as const;

export type GameplayControlAction = (typeof GAMEPLAY_CONTROL_ACTIONS)[number];
export type GameplayControlBindings = Record<GameplayControlAction, string>;

export const DEFAULT_GAMEPLAY_CONTROL_BINDINGS: Readonly<GameplayControlBindings> = Object.freeze({
  moveForward: "KeyW", moveBackward: "KeyS", strafeLeft: "KeyA", strafeRight: "KeyD",
  jump: "Space", sprint: "ControlLeft", sneak: "ShiftLeft", inventory: "KeyE", drop: "KeyQ",
  perspective: "F5", screenshot: "F2", debug: "F3", toggleHud: "F1", fullscreen: "F11", openChat: "KeyT", openCommand: "Slash", playerList: "Tab",
  hotbar1: "Digit1", hotbar2: "Digit2", hotbar3: "Digit3", hotbar4: "Digit4", hotbar5: "Digit5",
  hotbar6: "Digit6", hotbar7: "Digit7", hotbar8: "Digit8", hotbar9: "Digit9", attack: "Mouse0", use: "Mouse2",
});

export const GAMEPLAY_CONTROL_LABELS: Readonly<Record<GameplayControlAction, string>> = Object.freeze({
  moveForward: "Walk Forward", moveBackward: "Walk Backward", strafeLeft: "Strafe Left", strafeRight: "Strafe Right",
  jump: "Jump / Fly Up", sprint: "Sprint", sneak: "Sneak / Fly Down", inventory: "Inventory", drop: "Drop Item",
  perspective: "Toggle Perspective", screenshot: "Take Screenshot", debug: "Debug Overlay", toggleHud: "Toggle HUD", fullscreen: "Toggle Fullscreen",
  openChat: "Open Chat", openCommand: "Open Command", playerList: "List Players", hotbar1: "Hotbar Slot 1", hotbar2: "Hotbar Slot 2",
  hotbar3: "Hotbar Slot 3", hotbar4: "Hotbar Slot 4", hotbar5: "Hotbar Slot 5", hotbar6: "Hotbar Slot 6",
  hotbar7: "Hotbar Slot 7", hotbar8: "Hotbar Slot 8", hotbar9: "Hotbar Slot 9", attack: "Attack / Destroy", use: "Use / Place",
});

const CODE_PATTERN = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control|Alt)(?:Left|Right)|Space|Enter|Escape|Tab|Slash|Backquote|Backslash|Bracket(?:Left|Right)|Semicolon|Quote|Comma|Period|Minus|Equal|Backspace|Delete|Home|End|Page(?:Up|Down)|Insert|Mouse[0-4])$/;
const allowedBinding = (action: GameplayControlAction, code: string): boolean =>
  CODE_PATTERN.test(code) && (!code.startsWith("Mouse") || action === "attack" || action === "use");

export function normalizeGameplayControlBindings(value: unknown): GameplayControlBindings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_GAMEPLAY_CONTROL_BINDINGS };
  for (const action of GAMEPLAY_CONTROL_ACTIONS) {
    const binding = source[action];
    if (typeof binding === "string" && allowedBinding(action, binding)) result[action] = binding;
  }
  return result;
}

export function gameplayControlActionForCode(
  bindings: Readonly<GameplayControlBindings>,
  code: string,
): GameplayControlAction | null {
  for (const action of GAMEPLAY_CONTROL_ACTIONS) if (bindings[action] === code) return action;
  return null;
}

export function gameplayControlConflicts(bindings: Readonly<GameplayControlBindings>): ReadonlySet<GameplayControlAction> {
  const owners = new Map<string, GameplayControlAction>();
  const conflicts = new Set<GameplayControlAction>();
  for (const action of GAMEPLAY_CONTROL_ACTIONS) {
    const previous = owners.get(bindings[action]);
    if (previous) { conflicts.add(previous); conflicts.add(action); }
    else owners.set(bindings[action], action);
  }
  return conflicts;
}

/** Assigns one input and swaps its previous owner, so gameplay never has an ambiguous active binding. */
export function assignGameplayControlBinding(
  bindings: Readonly<GameplayControlBindings>,
  action: GameplayControlAction,
  code: string,
): GameplayControlBindings {
  if (!allowedBinding(action, code)) return { ...bindings };
  const next = { ...bindings };
  const previousCode = next[action];
  const previousOwner = GAMEPLAY_CONTROL_ACTIONS.find((candidate) => candidate !== action && next[candidate] === code);
  next[action] = code;
  if (previousOwner) next[previousOwner] = previousCode;
  return next;
}

export function gameplayControlCodeLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Mouse")) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code.replace(/Left$/, " Left").replace(/Right$/, " Right");
}

export function hotbarActionIndex(action: GameplayControlAction | null): number | null {
  if (!action?.startsWith("hotbar")) return null;
  const index = Number(action.slice(6)) - 1;
  return index >= 0 && index < 9 ? index : null;
}
