export type StatusStripProps = {
  worldName?: string;
  roomCode?: string;
  playerName?: string;
  onlineCount?: number;
  latencyMs?: number | null;
  connected?: boolean;
  health?: number;
  maxHealth?: number;
};

export function StatusStrip({
  worldName = "Fern Hollow",
  roomCode = "LOCAL",
  playerName = "Wayfarer",
  onlineCount = 1,
  latencyMs = null,
  connected = true,
  health = 20,
  maxHealth = 20,
}: StatusStripProps) {
  return (
    <header className="lc-status" aria-label="World and connection status">
      <div className="lc-status__brand">
        <span className="lc-status__brand-mark" aria-hidden="true">L</span>
        <span><strong>LAKECRAFT</strong><small>field build · 01</small></span>
      </div>
      <div className="lc-status__world">
        <span className="lc-kicker">current survey</span>
        <strong>{worldName}</strong>
        <span className="lc-status__room">ROOM / {roomCode}</span>
      </div>
      <div className="lc-status__health" aria-label={`${Math.max(0, health)} of ${maxHealth} health`}>
        <span>HEALTH</span><strong>{Array.from({ length: 10 }, (_, index) => index * 2 < health ? "♥" : "♡").join("")}</strong>
      </div>
      <div className="lc-status__presence">
        <span className={`lc-signal${connected ? " is-online" : ""}`} aria-hidden="true" />
        <span><strong>{connected ? `${onlineCount} online` : "reconnecting"}</strong><small>{playerName}{latencyMs == null ? "" : ` · ${latencyMs}ms`}</small></span>
      </div>
    </header>
  );
}
