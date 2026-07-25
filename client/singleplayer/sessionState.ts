export const SINGLE_PLAYER_INITIAL_PAUSE_OPEN = false;

export interface SinglePlayerPauseState {
  pauseOpen: boolean;
  inventoryOpen: boolean;
  worldModalOpen: boolean;
  deathScreenOpen: boolean;
  documentVisible: boolean;
}

/** One pause predicate used before engine startup and for every later UI/visibility transition. */
export function singlePlayerGameplayPaused(state: Readonly<SinglePlayerPauseState>): boolean {
  return state.pauseOpen
    || state.inventoryOpen
    || state.worldModalOpen
    || state.deathScreenOpen
    || !state.documentVisible;
}
