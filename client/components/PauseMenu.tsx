export type PauseMenuProps = {
  open: boolean;
  onBack?: () => void;
  onOptions?: () => void;
  onDisconnect?: () => void;
};

export function PauseMenu({ open, onBack, onOptions, onDisconnect }: PauseMenuProps) {
  if (!open) return null;
  return (
    <div className="lc-menu-layer" role="presentation">
      <section className="lc-game-menu" role="dialog" aria-modal="true" aria-labelledby="lc-game-menu-title">
        <h2 id="lc-game-menu-title">Game Menu</h2>
        <div className="lc-game-menu__buttons">
          <button autoFocus onClick={onBack} type="button">Back to Game</button>
          <button disabled={!onOptions} onClick={onOptions} type="button">Options…</button>
          <button className="lc-game-menu__disconnect" onClick={onDisconnect} type="button">Disconnect</button>
        </div>
      </section>
    </div>
  );
}
