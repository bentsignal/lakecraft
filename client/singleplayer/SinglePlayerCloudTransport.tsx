import { useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SinglePlayerStorageAdapter } from "./localSave.ts";
import { isLocalWorldRegistryTransactionReadOnly, listLocalWorlds, type LocalWorldRecord } from "./localWorldRegistry.ts";
import { localWorldDialogRef } from "./localWorldBrowserIssue.ts";
import { parseRestorableSinglePlayerCloudBackupWire, parseSinglePlayerCloudBackupWire, parseSinglePlayerCloudDescriptor,
  parseSinglePlayerCloudMutationWire, parseSinglePlayerCloudQueryWire, prepareSinglePlayerCloudBackup,
  restoreSinglePlayerCloudBackup, singlePlayerCloudNumber, SINGLE_PLAYER_CLOUD_MAX_REVISION,
  SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP, SINGLE_PLAYER_CLOUD_WORLD_ID, SINGLE_PLAYER_CLOUD_HASH,
  type PreparedSinglePlayerCloudBackup,
  type SinglePlayerCloudBackupWire, type SinglePlayerCloudLineage, type SinglePlayerCloudQueryWire,
} from "./cloudBackupClient.ts";

type Marker = readonly [SinglePlayerCloudLineage | null, readonly [string, string] | null];
type Pending = readonly [LocalWorldRecord, PreparedSinglePlayerCloudBackup];
const enum ACTION { DELETE, RESTORE, RESUME, RECOVER, RESUME_ALL }
const enum STATUS { CHECKING, READY, CURRENT, UPLOADING, OFFLINE, QUOTA, CAPACITY, QUARANTINE, AUTH }
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
const TITLE_ID = "lc-cloud-title";
const DIALOG_ID = "lc-cloud-dialog-title";
const DELETE_PHRASE = "yes, I want to delete this world";
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
const key = (userId: string, worldId?: string) => `lakecraft:cloud-backup:v1:${worldId === undefined ? "user" : "world"}`
  + `:${JSON.stringify(userId)}${worldId === undefined ? "" : `:${worldId}`}`;
