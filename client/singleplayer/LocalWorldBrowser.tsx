import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LobbyStyles } from "../lobby/LobbyStyles.tsx";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  canPlayLocalWorld,
  createLocalWorld,
  deleteLocalWorld,
  importLegacyLocalWorld,
  inspectLegacyLocalWorld,
  isLocalWorldRegistryTransactionReadOnly,
  listLocalWorlds,
  resetLegacyLocalWorld,
  resetLocalWorldData,
  resolveLocalWorldPlay,
  touchLocalWorld,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";
import {
  browserSinglePlayerStorage,
  type SinglePlayerStorageAdapter,
} from "./localSave.ts";

interface LocalWorldBrowserProps {
  onPlay: (world: LocalWorldRecord, pointerLockHandoff: boolean) => void;
  storage?: SinglePlayerStorageAdapter;
}

const CREATE = 1;
const DELETE = 2;
const RESET = 3;
const LEGACY_RESET = 4;
type Modal = 0 | typeof CREATE | typeof DELETE | typeof RESET | typeof LEGACY_RESET;
type Action = readonly [label: string, disabled: boolean, run: () => void];

const READ_ONLY = "World storage is read-only until pending transaction state can be verified.";
const HEALTH_LABELS = {
  ready: "Ready",
  healthy: "Healthy",
  recovered: "Recovered backup",
  corrupt: "Corrupt save",
  unsupported: "Newer save format",
} as const;
const CAPACITY_LABELS = {
  ok: "Storage OK",
  warning: "Storage near limit",
  exceeded: "Storage limit exceeded",
  unavailable: "Storage unavailable",
} as const;

