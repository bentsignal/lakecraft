import { useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SinglePlayerStorageAdapter } from "./localSave.ts";
import { isLocalWorldRegistryTransactionReadOnly, listLocalWorlds, type LocalWorldRecord } from "./localWorldRegistry.ts";
import { localWorldDialogRef } from "./localWorldBrowserIssue.ts";
import { parseSinglePlayerCloudDescriptor,
  parseSinglePlayerCloudMutationWire, parseSinglePlayerCloudQueryWire, prepareSinglePlayerCloudBackup,
  restoreSinglePlayerCloudBackup, singlePlayerCloudNumber, singlePlayerCloudUploadRevision, SINGLE_PLAYER_CLOUD_MAX_REVISION,
  SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP, SINGLE_PLAYER_CLOUD_WORLD_ID, SINGLE_PLAYER_CLOUD_HASH,
  validateRestorableSinglePlayerCloudBackup,
  type PreparedSinglePlayerCloudBackup,
  type SinglePlayerCloudBackupWire, type SinglePlayerCloudLineage, type SinglePlayerCloudQueryWire,
} from "./cloudBackupClient.ts";

type DeleteMarker = readonly [string, string, 0 | 1];
type Marker = readonly [SinglePlayerCloudLineage | null, DeleteMarker | null];
type Pending = readonly [LocalWorldRecord, PreparedSinglePlayerCloudBackup];
type LocalCloudState = readonly [0 | 1 | 2 | 3, PreparedSinglePlayerCloudBackup | null];
const enum ACTION { DELETE, RESTORE, KEEP_LOCAL, CANCEL_DELETE, RESUME, RECOVER, RESUME_ALL }
const enum STATUS { CHECKING, READY, CURRENT, UPLOADING, OFFLINE, QUOTA, CAPACITY, CONFLICT, TOMBSTONES, QUARANTINE, AUTH }
type Frozen = readonly [ACTION, string, string, SinglePlayerCloudBackupWire | null, string, string, string];
type DeletePending = readonly [Frozen, string, number];
type Controller = [SinglePlayerCloudQueryWire | null, readonly [number, number] | null,
  readonly [number, string, number] | null, Map<string, Marker>, number, number, boolean, Pending | null, () => void,
  DeletePending | null];
