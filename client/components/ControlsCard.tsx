export type ControlsCardProps = { visible?: boolean; onDismiss?: () => void };

export function ControlsCard({ visible = true, onDismiss }: ControlsCardProps) {
  if (!visible) return null;
  return (
    <aside className="lc-controls" aria-label="Game controls">
      <div className="lc-controls__head"><span className="lc-kicker">trail notes</span>{onDismiss ? <button onClick={onDismiss} type="button" aria-label="Dismiss controls">×</button> : null}</div>
      <div className="lc-controls__grid">
        <div><span className="lc-key-cluster"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span><p><strong>Walk</strong><small>mouse to look</small></p></div>
        <div><span className="lc-mouse lc-mouse--left" aria-hidden="true" /><p><strong>Mine</strong><small>hold left click</small></p></div>
        <div><span className="lc-mouse lc-mouse--right" aria-hidden="true" /><p><strong>Place / Use</strong><small>interact or eat</small></p></div>
        <div><span className="lc-key-row"><kbd>SPC</kbd><kbd>E</kbd></span><p><strong>Jump / Pack</strong><small>esc frees cursor</small></p></div>
      </div>
    </aside>
  );
}
