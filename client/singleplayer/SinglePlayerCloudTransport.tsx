import { useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { loadSinglePlayerSave, type SinglePlayerStorageAdapter } from "./localSave.ts";
import { isLocalWorldRegistryTransactionReadOnly, listLocalWorlds, type LocalWorldRecord } from "./localWorldRegistry.ts";
import { localWorldDialogRef } from "./localWorldBrowserIssue.ts";
import { parseRestorableSinglePlayerCloudBackupWire, parseSinglePlayerCloudDescriptor,
  parseSinglePlayerCloudMutationWire, parseSinglePlayerCloudQueryWire, prepareSinglePlayerCloudBackup,
  restoreSinglePlayerCloudBackup, singlePlayerCloudNumber, type PreparedSinglePlayerCloudBackup,
  type SinglePlayerCloudBackupWire, type SinglePlayerCloudLineage, type SinglePlayerCloudQueryWire,
} from "./cloudBackupClient.ts";

type Marker = { lineage: SinglePlayerCloudLineage | null; deletion: readonly [string, string] | null };
type Pending = readonly [LocalWorldRecord, PreparedSinglePlayerCloudBackup];
type Frozen = { kind: "delete" | "restore" | "resume" | "recover" | "resume-all"; userId: string;
  worldId: string; name: string; revision: string; hash: string; uploadedAt: string; operationId: string;
  wire: SinglePlayerCloudBackupWire | null };
type Controller = { query: SinglePlayerCloudQueryWire | null; anchor: readonly [number, number] | null;
  budget: readonly [number, string, number] | null; markers: Map<string, Marker>; busy: boolean; timer: number;
  mounted: boolean; pending: Pending | null; run: () => void };
const INTERVAL = 7_500_000;
const DELETE_PHRASE = "yes, I want to delete this world";
const read = (storage: SinglePlayerStorageAdapter, key: string, maximum: number) => {
  try { const value = storage.getItem(key); return value && value.length <= maximum ? value : null; } catch { return null; }
};
const exactWrite = (storage: SinglePlayerStorageAdapter, key: string, value: string) => {
  try { storage.setItem(key, value); return storage.getItem(key) === value; } catch { return false; }
};
const exactRemove = (storage: SinglePlayerStorageAdapter, key: string) => {
  try { if (!storage.removeItem) return false; storage.removeItem(key); return storage.getItem(key) === null; } catch { return false; }
};
const key = (userId: string, worldId?: string) => worldId === undefined
  ? `lakecraft:cloud-backup:v1:user:${JSON.stringify(userId)}`
  : `lakecraft:cloud-backup:v1:world:${JSON.stringify(userId)}:${worldId}`;
const parts = (value: string | null, length: number) => { const split = value?.split("|"); return split?.length === length ? split : null; };
const operationId = () => `delete_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const marker = (storage: SinglePlayerStorageAdapter, userId: string, worldId: string): Marker => {
  const raw = read(storage, key(userId, worldId), 96);
  const deletion = parts(raw, 3);
  if (deletion?.[0] === "D" && singlePlayerCloudNumber(deletion[1], 0, Number.MAX_SAFE_INTEGER)
    && /^[A-Za-z0-9_-]{8,80}$/.test(deletion[2])) return { lineage: null, deletion: [deletion[1], deletion[2]] };
  const value = parts(raw, 4);
  const lineage = value && singlePlayerCloudNumber(value[0], 1, Number.MAX_SAFE_INTEGER)
    && singlePlayerCloudNumber(value[1], 1, Number.MAX_SAFE_INTEGER)
    && singlePlayerCloudNumber(value[2], 0, 8_640_000_000_000_000) && /^[0-9a-f]{8}$/.test(value[3])
    ? [value[0], Number(value[1]), Number(value[2]), value[3]] as SinglePlayerCloudLineage : null;
  return { lineage, deletion: null };
};
const saveLineage = (storage: SinglePlayerStorageAdapter, userId: string, worldId: string,
  value: SinglePlayerCloudLineage, controller: Controller) => {
  controller.markers.set(worldId, { lineage: value, deletion: null });
  exactWrite(storage, key(userId, worldId), value.join("|"));
};
const date = (value: string) => new Date(Number(value)).toLocaleString();

function SignedInCloud({ storage, userId, title }: { storage: SinglePlayerStorageAdapter; userId: string; title: boolean }) {
  const query = parseSinglePlayerCloudQueryWire(useQuery<unknown>("singlePlayerCloudBackups"));
  const mutate = useMutation<[string], unknown>("mutateSinglePlayerCloudBackup");
  const [status, setStatus] = useState("checking");
  const [dialog, setDialog] = useState<Frozen | null>(null);
  const [phrase, setPhrase] = useState("");
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [mountDialog] = useState(() => localWorldDialogRef(restoreFocus, () => document.getElementById("lc-cloud-title")));
  const controller = useRef<Controller>({ query, anchor: null, budget: null, markers: new Map(), busy: false,
    timer: 0, mounted: true, pending: null, run: () => {} }).current;
  controller.query = query;
  if (query?.length && (!controller.anchor || controller.anchor[0] !== query[1])) controller.anchor = [query[1], Date.now()];
  const schedule = (delay: number) => {
    window.clearTimeout(controller.timer);
    if (controller.mounted) controller.timer = window.setTimeout(controller.run, Math.max(1_000, delay));
  };
  const localMarker = (worldId: string) => {
    let value = controller.markers.get(worldId);
    if (!value) { value = marker(storage, userId, worldId); controller.markers.set(worldId, value); }
    return value;
  };
  const remoteState = () => {
    const remotes = new Map<string, SinglePlayerCloudBackupWire>();
    const tombstones = new Map<string, string>();
    let fence: string | null = null;
    let damaged = false;
    if (controller.query?.[0] !== 1) return { remotes, tombstones, fence, damaged: true };
    for (const raw of controller.query[2]) {
      const remote = parseRestorableSinglePlayerCloudBackupWire(raw);
      if (remote) remotes.set(remote[1], remote); else damaged = true;
    }
    for (const raw of controller.query[3]) {
      const descriptor = parseSinglePlayerCloudDescriptor(raw);
      if (!descriptor) damaged = true;
      else if (descriptor[0] === 1) tombstones.set(descriptor[1], descriptor[2]);
      else if (descriptor[0] === 2) fence = descriptor[1];
      else damaged = true;
    }
    return { remotes, tombstones, fence, damaged };
  };
  const acceptUpload = (pending: Pending, revision: string) => {
    saveLineage(storage, userId, pending[0].id,
      [revision, pending[1][2], pending[1][3], pending[1][4]], controller);
    controller.pending = null;
  };
  const sendUpload = (pending: Pending, retry = false) => {
    controller.busy = true; controller.pending = pending; setStatus("uploading");
    void mutate(pending[1][0]).then((raw) => {
      const response = parseSinglePlayerCloudMutationWire(raw);
      if (response?.[0] === 1) {
        acceptUpload(pending, response[1]);
        const now = controller.anchor ? controller.anchor[0] + Date.now() - controller.anchor[1] : Date.now();
        const day = Math.floor(now / 86_400_000);
        controller.budget = [now, pending[0].id, 0]; exactWrite(storage, key(userId), controller.budget.join("|"));
        setStatus("up-to-date"); schedule(INTERVAL);
      } else if (response?.[0] === 3) { setStatus(response[1] === "cloud_capacity" ? "capacity" : "quota"); schedule(300_000); }
      else if (response?.[0] === 6) { setStatus("quota"); schedule(response[1]); }
      else if (response?.[0] === 4) setStatus("auth-expired");
      else { controller.pending = null; setStatus("quarantine"); schedule(300_000); }
      controller.busy = false;
    }).catch(() => {
      setStatus("offline"); controller.busy = false;
      if (!retry && controller.mounted) schedule(60_000); else schedule(300_000);
    });
  };
  controller.run = () => {
    if (controller.busy) return;
    const result = controller.query;
    if (!result?.length) return setStatus("checking");
    if (result[0] === 2) return setStatus("auth-expired");
    if (result[0] === 3) return setStatus("quarantine");
    const listing = listLocalWorlds(storage);
    if (!listing.registryLoad.registry || isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)) {
      setStatus("quarantine"); return schedule(300_000);
    }
    const state = remoteState();
    if (state.fence) { setStatus("quarantine"); return; }
    const candidates: Pending[] = [];
    for (const world of listing.registryLoad.registry.worlds) {
      const remote = state.remotes.get(world.id) ?? null;
      const mark = localMarker(world.id);
      if (mark.deletion || state.tombstones.has(world.id)) continue;
      const prepared = prepareSinglePlayerCloudBackup(storage, world, remote?.[8] ?? "0");
      if (!prepared.ok) continue;
      if (remote?.[7] === prepared.backup[1]) {
        const lineage: SinglePlayerCloudLineage = [remote[8], prepared.backup[2], prepared.backup[3], prepared.backup[4]];
        saveLineage(storage, userId, world.id, lineage, controller);
      } else if (!remote ? !mark.lineage : mark.lineage?.[0] === remote[8]
        && prepared.backup[2] > mark.lineage[1] && prepared.backup[3] >= mark.lineage[2]) candidates.push([world, prepared.backup]);
    }
    if (controller.pending) return sendUpload(controller.pending, true);
    if (!candidates.length) { setStatus(state.damaged ? "quarantine" : "up-to-date"); return schedule(300_000); }
    const now = controller.anchor ? controller.anchor[0] + Date.now() - controller.anchor[1] : Date.now();
    const day = Math.floor(now / 86_400_000);
    if (!controller.budget) {
      const value = parts(read(storage, key(userId), 96), 3);
      controller.budget = value && singlePlayerCloudNumber(value[0], 0, now)
        && (value[1] === "" || /^[a-z0-9][a-z0-9-]{0,63}$/.test(value[1]))
        && singlePlayerCloudNumber(value[2], 0, 100_000) ? [Number(value[0]), value[1], Number(value[2])] : [0, "", 0];
    }
    if (controller.budget[2] === day) { setStatus("quota"); return schedule((day + 1) * 86_400_000 - now); }
    const due = controller.budget[0] + INTERVAL;
    if (now < due) { setStatus("ready"); return schedule(due - now); }
    candidates.sort((a, b) => a[0].id < b[0].id ? -1 : 1);
    sendUpload(candidates.find((candidate) => candidate[0].id > controller.budget![1]) ?? candidates[0]);
  };
  useEffect(() => { controller.mounted = true; controller.run(); return () => {
    controller.mounted = false; window.clearTimeout(controller.timer);
  }; }, [query, storage, userId]);

  const open = (kind: Frozen["kind"], opener: HTMLElement, wire: SinglePlayerCloudBackupWire | null,
    revision: string, worldId = "~", name = "Cloud backups") => {
    if (controller.busy) return;
    controller.busy = true; restoreFocus.current = opener; setPhrase("");
    setDialog({ kind, userId, worldId, name, revision, hash: wire?.[6] ?? "", uploadedAt: wire?.[9] ?? "0",
      operationId: operationId(), wire });
  };
  const close = () => { setDialog(null); setPhrase(""); controller.busy = false; schedule(1_000); };
  const submit = async () => {
    const frozen = dialog;
    if (!frozen || frozen.userId !== userId) return close();
    const current = remoteState();
    const listing = listLocalWorlds(storage);
    if (!listing.registryLoad.registry || isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)) {
      setStatus("quarantine"); return close();
    }
    const local = listing.registryLoad.registry.worlds.find((world) => world.id === frozen.worldId) ?? null;
    const remote = current.remotes.get(frozen.worldId) ?? null;
    const revision = current.tombstones.get(frozen.worldId) ?? remote?.[8] ?? current.fence;
    if (revision !== frozen.revision || remote && (remote[6] !== frozen.hash || remote[9] !== frozen.uploadedAt)) {
      setStatus("quarantine"); return close();
    }
    if (frozen.kind === "restore") {
      if (!frozen.wire || local) return close();
      const restored = restoreSinglePlayerCloudBackup(storage, frozen.wire);
      if (!restored.ok) { setStatus("quarantine"); return close(); }
      const prepared = prepareSinglePlayerCloudBackup(storage, restored.world, frozen.revision);
      if (!prepared.ok) { setStatus("quarantine"); return close(); }
      saveLineage(storage, userId, frozen.worldId,
        [frozen.revision, prepared.backup[2], prepared.backup[3], prepared.backup[4]], controller);
      setStatus("up-to-date"); return close();
    }
    if (frozen.kind === "delete") {
      if (phrase !== DELETE_PHRASE || !remote) return;
      const durable = `D|${frozen.revision}|${frozen.operationId}`;
      if (!exactWrite(storage, key(userId, frozen.worldId), durable)) { setStatus("offline"); return close(); }
      controller.markers.set(frozen.worldId, { lineage: null, deletion: [frozen.revision, frozen.operationId] });
      setDialog(null); setStatus("uploading");
      void mutate(JSON.stringify([1, frozen.worldId, frozen.revision, frozen.operationId])).then((raw) => {
        const response = parseSinglePlayerCloudMutationWire(raw);
        setStatus(response?.[0] === 2 ? "up-to-date" : response?.[0] === 4 ? "auth-expired" : "quarantine");
        controller.busy = false;
      }).catch(() => { setStatus("offline"); controller.busy = false; schedule(60_000); });
      return;
    }
    if (frozen.kind === "resume") {
      if (!local) return close();
      const prepared = prepareSinglePlayerCloudBackup(storage, local, frozen.revision);
      if (!prepared.ok) { setStatus("quarantine"); return close(); }
      setDialog(null); controller.busy = false; sendUpload([local, prepared.backup]); return;
    }
    let request = JSON.stringify([frozen.kind === "recover" ? 2 : 3, frozen.revision]);
    let response = parseSinglePlayerCloudMutationWire(await mutate(request));
    while (response?.[0] === 7 && response[2] === 1) response = parseSinglePlayerCloudMutationWire(
      await mutate(JSON.stringify([2, response[1]])));
    if (frozen.kind === "resume-all" && response?.[0] === 8) {
      if (!exactRemove(storage, key(userId))) { setStatus("offline"); return close(); }
      setStatus("ready");
    } else if (frozen.kind === "recover" && response?.[0] === 7) {
      exactWrite(storage, key(userId), `F|${response[1]}`); setStatus("quarantine");
    } else setStatus(response?.[0] === 4 ? "auth-expired" : "quarantine");
    close();
  };
  if (!title) return null;
  const listing = listLocalWorlds(storage);
  const state = remoteState();
  const statusText: Record<string, string> = { checking: "Checking cloud backups…", ready: "Cloud backup ready",
    "up-to-date": "Cloud backups up to date", uploading: "Uploading cloud backup…", offline: "Cloud backups offline",
    quota: "Cloud backup paused until its quota resets", capacity: "Cloud storage capacity reached",
    quarantine: "Cloud backup needs attention", "auth-expired": "Sign in again for cloud backups" };
  const download = (wire: SinglePlayerCloudBackupWire) => {
    const blob = new Blob([wire[7]], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${wire[2].replace(/[^a-z0-9]+/gi, "-") || "world"}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  return <section aria-labelledby="lc-cloud-title" className="lc-cloud">
    <h2 id="lc-cloud-title" tabIndex={-1}>Cloud Backups</h2>
    <p aria-live="polite" className="lc-server-hint" role={status === "offline" || status === "quarantine" ? "alert" : "status"}>
      {statusText[status]}</p>
    {query?.[0] === 3 ? <button className="lc-menu-button" onClick={(e) => open("recover", e.currentTarget,
      null, query[2])} type="button">Repair Cloud Backups</button> : null}
    {state.fence ? <div className="lc-local-world-row"><span className="lc-local-world-select"><strong>Cloud backups paused</strong>
      <small>Recovery is complete. Resume when this device is ready.</small></span><button className="lc-menu-button"
        onClick={(e) => open("resume-all", e.currentTarget, null, state.fence!)} type="button">Resume</button></div> : null}
    {[...state.remotes.values()].map((remote) => {
      const local = listing.registryLoad.registry?.worlds.some((world) => world.id === remote[1]);
      return <div className="lc-local-world-row" key={remote[1]}><span className="lc-local-world-select"><strong>{remote[2]}</strong>
        <small>{local ? "Backed up on this device" : "Cloud backup"} · {date(remote[9])}</small></span><span className="lc-cloud-actions">
          {!local ? <button onClick={(e) => open("restore", e.currentTarget, remote, remote[8], remote[1], remote[2])} type="button">Restore</button> : null}
          <button onClick={() => download(remote)} type="button">Download</button>
          <button onClick={(e) => open("delete", e.currentTarget, remote, remote[8], remote[1], remote[2])} type="button">Delete</button>
        </span></div>;
    })}
    {[...state.tombstones].map(([worldId, revision]) => {
      const local = listing.registryLoad.registry?.worlds.find((world) => world.id === worldId);
      return <div className="lc-local-world-row" key={worldId}><span className="lc-local-world-select"><strong>{local?.name ?? "Deleted cloud backup"}</strong>
        <small>Cloud backup paused</small></span>{local ? <button className="lc-menu-button"
          onClick={(e) => open("resume", e.currentTarget, null, revision, worldId, local.name)} type="button">Resume</button> : null}</div>;
    })}
    {dialog ? <dialog aria-labelledby="lc-cloud-dialog-title" className="lc-username-layer lc-local-world-dialog"
      onClose={close} ref={mountDialog} role="alertdialog"><form className="lc-username-menu" method="dialog"
        onSubmit={(event) => { event.preventDefault(); void submit().catch(() => { setStatus("offline"); close(); }); }}>
        <h2 id="lc-cloud-dialog-title">{dialog.kind === "delete" ? "Delete Cloud Backup" : dialog.kind === "restore" ? "Restore Cloud Backup" : "Resume Cloud Backups"}</h2>
        <p>{dialog.kind === "delete" ? `Permanently delete the cloud backup for ${dialog.name}? Local progress stays on this device.`
          : dialog.kind === "restore" ? `Restore ${dialog.name} into an empty local world namespace?` : "Allow this device to upload cloud backups again?"}</p>
        {dialog.kind === "delete" ? <label><span>Type <strong>{DELETE_PHRASE}</strong> to confirm</span><input autoFocus
          aria-label="Delete cloud backup confirmation phrase" autoComplete="off" onInput={(e) => setPhrase(e.currentTarget.value)} value={phrase} /></label> : null}
        <button className="lc-menu-button" disabled={dialog.kind === "delete" && phrase !== DELETE_PHRASE} type="submit">Confirm</button>
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
