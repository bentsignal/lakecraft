export const SINGLE_PLAYER_INITIAL_PAUSE_OPEN = false;
export const POINTER_LOCK_ESCAPE_DEDUP_MS = 160;
export const COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS = 500;

export interface SinglePlayerPauseState {
  pauseOpen: boolean;
  inventoryOpen: boolean;
  worldModalOpen: boolean;
  deathScreenOpen: boolean;
  pointerCaptureNeeded: boolean;
  documentVisible: boolean;
}

/** One pause predicate used before engine startup and for every later UI/visibility transition. */
export function singlePlayerGameplayPaused(state: Readonly<SinglePlayerPauseState>): boolean {
  return state.pauseOpen
    || state.inventoryOpen
    || state.worldModalOpen
    || state.deathScreenOpen
    || state.pointerCaptureNeeded
    || !state.documentVisible;
}

export interface SinglePlayerPointerSessionState {
  locked: boolean;
  pauseOpen: boolean;
  intentionalReleasePending: boolean;
  ignoreEscapeUntil: number;
}

export type SinglePlayerPointerSessionEvent =
  | { type: "escape"; now: number; repeat?: boolean; uiBlocked: boolean }
  | { type: "close_ui_escape"; now: number }
  | { type: "intentional_release" }
  | { type: "lock_change"; locked: boolean; now: number; uiBlocked: boolean }
  | { type: "resume" }
  | { type: "set_pause"; open: boolean };

/** Escape cannot activate Pointer Lock in Chrome; these keys can silently recapture and still play. */
export function singlePlayerSilentRecaptureKey(code: string, repeat = false): boolean {
  return !repeat && [
    "KeyW", "KeyA", "KeyS", "KeyD", "Space",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  ].includes(code);
}

export interface SinglePlayerPointerSessionTransition {
  state: SinglePlayerPointerSessionState;
  openPause: boolean;
  closePause: boolean;
  requestPointerLock: boolean;
  showCaptureAffordance: boolean;
}

export function createSinglePlayerPointerSessionState(
  locked = false,
  pauseOpen = SINGLE_PLAYER_INITIAL_PAUSE_OPEN,
): SinglePlayerPointerSessionState {
  return {
    locked,
    pauseOpen,
    intentionalReleasePending: false,
    ignoreEscapeUntil: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Coordinates the two browser signals produced by Escape. Chromium commonly
 * reports keydown before pointerlockchange, while Firefox can report the lock
 * loss first. Both orderings must produce one pause transition. Escape from a
 * focused gameplay layer is different: Chrome explicitly excludes Escape from
 * user activation, so it cannot re-enter Pointer Lock. The layer closes into a
 * live silent-recapture state and the next eligible gameplay activation grants
 * capture while still performing its movement or canvas action. The bounded
 * suppression token absorbs either lock-change ordering without suppressing the
 * next ordinary gameplay Escape.
 */
export function transitionSinglePlayerPointerSession(
  current: Readonly<SinglePlayerPointerSessionState>,
  event: Readonly<SinglePlayerPointerSessionEvent>,
): SinglePlayerPointerSessionTransition {
  const unchanged = (state: SinglePlayerPointerSessionState = { ...current }): SinglePlayerPointerSessionTransition => ({
    state,
    openPause: false,
    closePause: false,
    requestPointerLock: false,
    showCaptureAffordance: false,
  });

  if (event.type === "intentional_release") {
    return unchanged({
      ...current,
      intentionalReleasePending: current.locked,
      ignoreEscapeUntil: Number.NEGATIVE_INFINITY,
    });
  }

  if (event.type === "close_ui_escape") {
    return unchanged({
      ...current,
      pauseOpen: false,
      intentionalReleasePending: true,
      ignoreEscapeUntil: event.now + COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS,
    });
  }

  if (event.type === "set_pause") {
    return unchanged({
      ...current,
      pauseOpen: event.open,
      ignoreEscapeUntil: event.open ? current.ignoreEscapeUntil : Number.NEGATIVE_INFINITY,
    });
  }

  if (event.type === "resume") {
    return {
      ...unchanged({
        ...current,
        pauseOpen: false,
        intentionalReleasePending: false,
        ignoreEscapeUntil: Number.NEGATIVE_INFINITY,
      }),
      closePause: current.pauseOpen,
      requestPointerLock: true,
    };
  }

  if (event.type === "escape") {
    if (event.repeat || event.uiBlocked) return unchanged();
    if (current.pauseOpen) {
      if (event.now <= current.ignoreEscapeUntil) return unchanged();
      return {
        ...unchanged({
          ...current,
          pauseOpen: false,
          intentionalReleasePending: false,
          ignoreEscapeUntil: Number.NEGATIVE_INFINITY,
        }),
        closePause: true,
        requestPointerLock: true,
      };
    }
    return {
      ...unchanged({
        ...current,
        pauseOpen: true,
        intentionalReleasePending: current.locked,
        ignoreEscapeUntil: Number.NEGATIVE_INFINITY,
      }),
      openPause: true,
    };
  }

  if (event.locked) {
    const commandEscapePending = current.intentionalReleasePending
      && event.now <= current.ignoreEscapeUntil;
    return unchanged({
      ...current,
      locked: true,
      intentionalReleasePending: commandEscapePending,
      ignoreEscapeUntil: commandEscapePending ? current.ignoreEscapeUntil : Number.NEGATIVE_INFINITY,
    });
  }

  const wasLocked = current.locked;
  const expiringCommandEscape = Number.isFinite(current.ignoreEscapeUntil);
  const intentional = current.intentionalReleasePending
    && (!expiringCommandEscape || event.now <= current.ignoreEscapeUntil);
  const next = {
    ...current,
    locked: false,
    intentionalReleasePending: false,
  };
  if (!wasLocked) {
    return {
      ...unchanged(next),
      showCaptureAffordance: !event.uiBlocked && !current.pauseOpen,
    };
  }
  if (intentional || event.uiBlocked || current.pauseOpen) return unchanged(next);
  return {
    ...unchanged({
      ...next,
      pauseOpen: true,
      ignoreEscapeUntil: event.now + POINTER_LOCK_ESCAPE_DEDUP_MS,
    }),
    openPause: true,
  };
}
