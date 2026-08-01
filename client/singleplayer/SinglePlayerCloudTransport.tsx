import { signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef } from "preact/hooks";
import { parseRestorableSinglePlayerCloudBackupWire, parseSinglePlayerCloudMutationWire,
  parseSinglePlayerCloudQueryWire, prepareSinglePlayerCloudBackup, singlePlayerCloudNumber,
  type PreparedSinglePlayerCloudBackup, type SinglePlayerCloudBackupWire, type SinglePlayerCloudLineage,
  type SinglePlayerCloudQueryWire } from "./cloudBackupClient.ts";
import { isLocalWorldRegistryTransactionReadOnly, listLocalWorlds, type LocalWorldRecord } from "./localWorldRegistry.ts";
import type { SinglePlayerStorageAdapter } from "./localSave.ts";

type Budget = readonly [number, string, number];
type Marker = readonly [SinglePlayerCloudLineage | null, boolean];
type Controller = [SinglePlayerCloudQueryWire | null, readonly [number, number] | null,
  Budget | null, Map<string, Marker>, boolean, number, () => void];
const INTERVAL = 7_500_000;
const read = (storage: SinglePlayerStorageAdapter, key: string, maximum: number) => {
  try { const value = storage.getItem(key); return value && value.length <= maximum ? value : null; } catch { return null; }
};
const write = (storage: SinglePlayerStorageAdapter, key: string, value: string) => {
  try { storage.setItem(key, value); } catch { /* mounted session remains authoritative */ }
};
const key = (userId: string, worldId?: string) => worldId === undefined
  ? `lakecraft:cloud-backup:v1:user:${JSON.stringify(userId)}`
  : `lakecraft:cloud-backup:v1:world:${JSON.stringify(userId)}:${worldId}`;
const decode = (value: string | null, length: number) => { const parts = value?.split("|"); return parts?.length === length ? parts : null; };
const reload = () => { signOut(); window.location.reload(); };

