import { useRef, useState } from "preact/hooks";
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

const enum ACTION {
  CREATE = 1,
  DELETE,
  RESET,
  LEGACY_RESET,
  PLAY,
  IMPORT,
  RETRY,
}
type Modal = 0 | ACTION.CREATE | ACTION.DELETE | ACTION.RESET | ACTION.LEGACY_RESET;
type Action = readonly [label: string, disabled: boolean, action: number];

const READ_ONLY = "Unverified transactions: storage is read-only.";
const TITLE_ID = "lc-world-browser-title";
const DIALOG_TITLE_ID = "lc-world-dialog-title";
const CREATE_LABEL = "Create New World";
const LEGACY = "Legacy ";
const CREATE_FIELDS = '<input aria-label="World Name" value="New World" maxlength=48>'
  + '<input aria-label=Seed placeholder="Seed (blank: Lakecraft)">'
  + '<select aria-label="Game Mode" class=lc-menu-button>'
  + "<option>Survival</option><option>Creative</option></select>";

function dateText(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function worldText(entry: LocalWorldInspection): string {
  const { world } = entry;
  const parts = [
    world.name,
    capitalize(entry.gameMode),
    `Last played ${dateText(world.lastPlayedAt)}`,
    `Last saved ${dateText(entry.lastSavedAt)}`,
    `seed ${world.seed}`,
  ];
  const health = entry.health === "unsupported"
    ? "Newer version"
    : capitalize(entry.health);
  const capacity = entry.capacity === "ok" ? "OK"
    : entry.capacity === "warning" ? "low"
      : entry.capacity === "exceeded" ? "full" : "unavailable";
  parts.push(health, `Storage ${capacity}`);
  return parts.join(" · ");
}

function hint(text: string) {
  const error = text[0] === "!";
  return (
    <p
      className={`lc-server-hint${error ? " is-error" : ""}`}
      role={error ? "alert" : "status"}
    >{text.slice(+error)}</p>
  );
}

export function LocalWorldBrowser({ onPlay, storage: suppliedStorage }: LocalWorldBrowserProps) {
  const [storage] = useState(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    return suppliedStorage ?? browserSinglePlayerStorage();
  });
  const [[listing, legacy], setListing] = useState(
    () => [listLocalWorlds(storage), inspectLegacyLocalWorld(storage)] as const,
  );
  const { registryLoad, worlds } = listing;
  const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(registryLoad);
  const [selectedId, setSelectedId] = useState<string | null>(worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(
    worlds.length === 0 && registryLoad.registry !== null && !transactionReadOnly
      ? ACTION.CREATE
      : 0,
  );
  const [notice, setNotice] = useState("");
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const mountDialog = useRef((dialog: HTMLDialogElement | null) => {
    if (dialog) {
      dialog.showModal();
      return;
    }
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!restore?.isConnected || (restore as HTMLButtonElement).disabled) {
      document.getElementById(TITLE_ID)?.focus();
    }
  }).current;
  const creating = modal === ACTION.CREATE;
  const deleting = modal === ACTION.DELETE;

  const filtered = worlds.filter(({ world }) =>
    world.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null;

  const issues = registryLoad.issues;
  const blocked = registryLoad.registry === null;
  const deleteRecoveryPending = !blocked
    && issues.some((issue) => /^delete:(transaction_read_failed|invalid_transaction_pending|recovery_pending)$/.test(issue));
  const invalidDeleteIgnored = !blocked && issues.includes("delete:invalid_transaction_cleared");
  const deleteRecoveryCompleted = !blocked && !deleteRecoveryPending && !invalidDeleteIgnored
    && issues.some((issue) => /^delete:(rollback|cleanup)_completed$/.test(issue));
  const imported = worlds.some(({ world }) => world.importedLegacy);
  const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected));
  const confirmedWorld = modal > ACTION.CREATE && modal < ACTION.LEGACY_RESET ? selected?.world : null;
  const confirmedName = confirmedWorld?.name ?? "this world";
  const warning = blocked
    ? "!Corrupt/newer list; no data changed."
    : transactionReadOnly
      ? `!${READ_ONLY} Play and changes are disabled until recovery.`
      : deleteRecoveryPending
        ? "!Deletion committed; cleanup pending."
        : invalidDeleteIgnored
          ? "!Invalid deletion ignored. Worlds remain available; orphaned data may remain."
          : deleteRecoveryCompleted
            ? "Deletion recovered; other worlds unchanged."
            : "";

  function fail(text: string): void {
    setNotice(`!${text}`);
  }

  function refresh(text: string): void {
    setListing([listLocalWorlds(storage), inspectLegacyLocalWorld(storage)]);
    setNotice(text);
    setModal(0);
  }

  function play(): void {
    if (!selected || !selectedPlayable) {
      if (transactionReadOnly) fail(READ_ONLY);
      return;
    }
    const result = touchLocalWorld(storage, selected.world.id, Date.now(), selected.world);
    const playable = resolveLocalWorldPlay(storage, selected, result);
    if (!playable) {
      fail("Unsafe world update blocked.");
      return;
    }
    onPlay(playable, requestDocumentPointerLockHandoff());
  }

  function perform(action: number, form?: HTMLFormElement): void {
    if (action === ACTION.RETRY) {
      refresh("Storage checked.");
      return;
    }
    if (action === ACTION.PLAY) {
      play();
      return;
    }
    if (transactionReadOnly) {
      fail(READ_ONLY);
      if (modal) setModal(0);
      return;
    }
    if (action <= ACTION.LEGACY_RESET && modal !== action) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setNotice("");
      setModal(action as Exclude<Modal, 0>);
      return;
    }
    if (action === ACTION.CREATE || action === ACTION.IMPORT) {
      const fields = form?.elements as (HTMLFormControlsCollection & {
        0: HTMLInputElement;
        1: HTMLInputElement;
        2: HTMLSelectElement;
      }) | undefined;
      const result = fields
        ? createLocalWorld(storage, {
          name: fields[0].value,
          seedText: fields[1].value,
          gameMode: fields[2].selectedIndex ? "creative" : "survival",
        })
        : importLegacyLocalWorld(storage, { name: "Imported World" });
      if (!result.ok) {
        fail(fields
          ? result.reason === "world_limit_reached"
            ? `World limit (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}) reached.`
            : "Create failed; storage full/unavailable."
          : `${LEGACY}import failed; source remains.`);
        return;
      }
      setSelectedId(result.world.id);
      refresh(fields ? `Created ${result.world.name}.` : `${LEGACY}imported; reset source separately.`);
      return;
    }
    if (action === ACTION.LEGACY_RESET) {
      const result = resetLegacyLocalWorld(storage);
      if (!result.ok) fail(`${LEGACY}reset failed; data kept.`);
      else refresh(`${LEGACY}reset.`);
      return;
    }
    if (!confirmedWorld) {
      fail("World no longer listed.");
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

  const actions: Action[] = [
    ["Play World", !selectedPlayable, ACTION.PLAY],
    [CREATE_LABEL, blocked || transactionReadOnly || worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS,
      ACTION.CREATE],
    ["Reset World…", !selected || transactionReadOnly, ACTION.RESET],
    ["Delete World…", !selected || deleteRecoveryPending || transactionReadOnly, ACTION.DELETE],
  ];
  if (transactionReadOnly) actions.push(["Retry Storage", false, ACTION.RETRY]);
  if (legacy.status !== "none") {
    actions.push(
      [imported ? `${LEGACY}Imported` : `Import ${LEGACY}World`,
        legacy.status !== "available" || blocked || transactionReadOnly || imported, ACTION.IMPORT],
      [`Reset ${LEGACY}Data…`, transactionReadOnly, ACTION.LEGACY_RESET],
    );
  }

  return (
    <main className="lc-server-browser">
      <LobbyStyles />
      <div className="lc-dirt-background" aria-hidden="true" />
      <section
        className="lc-server-browser__content"
        aria-label="Local world browser"
        onClick={(event) => {
          const action = +(event.target as HTMLElement).id;
          if (action) perform(action);
        }}
      >
        <h1 id={TITLE_ID} tabIndex={-1}>Select World</h1>
        <div className="lc-username-menu">
          <input
            aria-label="Search worlds"
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search"
            type="search"
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
        {!filtered.length ? hint(search ? "No worlds match." : "Create a world to start.") : null}
        {warning ? hint(warning) : null}
        {legacy.status !== "none"
          ? hint(`${LEGACY}world found. Import or reset manually; never automatic.`) : null}
        <div className="lc-server-actions">
          {actions.map(([text, disabled, action]) =>
            menuButton(text, undefined, disabled, 0, action))}
        </div>
        {hint(notice || "Local worlds · no Lakebed traffic")}
      </section>

      {modal ? (
        <dialog
          aria-labelledby={DIALOG_TITLE_ID}
          className="lc-username-layer"
          onClose={() => setModal(0)}
          ref={mountDialog}
          role={creating ? undefined : "alertdialog"}
        >
          <form
            className="lc-username-menu"
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              perform(modal, event.currentTarget);
            }}
          >
            <h2 id={DIALOG_TITLE_ID}>{creating ? CREATE_LABEL : "Confirm deletion/reset"}</h2>
            {creating ? (
              <div dangerouslySetInnerHTML={{ __html: CREATE_FIELDS }} />
            ) : (
              <p>
                {deleting ? `Delete ${confirmedName} and local progress?`
                  : modal === ACTION.RESET ? `Reset ${confirmedName} to original seed/mode?`
                    : "Reset legacy data?"} This cannot be undone.
              </p>
            )}
            {notice[0] === "!" ? hint(notice) : null}
            {menuButton(creating ? "Create World" : `Confirm ${deleting ? "Delete" : "Reset"}`, undefined, false, 1)}
            <button autoFocus className="lc-menu-link" onClick={() => setModal(0)} type="button">Cancel</button>
          </form>
        </dialog>
      ) : null}
    </main>
  );
}
