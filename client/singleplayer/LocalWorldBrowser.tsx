import { useRef, useState } from "preact/hooks";
import { LobbyStyles } from "../lobby/LobbyStyles.tsx";
import { requestDocumentPointerLockHandoff } from "../pointerLockHandoff.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  canPlayLocalWorld,
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
import {
  createLocalWorldForImmediatePlay,
  enterVerifiedCreatedLocalWorld,
  localWorldDeleteState,
  localWorldDialogRef,
} from "./localWorldBrowserIssue.ts";

interface LocalWorldBrowserProps {
  onBack: () => void;
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
.lc-local-world-titlebar{align-items:center;display:grid;grid-template-columns:132px minmax(0,1fr) 132px;margin:0 0 20px;width:100%}
.lc-local-world-titlebar h1{margin:0}
.lc-local-world-back{align-items:center;display:inline-flex;gap:8px;justify-content:center;min-width:0;padding-inline:14px}
.lc-local-world-back span{font-size:18px;line-height:0}
.lc-local-world-header{align-items:end;display:grid;gap:12px;grid-template-columns:minmax(0,1fr) minmax(240px,auto);width:100%}
.lc-local-world-search{display:grid;gap:5px;min-width:0}
.lc-local-world-search span{font-size:13px}
.lc-local-world-search input,.lc-local-world-dialog input,.lc-local-world-dialog select{box-sizing:border-box;min-width:0;width:100%}
.lc-local-world-search input{background:#111;border:2px solid;border-color:#333 #aaa #aaa #333;color:#fff;font:18px/1 var(--lc-pixel-font,monospace);height:46px;outline:0;padding:5px 9px}
.lc-local-world-search input:focus-visible{border-color:#fff;outline:2px solid #fff;outline-offset:2px}
.lc-local-world-header>.lc-menu-button{min-width:240px;white-space:nowrap}
.lc-local-world-stage{background:rgba(0,0,0,.68);border-bottom:2px solid #8a8a8a;border-top:2px solid #111;box-shadow:inset 0 10px 18px rgba(0,0,0,.35);display:flex;flex:1;margin-top:14px;min-height:0;overflow:hidden;width:100%}
.lc-local-world-list{list-style:none;margin:0;min-height:0;overflow-x:hidden;overflow-y:auto;padding:7px;width:100%}
.lc-local-world-row{align-items:stretch;background:#312f2b;border:2px solid #111;box-shadow:inset 0 0 0 1px #67625a;display:grid;gap:8px;grid-template-columns:minmax(0,1fr) auto;margin:0 0 8px;min-width:0;padding:6px}
.lc-local-world-row.is-selected{border-color:#fff;box-shadow:inset 0 0 0 1px #979188}
.lc-local-world-select{appearance:none;background:transparent;border:0;color:#fff;cursor:pointer;display:grid;gap:5px;min-width:0;padding:7px 9px;text-align:left}
.lc-local-world-select strong,.lc-local-world-select small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-local-world-select small{color:#c7c7c7}
.lc-local-world-delete{align-self:center;background:#6d2525;border:2px solid #170707;box-shadow:inset 0 0 0 1px #b75b5b;color:#fff;cursor:pointer;min-width:88px;padding:10px 12px}
.lc-local-world-delete:disabled{cursor:not-allowed;filter:grayscale(1);opacity:.55}
.lc-local-world-select:focus-visible,.lc-local-world-delete:focus-visible,.lc-local-world-header button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.lc-local-world-empty{align-items:center;display:flex;flex:1;justify-content:center;min-height:180px;padding:24px;text-align:center}
.lc-local-world-empty .lc-server-hint{font-size:15px;height:auto;padding:0}
.lc-local-world-feedback{align-items:center;display:grid;gap:8px;grid-template-columns:minmax(0,1fr) auto;min-height:46px;width:100%}
.lc-local-world-feedback-copy{min-width:0}
.lc-local-world-feedback .lc-server-hint{height:auto;min-height:18px;padding:4px 3px}
.lc-local-world-retry{min-width:150px}
.lc-local-world-dialog{background:transparent;border:0;box-sizing:border-box;height:100vh;height:100dvh;margin:0;max-height:none;max-width:none;overflow-y:auto;padding:clamp(16px,5vh,48px) 16px;width:100vw}
.lc-local-world-dialog::backdrop{background:rgba(0,0,0,.72)}
.lc-local-world-dialog .lc-username-menu{margin:auto;width:min(520px,calc(100vw - 32px))}
.lc-local-world-delete-copy{color:#ff8f8f;overflow-wrap:anywhere}
.lc-local-world-dialog label{display:grid;gap:7px;text-align:left}
@media(max-width:560px){
  .lc-local-world-titlebar{grid-template-columns:104px minmax(0,1fr);margin-bottom:14px}
  .lc-local-world-titlebar>span{display:none}
  .lc-local-world-back{padding-inline:8px}
  .lc-local-world-header{align-items:stretch;grid-template-columns:1fr}
  .lc-local-world-header>.lc-menu-button{min-width:0;width:100%}
  .lc-local-world-row{grid-template-columns:minmax(0,1fr) auto}
  .lc-local-world-delete{min-width:72px;padding-inline:8px}
}`;

function SinglePlayerPanorama() {
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

export function SinglePlayerTitleScreen({ onJoinSingleplayer }: { onJoinSingleplayer: () => void }) {
  return (
    <main className="lc-title-screen">
      <LobbyStyles />
      <SinglePlayerPanorama />
      <div className="lc-title-shade" aria-hidden="true" />
      <section className="lc-title-content" aria-label="Lakecraft main menu">
        <header className="lc-title-logo">
          <h1>LAKECRAFT</h1>
          <span>Build worlds that stay in this browser</span>
        </header>
        <div className="lc-title-menu">
          <button className="lc-menu-button is-wide" onClick={onJoinSingleplayer} type="button">Singleplayer</button>
        </div>
      </section>
      <footer className="lc-title-footer"><span>Lakecraft</span><span>Local worlds</span></footer>
    </main>
  );
}

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

export function LocalWorldBrowser({ onBack, onPlay, storage: suppliedStorage }: LocalWorldBrowserProps) {
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
    ? "!World list storage unavailable; no data changed."
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
    const attempt = createLocalWorldForImmediatePlay(storage, {
      name: name.value,
      seedText: seed.value,
      gameMode: mode.value === "creative" ? "creative" : "survival",
    });
    const result = attempt.creation;
    if (!result.ok) {
      fail(result.reason === "world_limit_reached"
        ? `World limit (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}) reached.`
        : "Create failed; storage full/unavailable.");
      return;
    }
    setSelectedId(result.world.id);
    setListing(attempt.listing!);
    closeDialog();
    if (!enterVerifiedCreatedLocalWorld(
      attempt.playable,
      requestDocumentPointerLockHandoff,
      onPlay,
    )) {
      fail("Created world could not be safely opened.");
    }
  }

  function removeConfirmedWorld(confirmed = deleteConfirmed): void {
    if (!confirmed) return;
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
        <div className="lc-local-world-titlebar">
          <button
            aria-label="Back to main menu"
            className="lc-menu-button lc-local-world-back"
            onClick={onBack}
            type="button"
          ><span aria-hidden="true">&#8592;</span> Back</button>
          <h1 id={TITLE_ID} tabIndex={-1}>Select World</h1>
          <span aria-hidden="true" />
        </div>
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

        <div className="lc-local-world-stage">
          {filtered.length ? (
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
          ) : (
            <div className="lc-local-world-empty">{hint(search ? "No worlds match." : "Create a world to start.")}</div>
          )}
        </div>

        <div className="lc-local-world-feedback">
          <div className="lc-local-world-feedback-copy">
            {warning ? hint(warning) : hint(notice || "Worlds save locally in this browser")}
          </div>
          {transactionReadOnly ? (
            <button
              className="lc-menu-button lc-local-world-retry"
              onClick={() => refresh("Storage checked.")}
              type="button"
            >Retry Storage</button>
          ) : null}
        </div>
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
            <h2 className={deleting ? "lc-local-world-delete-copy" : undefined} id={DIALOG_TITLE_ID}>
              {deleting ? "Delete World" : CREATE_LABEL}
            </h2>
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
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      removeConfirmedWorld(event.currentTarget.value === DELETE_PHRASE);
                    }}
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
