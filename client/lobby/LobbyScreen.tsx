import { useMemo, useState } from "preact/hooks";
import { OptionsDialog } from "../components/OptionsDialog";
import { WorldLoadingScreen } from "../components/WorldLoadingScreen.tsx";
import type { ClientSettings } from "../settings";
import { LobbyStyles } from "./LobbyStyles";
import { menuButton } from "./menuButton.tsx";
import { TitleLogo } from "./TitleLogo.tsx";
import { TitlePanorama } from "./TitlePanorama.tsx";

export type LobbyAuthState = "loading" | "signed_out" | "needs_username" | "ready";
export type UsernameClaimState = "idle" | "checking" | "available" | "saving" | "claimed" | "taken" | "error";
export type LobbyWorldStatus = "online" | "busy" | "maintenance" | "offline";
export type LobbyJoinPhase = "idle" | "joining" | "waiting" | "ready" | "error";

export interface LobbyServerEntry {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  status: LobbyWorldStatus;
  onlinePlayers?: number;
  capacity?: number;
}

export interface LobbyScreenProps {
  authState: LobbyAuthState;
  displayName?: string;
  email?: string;
  username: string;
  usernameState?: UsernameClaimState;
  usernameError?: string;
  worldName?: string;
  worldDescription?: string;
  worldStatus?: LobbyWorldStatus;
  joinPhase?: LobbyJoinPhase;
  queuePosition?: number;
  joinError?: string;
  servers?: readonly LobbyServerEntry[];
  selectedServerId?: string;
  directConnectValue?: string;
  directConnectToken?: string;
  settings: ClientSettings;
  onSignInWithGoogle: () => void;
  onBack: () => void;
  onSignOut?: () => void;
  onUsernameChange: (value: string) => void;
  onUsernameSubmit: (value: string) => void;
  onJoinWorld: () => void;
  onJoinServer?: (serverId: string) => void;
  onSelectServer?: (serverId: string) => void;
  onDirectConnectChange?: (value: string) => void;
  onDirectConnectTokenChange?: (value: string) => void;
  onAddDirectServer?: () => void;
  onOpenHelp?: () => void;
  onSettingsChange: (settings: ClientSettings) => void;
}

export interface TitleScreenProps {
  settings: ClientSettings;
  onJoinSingleplayer: () => void;
  onJoinMultiplayer: () => void;
  onSettingsChange: (settings: ClientSettings) => void;
}

export interface UsernameValidationResult {
  valid: boolean;
  message: string;
  normalized: string;
}

export function validateLakecraftUsername(value: string): UsernameValidationResult {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3) return { valid: false, message: "Use at least 3 characters.", normalized };
  if (normalized.length > 16) return { valid: false, message: "Keep it to 16 characters or fewer.", normalized };
  if (!/^[a-z0-9_]+$/.test(normalized)) return { valid: false, message: "Use only letters, numbers, and _.", normalized };
  return { valid: true, message: "Username available", normalized };
}

function usernameStatus(state: UsernameClaimState, fallback = "") {
  if (state === "checking") return "Checking username…";
  if (state === "saving") return "Saving username…";
  if (state === "available") return "Username available";
  if (state === "claimed") return "Username saved";
  if (state === "taken") return fallback || "That username is already taken.";
  if (state === "error") return fallback || "Lakebed could not save that username.";
  return "3–16 letters, numbers, or underscores";
}

function serverEndpointLabel(endpoint: string): string {
  if (!endpoint) return "Lakebed legacy world";
  try {
    return new URL(endpoint).host;
  } catch {
    return "Invalid server address";
  }
}

