export type PlayerListEntry = {
  id?: string;
  name: string;
  isSelf?: boolean;
  connected?: boolean;
  latencyMs?: number | null;
};

export type PlayerListProps = {
  visible: boolean;
  players: readonly PlayerListEntry[];
};

function signalLevel(latencyMs: number | null | undefined, connected: boolean | undefined) {
  if (connected === false) return 0;
  if (latencyMs == null) return 4;
  if (latencyMs < 100) return 5;
  if (latencyMs < 200) return 4;
  if (latencyMs < 350) return 3;
  return 2;
}

export function PlayerList({ visible, players }: PlayerListProps) {
  if (!visible) return null;
  return (
    <section className="lc-player-list" aria-label={`${players.length} players online`}>
      <h2>Lakecraft</h2>
      <ul>
        {players.map((player, index) => {
          const level = signalLevel(player.latencyMs, player.connected);
          return (
            <li key={player.id ?? `${player.name}-${index}`}>
              <span className="lc-player-list__head" aria-hidden="true" />
              <span>{player.name}{player.isSelf ? " (You)" : ""}</span>
              <span className="lc-player-list__signal" data-level={level} title={player.connected === false ? "Disconnected" : player.latencyMs == null ? "Connected" : `${player.latencyMs} ms`} aria-label={player.connected === false ? "Disconnected" : player.latencyMs == null ? "Connected" : `${player.latencyMs} milliseconds`}>
                {Array.from({ length: 5 }, (_, bar) => <i className={bar < level ? "is-on" : ""} key={bar} />)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
