import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
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
  onSignInWithGoogle: () => void;
  onSignOut?: () => void;
  onUsernameChange: (value: string) => void;
  onUsernameSubmit: (value: string) => void;
  onJoinWorld: () => void;
  onOpenHelp?: () => void;
  onOpenSettings?: () => void;
  onOpenAbout?: () => void;
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

function MenuButton({ children, disabled, onClick, type = "button", wide = false }: { children: ComponentChildren; disabled?: boolean; onClick?: () => void; type?: "button" | "submit"; wide?: boolean }) {
  return <button className={`lc-menu-button${wide ? " is-wide" : ""}`} disabled={disabled} onClick={onClick} type={type}>{children}</button>;
}

function UsernameMenu(props: LobbyScreenProps) {
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
      {props.onSignOut ? <button className="lc-menu-link" onClick={props.onSignOut} type="button">Use another account</button> : null}
    </form>
  );
}

function JoinLabel(props: LobbyScreenProps) {
  const phase = props.joinPhase ?? "idle";
  if (phase === "joining") return <>Connecting to world…</>;
  if (phase === "waiting") return <>Waiting for world{props.queuePosition ? ` (#${props.queuePosition})` : "…"}</>;
  if (phase === "ready") return <>Joining world…</>;
  if (phase === "error") return <>Retry Connection</>;
  return <>Multiplayer</>;
}

export function LobbyScreen(props: LobbyScreenProps) {
  const phase = props.joinPhase ?? "idle";
  const status = props.worldStatus ?? "online";
  const joining = phase === "joining" || phase === "waiting" || phase === "ready";
  const worldUnavailable = status === "maintenance" || status === "offline";

  return (
    <main className="lc-title-screen">
      <LobbyStyles />
      <Panorama />
      <div className="lc-title-shade" aria-hidden="true" />
      <section className="lc-title-content" aria-label="Lakecraft main menu">
        <header className="lc-title-logo">
          <h1>LAKECRAFT</h1>
          <span>Multiplayer survival on Lakebed</span>
        </header>

        {props.authState === "loading" ? <p className="lc-title-loading" role="status">Loading account…</p> : null}

        {props.authState === "signed_out" ? (
          <div className="lc-title-menu">
            <MenuButton onClick={props.onSignInWithGoogle} wide>Sign In with Google</MenuButton>
            <MenuButton disabled wide>Multiplayer</MenuButton>
            <div className="lc-menu-row">
              <MenuButton onClick={props.onOpenSettings}>Options…</MenuButton>
              <MenuButton onClick={props.onOpenAbout}>About</MenuButton>
            </div>
          </div>
        ) : null}

        {props.authState === "needs_username" ? <UsernameMenu {...props} /> : null}

        {props.authState === "ready" ? (
          <div className="lc-title-menu">
            <MenuButton disabled={joining || worldUnavailable} onClick={props.onJoinWorld} wide><JoinLabel {...props} /></MenuButton>
            <div className="lc-world-line" role="status">
              <span className={`is-${status}`} />
              <strong>{props.worldName || "Lakecraft World"}</strong>
              <small>{Math.max(0, props.onlineCount ?? 0)} online</small>
            </div>
            <div className="lc-menu-row">
              <MenuButton onClick={props.onOpenSettings}>Options…</MenuButton>
              <MenuButton onClick={props.onSignOut}>Sign Out</MenuButton>
            </div>
            {phase === "error" && props.joinError ? <p className="lc-title-error" role="alert">{props.joinError}</p> : null}
          </div>
        ) : null}
      </section>
      <footer className="lc-title-footer">
        <span>Lakecraft {props.buildLabel || "Alpha"}</span>
        <span>{props.authState === "ready" ? props.username || props.displayName : "craft.lakebed.app"}</span>
      </footer>
    </main>
  );
}
