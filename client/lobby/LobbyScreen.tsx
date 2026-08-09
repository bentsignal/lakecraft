import { useMemo, useState } from "preact/hooks";
import { OptionsDialog } from "../components/OptionsDialog";
import type { ClientSettings } from "../settings";
import { LobbyStyles } from "./LobbyStyles";
import { menuButton } from "./menuButton.tsx";

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
  buildLabel?: string;
  settings: ClientSettings;
  onSignInWithGoogle: () => void;
  onJoinSingleplayer: () => void;
  onSignOut?: () => void;
  onUsernameChange: (value: string) => void;
  onUsernameSubmit: (value: string) => void;
  onJoinWorld: () => void;
  onSelectServer?: (serverId: string) => void;
  onDirectConnectChange?: (value: string) => void;
  onDirectConnectTokenChange?: (value: string) => void;
  onAddDirectServer?: () => void;
  onOpenHelp?: () => void;
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

function Panorama() {
  return (
    <div className="lc-title-panorama" aria-hidden="true">
      <span className="lc-title-sun" />
      <span className="lc-title-cloud cloud-one" />
      <span className="lc-title-cloud cloud-two" />
      <span className="lc-title-hills hills-back" />
      <span className="lc-title-hills hills-front" />
      <span className="lc-title-ground" />
      <span className="lc-title-tree tree-one" />
      <span className="lc-title-tree tree-two" />
    </div>
  );
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

function AccountPanel({ onSignIn, onChooseUsername, props }: {
  onSignIn?: () => void;
  onChooseUsername: () => void;
  props: LobbyScreenProps;
}) {
  const signedOut = props.authState === "signed_out";
  const loading = props.authState === "loading";
  const needsUsername = props.authState === "needs_username";
  const accountName = loading ? "Checking account…"
    : signedOut ? "Offline player"
      : needsUsername ? props.displayName || props.email || "Unnamed player"
        : props.username || props.displayName || "Player";
  return (
    <aside className="lc-account-panel" aria-label="Player account">
      <span className="lc-account-head" aria-hidden="true" />
      <div><small>Player</small><strong>{accountName}</strong></div>
      {signedOut && onSignIn ? <button onClick={onSignIn} type="button">Sign In</button> : null}
      {needsUsername ? <button onClick={onChooseUsername} type="button">Set Name</button> : null}
      {!signedOut && !loading && !needsUsername && props.onSignOut ? <button onClick={props.onSignOut} type="button">Sign Out</button> : null}
    </aside>
  );
}

function ServerBrowser({ onBack, onChooseUsername, props }: {
  onBack: () => void;
  onChooseUsername: () => void;
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
  const accountHint = props.authState === "signed_out" ? "Sign in to join this server."
    : props.authState === "needs_username" ? "Choose a player name before joining."
      : props.authState === "loading" ? "Checking your Lakebed account…"
        : status === "maintenance" ? "Server maintenance in progress."
          : status === "offline" ? "The server is currently offline."
            : "Select a server and click Join Server.";

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <AccountPanel onSignIn={props.onSignInWithGoogle} onChooseUsername={onChooseUsername} props={props} />
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
                aria-label="Invitation token"
                autoComplete="off"
                onInput={(event) => props.onDirectConnectTokenChange?.(event.currentTarget.value)}
                placeholder="Invitation token (beta servers)"
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
      <footer className="lc-title-footer"><span>Lakecraft {props.buildLabel || "Alpha"}</span><span>craft.lakebed.app</span></footer>
    </main>
  );
}

export function LobbyScreen(props: LobbyScreenProps) {
  const [page, setPage] = useState<"title" | "multiplayer">("title");
  const [editingUsername, setEditingUsername] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const showUsername = editingUsername && props.authState === "needs_username";

  if (page === "multiplayer") {
    return (
      <>
        <ServerBrowser onBack={() => { setEditingUsername(false); setPage("title"); }} onChooseUsername={() => setEditingUsername(true)} props={props} />
        {showUsername ? <div className="lc-username-layer" role="presentation"><UsernameMenu {...props} onCancel={() => setEditingUsername(false)} /></div> : null}
      </>
    );
  }

  return (
    <main className="lc-title-screen">
      <LobbyStyles />
      <Panorama />
      <div className="lc-title-shade" aria-hidden="true" />
      <AccountPanel onSignIn={() => setPage("multiplayer")} onChooseUsername={() => setEditingUsername(true)} props={props} />
      <section className="lc-title-content" aria-label="Lakecraft main menu">
        <header className="lc-title-logo">
          <h1>LAKECRAFT</h1>
          <span>Multiplayer survival on Lakebed</span>
        </header>

        <div className="lc-title-menu">
          {menuButton("Singleplayer", props.onJoinSingleplayer, false, 2)}
          {menuButton("Multiplayer", () => setPage("multiplayer"), false, 2)}
          {menuButton("Options…", () => setOptionsOpen(true), false, 2, "lc-title-options")}
        </div>
      </section>
      {showUsername ? <div className="lc-username-layer" role="presentation"><UsernameMenu {...props} onCancel={() => setEditingUsername(false)} /></div> : null}
      <OptionsDialog
        fovDegrees={props.settings.fovDegrees}
        mouseSensitivity={props.settings.mouseSensitivity}
        onBack={() => setOptionsOpen(false)}
        onFovChange={(fovDegrees) => props.onSettingsChange({ ...props.settings, fovDegrees })}
        onSensitivityChange={(mouseSensitivity) => props.onSettingsChange({ ...props.settings, mouseSensitivity })}
        onToggleSound={() => props.onSettingsChange({ ...props.settings, soundMuted: !props.settings.soundMuted })}
        open={optionsOpen}
        returnFocusId="lc-title-options"
        soundMuted={props.settings.soundMuted}
      />
      <footer className="lc-title-footer">
        <span>Lakecraft {props.buildLabel || "Alpha"}</span>
        <span>craft.lakebed.app</span>
      </footer>
    </main>
  );
}
