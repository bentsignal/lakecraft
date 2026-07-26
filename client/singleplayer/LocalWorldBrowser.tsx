import { useRef, useState } from "preact/hooks";
import { LobbyStyles } from "../lobby/LobbyStyles.tsx";
import { requestDocumentPointerLockHandoff } from "../pointerLockHandoff.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  canPlayLocalWorld,
  createLocalWorld,
  deleteLocalWorld,
  isLocalWorldRegistryTransactionReadOnly,
  listLocalWorlds,
  resolveLocalWorldPlay,
  touchLocalWorld,
  type LocalWorldInspection,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";
import {
  browserSinglePlayerStorage,
  type SinglePlayerStorageAdapter,
} from "./localSave.ts";
import { localWorldDeleteState, localWorldDialogRef } from "./localWorldBrowserIssue.ts";

interface LocalWorldBrowserProps {
  onPlay: (world: LocalWorldRecord, pointerLockHandoff: boolean) => void;
  storage?: SinglePlayerStorageAdapter;
}

const enum MODAL {
  CREATE = 1,
  DELETE,
}
type Modal = 0 | MODAL.CREATE | MODAL.DELETE;

const READ_ONLY = "Unverified transactions: storage is read-only.";
const TITLE_ID = "lc-world-browser-title";
const DIALOG_TITLE_ID = "lc-world-dialog-title";
const CREATE_LABEL = "Create New World";
const DELETE_PHRASE = "yes, I want to delete this world";

const WORLD_BROWSER_CSS = `
.lc-local-world-browser,.lc-local-world-browser *,.lc-local-world-dialog,.lc-local-world-dialog *{text-shadow:none}
.lc-local-world-browser{overflow:hidden}
.lc-local-world-browser .lc-server-browser__content{box-sizing:border-box;display:flex;flex-direction:column;height:100dvh;min-height:0;overflow:hidden}
.lc-local-world-header{align-items:end;display:grid;gap:12px;grid-template-columns:minmax(0,1fr) 220px;width:100%}
.lc-local-world-search{display:grid;gap:5px;min-width:0}
.lc-local-world-search span{font-size:13px}
.lc-local-world-search input,.lc-local-world-dialog input,.lc-local-world-dialog select{box-sizing:border-box;min-width:0;width:100%}
.lc-local-world-list{list-style:none;margin:14px 0 0;min-height:0;overflow-x:hidden;overflow-y:auto;padding:0;width:100%}
.lc-local-world-row{align-items:stretch;background:#312f2b;border:2px solid #111;box-shadow:inset 0 0 0 1px #67625a;display:grid;gap:8px;grid-template-columns:minmax(0,1fr) auto;margin:0 0 8px;min-width:0;padding:6px}
.lc-local-world-row.is-selected{border-color:#fff;box-shadow:inset 0 0 0 1px #979188}
.lc-local-world-select{appearance:none;background:transparent;border:0;color:#fff;cursor:pointer;display:grid;gap:5px;min-width:0;padding:7px 9px;text-align:left}
.lc-local-world-select strong,.lc-local-world-select small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-local-world-select small{color:#c7c7c7}
.lc-local-world-delete{align-self:center;background:#6d2525;border:2px solid #170707;box-shadow:inset 0 0 0 1px #b75b5b;color:#fff;cursor:pointer;min-width:88px;padding:10px 12px}
.lc-local-world-delete:disabled{cursor:not-allowed;filter:grayscale(1);opacity:.55}
.lc-local-world-select:focus-visible,.lc-local-world-delete:focus-visible,.lc-local-world-header button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.lc-local-world-empty{margin:auto 0}
.lc-local-world-retry{margin-top:10px}
.lc-local-world-dialog .lc-username-menu{width:min(520px,calc(100vw - 40px))}
.lc-local-world-delete-copy{overflow-wrap:anywhere}
.lc-local-world-dialog label{display:grid;gap:7px;text-align:left}
@media(max-width:560px){
  .lc-local-world-header{align-items:stretch;grid-template-columns:1fr}
  .lc-local-world-header button{width:100%}
  .lc-local-world-row{grid-template-columns:minmax(0,1fr) auto}
  .lc-local-world-delete{min-width:72px;padding-inline:8px}
}`;

