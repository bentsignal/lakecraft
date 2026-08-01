import {
  canPlayLocalWorld,
  createLocalWorld,
  listLocalWorlds,
  type LocalWorldInspection,
  type LocalWorldMutationResult,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";
import type { SinglePlayerStorageAdapter } from "./localSave.ts";
import type { LocalGameMode } from "./localCommands.ts";

function sameWorld(left: LocalWorldRecord, right: LocalWorldRecord): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.seed === right.seed
    && left.initialGameMode === right.initialGameMode
    && left.createdAt === right.createdAt
    && left.lastPlayedAt === right.lastPlayedAt
    && left.importedLegacy === right.importedLegacy;
}

export function verifiedCreatedLocalWorld(
  expected: LocalWorldRecord,
  worlds: readonly LocalWorldInspection[],
): LocalWorldRecord | null {
  const entry = worlds.find(({ world }) => world.id === expected.id);
  return entry && sameWorld(entry.world, expected) && canPlayLocalWorld(entry) ? entry.world : null;
}

export function createLocalWorldForImmediatePlay(
  storage: SinglePlayerStorageAdapter,
  input: { name: string; seedText: string; gameMode: LocalGameMode },
): {
  creation: LocalWorldMutationResult;
  listing: ReturnType<typeof listLocalWorlds> | null;
  playable: LocalWorldRecord | null;
} {
  const creation = createLocalWorld(storage, input);
  if (!creation.ok) return { creation, listing: null, playable: null };
  const listing = listLocalWorlds(storage);
  return { creation, listing, playable: verifiedCreatedLocalWorld(creation.world, listing.worlds) };
}

export function enterVerifiedCreatedLocalWorld(
  world: LocalWorldRecord | null,
  requestPointerLockHandoff: () => boolean,
  onPlay: (world: LocalWorldRecord, pointerLockHandoff: boolean) => void,
): boolean {
  if (!world) return false;
  onPlay(world, requestPointerLockHandoff());
  return true;
}

export function localWorldDeleteState(issues: readonly string[]): readonly [string, boolean] {
  const has = (issue: string) => issues.includes(`delete:${issue}`);
  if (has("recovery_pending")) {
    return ["!Deletion committed; cleanup pending.", true];
  }
  if (has("invalid_transaction_pending")) {
    return ["!Invalid deletion marker; worlds unchanged.", true];
  }
  if (has("transaction_read_failed")) return ["", true];
  if (has("invalid_transaction_cleared")) {
    return ["!Invalid deletion ignored. Worlds remain available; orphaned data may remain.", false];
  }
  if (has("rollback_completed") || has("cleanup_completed")) {
    return ["Deletion recovered; other worlds unchanged.", false];
  }
  return ["", false];
}

interface DialogLike {
  open: boolean;
  close(): void;
  showModal(): void;
}

interface FocusLike {
  isConnected: boolean;
  disabled?: boolean;
  focus(): void;
}

export function localWorldDialogRef(
  restoreRef: { current: FocusLike | null },
  fallback: () => FocusLike | null,
): (dialog: DialogLike | null) => void {
  let opened: DialogLike | null;
  return (dialog) => {
    if (dialog) {
      opened = dialog;
      dialog.showModal();
      return;
    }
    const restore = restoreRef.current;
    const closing = opened;
    restoreRef.current = opened = null;
    if (closing?.open) closing.close();
    (restore?.isConnected && !restore.disabled ? restore : fallback())?.focus();
  };
}
