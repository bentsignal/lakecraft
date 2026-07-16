import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { OptionsDialog } from "../components/OptionsDialog";
import type { ClientSettings } from "../settings";
import { LobbyStyles } from "./LobbyStyles";

export type LobbyAuthState = "loading" | "signed_out" | "needs_username" | "ready";
export type UsernameClaimState = "idle" | "checking" | "available" | "saving" | "claimed" | "taken" | "error";
export type LobbyWorldStatus = "online" | "busy" | "maintenance" | "offline";
export type LobbyJoinPhase = "idle" | "joining" | "waiting" | "ready" | "error";

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
  onlineCount?: number;
  joinPhase?: LobbyJoinPhase;
  queuePosition?: number;
  joinError?: string;
  buildLabel?: string;
  settings: ClientSettings;
  onSignInWithGoogle: () => void;
  onJoinSingleplayer: () => void;
  onSignOut?: () => void;
  onUsernameChange: (value: string) => void;
  onUsernameSubmit: (value: string) => void;
  onJoinWorld: () => void;
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

function MenuButton({ children, disabled, id, onClick, type = "button", wide = false }: { children: ComponentChildren; disabled?: boolean; id?: string; onClick?: () => void; type?: "button" | "submit"; wide?: boolean }) {
  return <button className={`lc-menu-button${wide ? " is-wide" : ""}`} disabled={disabled} id={id} onClick={onClick} type={type}>{children}</button>;
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
      <MenuButton disabled={busy || !validation.valid} type="submit" wide>{busy ? "Please wait…" : "Done"}</MenuButton>
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

function AccountPanel({ allowSignIn, onChooseUsername, props }: {
  allowSignIn: boolean;
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
      {signedOut && allowSignIn ? <button onClick={props.onSignInWithGoogle} type="button">Sign In</button> : null}
      {needsUsername ? <button onClick={onChooseUsername} type="button">Choose Name</button> : null}
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
  const status = props.worldStatus ?? "online";
  const joining = phase === "joining" || phase === "waiting" || phase === "ready";
  const canJoin = props.authState === "ready" && status !== "maintenance" && status !== "offline" && !joining;
  const accountHint = props.authState === "signed_out" ? "Sign in to join this server."
    : props.authState === "needs_username" ? "Choose a player name before joining."
      : props.authState === "loading" ? "Checking your Lakebed account…"
        : status === "maintenance" ? "Server maintenance in progress."
          : status === "offline" ? "The server is currently offline."
            : "Select a server and click Join Server.";
  const count = Math.max(0, props.onlineCount ?? 0);

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <AccountPanel allowSignIn onChooseUsername={onChooseUsername} props={props} />
      <section className="lc-server-browser__content" aria-label="Multiplayer server list">
        <h1>Play Multiplayer</h1>
        <div className="lc-server-list" role="listbox" aria-label="Available servers">
          <button aria-selected="true" className="lc-server-row is-selected" role="option" type="button">
            <span className="lc-server-icon" aria-hidden="true"><i /><i /><i /></span>
            <span className="lc-server-copy">
              <strong>{props.worldName || "Fern Hollow"}</strong>
              <small>{props.worldDescription || "Lakecraft survival world"}</small>
            </span>
            <span className="lc-server-population">
              <i className={`is-${status}`} aria-hidden="true" />
              <small>{count} / 20</small>
            </span>
          </button>
        </div>
        <p className={`lc-server-hint${phase === "error" ? " is-error" : ""}`} role={phase === "error" ? "alert" : "status"}>{phase === "error" && props.joinError ? props.joinError : accountHint}</p>
        <div className="lc-server-actions">
          <MenuButton disabled={!canJoin} onClick={props.onJoinWorld}><JoinLabel {...props} /></MenuButton>
          <MenuButton disabled>Direct Connection</MenuButton>
          <MenuButton onClick={onBack}>Back</MenuButton>
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
      <AccountPanel allowSignIn={false} onChooseUsername={() => setEditingUsername(true)} props={props} />
      <section className="lc-title-content" aria-label="Lakecraft main menu">
        <header className="lc-title-logo">
          <h1>LAKECRAFT</h1>
          <span>Multiplayer survival on Lakebed</span>
        </header>

        <div className="lc-title-menu">
          <MenuButton onClick={props.onJoinSingleplayer} wide>Singleplayer</MenuButton>
          <MenuButton onClick={() => setPage("multiplayer")} wide>Multiplayer</MenuButton>
          <MenuButton id="lc-title-options" onClick={() => setOptionsOpen(true)} wide>Options…</MenuButton>
        </div>
      </section>
      {showUsername ? <div className="lc-username-layer" role="presentation"><UsernameMenu {...props} onCancel={() => setEditingUsername(false)} /></div> : null}
      <OptionsDialog
        mouseSensitivity={props.settings.mouseSensitivity}
        onBack={() => setOptionsOpen(false)}
        onSensitivityChange={(mouseSensitivity) => props.onSettingsChange({ ...props.settings, mouseSensitivity })}
        onToggleSound={() => props.onSettingsChange({ ...props.settings, soundMuted: !props.settings.soundMuted })}
        open={optionsOpen}
        returnFocusId="lc-title-options"
        soundMuted={props.settings.soundMuted}
      />
      <footer className="lc-title-footer">
        <span>Lakecraft {props.buildLabel || "Alpha"}</span>
        <span>{props.authState === "ready" ? props.username || props.displayName : "craft.lakebed.app"}</span>
      </footer>
    </main>
  );
}
