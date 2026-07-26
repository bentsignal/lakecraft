import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LobbyStyles } from "../lobby/LobbyStyles.tsx";
import type { LocalGameMode } from "./localCommands.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  createLocalWorld,
  deleteLocalWorld,
  importLegacyLocalWorld,
  inspectLegacyLocalWorld,
  listLocalWorlds,
  moveLocalWorldSelection,
  reconcileLocalWorldSelection,
  resetLegacyLocalWorld,
  resetLocalWorldData,
  touchLocalWorld,
  type LocalWorldInspection,
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

type ConfirmAction = { kind: "delete" | "reset"; worldId: string } | { kind: "legacy_reset" } | null;

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
function requestPointerLockHandoff(): boolean {
  if (typeof document.documentElement.requestPointerLock !== "function") return false;
  try {
    void Promise.resolve(document.documentElement.requestPointerLock()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function dateText(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function canPlay(world: LocalWorldInspection): boolean {
  return world.health !== "corrupt" && world.health !== "unsupported" && world.capacity !== "exceeded";
}

export function LocalWorldBrowser({ onPlay, storage: suppliedStorage }: LocalWorldBrowserProps) {
  const storage = useMemo(() => suppliedStorage ?? browserSinglePlayerStorage(), [suppliedStorage]);
  const [revision, setRevision] = useState(0);
  const listing = useMemo(() => listLocalWorlds(storage), [revision, storage]);
  const legacy = useMemo(() => inspectLegacyLocalWorld(storage), [revision, storage]);
  const [selectedId, setSelectedId] = useState<string | null>(listing.worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(listing.worlds.length === 0 && listing.registryLoad.registry !== null);
  const [newName, setNewName] = useState("New World");
  const [newSeed, setNewSeed] = useState("");
  const [newMode, setNewMode] = useState<LocalGameMode>("survival");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);
  const filtered = listing.worlds.filter(({ world }) =>
    world.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visibleWorldIds = filtered.map(({ world }) => world.id);
  const reconciledSelectedId = reconcileLocalWorldSelection(selectedId, visibleWorldIds);
  const visibleWorldKey = visibleWorldIds.join("\u0000");
  useEffect(() => {
    if (selectedId !== reconciledSelectedId) setSelectedId(reconciledSelectedId);
  }, [reconciledSelectedId, selectedId, visibleWorldKey]);
  const modalOpen = createOpen || Boolean(confirm);
  useEffect(() => {
    if (!modalOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-safe-action]")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      const canRestore = restore?.isConnected
        && (!(restore instanceof HTMLButtonElement) || !restore.disabled);
      (canRestore ? restore : fallbackFocusRef.current)?.focus();
    };
  }, [modalOpen]);

  const selected = filtered.find(({ world }) => world.id === reconciledSelectedId) ?? null;
  const confirmedWorld = confirm && confirm.kind !== "legacy_reset"
    ? listing.worlds.find(({ world }) => world.id === confirm.worldId)?.world ?? null
    : null;
  const blocked = listing.registryLoad.registry === null;
  const deleteRecoveryPending = !blocked && listing.registryLoad.issues.some((issue) =>
    issue === "delete:transaction_read_failed"
    || issue === "delete:invalid_transaction_pending"
    || issue === "delete:recovery_pending");
  const invalidDeleteIgnored = !blocked
    && listing.registryLoad.issues.includes("delete:invalid_transaction_cleared");
  const deleteRecoveryCompleted = !blocked && !deleteRecoveryPending && !invalidDeleteIgnored
    && listing.registryLoad.issues.some((issue) => issue === "delete:rollback_completed"
      || issue === "delete:cleanup_completed");
  const imported = listing.worlds.some(({ world }) => world.importedLegacy);

  function rememberDialogTrigger(): void {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError("");
  }

  function openCreateDialog(): void {
    rememberDialogTrigger();
    setCreateOpen(true);
  }

  function openConfirmation(action: Exclude<ConfirmAction, null>): void {
    rememberDialogTrigger();
    setConfirm(action);
  }

  function closeDialog(): void {
    if (dialogRef.current?.open) dialogRef.current.close();
    setCreateOpen(false);
    setConfirm(null);
  }

  function trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button,input,select,[tabindex]")]
      .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function moveSelection(event: KeyboardEvent, worldId: string): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = moveLocalWorldSelection(worldId, visibleWorldIds, event.key);
    if (!next) return;
    setSelectedId(next);
    document.getElementById(`lc-local-world-${next}`)?.focus();
  }

  function refresh(nextMessage: string): void {
    setRevision((value) => value + 1);
    setMessage(nextMessage);
    setError("");
    setConfirm(null);
  }

  function create(): void {
    const result = createLocalWorld(storage, { name: newName, seedText: newSeed, gameMode: newMode });
    if (!result.ok) {
      setError(result.reason === "world_limit_reached"
        ? `World limit reached (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}).`
        : "World creation failed. Browser storage may be full or unavailable.");
      return;
    }
    setSelectedId(result.world.id);
    setCreateOpen(false);
    setNewName("New World");
    setNewSeed("");
    setNewMode("survival");
    refresh(`Created ${result.world.name}.`);
  }

  function play(): void {
    if (!selected || !canPlay(selected)) return;
    const result = touchLocalWorld(storage, selected.world.id);
    if (!result.ok) {
      setError("Could not safely update the world list.");
      return;
    }
    onPlay(result.world, requestPointerLockHandoff());
  }

  function runConfirmed(): void {
    if (!confirm) return;
    if (confirm.kind === "legacy_reset") {
      const result = resetLegacyLocalWorld(storage);
      if (!result.ok) setError("Legacy reset failed; the old data remains visible.");
      else refresh("Legacy data reset.");
      return;
    }
    const world = listing.worlds.find(({ world }) => world.id === confirm.worldId)?.world;
    if (!world) {
      setError("That world is no longer listed.");
      return;
    }
    const result = confirm.kind === "delete"
      ? deleteLocalWorld(storage, world.id)
      : resetLocalWorldData(storage, world.id);
    if (!result.ok) setError(`${confirm.kind === "delete" ? "Delete" : "Reset"} failed safely.`);
    else {
      if (confirm.kind === "delete") restoreFocusRef.current = null;
      refresh(`${confirm.kind === "delete" ? "Deleted" : "Reset"} ${world.name}.`);
    }
  }

  function importLegacy(): void {
    const result = importLegacyLocalWorld(storage, { name: "Imported World" });
    if (!result.ok) {
      setError("Legacy import failed; the original data remains unchanged.");
      return;
    }
    setSelectedId(result.world.id);
    refresh("Legacy world imported. Reset the original separately when ready.");
  }

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <section className="lc-server-browser__content" aria-label="Local world browser" inert={modalOpen}>
        <h1 ref={fallbackFocusRef} tabIndex={-1}>Select World</h1>
        <div className="lc-username-menu">
          <input
            aria-label="Search worlds"
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search worlds"
            type="search"
            value={search}
          />
        </div>
        <div className="lc-server-list" aria-label="Local worlds" role="listbox">
          {filtered.map((entry, index) => (
            <button
              aria-selected={entry.world.id === reconciledSelectedId}
              className={`lc-server-row${entry.world.id === reconciledSelectedId ? " is-selected" : ""}`}
              id={`lc-local-world-${entry.world.id}`}
              key={entry.world.id}
              onClick={() => setSelectedId(entry.world.id)}
              onFocus={() => setSelectedId(entry.world.id)}
              onKeyDown={(event) => moveSelection(event, entry.world.id)}
              role="option"
              tabIndex={entry.world.id === reconciledSelectedId || (reconciledSelectedId === null && index === 0) ? 0 : -1}
              type="button"
            >
              <span className="lc-server-icon" aria-hidden="true"><i /><i /><i /></span>
              <span className="lc-server-copy">
                <strong>{entry.world.name}</strong>
                <small>
                  {entry.gameMode === "creative" ? "Creative" : "Survival"}
                  {" · Last played "}{dateText(entry.world.lastPlayedAt)}
                  {" · Last saved "}{dateText(entry.lastSavedAt)}
                </small>
                <small>{CAPACITY_LABELS[entry.capacity]}</small>
              </span>
              <span className="lc-server-population">
                <i className={canPlay(entry) ? "is-online" : "is-offline"} aria-hidden="true" />
                <small>{HEALTH_LABELS[entry.health]}</small>
              </span>
            </button>
          ))}
          {!filtered.length ? <p className="lc-server-hint">{search ? "No worlds match." : "Create a world to begin."}</p> : null}
        </div>
        {selected ? (
          <p className={`lc-server-hint${canPlay(selected) ? "" : " is-error"}`} role="status">
            {selected.world.name} · seed {selected.world.seed} · {HEALTH_LABELS[selected.health]} · {CAPACITY_LABELS[selected.capacity]}
          </p>
        ) : <p className="lc-server-hint">Select a world.</p>}
        {blocked ? <p className="lc-server-hint is-error" role="alert">World list corrupt or from a newer version. No data changed.</p> : null}
        {deleteRecoveryPending ? (
          <p className="lc-server-hint is-error" role="alert">
            World deletion cleanup is pending. Healthy worlds remain available; no unverified deletion was applied.
          </p>
        ) : invalidDeleteIgnored ? (
          <p className="lc-server-hint is-error" role="alert">
            Ignored an invalid world-deletion marker. Healthy worlds remain available; orphaned storage may remain.
          </p>
        ) : deleteRecoveryCompleted ? (
          <p className="lc-server-hint" role="status">Recovered an interrupted world deletion. Other worlds remain unchanged.</p>
        ) : null}
        <div className="lc-server-actions">
          <button className="lc-menu-button" disabled={!selected || !canPlay(selected)} onClick={play} type="button">Play Selected World</button>
          <button
            className="lc-menu-button"
            disabled={blocked || listing.worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS}
            onClick={openCreateDialog}
            type="button"
          >Create New World</button>
          <button
            className="lc-menu-button"
            disabled={!selected}
            onClick={() => selected && openConfirmation({ kind: "reset", worldId: selected.world.id })}
            type="button"
          >Reset World…</button>
          <button
            className="lc-menu-button"
            disabled={!selected || deleteRecoveryPending}
            onClick={() => selected && openConfirmation({ kind: "delete", worldId: selected.world.id })}
            type="button"
          >Delete World…</button>
        </div>
        {legacy.status !== "none" ? (
          <>
            <p className="lc-server-hint">Legacy single world detected. Import or explicitly reset it; migration is never automatic.</p>
            <div className="lc-server-actions">
              <button className="lc-menu-button" disabled={legacy.status !== "available" || blocked || imported} onClick={importLegacy} type="button">
                {imported ? "Legacy World Imported" : "Import Legacy World"}
              </button>
              <button className="lc-menu-button" onClick={() => openConfirmation({ kind: "legacy_reset" })} type="button">Reset Legacy Data…</button>
            </div>
          </>
        ) : null}
        <p className={`lc-server-hint${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || message || "Browser-local worlds · zero Lakebed traffic"}</p>
      </section>

      {createOpen ? (
        <dialog
          aria-labelledby="lc-create-world-title"
          aria-modal="true"
          className="lc-username-layer"
          onCancel={(event) => { event.preventDefault(); closeDialog(); }}
          onKeyDown={trapDialogFocus}
          ref={dialogRef}
        >
          <form className="lc-username-menu" onSubmit={(event) => { event.preventDefault(); create(); }}>
            <h2 id="lc-create-world-title">Create New World</h2>
            <input aria-label="World Name" maxLength={48} onInput={(event) => setNewName(event.currentTarget.value)} value={newName} />
            <input aria-label="Seed" onInput={(event) => setNewSeed(event.currentTarget.value)} placeholder="Seed (blank = Lakecraft)" value={newSeed} />
            <select aria-label="Game Mode" className="lc-menu-button" onChange={(event) => setNewMode(event.currentTarget.value as LocalGameMode)} value={newMode}>
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
            </select>
            {error ? <p className="lc-server-hint is-error" role="alert">{error}</p> : null}
            <button className="lc-menu-button" type="submit">Create World</button>
            <button autoFocus className="lc-menu-link" data-safe-action onClick={closeDialog} type="button">Cancel</button>
          </form>
        </dialog>
      ) : null}

      {confirm ? (
        <dialog
          aria-labelledby="lc-world-confirm-title"
          aria-modal="true"
          className="lc-username-layer"
          onCancel={(event) => { event.preventDefault(); closeDialog(); }}
          onKeyDown={trapDialogFocus}
          ref={dialogRef}
          role="alertdialog"
        >
          <section className="lc-username-menu">
            <h2 id="lc-world-confirm-title">Confirm destructive action</h2>
            <p>{confirm.kind === "delete" ? `Delete ${confirmedWorld?.name ?? "this world"} and all local progress?`
              : confirm.kind === "reset" ? `Reset ${confirmedWorld?.name ?? "this world"} to its original seed and mode?`
                : "Reset the legacy single-world data?"} This cannot be undone.</p>
            {error ? <p className="lc-server-hint is-error" role="alert">{error}</p> : null}
            <button className="lc-menu-button" onClick={runConfirmed} type="button">
              Confirm {confirm.kind === "delete" ? "Delete" : "Reset"}
            </button>
            <button autoFocus className="lc-menu-link" data-safe-action onClick={closeDialog} type="button">Cancel</button>
          </section>
        </dialog>
      ) : null}
    </main>
  );
}
