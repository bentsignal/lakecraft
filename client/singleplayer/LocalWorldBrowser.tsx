import { useEffect, useMemo, useState } from "preact/hooks";
import type { LocalGameMode } from "./localCommands.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  createLocalWorld,
  deleteLocalWorld,
  importLegacyLocalWorld,
  inspectLegacyLocalWorld,
  listLocalWorlds,
  resetLegacyLocalWorld,
  resetLocalWorldData,
  touchLocalWorld,
  type LegacyLocalWorldInspection,
  type LocalWorldInspection,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";

interface LocalWorldBrowserProps {
  onPlay: (world: LocalWorldRecord, pointerLockHandoff: boolean) => void;
}

type ConfirmAction = { kind: "delete" | "reset"; worldId: string } | { kind: "legacy_reset" } | null;

const LOCAL_WORLD_BROWSER_CSS = `
.lc-world-browser{--panel:#c6c6c6;--edge:#111;--light:#fff;--shadow:#555;box-sizing:border-box;min-height:100dvh;background:linear-gradient(rgba(10,15,20,.62),rgba(10,15,20,.8)),repeating-linear-gradient(45deg,#52683c 0 24px,#485d35 24px 48px);color:#fff;font:16px/1.35 var(--lc-pixel-font,"Courier New",monospace);padding:clamp(18px,4vw,48px)}
.lc-world-browser *{box-sizing:border-box}.lc-world-browser__shell{display:grid;gap:14px;margin:0 auto;max-width:980px}.lc-world-browser h1{font-size:clamp(26px,5vw,42px);letter-spacing:.04em;margin:0;text-align:center;text-shadow:3px 3px #222}.lc-world-browser__subtitle{color:#ddd;margin:0;text-align:center}
.lc-world-browser__toolbar,.lc-world-browser__actions,.lc-world-browser__legacy-actions,.lc-world-browser__form-actions{display:flex;flex-wrap:wrap;gap:10px}.lc-world-browser input,.lc-world-browser select,.lc-world-browser button{font:inherit}.lc-world-browser input,.lc-world-browser select{background:#111;border:2px solid #777;color:#fff;min-height:42px;padding:8px 10px}.lc-world-browser__search{flex:1;min-width:220px}
.lc-world-browser button{background:#777;border:2px solid var(--edge);box-shadow:inset 2px 2px var(--light),inset -2px -2px var(--shadow);color:#fff;cursor:pointer;min-height:42px;padding:8px 16px;text-shadow:2px 2px #333}.lc-world-browser button:hover,.lc-world-browser button:focus-visible{background:#6b6bb6;outline:2px solid #fff;outline-offset:1px}.lc-world-browser button:disabled{cursor:not-allowed;filter:grayscale(1);opacity:.48}
.lc-world-browser__content{display:grid;gap:14px;grid-template-columns:minmax(0,1.55fr) minmax(260px,.85fr)}.lc-world-browser__list,.lc-world-browser__detail,.lc-world-browser__legacy,.lc-world-browser__create,.lc-world-browser__confirm{background:rgba(20,20,20,.9);border:3px solid #111;box-shadow:inset 2px 2px #777,inset -2px -2px #050505;padding:12px}.lc-world-browser__list{display:grid;gap:8px;max-height:56dvh;overflow:auto}
.lc-world-card{background:#2a2a2a;border:2px solid #555;color:#fff;cursor:pointer;display:grid;gap:4px;padding:12px;text-align:left;width:100%}.lc-world-card[aria-selected="true"]{border-color:#fff;box-shadow:inset 0 0 0 2px #777}.lc-world-card strong{font-size:18px}.lc-world-card span{color:#bbb;font-size:13px}.lc-world-card__bad{color:#ff9b8d!important}.lc-world-card__warn{color:#ffd966!important}
.lc-world-browser__detail{align-content:start;display:grid;gap:10px}.lc-world-browser__detail h2,.lc-world-browser__create h2,.lc-world-browser__legacy h2,.lc-world-browser__confirm h2{margin:0}.lc-world-browser__facts{display:grid;gap:7px;margin:0}.lc-world-browser__facts div{display:flex;gap:10px;justify-content:space-between}.lc-world-browser__facts dt{color:#aaa}.lc-world-browser__facts dd{margin:0;text-align:right}.lc-world-browser__danger{background:#963b32!important}.lc-world-browser__form{display:grid;gap:12px}.lc-world-browser__form label{display:grid;gap:5px}.lc-world-browser__legacy p,.lc-world-browser__confirm p{color:#ddd;margin:6px 0 12px}.lc-world-browser__status{color:#a6e3a1;min-height:22px}.lc-world-browser__error{color:#ff9b8d;min-height:22px}.lc-world-browser__empty{color:#bbb;margin:auto;padding:40px 12px;text-align:center}
@media(max-width:720px){.lc-world-browser__content{grid-template-columns:1fr}.lc-world-browser__list{max-height:38dvh}}
`;

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
  if (value === null) return "Never saved";
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
}