function dateText(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function requestPointerLockHandoff(): boolean {
  if (typeof document.documentElement.requestPointerLock !== "function") return false;
  try {
    void Promise.resolve(document.documentElement.requestPointerLock()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function LocalWorldBrowser({ onPlay, storage: suppliedStorage }: LocalWorldBrowserProps) {
  const storage = useMemo(() => suppliedStorage ?? browserSinglePlayerStorage(), [suppliedStorage]);
  const [revision, setRevision] = useState(0);
  const listing = useMemo(() => listLocalWorlds(storage), [revision, storage]);
  const legacy = useMemo(() => inspectLegacyLocalWorld(storage), [revision, storage]);
  const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(listing.registryLoad);
  const [selectedId, setSelectedId] = useState<string | null>(listing.worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(
    listing.worlds.length === 0 && listing.registryLoad.registry !== null && !transactionReadOnly
      ? CREATE
      : 0,
  );
  const [notice, setNotice] = useState<readonly [text: string, error: boolean]>(["", false]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  const query = search.trim().toLocaleLowerCase();
  const filtered = listing.worlds.filter(({ world }) => world.name.toLocaleLowerCase().includes(query));
  const selected = filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!modal) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (!restore?.isConnected || (restore as HTMLButtonElement).disabled) {
        document.getElementById("lc-world-browser-title")?.focus();
      }
    };
  }, [modal]);

  const issues = listing.registryLoad.issues;
  const blocked = listing.registryLoad.registry === null;
  const deleteRecoveryPending = !blocked && issues.some((issue) =>
    issue === "delete:transaction_read_failed"
    || issue === "delete:invalid_transaction_pending"
    || issue === "delete:recovery_pending");
  const invalidDeleteIgnored = !blocked && issues.includes("delete:invalid_transaction_cleared");
  const deleteRecoveryCompleted = !blocked && !deleteRecoveryPending && !invalidDeleteIgnored
    && issues.some((issue) => issue === "delete:rollback_completed" || issue === "delete:cleanup_completed");
  const imported = listing.worlds.some(({ world }) => world.importedLegacy);
  const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected));
  const confirmedWorld = modal !== CREATE && modal !== LEGACY_RESET ? selected?.world : null;
  const warning: readonly [text: string, error: boolean] | null = blocked
    ? ["World list corrupt or from a newer version. No data changed.", true]
    : transactionReadOnly
      ? ["World storage is read-only because pending transaction state could not be verified. Play and world changes are disabled until browser storage recovers.", true]
      : deleteRecoveryPending
        ? ["World deletion cleanup is pending. Healthy worlds remain available; no unverified deletion was applied.", true]
        : invalidDeleteIgnored
          ? ["Ignored an invalid world-deletion marker. Healthy worlds remain available; orphaned storage may remain.", true]
          : deleteRecoveryCompleted
            ? ["Recovered an interrupted world deletion. Other worlds remain unchanged.", false]
            : null;

  function fail(text: string): void {
    setNotice([text, true]);
  }

  function refresh(text: string): void {
    setRevision((value) => value + 1);
    setNotice([text, false]);
    setModal(0);
  }

  function openDialog(next: Exclude<Modal, 0>): void {
    if (transactionReadOnly) {
      fail(READ_ONLY);
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice(["", false]);
    setModal(next);
  }

  function create(form: HTMLFormElement): void {
    if (transactionReadOnly) {
      fail(READ_ONLY);
      return;
    }
    const data = new FormData(form);
    const result = createLocalWorld(storage, {
      name: String(data.get("n") ?? ""),
      seedText: String(data.get("s") ?? ""),
      gameMode: data.get("m") === "creative" ? "creative" : "survival",
    });
    if (!result.ok) {
      fail(result.reason === "world_limit_reached"
        ? `World limit reached (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}).`
        : "World creation failed. Browser storage may be full or unavailable.");
      return;
    }
    setSelectedId(result.world.id);
    refresh(`Created ${result.world.name}.`);
  }

  function play(): void {
    if (!selected || !selectedPlayable) {
      if (transactionReadOnly) fail(READ_ONLY);
      return;
    }
    const result = touchLocalWorld(storage, selected.world.id, Date.now(), selected.world);
    const playable = resolveLocalWorldPlay(storage, selected, result);
    if (!playable) {
      fail("Could not safely update the world list.");
      return;
    }
    onPlay(playable, requestPointerLockHandoff());
  }

  function runConfirmed(): void {
    if (!modal || modal === CREATE) return;
    if (transactionReadOnly) {
      fail(READ_ONLY);
      setModal(0);
      return;
    }
    if (modal === LEGACY_RESET) {
      const result = resetLegacyLocalWorld(storage);
      if (!result.ok) fail("Legacy reset failed; the old data remains visible.");
      else refresh("Legacy data reset.");
      return;
    }
    if (!confirmedWorld) {
      fail("That world is no longer listed.");
      return;
    }
    const result = modal === DELETE
      ? deleteLocalWorld(storage, confirmedWorld.id)
      : resetLocalWorldData(storage, confirmedWorld.id);
    if (!result.ok) fail(`${modal === DELETE ? "Delete" : "Reset"} failed safely.`);
    else {
      if (modal === DELETE) restoreFocusRef.current = null;
      refresh(`${modal === DELETE ? "Deleted" : "Reset"} ${confirmedWorld.name}.`);
    }
  }

  function importLegacy(): void {
    if (transactionReadOnly) {
      fail(READ_ONLY);
      return;
    }
    const result = importLegacyLocalWorld(storage, { name: "Imported World" });
    if (!result.ok) {
      fail("Legacy import failed; the original data remains unchanged.");
      return;
    }
    setSelectedId(result.world.id);
    refresh("Legacy world imported. Reset the original separately when ready.");
  }

  const actions: readonly Action[] = [
    ["Play Selected World", !selectedPlayable, play],
    ["Create New World", blocked || transactionReadOnly || listing.worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS,
      () => openDialog(CREATE)],
    ["Reset World…", !selected || transactionReadOnly, () => openDialog(RESET)],
    ["Delete World…", !selected || deleteRecoveryPending || transactionReadOnly, () => openDialog(DELETE)],
  ];

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <section className="lc-server-browser__content" aria-label="Local world browser">
        <h1 id="lc-world-browser-title" tabIndex={-1}>Select World</h1>
        <div className="lc-username-menu">
          <input
            aria-label="Search worlds"
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search worlds"
            type="search"
            value={search}
          />
        </div>
        <select
          aria-label="Local worlds"
          className="lc-server-list lc-server-row"
          onChange={(event) => setSelectedId(event.currentTarget.value)}
          size={Math.max(3, Math.min(8, filtered.length || 3))}
          value={selected?.world.id ?? ""}
        >
          {filtered.map((entry) => (
            <option key={entry.world.id} value={entry.world.id}>
              {entry.world.name} · {entry.gameMode === "creative" ? "Creative" : "Survival"}
              {" · Last saved "}{dateText(entry.lastSavedAt)}
              {" · "}{HEALTH_LABELS[entry.health]} · {CAPACITY_LABELS[entry.capacity]}
            </option>
          ))}
        </select>
        {!filtered.length ? (
          <p className="lc-server-hint">{search ? "No worlds match." : "Create a world to begin."}</p>
        ) : selected ? (
          <p className={`lc-server-hint${selectedPlayable ? "" : " is-error"}`} role="status">
            {selected.world.name} · {selected.gameMode === "creative" ? "Creative" : "Survival"}
            {" · Last played "}{dateText(selected.world.lastPlayedAt)}
            {" · Last saved "}{dateText(selected.lastSavedAt)}
            {" · seed "}{selected.world.seed} · {HEALTH_LABELS[selected.health]} · {CAPACITY_LABELS[selected.capacity]}
          </p>
        ) : null}
        {warning ? (
          <p className={`lc-server-hint${warning[1] ? " is-error" : ""}`} role={warning[1] ? "alert" : "status"}>
            {warning[0]}
          </p>
        ) : null}
        <div className="lc-server-actions">
          {actions.map(([label, disabled, run]) => (
            <button className="lc-menu-button" disabled={disabled} key={label} onClick={run} type="button">{label}</button>
          ))}
          {transactionReadOnly ? (
            <button className="lc-menu-button" onClick={() => refresh("World storage rechecked.")} type="button">
              Retry World Storage
            </button>
          ) : null}
        </div>
        {legacy.status !== "none" ? (
          <>
            <p className="lc-server-hint">Legacy single world detected. Import or explicitly reset it; migration is never automatic.</p>
            <div className="lc-server-actions">
              <button
                className="lc-menu-button"
                disabled={legacy.status !== "available" || blocked || transactionReadOnly || imported}
                onClick={importLegacy}
                type="button"
              >
                {imported ? "Legacy World Imported" : "Import Legacy World"}
              </button>
              <button
                className="lc-menu-button"
                disabled={transactionReadOnly}
                onClick={() => openDialog(LEGACY_RESET)}
                type="button"
              >Reset Legacy Data…</button>
            </div>
          </>
        ) : null}
        <p className={`lc-server-hint${notice[1] ? " is-error" : ""}`} role={notice[1] ? "alert" : "status"}>
          {notice[0] || "Browser-local worlds · zero Lakebed traffic"}
        </p>
      </section>

      {modal ? (
        <dialog
          aria-labelledby="lc-world-dialog-title"
          className="lc-username-layer"
          onClose={() => setModal(0)}
          ref={dialogRef}
          role={modal === CREATE ? undefined : "alertdialog"}
        >
          <form
            className="lc-username-menu"
            method="dialog"
            onSubmit={(event) => {
              if (modal === CREATE) {
                event.preventDefault();
                create(event.currentTarget);
              }
            }}
          >
            <h2 id="lc-world-dialog-title">{modal === CREATE ? "Create New World" : "Confirm destructive action"}</h2>
            {modal === CREATE ? (
              <>
                <input aria-label="World Name" defaultValue="New World" maxLength={48} name="n" />
                <input aria-label="Seed" name="s" placeholder="Seed (blank = Lakecraft)" />
                <select aria-label="Game Mode" className="lc-menu-button" defaultValue="survival" name="m">
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                </select>
              </>
            ) : (
              <p>
                {modal === DELETE ? `Delete ${confirmedWorld?.name ?? "this world"} and all local progress?`
                  : modal === RESET ? `Reset ${confirmedWorld?.name ?? "this world"} to its original seed and mode?`
                    : "Reset the legacy single-world data?"} This cannot be undone.
              </p>
            )}
            {notice[1] ? <p className="lc-server-hint is-error" role="alert">{notice[0]}</p> : null}
            {modal === CREATE ? (
              <button className="lc-menu-button" type="submit">Create World</button>
            ) : (
              <button className="lc-menu-button" onClick={runConfirmed} type="button">
                Confirm {modal === DELETE ? "Delete" : "Reset"}
              </button>
            )}
            <button autoFocus className="lc-menu-link" onClick={() => setModal(0)} type="button">Cancel</button>
          </form>
        </dialog>
      ) : null}
    </main>
  );
}
