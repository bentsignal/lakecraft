import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LobbyStyles } from "../lobby/LobbyStyles.tsx";
import { menuButton } from "../lobby/menuButton.tsx";
import { requestDocumentPointerLockHandoff } from "../pointerLockHandoff.ts";
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

const CREATE = 1;
const DELETE = 2;
const RESET = 3;
const LEGACY_RESET = 4;
type Modal = 0 | typeof CREATE | typeof DELETE | typeof RESET | typeof LEGACY_RESET;
type Action = readonly [label: string, disabled: boolean, run: () => void];

const READ_ONLY = "Unverified transactions: storage is read-only.";
const HEALTH_LABELS = {
  ready: "Ready",
  healthy: "Healthy",
  recovered: "Recovered",
  corrupt: "Corrupt",
  unsupported: "Newer version",
} as const;
const CAPACITY_LABELS = {
  ok: "Storage OK",
  warning: "Storage low",
  exceeded: "Storage full",
  unavailable: "Storage unavailable",
} as const;

function dateText(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function worldText(entry: LocalWorldInspection, detailed = false): string {
  const { world } = entry;
  const parts = [world.name, entry.gameMode === "creative" ? "Creative" : "Survival"];
  if (detailed) parts.push(`Last played ${dateText(world.lastPlayedAt)}`);
  parts.push(`Last saved ${dateText(entry.lastSavedAt)}`);
  if (detailed) parts.push(`seed ${world.seed}`);
  parts.push(HEALTH_LABELS[entry.health], CAPACITY_LABELS[entry.capacity]);
  return parts.join(" · ");
}

function actionRow(actions: readonly Action[]) {
  return <div className="lc-server-actions">{actions.map(([text, disabled, run]) => menuButton(text, run, disabled))}</div>;
}

function hint(text: string, error = false, announced = false) {
  return (
    <p
      className={`lc-server-hint${error ? " is-error" : ""}`}
      role={announced ? (error ? "alert" : "status") : undefined}
    >{text}</p>
  );
}

export function LocalWorldBrowser({ onPlay, storage: suppliedStorage }: LocalWorldBrowserProps) {
  const storage = useMemo(() => suppliedStorage ?? browserSinglePlayerStorage(), [suppliedStorage]);
  const [revision, setRevision] = useState(0);
  const [listing, legacy] = useMemo(
    () => [listLocalWorlds(storage), inspectLegacyLocalWorld(storage)] as const,
    [revision, storage],
  );
  const { registryLoad, worlds } = listing;
  const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(registryLoad);
  const [selectedId, setSelectedId] = useState<string | null>(worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(
    worlds.length === 0 && registryLoad.registry !== null && !transactionReadOnly
      ? CREATE
      : 0,
  );
  const [notice, setNotice] = useState<readonly [text: string, error: boolean]>(["", false]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const creating = modal === CREATE;
  const deleting = modal === DELETE;

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  const query = search.trim().toLocaleLowerCase();
  const filtered = worlds.filter(({ world }) => world.name.toLocaleLowerCase().includes(query));
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

  const issues = registryLoad.issues;
  const blocked = registryLoad.registry === null;
  const deleteRecoveryPending = !blocked
    && issues.some((issue) => /^delete:(transaction_read_failed|invalid_transaction_pending|recovery_pending)$/.test(issue));
  const invalidDeleteIgnored = !blocked && issues.includes("delete:invalid_transaction_cleared");
  const deleteRecoveryCompleted = !blocked && !deleteRecoveryPending && !invalidDeleteIgnored
    && issues.some((issue) => /^delete:(rollback|cleanup)_completed$/.test(issue));
  const imported = worlds.some(({ world }) => world.importedLegacy);
  const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected));
  const confirmedWorld = modal > CREATE && modal < LEGACY_RESET ? selected?.world : null;
  const confirmedName = confirmedWorld?.name ?? "this world";
  const warning: readonly [text: string, error: boolean] | null = blocked
    ? ["Corrupt/newer world list; no data changed.", true]
    : transactionReadOnly
      ? ["Unverified transactions: storage is read-only. Play and world changes stay disabled until recovery.", true]
      : deleteRecoveryPending
        ? ["Deletion cleanup pending; no unverified deletion applied. Healthy worlds are available.", true]
        : invalidDeleteIgnored
          ? ["Invalid deletion marker ignored. Worlds are available; storage orphans may remain.", true]
          : deleteRecoveryCompleted
            ? ["Interrupted deletion recovered; other worlds unchanged.", false]
            : null;

  function fail(text: string): void {
    setNotice([text, true]);
  }

  function writeBlocked(): boolean {
    if (!transactionReadOnly) return false;
    fail(READ_ONLY);
    return true;
  }

  function refresh(text: string): void {
    setRevision((value) => value + 1);
    setNotice([text, false]);
    setModal(0);
  }

  function openDialog(next: Exclude<Modal, 0>): void {
    if (writeBlocked()) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice(["", false]);
    setModal(next);
  }

  function create(form: HTMLFormElement): void {
    if (writeBlocked()) return;
    const data = new FormData(form);
    const result = createLocalWorld(storage, {
      name: String(data.get("n") ?? ""),
      seedText: String(data.get("s") ?? ""),
      gameMode: data.get("m") === "creative" ? "creative" : "survival",
    });
    if (!result.ok) {
      fail(result.reason === "world_limit_reached"
        ? `World limit (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}) reached.`
        : "Creation failed; storage full/unavailable.");
      return;
    }
    setSelectedId(result.world.id);
    refresh(`Created ${result.world.name}.`);
  }

  function play(): void {
    if (!selected || !selectedPlayable) {
      if (transactionReadOnly) writeBlocked();
      return;
    }
    const result = touchLocalWorld(storage, selected.world.id, Date.now(), selected.world);
    const playable = resolveLocalWorldPlay(storage, selected, result);
    if (!playable) {
      fail("Unsafe world-list update blocked.");
      return;
    }
    onPlay(playable, requestDocumentPointerLockHandoff());
  }

  function runConfirmed(): void {
    if (!modal || creating) return;
    if (writeBlocked()) {
      setModal(0);
      return;
    }
    if (modal === LEGACY_RESET) {
      const result = resetLegacyLocalWorld(storage);
      if (!result.ok) fail("Legacy reset failed; data kept.");
      else refresh("Legacy data reset.");
      return;
    }
    if (!confirmedWorld) {
      fail("World is no longer listed.");
      return;
    }
    const result = deleting
      ? deleteLocalWorld(storage, confirmedWorld.id)
      : resetLocalWorldData(storage, confirmedWorld.id);
    const verb = deleting ? "Delete" : "Reset";
    if (!result.ok) fail(`${verb} failed safely.`);
    else {
      if (deleting) restoreFocusRef.current = null;
      refresh(`${deleting ? "Deleted" : verb} ${confirmedWorld.name}.`);
    }
  }

  function importLegacy(): void {
    if (writeBlocked()) return;
    const result = importLegacyLocalWorld(storage, { name: "Imported World" });
    if (!result.ok) {
      fail("Legacy import failed; original remains.");
      return;
    }
    setSelectedId(result.world.id);
    refresh("Legacy imported. Reset original separately.");
  }

  const actions: readonly Action[] = [
    ["Play World", !selectedPlayable, play],
    ["Create New World", blocked || transactionReadOnly || worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS,
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
            placeholder="Search"
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
              {worldText(entry)}
            </option>
          ))}
        </select>
        {!filtered.length
          ? hint(search ? "No worlds match." : "Create a world to start.")
          : selected ? hint(worldText(selected, true), !selectedPlayable, true) : null}
        {warning ? hint(warning[0], warning[1], true) : null}
        {actionRow(actions)}
        {transactionReadOnly
          ? actionRow([["Retry Storage", false, () => refresh("Storage rechecked.")]])
          : null}
        {legacy.status !== "none" ? (
          <>
            {hint("Legacy world found. Import or reset explicitly; never automatic.")}
            {actionRow([
              [imported ? "Legacy Imported" : "Import Legacy World",
                legacy.status !== "available" || blocked || transactionReadOnly || imported, importLegacy],
              ["Reset Legacy Data…", transactionReadOnly, () => openDialog(LEGACY_RESET)],
            ])}
          </>
        ) : null}
        {hint(notice[0] || "Local worlds · no Lakebed traffic", notice[1], true)}
      </section>

      {modal ? (
        <dialog
          aria-labelledby="lc-world-dialog-title"
          className="lc-username-layer"
          onClose={() => setModal(0)}
          ref={dialogRef}
          role={creating ? undefined : "alertdialog"}
        >
          <form
            className="lc-username-menu"
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (creating) create(event.currentTarget);
              else runConfirmed();
            }}
          >
            <h2 id="lc-world-dialog-title">{creating ? "Create New World" : "Confirm destructive action"}</h2>
            {creating ? (
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
                {deleting ? `Delete ${confirmedName} and its local progress?`
                  : modal === RESET ? `Reset ${confirmedName} to original seed/mode?`
                    : "Reset legacy single-world data?"} This cannot be undone.
              </p>
            )}
            {notice[1] ? hint(notice[0], true, true) : null}
            {menuButton(creating ? "Create World" : `Confirm ${deleting ? "Delete" : "Reset"}`, undefined, false, 1)}
            <button autoFocus className="lc-menu-link" onClick={() => setModal(0)} type="button">Cancel</button>
          </form>
        </dialog>
      ) : null}
    </main>
  );
}
