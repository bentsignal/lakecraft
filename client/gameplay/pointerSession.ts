export const GAMEPLAY_INITIAL_PAUSE_OPEN = false;
/** @deprecated Use GAMEPLAY_INITIAL_PAUSE_OPEN from the shared gameplay session. */
export const SINGLE_PLAYER_INITIAL_PAUSE_OPEN = GAMEPLAY_INITIAL_PAUSE_OPEN;
export const POINTER_LOCK_ESCAPE_DEDUP_MS = 160;
export const COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS = 500;

export interface SinglePlayerCommandSurfaceKeyEvent {
  code: string;
  repeat: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/**
 * Consumes Escape against the synchronously tracked command surface. The caller
 * owns the mutable open ref so this boundary remains correct before Preact has
 * committed the corresponding render state.
 */
export function consumeSinglePlayerCommandSurfaceEscape(
  open: boolean,
  event: SinglePlayerCommandSurfaceKeyEvent,
  close: () => void,
): boolean {
  if (!open || event.code !== "Escape") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) close();
  return true;
}

export interface SinglePlayerPauseState {
  pauseOpen: boolean;
  inventoryOpen: boolean;
  worldModalOpen: boolean;
  deathScreenOpen: boolean;
  documentVisible: boolean;
}

export interface GameplaySessionBlockers {
  foreground: boolean;
  pause: boolean;
  inventory: boolean;
  chat: boolean;
  modal: boolean;
  death: boolean;
  mobileUnsupported: boolean;
}

/** The sole pause predicate for local and network-backed gameplay sessions. */
export function gameplaySessionPaused(state: Readonly<GameplaySessionBlockers>): boolean {
  return !state.foreground || state.pause || state.inventory || state.chat || state.modal
    || state.death || state.mobileUnsupported;
}

/** One pause predicate used before engine startup and for every later UI/visibility transition. */
export function singlePlayerGameplayPaused(state: Readonly<SinglePlayerPauseState>): boolean {
  return gameplaySessionPaused({
    foreground: state.documentVisible,
    pause: state.pauseOpen,
    inventory: state.inventoryOpen,
    chat: false,
    modal: state.worldModalOpen,
    death: state.deathScreenOpen,
    mobileUnsupported: false,
  });
}

export interface SinglePlayerPointerSessionState {
  locked: boolean;
  pauseOpen: boolean;
  intentionalReleasePending: boolean;
  ignoreEscapeUntil: number;
}
export type GameplayPointerSessionState = SinglePlayerPointerSessionState;

export type SinglePlayerPointerSessionEvent =
  | { type: "escape"; now: number; repeat?: boolean; uiBlocked: boolean }
  | { type: "close_ui_escape"; now: number }
  | { type: "intentional_release" }
  | { type: "lock_change"; locked: boolean; now: number; uiBlocked: boolean }
  | { type: "resume" }
  | { type: "set_pause"; open: boolean };
export type GameplayPointerSessionEvent = SinglePlayerPointerSessionEvent;

/** Escape cannot activate Pointer Lock in Chrome; these keys can silently recapture and still play. */
export function singlePlayerSilentRecaptureKey(code: string, repeat = false): boolean {
  return !repeat && [
    "KeyW", "KeyA", "KeyS", "KeyD", "Space",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  ].includes(code);
}

/**
 * Re-enters Pointer Lock on Escape keyup, after Chrome's reserved unlock tail.
 * Chat and inventory surfaces in both authority modes share this sequencing so
 * closing an overlay never leaves a visible cursor over live gameplay.
 */
export function scheduleGameplayPointerLockAfterEscapeRelease(
  target: Window,
  canRecapture: () => boolean,
  request: () => void,
): () => void {
  let cleanupTimer = 0;
  const cleanup = () => {
    target.removeEventListener("keyup", onEscapeRelease, true);
    target.clearTimeout(cleanupTimer);
  };
  const onEscapeRelease = (event: KeyboardEvent) => {
    if (event.code !== "Escape") return;
    cleanup();
    if (canRecapture()) request();
  };
  target.addEventListener("keyup", onEscapeRelease, true);
  cleanupTimer = target.setTimeout(cleanup, 1_000);
  return cleanup;
}

/**
 * Escape is the browser's reserved Pointer Lock release gesture, so Chrome does
 * not let that same key activation reliably reacquire capture. E and pointer
 * clicks are ordinary trusted activations and can reacquire before the
 * inventory UI is removed.
 */
export function singlePlayerInventoryCloseUsesTrustedRecapture(
  code?: "Escape" | "KeyE",
): boolean {
  return code !== "Escape";
}

export type SinglePlayerInventoryClosePath = "trusted" | "deferred_escape";

/**
 * Runs the inventory-close gesture in browser-safe order. E and pointer clicks
 * prepare the synchronous UI gate and start Pointer Lock before closing the
 * activating UI. Escape closes first and arms recovery for a later eligible
 * activation because Escape itself is reserved by the browser.
 */
export function orchestrateSinglePlayerInventoryClose(
  code: "Escape" | "KeyE" | undefined,
  prepareTrustedRecapture: () => void,
  requestTrustedRecapture: (onStarted: () => void) => void,
  closeUi: () => void,
  armDeferredEscapeRecapture: () => void,
): SinglePlayerInventoryClosePath {
  if (singlePlayerInventoryCloseUsesTrustedRecapture(code)) {
    prepareTrustedRecapture();
    requestTrustedRecapture(closeUi);
    return "trusted";
  }

  closeUi();
  armDeferredEscapeRecapture();
  return "deferred_escape";
}

export interface SinglePlayerPointerSessionTransition {
  state: SinglePlayerPointerSessionState;
  openPause: boolean;
  closePause: boolean;
  requestPointerLock: boolean;
}
export type GameplayPointerSessionTransition = SinglePlayerPointerSessionTransition;

/**
 * Starts Pointer Lock before running any UI transition effects. Browser user
 * activation is tied to the current input callback, so callers must not close
 * or replace the activating button before invoking the browser request.
 */
export function beginSinglePlayerPointerLockAttempt(
  request: () => PromiseLike<boolean> | boolean,
  onStarted: () => void,
  onSettled: (locked: boolean) => void,
): void {
  let result: PromiseLike<boolean> | boolean;
  try {
    result = request();
  } catch {
    onStarted();
    onSettled(false);
    return;
  }
  onStarted();
  void Promise.resolve(result).then(onSettled, () => onSettled(false));
}

/** Rejects a late browser grant without disturbing the UI that superseded it. */
export function releaseBlockedSinglePlayerPointerLockGrant(
  locked: boolean,
  uiBlocked: boolean,
  pauseOpen: boolean,
  mounted: boolean,
  release: () => void,
): boolean {
  if (!locked || (mounted && !uiBlocked && !pauseOpen)) return false;
  release();
  return true;
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
    return unchanged(next);
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

/** Authority-neutral names used by all new gameplay sessions. */
export const createGameplayPointerSessionState = createSinglePlayerPointerSessionState;
export const transitionGameplayPointerSession = transitionSinglePlayerPointerSession;