function UsernameMenu(props: LobbyScreenProps & { onCancel?: () => void }) {
  const [localError, setLocalError] = useState("");
  const validation = useMemo(() => validateLakecraftUsername(props.username), [props.username]);
  const state = props.usernameState ?? "idle";
  const busy = state === "checking" || state === "saving";
  const error = localError || usernameStatus(state, props.usernameError);

  function submit(event: Event) {
    event.preventDefault();
    if (!validation.valid) {
      setLocalError(validation.message);
      return;
    }
    setLocalError("");
    props.onUsernameSubmit(validation.normalized);
  }

  return (
    <form className="lc-username-menu" onSubmit={submit}>
      <h2>Choose Username</h2>
      <p>This name appears above your player and in chat.</p>
      <input
        aria-describedby="lc-username-help"
        aria-invalid={Boolean(localError || state === "taken" || state === "error")}
        autoCapitalize="off"
        autoComplete="username"
        autoFocus
        maxLength={16}
        onInput={(event) => {
          setLocalError("");
          props.onUsernameChange(event.currentTarget.value);
        }}
        placeholder="Username"
        spellcheck={false}
        value={props.username}
      />
      <p className={`lc-username-help${localError || state === "taken" || state === "error" ? " is-error" : ""}`} id="lc-username-help">{error}</p>
      {menuButton(busy ? "Please wait…" : "Done", undefined, busy || !validation.valid, 3)}
      {props.onCancel ? <button className="lc-menu-link" onClick={props.onCancel} type="button">Back</button> : null}
    </form>
  );
}

function JoinLabel(props: LobbyScreenProps) {
  const phase = props.joinPhase ?? "idle";
  if (phase === "joining") return <>Connecting to world…</>;
  if (phase === "waiting") return <>Waiting for world{props.queuePosition ? ` (#${props.queuePosition})` : "…"}</>;
  if (phase === "ready") return <>Joining world…</>;
  if (phase === "error") return <>Retry Connection</>;
  return <>Join Server</>;
}

function AccountPanel({ props }: { props: LobbyScreenProps }) {
  const accountName = props.username || props.displayName || "Player";
  return (
    <aside className="lc-account-panel" aria-label="Player account">
      <span className="lc-account-head" aria-hidden="true" />
      <div><small>Player</small><strong>{accountName}</strong></div>
      {props.onSignOut ? <button onClick={props.onSignOut} type="button">Sign Out</button> : null}
    </aside>
  );
}

function MultiplayerAccess({ props }: { props: LobbyScreenProps }) {
  const loading = props.authState === "loading";
  const needsUsername = props.authState === "needs_username";

  return (
    <main className="lc-multiplayer-auth">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <section className="lc-multiplayer-auth__card" aria-busy={loading} aria-label="Multiplayer sign in">
        {needsUsername ? (
          <UsernameMenu {...props} onCancel={props.onBack} />
        ) : (
          <>
            <span className="lc-multiplayer-auth__avatar" aria-hidden="true" />
            <h1>Play Multiplayer</h1>
            <p>{loading
              ? "Checking your Lakebed account…"
              : "Sign in with Google to browse servers and play online."}</p>
            {props.usernameError ? <p className="lc-multiplayer-auth__error" role="alert">{props.usernameError}</p> : null}
            <div className="lc-multiplayer-auth__actions">
              {loading
                ? <span className="lc-multiplayer-auth__loading" role="status">Connecting…</span>
                : menuButton("Continue with Google", props.onSignInWithGoogle, false, 3)}
              {menuButton("Back", props.onBack)}
            </div>
            <small>Singleplayer never needs an account.</small>
          </>
        )}
      </section>
      <footer className="lc-title-footer"><span>Lakecraft</span><span>craft.lakebed.app</span></footer>
    </main>
  );
}

