type KeyboardLockController = {
  lock: (codes: readonly string[]) => Promise<void> | void;
  unlock?: () => void;
};

type NavigatorWithKeyboardLock = Navigator & {
  keyboard?: KeyboardLockController;
};

export const GAMEPLAY_KEYBOARD_LOCK_CODES = Object.freeze(["KeyW", "Escape"] as const);

function keyboardLockController(): KeyboardLockController | null {
  const keyboard = (navigator as NavigatorWithKeyboardLock).keyboard;
  return keyboard && typeof keyboard.lock === "function" ? keyboard : null;
}

async function lockGameplayKeyboard(): Promise<boolean> {
  const keyboard = keyboardLockController();
  if (!keyboard) return false;
  try {
    await keyboard.lock(GAMEPLAY_KEYBOARD_LOCK_CODES);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the only browser-standard protection for Ctrl+W: JavaScript-initiated
 * fullscreen followed by a narrow Keyboard Lock for KeyW. Locking the physical
 * W code also captures its Ctrl/Shift modifier combinations. Unsupported or
 * denied browsers fail quietly and keep ordinary play available.
 */
export function requestGameplayKeyboardCapture(): boolean {
  if (!keyboardLockController()) return false;
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== "function") return false;
  try {
    const alreadyFullscreen = Boolean(document.fullscreenElement);
    const fullscreenRequest = alreadyFullscreen
      ? Promise.resolve()
      : Promise.resolve(root.requestFullscreen({ navigationUI: "hide" }));
    void fullscreenRequest.then(lockGameplayKeyboard).then((locked) => {
      if (locked || alreadyFullscreen || document.fullscreenElement !== root
        || typeof document.exitFullscreen !== "function") return;
      void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
    }).catch(() => false);
    return true;
  } catch {
    return false;
  }
}

/** Releases the narrow key lock and returns title/menu UI to normal windowed mode. */
export function releaseGameplayKeyboardCapture(exitFullscreen = true): void {
  try {
    keyboardLockController()?.unlock?.();
  } catch {
    // Browser teardown and permission transitions can invalidate the controller.
  }
  if (!exitFullscreen || !document.fullscreenElement || typeof document.exitFullscreen !== "function") return;
  try {
    void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
  } catch {
    // Fullscreen may already be leaving through the browser's Escape handling.
  }
}

/** Best-effort F11-style toggle; browsers that reserve the key simply keep their native behavior. */
export function toggleGameplayFullscreen(): boolean {
  try {
    if (document.fullscreenElement) {
      void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
      return true;
    }
    if (typeof document.documentElement.requestFullscreen !== "function") return false;
    void Promise.resolve(document.documentElement.requestFullscreen({ navigationUI: "hide" })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
