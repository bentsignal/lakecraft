export type PauseMenuProps = {
  open: boolean;
  onBack?: () => void;
  onOptions?: () => void;
  autosaveStatusText?: string;
  lastAutosavedText?: string;
  disconnectDisabled?: boolean;
  onResetWorld?: () => void;
  onDisconnect?: () => void;
  title?: string;
  disconnectLabel?: string;
  backLabel?: string;
};

export function PauseMenu({
  open,
  onBack,
  onOptions,
  autosaveStatusText,
  lastAutosavedText,
  disconnectDisabled = false,
  onResetWorld,
  onDisconnect,
  title = "Game Menu",
  disconnectLabel = "Disconnect",
  backLabel = "Back to Game",
}: PauseMenuProps) {
  if (!open) return null;
  const showAutosaveStatus = Boolean(autosaveStatusText || lastAutosavedText);
  return (
    <div className="lc-menu-layer" role="presentation">
      <section className="lc-game-menu" role="dialog" aria-modal="true" aria-labelledby="lc-game-menu-title">
        <h2 id="lc-game-menu-title">{title}</h2>
        <div className="lc-game-menu__buttons">
          <button autoFocus onClick={onBack} type="button">{backLabel}</button>
          <button disabled={!onOptions} id="lc-game-menu-options" onClick={onOptions} type="button">Options…</button>
          <button
            aria-describedby={showAutosaveStatus ? "lc-game-menu-autosave-status" : undefined}
            className="lc-game-menu__disconnect"
            disabled={!onDisconnect || disconnectDisabled}
            onClick={onDisconnect}
            type="button"
          >
            {disconnectLabel}
          </button>
          {showAutosaveStatus ? (
            <div aria-atomic="true" aria-live="polite" className="lc-game-menu__autosave-status" id="lc-game-menu-autosave-status" role="status">
              {lastAutosavedText ? <span className="lc-game-menu__last-autosaved">{lastAutosavedText}</span> : null}
              {autosaveStatusText ? <span>{autosaveStatusText}</span> : null}
            </div>
          ) : null}
          {disconnectDisabled && onResetWorld ? (
            <button className="lc-game-menu__reset" onClick={onResetWorld} type="button">Reset Local World…</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