const parts = (value: string | null, length: number) => { const split = value?.split("|"); return split?.length === length ? split : null; };
const operationId = () => `delete_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const deleteRequest = (worldId: string, revision: string, operation: string) =>
  JSON.stringify([1, worldId, revision, operation]);
const marker = (storage: SinglePlayerStorageAdapter, userId: string, worldId: string): Marker => {
  const raw = read(storage, key(userId, worldId));
  const deletion = parts(raw, 3);
  if (deletion?.[0] === "D" && singlePlayerCloudNumber(deletion[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && /^[A-Za-z0-9_-]{8,80}$/.test(deletion[2])) return [null, [deletion[1], deletion[2]]];
  const value = parts(raw, 4);
  const lineage = value && singlePlayerCloudNumber(value[0], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[2], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP) && SINGLE_PLAYER_CLOUD_HASH.test(value[3])
    ? [value[0], Number(value[1]), Number(value[2]), value[3]] as SinglePlayerCloudLineage : null;
  return [lineage, null];
};
const saveLineage = (storage: SinglePlayerStorageAdapter, userId: string, worldId: string,
  value: SinglePlayerCloudLineage, controller: Controller) => {
  controller[3].set(worldId, [value, null]);
  store(storage, key(userId, worldId), value.join("|"));
};
const now = (controller: Controller) => controller[1] ? controller[1][0] + Date.now() - controller[1][1] : Date.now();
const date = (value: string) => new Date(Number(value)).toLocaleString();

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
    if (!value) { value = marker(storage, userId, worldId); controller[3].set(worldId, value); }
    return value;
  };
  const remoteState = (): RemoteState => {
    const remotes = new Map<string, SinglePlayerCloudBackupWire>();
    const tombstones = new Map<string, string>();
    let fence: string | null = null;
    let damaged = false;
    if (controller[0]?.[0] !== 1) return [remotes, tombstones, fence, true];
    for (const raw of controller[0][2]) {
      const remote = parseRestorableSinglePlayerCloudBackupWire(raw);
      const outer = remote ? null : parseSinglePlayerCloudBackupWire(raw);
      if (remote) remotes.set(remote[1], remote);
      else if (outer) tombstones.set(outer[1], `!${outer[8]}`); else damaged = true;
    }
    for (const raw of controller[0][3]) {
      const descriptor = parseSinglePlayerCloudDescriptor(raw);
      if (!descriptor) damaged = true;
      else if (descriptor[0] === 1) tombstones.set(descriptor[1], descriptor[2]);
      else if (descriptor[0] === 2) fence = descriptor[1];
      else tombstones.set(descriptor[1], `!${descriptor[2]}`);
    }
    return [remotes, tombstones, fence, damaged];
  };
  const acceptUpload = (pending: Pending, revision: string) => {
    saveLineage(storage, userId, pending[0].id,
      [revision, pending[1][2], pending[1][3], pending[1][4]], controller);
    controller[7] = null;
  };
  const call = (request: string, result: (response: ReturnType<typeof parseSinglePlayerCloudMutationWire>) => void,
    failure: () => void) => {
    controller[4] = 2; setStatus(STATUS.UPLOADING);
    void mutate(request).then((raw) => result(parseSinglePlayerCloudMutationWire(raw))).catch(failure).finally(() => {
      controller[4] = 0;
    });
  };
  const sendUpload = (pending: Pending, retry = false) => {
    controller[7] = pending;
    call(pending[1][0], (response) => {
      if (response?.[0] === 1) {
        acceptUpload(pending, response[1]);
        const time = now(controller);
        controller[2] = [time, pending[0].id, 0]; store(storage, accountKey, controller[2].join("|"));
        setStatus(STATUS.CURRENT); schedule(INTERVAL);
      } else if (response?.[0] === 3) { setStatus(response[1] === "cloud_capacity" ? STATUS.CAPACITY : STATUS.QUOTA); schedule(RETRY); }
      else if (response?.[0] === 6) { setStatus(STATUS.QUOTA); schedule(response[1]); }
      else if (response?.[0] === 4) setStatus(STATUS.AUTH);
      else { controller[7] = null; setStatus(STATUS.QUARANTINE); schedule(RETRY); }
    }, () => {
      setStatus(STATUS.OFFLINE);
      schedule(!retry && controller[6] ? SHORT_RETRY : RETRY);
    });
  };
  const sendDelete = (pending: DeletePending) => {
    controller[9] = pending;
    const retry = () => {
      const count = Math.min(5, pending[2] + 1);
      controller[9] = [pending[0], pending[1], count]; schedule(Math.min(RETRY, SHORT_RETRY * count));
    };
    call(pending[1], (response) => {
      if (response?.[0] === 2) { controller[9] = null; setStatus(STATUS.CURRENT); schedule(1_000); }
      else if (response?.[0] === 5) { controller[9] = null; setStatus(STATUS.QUARANTINE); }
      else if (response?.[0] === 4) setStatus(STATUS.AUTH);
      else { setStatus(STATUS.QUARANTINE); retry(); }
    }, () => {
      setStatus(STATUS.OFFLINE); retry();
    });
  };
  controller[8] = () => {
    if (controller[4]) return;
    const result = controller[0];
    if (!result?.length) return setStatus(STATUS.CHECKING);
    if (result[0] === 2) return setStatus(STATUS.AUTH);
    if (result[0] === 3) return setStatus(STATUS.QUARANTINE);
    const listing = listLocalWorlds(storage);
    const worlds = listing.registryLoad.registry?.worlds;
    if (!worlds || isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)) {
      setStatus(STATUS.QUARANTINE); return schedule(RETRY);
    }
    const state = remoteState();
    if (state[2]) { setStatus(STATUS.QUARANTINE); return; }
    if (state[3]) { setStatus(STATUS.QUARANTINE); return schedule(RETRY); }
    if (controller[7]) {
      const pending = controller[7], remote = state[0].get(pending[0].id);
      if (remote?.[7] === pending[1][1] && remote[6] === pending[1][4]) {
        acceptUpload(pending, remote[8]); setStatus(STATUS.CURRENT); return schedule(INTERVAL);
      }
    }
    if (controller[9]) {
      const frozen = controller[9][0];
      const worldId = frozen[3]?.[1] ?? frozen[4];
      const remote = state[0].get(worldId);
      const descriptor = state[1].get(worldId);
      if (descriptor && descriptor[0] !== "!") controller[9] = null;
      else if (remote?.[8] === frozen[2] && remote[6] === frozen[3]?.[6] && remote[9] === frozen[3]?.[9]
        || descriptor === `!${frozen[2]}`) {
        return sendDelete(controller[9]);
      } else { controller[9] = null; setStatus(STATUS.QUARANTINE); return; }
    }
    for (const remote of state[0].values()) {
      const deletion = localMarker(remote[1])[1];
      if (!deletion) continue;
      if (deletion[0] !== remote[8]) { setStatus(STATUS.QUARANTINE); return; }
      const frozen: Frozen = [ACTION.DELETE, userId, remote[8], remote, "", "", deletion[1]];
      return sendDelete([frozen, deleteRequest(remote[1], deletion[0], deletion[1]), 0]);
    }
    for (const [worldId, descriptor] of state[1]) {
      if (descriptor[0] !== "!") continue;
      const revision = descriptor.slice(1);
      const deletion = localMarker(worldId)[1];
      if (!deletion) continue;
      if (deletion[0] !== revision) { setStatus(STATUS.QUARANTINE); return; }
      const frozen: Frozen = [ACTION.DELETE, userId, revision, null, worldId, "Damaged cloud backup", deletion[1]];
      return sendDelete([frozen, deleteRequest(worldId, revision, deletion[1]), 0]);
    }
    const candidates: Pending[] = [];
    for (const world of worlds) {
      const remote = state[0].get(world.id) ?? null;
      const mark = localMarker(world.id);
      if (mark[1] || state[1].has(world.id)) continue;
      const prepared = prepareSinglePlayerCloudBackup(storage, world, remote?.[8] ?? "0");
      if (!prepared.ok) continue;
      if (remote?.[7] === prepared.backup[1]) {
        const lineage: SinglePlayerCloudLineage = [remote[8], prepared.backup[2], prepared.backup[3], prepared.backup[4]];
        saveLineage(storage, userId, world.id, lineage, controller);
      } else if (!remote ? !mark[0] : mark[0]?.[0] === remote[8]
        && prepared.backup[2] > mark[0][1] && prepared.backup[3] >= mark[0][2]) candidates.push([world, prepared.backup]);
    }
    if (controller[7]) return sendUpload(controller[7], true);
    if (!candidates.length) { setStatus([...state[1].values()].some((value) => value[0] === "!")
      ? STATUS.QUARANTINE : STATUS.CURRENT); return schedule(RETRY); }
    const time = now(controller);
    const day = Math.floor(time / DAY);
    if (!controller[2]) {
      const value = parts(read(storage, accountKey), 3);
      controller[2] = value && singlePlayerCloudNumber(value[0], 0, time)
        && (value[1] === "" || SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[1]))
        && singlePlayerCloudNumber(value[2], 0, 100_000) ? [Number(value[0]), value[1], Number(value[2])] : [0, "", 0];
    }
    if (controller[2][2] === day) { setStatus(STATUS.QUOTA); return schedule((day + 1) * DAY - time); }
    const due = controller[2][0] + INTERVAL;
    if (time < due) { setStatus(STATUS.READY); return schedule(due - time); }
    candidates.sort((a, b) => a[0].id < b[0].id ? -1 : 1);
    sendUpload(candidates.find((candidate) => candidate[0].id > controller[2]![1]) ?? candidates[0]);
  };
  useEffect(() => { controller[6] = true; controller[8](); return () => {
    controller[6] = false; window.clearTimeout(controller[5]);
  }; }, [query, storage, userId]);

  const open = (kind: ACTION, opener: HTMLElement, wire: SinglePlayerCloudBackupWire | null,
    revision: string, worldId = "~", name = `${CLOUD}s`) => {
    if (controller[4]) return;
    controller[4] = 1; restoreFocus.current = opener; setPhrase("");
    setDialog([kind, userId, revision, wire, worldId, name, operationId()]);
  };
  const close = (next: STATUS | -1 = -1) => {
    if (next >= 0) setStatus(next); setDialog(null); setPhrase("");
    controller[4] = 0; schedule(1_000);
  };
  const submit = async () => {
    if (controller[4] !== 1) return;
    controller[4] = 2; setStatus(STATUS.UPLOADING);
    const frozen = dialog;
    if (!frozen || frozen[1] !== userId) return close();
    const worldId = frozen[3]?.[1] ?? frozen[4];
    const current = remoteState();
    let local: LocalWorldRecord | null = null;
    let remote: SinglePlayerCloudBackupWire | null = null;
    if (frozen[0] === ACTION.RECOVER) {
      if (controller[0]?.[0] !== 3 || controller[0][2] !== frozen[2]) return close(STATUS.QUARANTINE);
    } else {
      const listing = listLocalWorlds(storage);
      const worlds = listing.registryLoad.registry?.worlds;
      if (!worlds || isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)) {
        return close(STATUS.QUARANTINE);
      }
      local = worlds.find((world) => world.id === worldId) ?? null;
      remote = current[0].get(worldId) ?? null;
      const descriptor = current[1].get(worldId);
      const revision = (descriptor?.[0] === "!" ? descriptor.slice(1) : descriptor) ?? remote?.[8] ?? current[2];
      if (revision !== frozen[2] || remote && (remote[6] !== frozen[3]?.[6] || remote[9] !== frozen[3]?.[9])) {
        return close(STATUS.QUARANTINE);
      }
    }
    if (frozen[0] === ACTION.RESTORE) {
      if (!frozen[3] || local) return close();
      const restored = restoreSinglePlayerCloudBackup(storage, frozen[3]);
      if (!restored.ok) return close(STATUS.QUARANTINE);
      const prepared = prepareSinglePlayerCloudBackup(storage, restored.world, frozen[2]);
      if (!prepared.ok) return close(STATUS.QUARANTINE);
      saveLineage(storage, userId, worldId,
        [frozen[2], prepared.backup[2], prepared.backup[3], prepared.backup[4]], controller);
      return close(STATUS.CURRENT);
    }
    if (frozen[0] === ACTION.DELETE) {
      if (phrase !== DELETE_PHRASE || !remote && current[1].get(worldId) !== `!${frozen[2]}`) return;
      const durable = `D|${frozen[2]}|${frozen[6]}`;
      if (!store(storage, key(userId, worldId), durable)) return close(STATUS.OFFLINE);
      controller[3].set(worldId, [null, [frozen[2], frozen[6]]]);
      setDialog(null);
      sendDelete([frozen, deleteRequest(worldId, frozen[2], frozen[6]), 0]);
      return;
    }
    if (frozen[0] === ACTION.RESUME) {
      if (!local) return close();
      const prepared = prepareSinglePlayerCloudBackup(storage, local, frozen[2]);
      if (!prepared.ok) return close(STATUS.QUARANTINE);
      setDialog(null); controller[4] = 0; sendUpload([local, prepared.backup]); return;
    }
    let request = JSON.stringify([frozen[0] === ACTION.RECOVER ? 2 : 3, frozen[2]]);
    let response = parseSinglePlayerCloudMutationWire(await mutate(request));
    while (response?.[0] === 7 && response[2] === 1) response = parseSinglePlayerCloudMutationWire(
      await mutate(JSON.stringify([2, response[1]])));
    let next: STATUS = STATUS.QUARANTINE;
    if (frozen[0] === ACTION.RESUME_ALL && response?.[0] === 8) {
      if (!store(storage, accountKey, null)) return close(STATUS.OFFLINE);
      next = STATUS.READY;
    } else if (frozen[0] === ACTION.RECOVER && response?.[0] === 7) {
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
    `${CLOUD} needs attention`, `Sign in again for ${cloud}s`];
  const download = (wire: SinglePlayerCloudBackupWire) => {
    const blob = new Blob([wire[7]], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${wire[2].replace(/[^a-z0-9]+/gi, "-") || "world"}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  const button = (label: string, onClick: (event: any) => void, menu = false) => <button
    className={menu ? "lc-menu-button" : undefined} onClick={onClick} type="button">{label}</button>;
  const row = (name: string, detail: any, actions: any, rowKey?: string) => <div className="lc-local-world-row" key={rowKey}>
    <span className="lc-local-world-select"><strong>{name}</strong><small>{detail}</small></span>{actions}</div>;
  const dialogName = dialog?.[3]?.[2] ?? dialog?.[5];
  return <section aria-labelledby={TITLE_ID} className="lc-cloud">
    <h2 id={TITLE_ID} tabIndex={-1}>Cloud Backups</h2>
    <p aria-live="polite" className="lc-server-hint" role={status === STATUS.OFFLINE || status === STATUS.QUARANTINE ? "alert" : "status"}>
      {statusText[status]}</p>
    {query?.[0] === 3 ? button("Repair Cloud Backups", (e) => open(ACTION.RECOVER, e.currentTarget, null, query[2]), true) : null}
    {state[2] ? row(`${CLOUD}s paused`, "Recovery is complete. Resume when this device is ready.",
      button("Resume", (e) => open(ACTION.RESUME_ALL, e.currentTarget, null, state[2]!), true)) : null}
    {[...state[0].values()].map((remote) => {
      const local = worlds.some((world) => world.id === remote[1]);
      return row(remote[2], [local ? "Backed up on this device" : CLOUD, " · ", date(remote[9])],
        <span className="lc-cloud-actions">
          {!local ? button("Restore", (e) => open(ACTION.RESTORE, e.currentTarget, remote, remote[8], remote[1], remote[2])) : null}
          {button("Download", () => download(remote))}
          {button("Delete", (e) => open(ACTION.DELETE, e.currentTarget, remote, remote[8], remote[1], remote[2]))}
        </span>, remote[1]);
    })}
    {[...state[1]].map(([worldId, descriptor]) => {
      const quarantined = descriptor[0] === "!", revision = quarantined ? descriptor.slice(1) : descriptor;
      const local = worlds.find((world) => world.id === worldId);
      return quarantined ? row("Damaged cloud backup", `${CLOUD} needs recovery`,
        button("Delete", (e) => open(ACTION.DELETE, e.currentTarget, null, revision, worldId, "Damaged cloud backup")), worldId)
        : row(local?.name ?? "Deleted cloud backup", `${CLOUD} paused`, local
          ? button("Resume", (e) => open(ACTION.RESUME, e.currentTarget, null, revision, worldId, local.name), true) : null, worldId);
    })}
    {dialog ? <dialog aria-labelledby={DIALOG_ID} className="lc-username-layer lc-local-world-dialog"
      onClose={close} ref={mountDialog} role="alertdialog"><form className="lc-username-menu" method="dialog"
        onSubmit={(event) => { event.preventDefault(); void submit().catch(() => close(STATUS.OFFLINE)); }}>
        <h2 id={DIALOG_ID}>{dialog[0] === ACTION.DELETE ? "Delete Cloud Backup" : dialog[0] === ACTION.RESTORE ? "Restore Cloud Backup" : "Resume Cloud Backups"}</h2>
        <p>{dialog[0] === ACTION.DELETE ? `Permanently delete the cloud backup for ${dialogName}? Local progress stays on this device.`
          : dialog[0] === ACTION.RESTORE ? `Restore ${dialogName} into an empty local world namespace?` : "Allow this device to upload cloud backups again?"}</p>
        {dialog[0] === ACTION.DELETE ? <label><span>Type <strong>{DELETE_PHRASE}</strong> to confirm</span><input autoFocus
          aria-label="Delete cloud backup confirmation phrase" autoComplete="off" onInput={(e) => setPhrase(e.currentTarget.value)} value={phrase} /></label> : null}
        <button className="lc-menu-button" disabled={controller[4] === 2 || dialog[0] === ACTION.DELETE && phrase !== DELETE_PHRASE} type="submit">Confirm</button>
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