function healthLabel(world: LocalWorldInspection): string {
  if (world.health === "healthy") return "Healthy";
  if (world.health === "recovered") return "Recovered backup";
  if (world.health === "corrupt") return "Corrupt save";
  if (world.health === "unsupported") return "Newer save format";
  return "Ready";
}

function capacityLabel(world: LocalWorldInspection): string {
  if (world.capacity === "warning") return "Storage near limit";
  if (world.capacity === "exceeded") return "Storage limit exceeded";
  if (world.capacity === "unavailable") return "Storage unavailable";
  return "Storage OK";
}

function canPlay(world: LocalWorldInspection): boolean {
  return world.health !== "corrupt" && world.health !== "unsupported" && world.capacity !== "exceeded";
}

export function LocalWorldBrowser({ onPlay }: LocalWorldBrowserProps) {
  const [revision, setRevision] = useState(0);
  const listing = useMemo(() => listLocalWorlds(localStorage), [revision]);
  const legacy = useMemo<LegacyLocalWorldInspection>(() => inspectLegacyLocalWorld(localStorage), [revision]);
  const [selectedId, setSelectedId] = useState<string | null>(listing.worlds[0]?.world.id ?? null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(listing.worlds.length === 0 && listing.registryLoad.registry !== null);
  const [newName, setNewName] = useState("New World");
  const [newSeed, setNewSeed] = useState("");
  const [newMode, setNewMode] = useState<LocalGameMode>("survival");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    // The title-screen click may have handed pointer lock to the document. A
    // world list is UI, so release it until Play supplies a fresh user gesture.
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  useEffect(() => {
    if (selectedId && listing.worlds.some(({ world }) => world.id === selectedId)) return;
    setSelectedId(listing.worlds[0]?.world.id ?? null);
  }, [listing.worlds, selectedId]);

  const filteredWorlds = listing.worlds.filter(({ world }) =>
    world.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = listing.worlds.find(({ world }) => world.id === selectedId) ?? null;
  const legacyAlreadyImported = listing.worlds.some(({ world }) => world.importedLegacy);

  function refresh(message = ""): void {
    setRevision((value) => value + 1);
    setStatus(message);
    setError("");
    setConfirmAction(null);
  }

  function createWorld(): void {
    const result = createLocalWorld(localStorage, {
      name: newName,
      seedText: newSeed,
      gameMode: newMode,
    });
    if (!result.ok) {
      setError(result.reason === "world_limit_reached"
        ? `World limit reached (${LOCAL_WORLD_REGISTRY_MAX_WORLDS}). Delete a world before creating another.`
        : result.reason.includes("too_large") || result.reason.includes("storage_write")
          ? "World creation failed because browser storage is full or unavailable."
          : "World creation failed. No existing world was changed.");
      return;
    }
    setSelectedId(result.world.id);
    setShowCreate(false);
    setNewName("New World");
    setNewSeed("");
    setNewMode("survival");
    refresh(`Created ${result.world.name}.`);
  }

  function playSelected(): void {
    if (!selected || !canPlay(selected)) return;
    const touched = touchLocalWorld(localStorage, selected.world.id);
    if (!touched.ok) {
      setError("Could not update the world list safely. The world was not opened.");
      return;
    }
    onPlay(touched.world, requestPointerLockHandoff());
  }

  function runConfirmedAction(): void {
    if (!confirmAction) return;
    if (confirmAction.kind === "legacy_reset") {
      const result = resetLegacyLocalWorld(localStorage);
      if (!result.ok) {
        setError("Legacy reset failed. Remaining data was not hidden or migrated.");
        return;
      }
      refresh("Legacy single-world data reset.");
      return;
    }
    const world = listing.worlds.find(({ world: candidate }) => candidate.id === confirmAction.worldId)?.world;
    if (!world) {
      setError("That world is no longer in the list.");
      return;
    }
    const result = confirmAction.kind === "delete"
      ? deleteLocalWorld(localStorage, world.id)
      : resetLocalWorldData(localStorage, world.id);
    if (!result.ok) {
      setError(result.mutationStarted
        ? `${confirmAction.kind === "delete" ? "Delete" : "Reset"} stopped partway. Reload before retrying.`
        : `${confirmAction.kind === "delete" ? "Delete" : "Reset"} did not start; saved data remains unchanged.`);
      return;
    }
    refresh(confirmAction.kind === "delete" ? `Deleted ${world.name}.` : `Reset ${world.name}.`);
  }

  function importLegacy(): void {
    const result = importLegacyLocalWorld(localStorage, { name: "Imported World" });
    if (!result.ok) {
      setError("Legacy import failed. The original data remains unchanged.");
      return;
    }
    setSelectedId(result.world.id);
    refresh("Legacy world imported. The original remains available until you explicitly reset it.");
  }

  const registryBlocked = listing.registryLoad.registry === null;
  return (
    <main className="lc-world-browser">
      <style>{LOCAL_WORLD_BROWSER_CSS}</style>
      <section className="lc-world-browser__shell" aria-labelledby="lc-world-browser-title">
        <h1 id="lc-world-browser-title">Select World</h1>
        <p className="lc-world-browser__subtitle">Browser-local worlds · zero Lakebed traffic</p>
        <div className="lc-world-browser__toolbar">
          <input
            aria-label="Search worlds"
            className="lc-world-browser__search"
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search worlds"
            type="search"
            value={search}
          />
          <button
            disabled={registryBlocked || listing.worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS}
            onClick={() => setShowCreate((open) => !open)}
            type="button"
          >
            Create New World
          </button>
        </div>

        {registryBlocked ? (
          <section className="lc-world-browser__confirm" role="alert">
            <h2>World list unavailable</h2>
            <p>The world registry is corrupt or from a newer Lakecraft version. No world data was changed.</p>
          </section>
        ) : null}

        {showCreate && !registryBlocked ? (
          <section className="lc-world-browser__create" aria-labelledby="lc-create-world-title">
            <h2 id="lc-create-world-title">Create New World</h2>
            <div className="lc-world-browser__form">
              <label>World Name
                <input maxLength={48} onInput={(event) => setNewName(event.currentTarget.value)} value={newName} />
              </label>
              <label>Seed
                <input
                  aria-describedby="lc-world-seed-help"
                  onInput={(event) => setNewSeed(event.currentTarget.value)}
                  placeholder="Leave blank for Lakecraft"
                  value={newSeed}
                />
                <small id="lc-world-seed-help">The same text always creates the same terrain seed.</small>
              </label>
              <label>Game Mode
                <select onChange={(event) => setNewMode(event.currentTarget.value as LocalGameMode)} value={newMode}>
                  <option value="survival">Survival</option>
                  <option value="creative">Creative</option>
                </select>
              </label>
              <div className="lc-world-browser__form-actions">
                <button onClick={createWorld} type="button">Create World</button>
                <button onClick={() => setShowCreate(false)} type="button">Cancel</button>
              </div>
            </div>
          </section>
        ) : null}

        <div className="lc-world-browser__content">
          <section aria-label="Local worlds" className="lc-world-browser__list" role="listbox">
            {filteredWorlds.length ? filteredWorlds.map((world) => (
              <button
                aria-selected={world.world.id === selectedId}
                className="lc-world-card"
                key={world.world.id}
                onClick={() => setSelectedId(world.world.id)}
                onDblClick={() => {
                  setSelectedId(world.world.id);
                  if (canPlay(world)) {
                    const touched = touchLocalWorld(localStorage, world.world.id);
                    if (touched.ok) onPlay(touched.world, requestPointerLockHandoff());
                  }
                }}
                role="option"
                type="button"
              >
                <strong>{world.world.name}</strong>
                <span>{world.gameMode === "creative" ? "Creative" : "Survival"} · Last played {dateText(world.world.lastPlayedAt || null)}</span>
                <span>Last saved {dateText(world.lastSavedAt)}</span>
                <span className={world.health === "corrupt" || world.health === "unsupported" ? "lc-world-card__bad" : ""}>
                  {healthLabel(world)}
                </span>
                <span className={world.capacity === "warning" ? "lc-world-card__warn"
                  : world.capacity === "exceeded" || world.capacity === "unavailable" ? "lc-world-card__bad" : ""}>
                  {capacityLabel(world)}
                </span>
              </button>
            )) : <p className="lc-world-browser__empty">{search ? "No worlds match your search." : "Create a world to begin."}</p>}
          </section>

          <section className="lc-world-browser__detail" aria-live="polite">
            {selected ? (
              <>
                <h2>{selected.world.name}</h2>
                <dl className="lc-world-browser__facts">
                  <div><dt>Mode</dt><dd>{selected.gameMode === "creative" ? "Creative" : "Survival"}</dd></div>
                  <div><dt>Seed</dt><dd>{selected.world.seed}</dd></div>
                  <div><dt>Health</dt><dd>{healthLabel(selected)}</dd></div>
                  <div><dt>Capacity</dt><dd>{capacityLabel(selected)}</dd></div>
                  <div><dt>Last saved</dt><dd>{dateText(selected.lastSavedAt)}</dd></div>
                </dl>
                <div className="lc-world-browser__actions">
                  <button autoFocus disabled={!canPlay(selected)} onClick={playSelected} type="button">Play Selected World</button>
                  <button onClick={() => setConfirmAction({ kind: "reset", worldId: selected.world.id })} type="button">Reset World…</button>
                  <button
                    className="lc-world-browser__danger"
                    onClick={() => setConfirmAction({ kind: "delete", worldId: selected.world.id })}
                    type="button"
                  >
                    Delete World…
                  </button>
                </div>
              </>
            ) : <p>Select a world to see details.</p>}
          </section>
        </div>

        {legacy.status !== "none" ? (
          <section className="lc-world-browser__legacy" aria-labelledby="lc-legacy-world-title">
            <h2 id="lc-legacy-world-title">Legacy single world detected</h2>
            <p>
              Import it as a separate world or explicitly reset the old data.
              Lakecraft will never migrate or delete it automatically.
            </p>
            <div className="lc-world-browser__legacy-actions">
              <button
                disabled={legacy.status !== "available" || registryBlocked || legacyAlreadyImported}
                onClick={importLegacy}
                type="button"
              >
                {legacyAlreadyImported ? "Legacy World Imported" : "Import Legacy World"}
              </button>
              <button className="lc-world-browser__danger" onClick={() => setConfirmAction({ kind: "legacy_reset" })} type="button">
                Reset Legacy Data…
              </button>
            </div>
          </section>
        ) : null}

        {confirmAction ? (
          <section className="lc-world-browser__confirm" role="alertdialog" aria-modal="true" aria-labelledby="lc-world-confirm-title">
            <h2 id="lc-world-confirm-title">Confirm destructive action</h2>
            <p>
              {confirmAction.kind === "delete" ? "Delete this world and all of its browser-local progress?"
                : confirmAction.kind === "reset" ? "Reset this world to its original seed and game mode?"
                  : "Reset the legacy single-world data?"}
              {" "}This cannot be undone.
            </p>
            <div className="lc-world-browser__form-actions">
              <button autoFocus className="lc-world-browser__danger" onClick={runConfirmedAction} type="button">
                Confirm {confirmAction.kind === "delete" ? "Delete" : "Reset"}
              </button>
              <button onClick={() => setConfirmAction(null)} type="button">Cancel</button>
            </div>
          </section>
        ) : null}

        <output aria-live="polite" className="lc-world-browser__status">{status}</output>
        <p className="lc-world-browser__error" role="alert">{error}</p>
      </section>
    </main>
  );
}
