export type DeathScreenProps = {
  open: boolean;
  cause?: string;
  score?: number;
  respawning?: boolean;
  respawnStatus?: string;
  respawnError?: string;
  onRespawn?: () => void;
  onTitleScreen?: () => void;
};

/**
 * Presentation-only death modal. The caller owns authoritative death and
 * respawn state; this component never starts a timer or changes game state.
 */
export function DeathScreen({
  open,
  cause,
  score = 0,
  respawning = false,
  respawnStatus,
  respawnError,
  onRespawn,
  onTitleScreen,
}: DeathScreenProps) {
  if (!open) return null;

  const displayedScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  return (
    <div className="lc-death-layer">
      <section
        aria-describedby="lc-death-cause lc-death-score"
        aria-labelledby="lc-death-title"
        aria-live="assertive"
        aria-modal="true"
        className="lc-death-screen"
        role="dialog"
      >
        <h2 id="lc-death-title">You Died!</h2>
        <p className="lc-death-screen__cause" id="lc-death-cause">{cause || "You died"}</p>
        <p className="lc-death-screen__score" id="lc-death-score">
          Score: <strong>{displayedScore}</strong>
        </p>
        <div className="lc-death-screen__buttons">
          <button autoFocus disabled={respawning || !onRespawn} onClick={onRespawn} type="button">
            {respawning ? "Respawning…" : "Respawn"}
          </button>
          <button disabled={respawning || !onTitleScreen} onClick={onTitleScreen} type="button">Title Screen</button>
        </div>
        {respawnError || respawnStatus ? (
          <p
            aria-atomic="true"
            aria-live={respawnError ? "assertive" : "polite"}
            className={`lc-death-screen__status${respawnError ? " is-error" : ""}`}
            role={respawnError ? "alert" : "status"}
          >
            {respawnError || respawnStatus}
          </p>
        ) : null}
      </section>
    </div>
  );
}
