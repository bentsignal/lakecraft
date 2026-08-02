export interface MultiplayerGameplayBlockers {
  foreground: boolean;
  mobileUnsupported: boolean;
  death: boolean;
  pause: boolean;
  inventory: boolean;
  chat: boolean;
  furnace: boolean;
  chest: boolean;
  bed: boolean;
}

export interface AuthoritativeKnockbackGate {
  paused: boolean;
  pauseEpoch: number;
}

export function multiplayerGameplayPaused(state: Readonly<MultiplayerGameplayBlockers>): boolean {
  return !state.foreground || state.mobileUnsupported || state.death || state.pause || state.inventory
    || state.chat || state.furnace || state.chest || state.bed;
}

/** Every transition into blocking UI permanently invalidates outstanding damage promises. */
export function updateAuthoritativeKnockbackGate(gate: AuthoritativeKnockbackGate, paused: boolean): void {
  if (paused && !gate.paused) gate.pauseEpoch += 1;
  gate.paused = paused;
}

export function canApplyAuthoritativeKnockback(
  gate: Readonly<AuthoritativeKnockbackGate>,
  requestPauseEpoch: number,
  pointerLocked: boolean,
): boolean {
  return !gate.paused && gate.pauseEpoch === requestPauseEpoch && pointerLocked;
}
