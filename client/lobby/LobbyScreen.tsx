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
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return { valid: false, message: "Use only letters, numbers, and _.", normalized };
  }
  return { valid: true, message: "That explorer tag looks good.", normalized };
}

function statusCopy(state: UsernameClaimState, fallback?: string): { tone: string; text: string } {
  if (state === "checking") return { tone: "busy", text: "Checking the registry…" };
  if (state === "available") return { tone: "good", text: "Name available. Claim it when ready." };
  if (state === "saving") return { tone: "busy", text: "Carving your name into the registry…" };
  if (state === "claimed") return { tone: "good", text: "Explorer tag claimed." };
  if (state === "taken") return { tone: "bad", text: fallback || "Another explorer already claimed that name." };
  if (state === "error") return { tone: "bad", text: fallback || "The registry did not answer. Try again." };
  return { tone: "quiet", text: "3–16 characters · letters, numbers, underscore" };
}

function AccountPanel(props: LobbyScreenProps) {
  const [localError, setLocalError] = useState("");
  const validation = useMemo(() => validateLakecraftUsername(props.username), [props.username]);
  const usernameState = props.usernameState ?? "idle";
  const serverStatus = statusCopy(usernameState, props.usernameError);
  const busy = usernameState === "checking" || usernameState === "saving";

  function submitUsername(event: Event) {
    event.preventDefault();
    if (!validation.valid) {
      setLocalError(validation.message);
      return;
    }
    setLocalError("");
    props.onUsernameSubmit(validation.normalized);
  }

  return (
    <section className="lc-lobby-account" aria-labelledby="lc-account-heading">
      <header className="lc-lobby-panel-head">
        <span className="lc-lobby-panel-index">01</span>
        <div>
          <p className="lc-lobby-eyebrow">Explorer registry</p>
          <h2 id="lc-account-heading">Your account</h2>
        </div>
        <span className={`lc-lobby-auth-light is-${props.authState}`} aria-hidden="true" />
      </header>

      {props.authState === "loading" ? (
        <div className="lc-lobby-account-loading" role="status" aria-live="polite">
          <span /><span /><small>Contacting Lakebed Auth…</small>
        </div>
      ) : null}

      {props.authState === "signed_out" ? (
        <div className="lc-lobby-signin">
          <p>A shared world needs a name to remember you by.</p>
          <button className="lc-lobby-google" type="button" onClick={props.onSignInWithGoogle}>
            <span className="lc-lobby-google-mark" aria-hidden="true">G</span>
            <span>Continue with Google</span>
            <span aria-hidden="true">→</span>
          </button>
          <small>Google identifies your account. Your explorer tag is public in-game.</small>
        </div>
      ) : null}

      {props.authState === "needs_username" ? (
        <form className="lc-lobby-username" onSubmit={submitUsername} noValidate>
          <label htmlFor="lc-username">Choose a unique explorer tag</label>
          <div className="lc-lobby-username-row">
            <span aria-hidden="true">@</span>
            <input
              id="lc-username"
              aria-describedby="lc-username-status"
              aria-invalid={Boolean(localError || serverStatus.tone === "bad")}
              autoCapitalize="off"
              autoComplete="username"
              maxLength={16}
              onInput={(event) => {
                setLocalError("");
                props.onUsernameChange(event.currentTarget.value);
              }}
              placeholder="mosswalker"
              spellcheck={false}
              value={props.username}
            />
            <button disabled={busy || !validation.valid} type="submit">{busy ? "Working…" : "Claim"}</button>
          </div>
          <p className={`lc-lobby-username-status is-${localError ? "bad" : serverStatus.tone}`} id="lc-username-status" role={localError || serverStatus.tone === "bad" ? "alert" : "status"}>
            {localError || serverStatus.text}
          </p>
        </form>
      ) : null}

      {props.authState === "ready" ? (
        <div className="lc-lobby-profile">
          <div className="lc-lobby-avatar" aria-hidden="true">
            <span className="lc-lobby-avatar-hair" />
            <span className="lc-lobby-avatar-eye is-left" />
            <span className="lc-lobby-avatar-eye is-right" />
          </div>
          <div className="lc-lobby-profile-copy">
            <span>Signed in as</span>
            <strong>{props.displayName || props.username || "Explorer"}</strong>
            {props.email ? <small>{props.email}</small> : null}
          </div>
          {props.onSignOut ? <button className="lc-lobby-text-button" type="button" onClick={props.onSignOut}>Sign out</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function JoinButton({ props, disabled }: { props: LobbyScreenProps; disabled: boolean }) {
  const phase = props.joinPhase ?? "idle";
  let label = "Join world";
  let detail = "ENTER";
  if (props.authState === "signed_out") label = "Sign in to join";
  else if (props.authState === "needs_username") label = "Claim a name first";
  else if (phase === "joining") { label = "Opening world…"; detail = "···"; }
  else if (phase === "waiting") { label = "Waiting for a slot"; detail = props.queuePosition ? `#${props.queuePosition}` : "···"; }
  else if (phase === "ready") { label = "Entering world"; detail = "→"; }
  else if (phase === "error") { label = "Try joining again"; detail = "↻"; }
  else if (props.worldStatus === "maintenance") label = "World under repair";
  else if (props.worldStatus === "offline") label = "World offline";

  return (
    <button className={`lc-lobby-join is-${phase}`} disabled={disabled} onClick={props.onJoinWorld} type="button">
      <span>{label}</span><kbd>{detail}</kbd>
    </button>
  );
}

function WorldPanel(props: LobbyScreenProps) {
  const status = props.worldStatus ?? "online";
  const phase = props.joinPhase ?? "idle";
  const readyForAccount = props.authState === "ready";
  const worldAvailable = status === "online" || status === "busy";
  const joining = phase === "joining" || phase === "waiting" || phase === "ready";
  const disabled = !readyForAccount || !worldAvailable || joining;

  return (
    <section className="lc-lobby-world-card" aria-labelledby="lc-world-heading">
      <div className="lc-lobby-world-thumb" aria-hidden="true">
        <span className="lc-lobby-world-sun" />
        <span className="lc-lobby-world-hill is-far" />
        <span className="lc-lobby-world-hill is-near" />
        <span className="lc-lobby-world-tree" />
        <span className="lc-lobby-world-player" />
      </div>
      <div className="lc-lobby-world-body">
        <header>
          <div>
            <p className="lc-lobby-eyebrow">Main multiplayer world</p>
            <h2 id="lc-world-heading">{props.worldName || "Fern Hollow"}</h2>
          </div>
          <div className={`lc-lobby-server-state is-${status}`}>
            <span aria-hidden="true" />
            {status === "online" ? "Online" : status === "busy" ? "Crowded" : status === "maintenance" ? "Repairing" : "Offline"}
          </div>
        </header>
        <p>{props.worldDescription || "A persistent frontier shaped by everyone. Build gently; somebody may live downstream."}</p>
        <dl>
          <div><dt>Players</dt><dd>{Math.max(0, props.onlineCount ?? 0)} online</dd></div>
          <div><dt>Mode</dt><dd>Survival · Shared</dd></div>
          <div><dt>Region</dt><dd>Lakebed · 01</dd></div>
        </dl>
        <JoinButton props={props} disabled={disabled} />
        {phase === "waiting" ? (
          <div className="lc-lobby-wait" role="status" aria-live="polite"><span /><p>Keeping your place at the trailhead{props.queuePosition ? ` · position ${props.queuePosition}` : ""}</p></div>
        ) : null}
        {phase === "error" && props.joinError ? <p className="lc-lobby-join-error" role="alert">{props.joinError}</p> : null}
      </div>
    </section>
  );
}

export function LobbyScreen(props: LobbyScreenProps) {
  return (
    <main className="lc-lobby-shell">
      <LobbyStyles />
      <div className="lc-lobby-panorama" aria-hidden="true">
        <div className="lc-lobby-sky-grain" />
        <span className="lc-lobby-orb" />
        <span className="lc-lobby-cloud is-one" /><span className="lc-lobby-cloud is-two" />
        <span className="lc-lobby-range is-back" /><span className="lc-lobby-range is-mid" />
        <span className="lc-lobby-ground" />
        <span className="lc-lobby-tree is-one" /><span className="lc-lobby-tree is-two" /><span className="lc-lobby-tree is-three" />
        <span className="lc-lobby-cube is-one" /><span className="lc-lobby-cube is-two" />
      </div>

      <div className="lc-lobby-content">
        <header className="lc-lobby-title">
          <p><span /> A Lakebed experiment <span /></p>
          <h1 aria-label="Lakecraft"><span>Lake</span><span>craft</span></h1>
          <small>Build together. Break things responsibly.</small>
        </header>

        <div className="lc-lobby-grid">
          <AccountPanel {...props} />
          <WorldPanel {...props} />
        </div>

        <footer className="lc-lobby-footer">
          <nav aria-label="Lakecraft information">
            <button onClick={props.onOpenHelp} type="button">How to play <kbd>?</kbd></button>
            <button onClick={props.onOpenSettings} type="button">Settings <kbd>⚙</kbd></button>
            <button onClick={props.onOpenAbout} type="button">About this experiment <kbd>↗</kbd></button>
          </nav>
          <p><span className="lc-lobby-live-dot" /> Multiplayer travels entirely through Lakebed <small>{props.buildLabel || "ALPHA"}</small></p>
        </footer>
      </div>
    </main>
  );
}
