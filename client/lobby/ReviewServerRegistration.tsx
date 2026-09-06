import { useMutation } from "lakebed/client";
import { useState } from "preact/hooks";
import { permitsMultiplayerEndpoint } from "../multiplayerEnvironment";
import { LobbyStyles } from "./LobbyStyles";

type Registration = { ok: boolean; reason?: string; server?: { id: string }; serverCredential?: string };

export function ReviewServerRegistration() {
  const params = new URL(window.location.href).searchParams;
  const [endpoint, setEndpoint] = useState(params.get("server") ?? "");
  const [result, setResult] = useState<Registration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const register = useMutation<[unknown], Registration>("registerExternalMultiplayerServer");
  const rotate = useMutation<[string], Registration>("rotateExternalMultiplayerServerCredential");
  const deployId = params.get("deployId") ?? "";

  async function submit(rotation = false) {
    if (busy) return;
    setError("");
    if (!/^dep_[A-Za-z0-9_-]+$/.test(deployId)
      || window.location.origin === "https://craft.lakebed.app"
      || !permitsMultiplayerEndpoint(window.location.origin, endpoint)) {
      setError("Use the setup URL from your isolated Railway binding and a valid WSS address.");
      return;
    }
    setBusy(true);
    try {
      const response = rotation && result?.server
        ? await rotate(result.server.id)
        : await register({ name: "Lakecraft test world", description: "Isolated multiplayer review", canonicalWssUrl: endpoint });
      setResult(response);
      if (!response.ok) setError(response.reason ?? "Registration failed.");
    } catch {
      setError("Registration did not complete. Retry to check whether the server was already registered.");
    } finally { setBusy(false); }
  }

  function download() {
    if (!result?.ok || !result.server || !result.serverCredential) return;
    const file = new Blob([JSON.stringify({ url: window.location.origin, deployId,
      serverId: result.server.id, canonicalWssUrl: endpoint, serverCredential: result.serverCredential }, null, 2)],
    { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lakecraft-review-registration.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="lc-server-browser">
    <LobbyStyles />
    <div className="lc-dirt-background" aria-hidden="true" />
    <section className="lc-server-browser__content" aria-label="Review server registration">
      <h1>Register Test World</h1>
      <p>This registers a world only in this review deployment. Sign-in and join tickets remain required.</p>
      <form className="lc-direct-connect" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor="review-world-url">Railway WSS address</label>
        <input id="review-world-url" value={endpoint} disabled={busy || Boolean(result?.server)}
          onInput={event => setEndpoint(event.currentTarget.value)} spellcheck={false} />
        <button type="submit" disabled={busy || Boolean(result?.server)}>Register world</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result?.reason === "already_registered" ? <button disabled={busy} onClick={() => void submit(true)}>Rotate existing credential</button> : null}
      {result?.ok ? <>
        <p>Registration complete. The download contains a server secret. Keep it private and never commit it.</p>
        <button onClick={download}>Download registration credential</button>
      </> : null}
      <p><a href="/?multiplayer=1">Back to multiplayer</a></p>
    </section>
  </main>;
}
