export const SINGLEPLAYER_AUTOSAVE_ACTIVE_MS = 5 * 60 * 1_000;
export const SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS = 5_000;

/**
 * Pure active-play accounting for the browser-local world saver. Wall-clock
 * gaps are counted only when the preceding sample declared gameplay active;
 * pause/background/menu time therefore cannot trigger an autosave.
 */
export interface SaveCadenceState {
  activePlayMsSinceSave: number;
  dirtyRevision: number;
  savedRevision: number;
  sampledAt: number | null;
  wasActive: boolean;
}

export interface SaveCadenceSample {
  state: SaveCadenceState;
  autosaveDue: boolean;
}

export function createSaveCadenceState(now: number | null = null): SaveCadenceState {
  return {
    activePlayMsSinceSave: 0,
    dirtyRevision: 0,
    savedRevision: 0,
    sampledAt: Number.isFinite(now) ? Number(now) : null,
    wasActive: false,
  };
}

export function markSaveCadenceDirty(state: Readonly<SaveCadenceState>): SaveCadenceState {
  return {
    ...state,
    dirtyRevision: state.dirtyRevision >= Number.MAX_SAFE_INTEGER ? 1 : state.dirtyRevision + 1,
    // Wrapping the dirty revision must never accidentally resemble a saved
    // revision from the previous epoch.
    savedRevision: state.dirtyRevision >= Number.MAX_SAFE_INTEGER ? 0 : state.savedRevision,
  };
}

export function sampleSaveCadence(
  state: Readonly<SaveCadenceState>,
  now: number,
  active: boolean,
): SaveCadenceSample {
  const safeNow = Number.isFinite(now) ? now : state.sampledAt ?? 0;
  const elapsed = state.sampledAt === null || !state.wasActive
    ? 0
    : Math.floor(Math.min(SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS, Math.max(0, safeNow - state.sampledAt)));
  const activePlayMsSinceSave = Math.min(
    Number.MAX_SAFE_INTEGER,
    state.activePlayMsSinceSave + elapsed,
  );
  const next: SaveCadenceState = {
    ...state,
    activePlayMsSinceSave,
    sampledAt: safeNow,
    wasActive: active,
  };
  return {
    state: next,
    autosaveDue: activePlayMsSinceSave >= SINGLEPLAYER_AUTOSAVE_ACTIVE_MS
      && next.dirtyRevision !== next.savedRevision,
  };
}

export function commitSaveCadence(
  state: Readonly<SaveCadenceState>,
  now: number,
  stillActive: boolean,
): SaveCadenceState {
  return {
    activePlayMsSinceSave: 0,
    dirtyRevision: state.dirtyRevision,
    savedRevision: state.dirtyRevision,
    sampledAt: Number.isFinite(now) ? now : state.sampledAt,
    wasActive: stillActive,
  };
}
