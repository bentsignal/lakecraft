import { HOTBAR_SIZE } from "../../shared/game.ts";

/** Maps the physical top-row number keys to Minecraft's zero-based hotbar. */
export function hotbarIndexForDigitCode(code: string): number | null {
  const match = /^Digit([1-9])$/.exec(code);
  return match ? Number(match[1]) - 1 : null;
}

/** Normalizes arbitrary wheel hardware into one intentional slot step. */
export function hotbarWheelDirection(deltaY: number): -1 | 0 | 1 {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY > 0 ? 1 : -1;
}

/** Wraps slot cycling in both directions without allowing invalid indices. */
export function cycleHotbarIndex(current: number, direction: -1 | 1): number {
  const selected = Number.isInteger(current) && current >= 0 && current < HOTBAR_SIZE ? current : 0;
  return (selected + direction + HOTBAR_SIZE) % HOTBAR_SIZE;
}
