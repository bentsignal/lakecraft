export type MobileUnsupportedOverlayProps = {
  visible?: boolean;
  onContinue?: () => void;
};

export function MobileUnsupportedOverlay({ visible = false, onContinue }: MobileUnsupportedOverlayProps) {
  if (!visible) return null;
  return (
    <div className="lc-unsupported" role="alertdialog" aria-modal="true" aria-labelledby="lc-unsupported-title">
      <div className="lc-unsupported__topo" aria-hidden="true" />
      <div className="lc-unsupported__card">
        <span className="lc-unsupported__stamp">FIELD NOTICE / 04</span>
        <div className="lc-unsupported__icon" aria-hidden="true">↔</div>
        <h2 id="lc-unsupported-title">More room to roam.</h2>
        <p>Lakecraft needs a keyboard, mouse, and a wider view for first-person building. Open this world on a desktop or laptop.</p>
        {onContinue ? <button onClick={onContinue} type="button">Continue anyway <span>→</span></button> : null}
        <small>Your world code will still work there.</small>
      </div>
    </div>
  );
}
