/** Keyboard-layout-safe chat shortcut shared by solo commands and multiplayer. */
export function gameplayChatShortcutDraft(
  input: Readonly<Pick<KeyboardEvent, "code" | "key" | "repeat">>,
): "" | "/" | null {
  if (input.repeat) return null;
  if (input.code === "Slash" || input.key === "/" || input.key === "?") return "/";
  if (input.code === "KeyT" || input.code === "Enter") return "";
  return null;
}
