export type PauseMenuProps = {
  open: boolean;
  onBack?: () => void;
  onOptions?: () => void;
  onSave?: () => void;
  saveStatusText?: string;
  lastSavedText?: string;
  saveDisabled?: boolean;
  saveInProgress?: boolean;
  onDisconnect?: () => void;
  title?: string;
  disconnectLabel?: string;
};

export function PauseMenu({
  open,
  onBack,
  onOptions,
  onSave,
  saveStatusText,
  lastSavedText,
  saveDisabled = false,
  saveInProgress = false,
  onDisconnect,
  title = "Game Menu",
  disconnectLabel = "Disconnect",
}: PauseMenuProps) {
  if (!open) return null;
  const showSaveControls = Boolean(onSave || saveStatusText || lastSavedText);
  return (
    <div className="lc-menu-layer" role="presentation">
      <section aria-busy={saveInProgress || undefined} className="lc-game-menu" role="dialog" aria-modal="true" aria-labelledby="lc-game-menu-title">
        <h2 id="lc-game-menu-title">{title}</h2>
        <div className="lc-game-menu__buttons">
          <button autoFocus onClick={onBack} type="button">Back to Game</button>
          <button disabled={!onOptions} id="lc-game-menu-options" onClick={onOptions} type="button">Options…</button>
          {showSaveControls ? (
            <div className="lc-game-menu__save">
              <button
                aria-describedby="lc-game-menu-save-status"
                disabled={!onSave || saveDisabled || saveInProgress}
                onClick={onSave}
                type="button"
              >
                {saveInProgress ? "Saving…" : "Save World"}
              </button>
              <div aria-atomic="true" aria-live="polite" className="lc-game-menu__save-status" id="lc-game-menu-save-status" role="status">
                {saveStatusText ? <span>{saveStatusText}</span> : null}
                {lastSavedText ? <span className="lc-game-menu__last-saved">{lastSavedText}</span> : null}
              </div>
            </div>
          ) : null}
          <button className="lc-game-menu__disconnect" onClick={onDisconnect} type="button">{disconnectLabel}</button>
        </div>
      </section>
    </div>
  );
}