function ServerBrowser({ onBack, props }: {
  onBack: () => void;
  props: LobbyScreenProps;
}) {
  const phase = props.joinPhase ?? "idle";
  const fallbackServer: LobbyServerEntry = {
    id: "fern-hollow",
    name: props.worldName || "Fern Hollow",
    description: props.worldDescription || "Lakecraft survival world",
    endpoint: "",
    status: props.worldStatus ?? "busy",
  };
  const servers = props.servers ? [...props.servers] : [fallbackServer];
  const selected = servers.find((server) => server.id === props.selectedServerId) ?? servers[0];
  const status = selected?.status ?? "offline";
  const joining = phase === "joining" || phase === "waiting" || phase === "ready";
  const canJoin = props.authState === "ready" && Boolean(selected)
    && status !== "maintenance" && status !== "offline" && !joining;
  const accountHint = status === "maintenance" ? "Server maintenance in progress."
    : status === "offline" ? "The server is currently offline."
      : "Select a server and click Join Server.";

  if (joining) {
    const detail = phase === "joining" ? `Connecting to ${selected?.name ?? "server"}…`
      : phase === "waiting" ? "Waiting for player data…"
        : "Building terrain…";
    return <WorldLoadingScreen detail={detail} />;
  }

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <AccountPanel props={props} />
      <section className="lc-server-browser__content" aria-label="Multiplayer server list">
        <h1>Play Multiplayer</h1>
        <div className="lc-server-list" role="listbox" aria-label="Available servers">
          {servers.length === 0 ? (
            <div className="lc-server-empty">
              <strong>No servers saved</strong>
              <small>Paste a Railway server address below to add it.</small>
            </div>
          ) : null}
          {servers.map((server) => {
            const selectedRow = server.id === selected?.id;
            return (
              <button
                aria-selected={selectedRow}
                className={`lc-server-row${selectedRow ? " is-selected" : ""}`}
                key={server.id}
                onClick={() => props.onSelectServer?.(server.id)}
                onDblClick={() => props.onJoinServer?.(server.id)}
                role="option"
                type="button"
              >
                <span className="lc-server-icon" aria-hidden="true"><i /><i /><i /></span>
                <span className="lc-server-copy">
                  <strong>{server.name}</strong>
                  <small>{server.description}</small>
                  <em>{serverEndpointLabel(server.endpoint)}</em>
                </span>
                <span className="lc-server-population">
                  <i className={`is-${server.status}`} aria-hidden="true" />
                  <small>{Math.max(0, server.onlinePlayers ?? 0)} / {server.capacity ?? 20}</small>
                </span>
              </button>
            );
          })}
        </div>
        {props.onDirectConnectChange && props.onAddDirectServer ? (
          <form className="lc-direct-connect" onSubmit={(event) => { event.preventDefault(); props.onAddDirectServer?.(); }}>
            <label htmlFor="lc-direct-server">Direct Connect</label>
            <input
              id="lc-direct-server"
              onInput={(event) => props.onDirectConnectChange?.(event.currentTarget.value)}
              placeholder="wss://your-server.up.railway.app/ws"
              spellcheck={false}
              value={props.directConnectValue ?? ""}
            />
            {props.onDirectConnectTokenChange ? (
              <input
                aria-label="Server password or invitation token"
                autoComplete="off"
                onInput={(event) => props.onDirectConnectTokenChange?.(event.currentTarget.value)}
                placeholder="Server password or invitation token"
                spellcheck={false}
                type="password"
                value={props.directConnectToken ?? ""}
              />
            ) : null}
            <button type="submit">Add Server</button>
          </form>
        ) : null}
        <p className={`lc-server-hint${phase === "error" ? " is-error" : ""}`} role={phase === "error" ? "alert" : "status"}>{phase === "error" && props.joinError ? props.joinError : accountHint}</p>
        <div className="lc-server-actions">
          {menuButton(<JoinLabel {...props} />, props.onJoinWorld, !canJoin)}
          {menuButton("Back", onBack)}
        </div>
      </section>
      <footer className="lc-title-footer"><span>Lakecraft</span><span>craft.lakebed.app</span></footer>
    </main>
  );
}

export function LobbyScreen(props: LobbyScreenProps) {
  if (props.authState !== "ready") return <MultiplayerAccess props={props} />;

  return <ServerBrowser onBack={props.onBack} props={props} />;
}

export function TitleScreen(props: TitleScreenProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <main className="lc-title-screen">
      <LobbyStyles />
      <TitlePanorama />
      <div className="lc-title-shade" aria-hidden="true" />
      <section className="lc-title-content" aria-label="Lakecraft main menu">
        <TitleLogo />

        <div className="lc-title-menu">
          {menuButton("Singleplayer", props.onJoinSingleplayer, false, 2)}
          {menuButton("Multiplayer", props.onJoinMultiplayer, false, 2)}
          {menuButton("Options…", () => setOptionsOpen(true), false, 2, "lc-title-options")}
        </div>
      </section>
      <footer className="lc-title-footer"><span /><span>craft.lakebed.app</span></footer>
      <OptionsDialog
        onBack={() => setOptionsOpen(false)}
        onSettingsChange={props.onSettingsChange}
        open={optionsOpen}
        returnFocusId="lc-title-options"
        settings={props.settings}
      />
    </main>
  );
}
