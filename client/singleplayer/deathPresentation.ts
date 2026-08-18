import type { PlayerDamageCause } from "../game/types.ts";

export type SinglePlayerDeathCause = PlayerDamageCause | "starvation" | "unknown";

export function singlePlayerStartsDead(playerHealth: number | null | undefined): boolean {
  return playerHealth === 0;
}

export function singlePlayerDeathMessage(cause: SinglePlayerDeathCause): string {
  switch (cause) {
    case "mob": return "Slain by a hostile mob";
    case "creeper": return "Blown up by a Creeper";
    case "tnt": return "Blown up by TNT";
    case "fall": return "Hit the ground too hard";
    case "drowning": return "Drowned";
    case "lava": return "Tried to swim in lava";
    case "starvation": return "Starved to death";
    default: return "You died";
  }
}