function dateText(value: number): string {
  return value ? new Date(value).toLocaleString() : "Never";
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
  const [listing, setListing] = useState(() => listLocalWorlds(storage));
  const { registryLoad, worlds } = listing;
  const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(registryLoad);
  const [selectedId, setSelectedId] = useState<string | null>(worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(0);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [notice, setNotice] = useState("");
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [mountDialog] = useState(() =>
    localWorldDialogRef(restoreFocusRef, () => document.getElementById(TITLE_ID)));

  const filtered = worlds.filter(({ world }) =>
    world.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null;
  const blocked = registryLoad.registry === null;
  const [deleteWarning, deleteBlocked] = localWorldDeleteState(registryLoad.issues);
  const warning = blocked
    ? "!Corrupt/newer list; no data changed."
    : transactionReadOnly
      ? `!${READ_ONLY} Play and changes are disabled until recovery.`
      : deleteWarning;
  const deleting = modal === MODAL.DELETE;
  const confirmedWorld = deleting ? selected?.world ?? null : null;
  const deleteConfirmed = deletePhrase === DELETE_PHRASE;

  function fail(text: string): void {
    setNotice(`!${text}`);
  }

  function closeDialog(): void {
    setDeletePhrase("");
    setModal(0);
  }

  function refresh(text: string): void {
    setListing(listLocalWorlds(storage));
    setNotice(text);
    closeDialog();
  }

  function openModal(next: Exclude<Modal, 0>, opener: HTMLElement): void {
    if (transactionReadOnly) {
      fail(READ_ONLY);
      return;
    }
    restoreFocusRef.current = opener;
    setDeletePhrase("");
    setNotice("");
    setModal(next);
  }

  function play(entry: LocalWorldInspection | null): void {
    if (!entry || transactionReadOnly || !canPlayLocalWorld(entry)) {
      if (transactionReadOnly) fail(READ_ONLY);
      return;
    }
    const result = touchLocalWorld(storage, entry.world.id, Date.now(), entry.world);
    const playable = resolveLocalWorldPlay(storage, entry, result);
    if (!playable) {
      fail("Unsafe world update blocked.");
      return;
    }
    onPlay(playable, requestDocumentPointerLockHandoff());
  }

  function create(form: HTMLFormElement): void {
    if (transactionReadOnly) {
      fail(READ_ONLY);
      closeDialog();
      return;
    }
    const name = form.elements.namedItem("world-title") as HTMLInputElement | null;
    const seed = form.elements.namedItem("world-seed") as HTMLInputElement | null;
    const mode = form.elements.namedItem("world-mode") as HTMLSelectElement | null;
    if (!name || !seed || !mode) {
      fail("Create failed safely.");
      return;
    }
    const result = createLocalWorld(storage, {
      name: name.value,
      seedText: seed.value,
      gameMode: mode.value === "creative" ? "creative" : "survival",
    });
    if (!result.ok) {
      fail(result.reason === "world_limit_reached"
        ? `World limit (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}) reached.`
        : "Create failed; storage full/unavailable.");
      return;
    }
    setSelectedId(result.world.id);
    refresh(`Created ${result.world.name}.`);
  }

  function removeConfirmedWorld(): void {
    if (!deleteConfirmed) return;
    if (transactionReadOnly) {
      fail(READ_ONLY);
      closeDialog();
      return;
    }
    if (!confirmedWorld) {
      fail("World no longer listed.");
      return;
    }
    const result = deleteLocalWorld(storage, confirmedWorld.id);
    if (!result.ok) {
      fail("Delete failed safely.");
      return;
    }
    restoreFocusRef.current = null;
    setSelectedId(result.registry.worlds[0]?.id ?? null);
    refresh(`Deleted ${confirmedWorld.name}.`);
  }

  return (
    <main className="lc-server-browser lc-local-world-browser">
      <LobbyStyles />
      <style>{WORLD_BROWSER_CSS}</style>
      <div className="lc-dirt-background" aria-hidden="true" />
      <section className="lc-server-browser__content" aria-label="Local world browser">
        <h1 id={TITLE_ID} tabIndex={-1}>Select World</h1>
        <div className="lc-local-world-header">
          <label className="lc-local-world-search">
            <span>Search worlds</span>
            <input
              aria-label="Search worlds"
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search"
              type="search"
            />
          </label>
          <button
            className="lc-menu-button"
            disabled={blocked || transactionReadOnly || worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS}
            onClick={(event) => openModal(MODAL.CREATE, event.currentTarget)}
            type="button"
          >{CREATE_LABEL}</button>
        </div>

        <ul aria-label="Local worlds" className="lc-local-world-list">
          {filtered.map((entry) => {
            const active = entry.world.id === selected?.world.id;
            return (
              <li className={`lc-local-world-row${active ? " is-selected" : ""}`} key={entry.world.id}>
                <button
                  aria-pressed={active}
                  className="lc-local-world-select"
                  onClick={() => setSelectedId(entry.world.id)}
                  onDblClick={() => play(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      play(entry);
                    }
                  }}
                  type="button"
                >
                  <strong>{entry.world.name}</strong>
                  <small>Last played {dateText(entry.world.lastPlayedAt)}</small>
                </button>
                <button
                  aria-label={`Delete ${entry.world.name}`}
                  className="lc-local-world-delete"
                  disabled={deleteBlocked || transactionReadOnly}
                  onClick={(event) => {
                    setSelectedId(entry.world.id);
                    openModal(MODAL.DELETE, event.currentTarget);
                  }}
                  type="button"
                >Delete</button>
              </li>
            );
          })}
        </ul>

        {!filtered.length
          ? <div className="lc-local-world-empty">{hint(search ? "No worlds match." : "Create a world to start.")}</div>
          : null}
        {warning ? hint(warning) : null}
        {transactionReadOnly ? (
          <button
            className="lc-menu-button lc-local-world-retry"
            onClick={() => refresh("Storage checked.")}
            type="button"
          >Retry Storage</button>
        ) : null}
        {hint(notice || "Local worlds · no Lakebed traffic")}
      </section>

      {modal ? (
        <dialog
          aria-labelledby={DIALOG_TITLE_ID}
          className="lc-username-layer lc-local-world-dialog"
          onClose={closeDialog}
          ref={mountDialog}
          role={deleting ? "alertdialog" : undefined}
        >
          <form
            className="lc-username-menu"
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (deleting) removeConfirmedWorld();
              else create(event.currentTarget);
            }}
          >
            <h2 id={DIALOG_TITLE_ID}>{deleting ? "Delete World" : CREATE_LABEL}</h2>
            {deleting ? (
              <>
                <p>Delete {confirmedWorld?.name ?? "this world"} and all local progress? This cannot be undone.</p>
                <label>
                  <span className="lc-local-world-delete-copy">
                    Type <strong>{DELETE_PHRASE}</strong> to confirm
                  </span>
                  <input
                    aria-label="Delete confirmation phrase"
                    autoComplete="off"
                    autoFocus
                    onInput={(event) => setDeletePhrase(event.currentTarget.value)}
                    value={deletePhrase}
                  />
                </label>
              </>
            ) : (
              <>
                <input aria-label="World Name" autoFocus defaultValue="New World" maxLength={48} name="world-title" />
                <input aria-label="Seed" name="world-seed" placeholder="Seed (blank: Lakecraft)" />
                <select aria-label="Game Mode" className="lc-menu-button" name="world-mode">
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                </select>
              </>
            )}
            {notice[0] === "!" ? hint(notice) : null}
            <button
              className="lc-menu-button"
              disabled={deleting && !deleteConfirmed}
              type="submit"
            >{deleting ? "Delete World" : "Create World"}</button>
            <button className="lc-menu-link" onClick={closeDialog} type="button">Cancel</button>
          </form>
        </dialog>
      ) : null}
    </main>
  );
}