function SignedInCloud({ storage, userId }: { storage: SinglePlayerStorageAdapter; userId: string }) {
  const query = parseSinglePlayerCloudQueryWire(useQuery<unknown>("singlePlayerCloudBackups"));
  const mutation = useMutation<[string], unknown>("mutateSinglePlayerCloudBackup");
  const controller = useRef<Controller>([query, null, null, new Map(), false, 0, () => {}]).current;
  if (controller[0] !== query || !controller[1]) {
    controller[0] = query;
    if (query?.length) controller[1] = [query[1], Date.now()];
  }
  const schedule = (delay: number) => {
    window.clearTimeout(controller[5]);
    if (controller[5] >= 0) controller[5] = window.setTimeout(() => controller[6](), delay);
  };
  controller[6] = () => {
    const result = controller[0];
    if (controller[4]) return;
    if (!result?.length || result[0] !== 1 || result[3].length) return schedule(300_000);
    const listing = listLocalWorlds(storage);
    if (!listing.registryLoad.registry || isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)) return schedule(300_000);
    const remotes = new Map<string, SinglePlayerCloudBackupWire>();
    for (const value of result[2]) {
      const remote = parseRestorableSinglePlayerCloudBackupWire(value);
      if (!remote) return schedule(300_000);
      remotes.set(remote[1], remote);
    }
    const candidates: [LocalWorldRecord, PreparedSinglePlayerCloudBackup][] = [];
    for (const world of listing.registryLoad.registry.worlds) {
      const remote = remotes.get(world.id) ?? null;
      const prepared = prepareSinglePlayerCloudBackup(storage, world, remote?.[8] ?? "0");
      if (!prepared.ok) continue;
      let marker = controller[3].get(world.id);
      if (!marker) {
        const raw = read(storage, key(userId, world.id), 80);
        const value = decode(raw, 4);
        const lineage = value && singlePlayerCloudNumber(value[0], 1, Number.MAX_SAFE_INTEGER)
          && singlePlayerCloudNumber(value[1], 1, Number.MAX_SAFE_INTEGER)
          && singlePlayerCloudNumber(value[2], 0, 8_640_000_000_000_000) && /^[0-9a-f]{8}$/.test(value[3])
          ? [value[0], Number(value[1]), Number(value[2]), value[3]] : null;
        marker = [lineage as SinglePlayerCloudLineage | null, raw === "1"];
        controller[3].set(world.id, marker);
      }
      const [lineage, disabled] = marker;
      if (!disabled && remote?.[7] === prepared.backup[1]) {
        const fresh: SinglePlayerCloudLineage = [remote[8], prepared.backup[2], prepared.backup[3], prepared.backup[4]];
        if (!lineage || fresh.some((value, index) => value !== lineage![index])) {
          controller[3].set(world.id, [fresh, false]); write(storage, key(userId, world.id), fresh.join("|"));
        }
      } else if (!disabled) {
        const revision = !remote ? lineage ? null : "0"
          : !lineage || lineage[0] !== remote[8] ? null
            : prepared.backup[2] === lineage[1] && prepared.backup[3] === lineage[2]
              && prepared.backup[4] === lineage[3] ? null
              : prepared.backup[2] > lineage[1] && prepared.backup[3] >= lineage[2] ? remote[8] : null;
        if (revision !== null) candidates.push([world, prepared.backup]);
      }
    }
    if (!candidates.length) return schedule(300_000);
    const anchor = controller[1];
    const now = anchor ? anchor[0] + Date.now() - anchor[1] : Date.now();
    const day = Math.floor(now / 86_400_000);
    if (!controller[2]) {
      const value = decode(read(storage, key(userId), 96), 3);
      controller[2] = value && singlePlayerCloudNumber(value[0], 0, now)
        && (value[1] === "" || /^[a-z0-9][a-z0-9-]{0,63}$/.test(value[1]))
        && singlePlayerCloudNumber(value[2], 0, 100_000)
        ? [Number(value[0]), value[1], Number(value[2]) === day ? day : 0] : [0, "", 0];
    }
    if (controller[2][2] === day) return schedule((day + 1) * 86_400_000 - now);
    const due = controller[2][0] + INTERVAL;
    if (now < due) return schedule(due - now);
    candidates.sort((left, right) => left[0].id < right[0].id ? -1 : 1);
    const selected = candidates.find((candidate) => candidate[0].id > controller[2]![1]) ?? candidates[0];
    controller[2] = [now, selected[0].id, 0]; write(storage, key(userId), controller[2].join("|"));
    controller[4] = true;
    void mutation(selected[1][0]).catch(() => [5, "offline", Date.now()] as const).then((value) => {
      const response = parseSinglePlayerCloudMutationWire(value);
      if (response?.[0] === 1) {
        const lineage: SinglePlayerCloudLineage = [response[1], selected[1][2], selected[1][3], selected[1][4]];
        controller[3].set(selected[0].id, [lineage, false]); write(storage, key(userId, selected[0].id), lineage.join("|"));
      } else if (response?.[0] === 3) {
        controller[2] = [controller[2]![0], controller[2]![1], day]; write(storage, key(userId), controller[2].join("|"));
      } else if (response?.[0] === 4) reload();
      controller[4] = false; schedule(60_000);
    });
  };
  const ready = query?.[0] === 1;
  useEffect(() => { if (ready) controller[6](); }, [ready, storage, userId]);
  useEffect(() => () => { window.clearTimeout(controller[5]); controller[5] = -1; }, []);
  return null;
}

export function SinglePlayerCloudIdentityBoundary({ storage }: { storage: SinglePlayerStorageAdapter }) {
  const auth = useAuth();
  useEffect(() => { if (!auth.isLoading && (!auth.isAuthenticated || auth.isGuest)) reload(); },
    [auth.isLoading, auth.isAuthenticated, auth.isGuest]);
  return auth.isAuthenticated && !auth.isGuest ? <SignedInCloud key={auth.userId} storage={storage} userId={auth.userId} /> : null;
}