type RemoteState = readonly [Map<string, SinglePlayerCloudBackupWire>, Map<string, string>, string | null, boolean];
const INTERVAL = 7_500_000;
const RETRY = 300_000;
const SHORT_RETRY = 60_000;
const DAY = 86_400_000;
const CLOUD = "Cloud backup";
const cloud = "cloud backup";
const CLOUDS = `${CLOUD}s`;
const TITLE_ID = "lc-cloud-title";
const DIALOG_ID = "lc-cloud-dialog-title";
const DELETE_PHRASE = "yes, I want to delete this world";
const DAMAGED = "Damaged cloud backup";
const CANCEL_DELETE = "Cancel Pending Delete";
const read = (storage: SinglePlayerStorageAdapter, key: string, maximum = 96) => {
  try { const value = storage.getItem(key); return value && value.length <= maximum ? value : null; } catch { return null; }
};
const store = (storage: SinglePlayerStorageAdapter, key: string, value: string | null) => {
  try {
    if (value === null) { if (!storage.removeItem) return false; storage.removeItem(key); }
    else storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch { return false; }
};
const key = (userId: string, worldId?: string) => `lakecraft:cloud-backup:v1:${worldId === undefined
  ? `user:${JSON.stringify(userId)}` : `world:${JSON.stringify(userId)}:${worldId}`}`;
const parts = (value: string | null, length: number) => { const split = value?.split("|"); return split?.length === length ? split : null; };
const operationId = () => `delete_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const deleteRequest = (worldId: string, revision: string, operation: string) =>
  JSON.stringify([1, worldId, revision, operation]);
const frozenWorldId = (frozen: Frozen) => frozen[3]?.[1] ?? frozen[4];
function SignedInCloud({ storage, userId, title }: { storage: SinglePlayerStorageAdapter; userId: string; title: boolean }) {
  const query = parseSinglePlayerCloudQueryWire(useQuery<unknown>("singlePlayerCloudBackups"));
  const mutate = useMutation<[string], unknown>("mutateSinglePlayerCloudBackup");
  const [status, setStatus] = useState(STATUS.CHECKING);
  const [dialog, setDialog] = useState<Frozen | null>(null);
  const [phrase, setPhrase] = useState("");
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [mountDialog] = useState(() => localWorldDialogRef(restoreFocus, () => document.getElementById(TITLE_ID)));
  const accountKey = key(userId);
  const controller = useRef<Controller>([query, null, null, new Map(), 0, 0, true, null, () => {}, null]).current;
  controller[0] = query;
  if (query?.length && (!controller[1] || controller[1][0] !== query[1])) controller[1] = [query[1], Date.now()];
  const schedule = (delay: number) => {
    window.clearTimeout(controller[5]);
    if (controller[6]) controller[5] = window.setTimeout(controller[8], Math.max(1_000, delay));
  };
  const localMarker = (worldId: string) => {
    let value = controller[3].get(worldId);
    if (value) return value;
    const raw = read(storage, key(userId, worldId)), deletion = parts(raw, 3), lineage = parts(raw, 4);
    value = (deletion?.[0] === "D" || deletion?.[0] === "P")
      && singlePlayerCloudNumber(deletion[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
      && /^[A-Za-z0-9_-]{8,80}$/.test(deletion[2]) ? [null, [deletion[1], deletion[2], deletion[0] === "P" ? 1 : 0]]
      : [lineage && singlePlayerCloudNumber(lineage[0], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
        && singlePlayerCloudNumber(lineage[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
        && singlePlayerCloudNumber(lineage[2], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP) && SINGLE_PLAYER_CLOUD_HASH.test(lineage[3])
        ? [lineage[0], Number(lineage[1]), Number(lineage[2]), lineage[3]] : null, null];
    controller[3].set(worldId, value);
    return value;
  };
  const saveLineage = (worldId: string, value: SinglePlayerCloudLineage) => {
    controller[3].set(worldId, [value, null]); store(storage, key(userId, worldId), value.join("|"));
  };
  const localCloudState = (world: LocalWorldRecord, remote: SinglePlayerCloudBackupWire | null): LocalCloudState => {
    const marker = localMarker(world.id);
    const prepared = prepareSinglePlayerCloudBackup(storage, world, remote?.[8] ?? "0");
    if (!prepared.ok) return [0, null];
    if (remote?.[7] === prepared.backup[1]) return [1, prepared.backup];
    return singlePlayerCloudUploadRevision(prepared.backup, remote, marker[0], Boolean(marker[1])) === null
      ? [3, prepared.backup] : [2, prepared.backup];
  };
  const now = () => controller[1] ? controller[1][0] + Date.now() - controller[1][1] : Date.now();
  const localWorlds = () => {
    const listing = listLocalWorlds(storage);
    return isLocalWorldRegistryTransactionReadOnly(listing.registryLoad) ? null : listing.registryLoad.registry?.worlds ?? null;
  };
  const remoteState = (): RemoteState => {
    const remotes = new Map<string, SinglePlayerCloudBackupWire>();
    const tombstones = new Map<string, string>();
    let fence: string | null = null;
    let damaged = false;
    if (controller[0]?.[0] !== 1) return [remotes, tombstones, fence, true];
    for (const raw of controller[0][2]) {
      const parsed = validateRestorableSinglePlayerCloudBackup(raw);
      const outer = parsed?.[0], remote = parsed?.[1] ? outer : null;
      if (remote) remotes.set(remote[1], remote);
      else if (outer) tombstones.set(outer[1], `!${outer[8]}`); else damaged = true;
    }
    for (const raw of controller[0][3]) {
      const descriptor = parseSinglePlayerCloudDescriptor(raw);
      if (!descriptor) damaged = true;
      else if (descriptor[0] === 2) fence = descriptor[1];
      else tombstones.set(descriptor[1], descriptor[0] === 1 ? descriptor[2] : `!${descriptor[2]}`);
    }
    return [remotes, tombstones, fence, damaged];
  };
  const acceptUpload = (pending: Pending, revision: string) => {
    saveLineage(pending[0].id, [revision, pending[1][2], pending[1][3], pending[1][4]]);
    controller[7] = null;
  };
  const call = (request: string, result: (response: ReturnType<typeof parseSinglePlayerCloudMutationWire>) => void,
    failure: () => void) => {
    controller[4] = 2; setStatus(STATUS.UPLOADING);
    void mutate(request).then((raw) => result(parseSinglePlayerCloudMutationWire(raw))).catch(failure).finally(() => {
      controller[4] = 0;
    });
  };
  const update = (next: STATUS, delay = 0) => { setStatus(next); if (delay) schedule(delay); };
  const sendUpload = (pending: Pending, retry = false) => {
    controller[7] = pending;
    call(pending[1][0], (response) => {
      if (response?.[0] === 1) {
        acceptUpload(pending, response[1]);
        const time = now();
        controller[2] = [time, pending[0].id, 0]; store(storage, accountKey, controller[2].join("|"));
        update(STATUS.CURRENT, INTERVAL);
      } else if (response?.[0] === 3) update(response[1] === "cloud_capacity" ? STATUS.CAPACITY : STATUS.QUOTA, RETRY);
      else if (response?.[0] === 6) update(STATUS.QUOTA, response[1]);
      else if (response?.[0] === 4) setStatus(STATUS.AUTH);
      else { controller[7] = null; update(STATUS.QUARANTINE, RETRY); }
    }, () => update(STATUS.OFFLINE, !retry && controller[6] ? SHORT_RETRY : RETRY));
  };
  const sendDelete = (pending: DeletePending) => {
    controller[9] = pending;
    const retry = () => {
      const count = Math.min(5, pending[2] + 1);
      controller[9] = [pending[0], pending[1], count]; schedule(Math.min(RETRY, SHORT_RETRY * count));
    };
    call(pending[1], (response) => {
      if (response?.[0] === 2) { controller[9] = null; update(STATUS.CURRENT, 1_000); }
      else if (response?.[0] === 3) {
        controller[9] = null;
        window.clearTimeout(controller[5]);
        const frozen = pending[0], worldId = frozenWorldId(frozen);
        if (store(storage, key(userId, worldId), null)) controller[3].set(worldId, [null, null]);
        else {
          store(storage, key(userId, worldId), `P|${frozen[2]}|${frozen[6]}`);
          controller[3].set(worldId, [null, [frozen[2], frozen[6], 1]]);
        }
        setStatus(response[1] === "tombstone_capacity" ? STATUS.TOMBSTONES : STATUS.CAPACITY);
      }
      else if (response?.[0] === 5) { controller[9] = null; setStatus(STATUS.QUARANTINE); }
      else if (response?.[0] === 4) setStatus(STATUS.AUTH);
      else { setStatus(STATUS.QUARANTINE); retry(); }
    }, () => {
      setStatus(STATUS.OFFLINE); retry();
    });
  };
  const resumeDelete = (worldId: string, revision: string, wire: SinglePlayerCloudBackupWire | null, name: string) => {
    const deletion = localMarker(worldId)[1];
    if (!deletion || deletion[2]) return false;
    if (deletion[0] !== revision) { setStatus(STATUS.QUARANTINE); return true; }
    const frozen: Frozen = [ACTION.DELETE, userId, revision, wire, worldId, name, deletion[1]];
    sendDelete([frozen, deleteRequest(worldId, revision, deletion[1]), 0]); return true;
  };
  controller[8] = () => {
    if (controller[4]) return;
    const result = controller[0];
    if (!result?.length) return setStatus(STATUS.CHECKING);
    if (result[0] === 2) return setStatus(STATUS.AUTH);
    if (result[0] === 3) return setStatus(STATUS.QUARANTINE);
    const worlds = localWorlds();
    if (!worlds) {
      setStatus(STATUS.QUARANTINE); return schedule(RETRY);
    }
    const state = remoteState();
    if (state[2]) { setStatus(STATUS.QUARANTINE); return; }
    if (state[3]) { setStatus(STATUS.QUARANTINE); return schedule(RETRY); }
    if (controller[7]) {
      const pending = controller[7], remote = state[0].get(pending[0].id);
      if (remote?.[7] === pending[1][1] && remote[6] === pending[1][4]) {
        acceptUpload(pending, remote[8]); update(STATUS.CURRENT, INTERVAL); return;
      }
    }
    if (controller[9]) {
      const frozen = controller[9][0];
      const worldId = frozenWorldId(frozen);
      const remote = state[0].get(worldId);
      const descriptor = state[1].get(worldId);
      if (descriptor && descriptor[0] !== "!") controller[9] = null;
      else if (remote?.[8] === frozen[2] && remote[6] === frozen[3]?.[6] && remote[9] === frozen[3]?.[9]
        || descriptor === `!${frozen[2]}`) {
        return sendDelete(controller[9]);
      } else { controller[9] = null; setStatus(STATUS.QUARANTINE); return; }
    }
    for (const remote of state[0].values()) {
      if (resumeDelete(remote[1], remote[8], remote, "")) return;
    }
    for (const [worldId, descriptor] of state[1]) {
      if (descriptor[0] !== "!") continue;
      const revision = descriptor.slice(1);
      if (resumeDelete(worldId, revision, null, DAMAGED)) return;
    }
    const candidates: Pending[] = [];
    let diverged = false;
    for (const world of worlds) {
      const remote = state[0].get(world.id) ?? null;
      const mark = localMarker(world.id);
      if (mark[1] || state[1].has(world.id)) continue;
      const localState = localCloudState(world, remote), prepared = localState[1];
      if (!prepared) continue;
      if (localState[0] === 1 && remote) {
        const lineage: SinglePlayerCloudLineage = [remote[8], prepared[2], prepared[3], prepared[4]];
        saveLineage(world.id, lineage);
      } else if (localState[0] === 2) candidates.push([world, prepared]);
      else if (localState[0] === 3) diverged = true;
    }
    if (controller[7]) return sendUpload(controller[7], true);
    if (!candidates.length) { update([...state[1].values()].some((value) => value[0] === "!")
      ? STATUS.QUARANTINE : diverged ? STATUS.CONFLICT : STATUS.CURRENT, RETRY); return; }
    const time = now();
    const day = Math.floor(time / DAY);
    if (!controller[2]) {
      const value = parts(read(storage, accountKey), 3);
      controller[2] = value && singlePlayerCloudNumber(value[0], 0, time)
        && (value[1] === "" || SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[1]))
        && singlePlayerCloudNumber(value[2], 0, 100_000) ? [Number(value[0]), value[1], Number(value[2])] : [0, "", 0];
    }
    if (controller[2][2] === day) { update(STATUS.QUOTA, (day + 1) * DAY - time); return; }
    const due = controller[2][0] + INTERVAL;
    if (time < due) { update(STATUS.READY, due - time); return; }
    candidates.sort((a, b) => a[0].id < b[0].id ? -1 : 1);
    sendUpload(candidates.find((candidate) => candidate[0].id > controller[2]![1]) ?? candidates[0]);
  };
  useEffect(() => { controller[6] = true; controller[8](); return () => {
    controller[6] = false; window.clearTimeout(controller[5]);
  }; }, [query, storage, userId]);

  const open = (kind: ACTION, opener: HTMLElement, wire: SinglePlayerCloudBackupWire | null,
    revision: string, worldId = "~", name = CLOUDS, operation = operationId()) => {
    if (controller[4]) return;
    controller[4] = 1; restoreFocus.current = opener; setPhrase("");
    setDialog([kind, userId, revision, wire, worldId, name, operation]);
  };
  const close = (next: STATUS | -1 = -1) => {
    if (next >= 0) setStatus(next); setDialog(null); setPhrase(""); controller[4] = 0; schedule(1_000);
  };
  const submit = async () => {
    if (controller[4] !== 1) return;
    controller[4] = 2; setStatus(STATUS.UPLOADING);
    const frozen = dialog;
    if (!frozen || frozen[1] !== userId) return close();
    const kind = frozen[0], worldId = frozenWorldId(frozen);
    const current = remoteState();
    let local: LocalWorldRecord | null = null;
    let remote: SinglePlayerCloudBackupWire | null = null;
    if (kind === ACTION.CANCEL_DELETE) {
      const deletion = localMarker(worldId)[1];
      if (!deletion || deletion[0] !== frozen[2] || deletion[1] !== frozen[6]) return close(STATUS.QUARANTINE);
      if (!store(storage, key(userId, worldId), null)) return close(STATUS.OFFLINE);
      controller[3].set(worldId, [null, null]); controller[9] = null;
      return close(STATUS.CONFLICT);
    } else if (kind === ACTION.RECOVER) {
      if (controller[0]?.[0] !== 3 || controller[0][2] !== frozen[2]) return close(STATUS.QUARANTINE);
    } else {
      const worlds = localWorlds();
      if (!worlds) return close(STATUS.QUARANTINE);
      local = worlds.find((world) => world.id === worldId) ?? null;
      remote = current[0].get(worldId) ?? null;
      const descriptor = current[1].get(worldId);
      const revision = (descriptor?.[0] === "!" ? descriptor.slice(1) : descriptor) ?? remote?.[8] ?? current[2] ?? "0";
      if (revision !== frozen[2] || remote && (remote[6] !== frozen[3]?.[6] || remote[9] !== frozen[3]?.[9])) {
        return close(STATUS.QUARANTINE);
      }
    }
    if (kind === ACTION.RESTORE) {
      if (!frozen[3] || local) return close();
      const restored = restoreSinglePlayerCloudBackup(storage, frozen[3]);
      if (!restored.ok) return close(STATUS.QUARANTINE);
      local = restored.world;
    }
    if (kind === ACTION.RESTORE || kind === ACTION.RESUME || kind === ACTION.KEEP_LOCAL) {
      if (!local) return close();
      const prepared = prepareSinglePlayerCloudBackup(storage, local, frozen[2]);
      if (!prepared.ok) return close(STATUS.QUARANTINE);
      if (kind === ACTION.RESTORE) {
        saveLineage(worldId, [frozen[2], prepared.backup[2], prepared.backup[3], prepared.backup[4]]);
        return close(STATUS.CURRENT);
      }
      setDialog(null); controller[4] = 0; sendUpload([local, prepared.backup]); return;
    }
    if (kind === ACTION.DELETE) {
      if (phrase !== DELETE_PHRASE || !remote && current[1].get(worldId) !== `!${frozen[2]}`) return;
      const durable = `D|${frozen[2]}|${frozen[6]}`;
      if (!store(storage, key(userId, worldId), durable)) return close(STATUS.OFFLINE);
      controller[3].set(worldId, [null, [frozen[2], frozen[6], 0]]);
      setDialog(null);
      sendDelete([frozen, deleteRequest(worldId, frozen[2], frozen[6]), 0]);
      return;
    }
    let response = parseSinglePlayerCloudMutationWire(await mutate(JSON.stringify([kind === ACTION.RECOVER ? 2 : 3, frozen[2]])));
    while (response?.[0] === 7 && response[2] === 1) response = parseSinglePlayerCloudMutationWire(
      await mutate(JSON.stringify([2, response[1]])));
    let next: STATUS = STATUS.QUARANTINE;
    if (kind === ACTION.RESUME_ALL && response?.[0] === 8) {
      if (!store(storage, accountKey, null)) return close(STATUS.OFFLINE);
      next = STATUS.READY;
    } else if (kind === ACTION.RECOVER && response?.[0] === 7) {
      store(storage, accountKey, `F|${response[1]}`);
    } else if (response?.[0] === 4) next = STATUS.AUTH;
    close(next);
  };
  if (!title) return null;
  const listing = listLocalWorlds(storage);
  const worlds = listing.registryLoad.registry?.worlds ?? [];
  const state = remoteState();
  const statusText = [`Checking ${cloud}s…`, `${CLOUD} ready`, `${CLOUD}s up to date`, `Uploading ${cloud}…`,
    `${CLOUD}s offline`, `${CLOUD} paused until its quota resets`, "Cloud storage capacity reached",
    "Local and cloud versions need a choice", "Cloud deletion history is full", `${CLOUD} needs attention`,
    `Sign in again for ${cloud}s`];
  const download = (wire: SinglePlayerCloudBackupWire) => {
    const blob = new Blob([wire[7]], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${wire[2].replace(/[^a-z0-9]+/gi, "-") || "world"}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  const button = (label: string, onClick: (event: any) => void, menu = false) => <button
    className={menu ? "lc-menu-button" : undefined} onClick={onClick} type="button">{label}</button>;
  const action = (label: string, menu: boolean, kind: ACTION, wire: SinglePlayerCloudBackupWire | null,
    revision: string, worldId?: string, name?: string, operation?: string) => button(label,
      (event) => open(kind, event.currentTarget, wire, revision, worldId, name, operation), menu);
  const row = (name: string, detail: any, actions: any, rowKey?: string) => <div className="lc-local-world-row" key={rowKey}>
    <span className="lc-local-world-select"><strong>{name}</strong><small>{detail}</small></span>{actions}</div>;
  const dialogName = dialog?.[3]?.[2] ?? dialog?.[5], dialogKind = dialog?.[0];
  return <section aria-labelledby={TITLE_ID} className="lc-cloud">
    <h2 id={TITLE_ID} tabIndex={-1}>Cloud Backups</h2>
    <p aria-live="polite" className="lc-server-hint" role={status === STATUS.OFFLINE || status >= STATUS.CONFLICT ? "alert" : "status"}>
      {statusText[status]}</p>
    {query?.[0] === 3 ? action("Repair Cloud Backups", true, ACTION.RECOVER, null, query[2]) : null}
    {state[2] ? row(`${CLOUDS} paused`, "Recovery is complete. Resume when this device is ready.",
      action("Resume", true, ACTION.RESUME_ALL, null, state[2]!)) : null}
    {[...state[0].values()].map((remote) => {
      const local = worlds.find((world) => world.id === remote[1]);
      const marker = localMarker(remote[1]), deletion = marker[1];
      const localState = local && !deletion ? localCloudState(local, remote)[0] : null;
      const detail = !local ? CLOUD : deletion ? "Cloud deletion pending"
        : localState === 1 ? "Backed up on this device" : localState === 2 ? "Local changes waiting to back up"
          : localState === 3 ? "Local and cloud versions conflict" : "Local save needs attention";
      return row(remote[2], [detail, " · ", new Date(Number(remote[9])).toLocaleString()],
        <span className="lc-cloud-actions">
          {!local ? action("Restore", false, ACTION.RESTORE, remote, remote[8], remote[1], remote[2]) : null}
          {localState === 3 ? action("Keep Local", false, ACTION.KEEP_LOCAL, remote, remote[8], remote[1], local!.name) : null}
          {button("Download", () => download(remote))}
          {deletion ? action(CANCEL_DELETE, false, ACTION.CANCEL_DELETE, remote, deletion[0], remote[1], remote[2], deletion[1])
            : action("Delete", false, ACTION.DELETE, remote, remote[8], remote[1], remote[2])}
        </span>, remote[1]);
    })}
    {[...state[1]].map(([worldId, descriptor]) => {
      const quarantined = descriptor[0] === "!", revision = quarantined ? descriptor.slice(1) : descriptor;
      const local = worlds.find((world) => world.id === worldId);
      const deletion = localMarker(worldId)[1];
      return quarantined ? row(DAMAGED, `${CLOUD} needs recovery`,
        deletion ? action(CANCEL_DELETE, false, ACTION.CANCEL_DELETE, null, deletion[0], worldId, DAMAGED, deletion[1])
          : action("Delete", false, ACTION.DELETE, null, revision, worldId, DAMAGED), worldId)
        : row(local?.name ?? "Deleted cloud backup", `${CLOUD} paused`, local
          ? action("Resume", true, ACTION.RESUME, null, revision, worldId, local.name) : null, worldId);
    })}
    {worlds.filter((world) => !state[0].has(world.id) && !state[1].has(world.id)
      && Boolean(localMarker(world.id)[0]) && !localMarker(world.id)[1]).map((world) => row(world.name,
        "Cloud lineage is missing; local progress was not uploaded",
        action("Keep Local", false, ACTION.KEEP_LOCAL, null, "0", world.id, world.name), `conflict-${world.id}`))}
    {dialog ? <dialog aria-labelledby={DIALOG_ID} className="lc-username-layer lc-local-world-dialog"
      onClose={close} ref={mountDialog} role="alertdialog"><form className="lc-username-menu" method="dialog"
        onSubmit={(event) => { event.preventDefault(); void submit().catch(() => close(STATUS.OFFLINE)); }}>
        <h2 id={DIALOG_ID}>{dialogKind === ACTION.DELETE ? "Delete Cloud Backup" : dialogKind === ACTION.RESTORE ? "Restore Cloud Backup"
          : dialogKind === ACTION.KEEP_LOCAL ? "Keep Local World" : dialogKind === ACTION.CANCEL_DELETE ? CANCEL_DELETE : "Resume Cloud Backups"}</h2>
        <p>{dialogKind === ACTION.DELETE ? `Permanently delete the cloud backup for ${dialogName}? Local progress stays on this device.`
          : dialogKind === ACTION.RESTORE ? `Restore ${dialogName} into an empty local world namespace?`
            : dialogKind === ACTION.KEEP_LOCAL ? `Upload this device's version of ${dialogName} only if the cloud revision is still unchanged?`
              : dialogKind === ACTION.CANCEL_DELETE ? `Stop retrying deletion of ${dialogName}? No cloud data will be changed.`
                : "Allow this device to upload cloud backups again?"}</p>
        {dialogKind === ACTION.DELETE ? <label><span>Type <strong>{DELETE_PHRASE}</strong> to confirm</span><input autoFocus
          aria-label="Delete cloud backup confirmation phrase" autoComplete="off" onInput={(e) => setPhrase(e.currentTarget.value)} value={phrase} /></label> : null}
        <button className="lc-menu-button" disabled={controller[4] === 2 || dialogKind === ACTION.DELETE && phrase !== DELETE_PHRASE} type="submit">Confirm</button>
        <button className="lc-menu-link" onClick={close} type="button">Cancel</button>
      </form></dialog> : null}
  </section>;
}

export function SinglePlayerCloudIdentityBoundary({ storage, title = false }:
  { storage: SinglePlayerStorageAdapter; title?: boolean }) {
  const auth = useAuth();
  return auth.isAuthenticated && !auth.isGuest
    ? <SignedInCloud key={auth.userId} storage={storage} title={title} userId={auth.userId} /> : null;
}
