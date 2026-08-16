import {
  DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
  gameplayControlActionForCode,
  type GameplayControlBindings,
} from "./controlBindings.ts";

/** Keyboard-layout-safe chat shortcut shared by solo commands and multiplayer. */
export function gameplayChatShortcutDraft(
  input: Readonly<Pick<KeyboardEvent, "code" | "key" | "repeat">>,
  bindings: Readonly<GameplayControlBindings> = DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
): "" | "/" | null {
  if (input.repeat) return null;
  const action = gameplayControlActionForCode(bindings, input.code);
  if (action === "openCommand"
    || bindings.openCommand === "Slash" && (input.key === "/" || input.key === "?")) return "/";
  if (action === "openChat" || bindings.openChat === "KeyT" && input.code === "Enter") return "";
  return null;
}
