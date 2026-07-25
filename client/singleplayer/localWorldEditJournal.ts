import type { WorldEdit } from "../game/types.ts";

export type LocalWorldEditIndex = Map<string, WorldEdit>;

export function localWorldEditKey(edit: Pick<WorldEdit, "x" | "y" | "z">): string {
  return `${edit.x}:${edit.y}:${edit.z}`;
}

export function createLocalWorldEditIndex(initial: readonly WorldEdit[]): LocalWorldEditIndex {
  return new Map(initial.map((edit) => [localWorldEditKey(edit), {
    x: edit.x, y: edit.y, z: edit.z, block: edit.block,
  }]));
}

export function canCommitLocalWorldEdits(
  index: LocalWorldEditIndex,
  batch: readonly WorldEdit[],
  capacity: number,
): boolean {
  let available = capacity - index.size;
  const novel = new Set<string>();
  for (const edit of batch) {
    const key = localWorldEditKey(edit);
    if (index.has(key) || novel.has(key)) continue;
    if (available <= 0) return false;
    available -= 1;
    novel.add(key);
  }
  return true;
}

/** Atomically applies a bounded last-write-wins batch in O(batch) time. */
export function tryCommitLocalWorldEdits(
  index: LocalWorldEditIndex,
  batch: readonly WorldEdit[],
  capacity: number,
): boolean {
  if (!canCommitLocalWorldEdits(index, batch, capacity)) return false;
  for (const edit of batch) index.set(localWorldEditKey(edit), {
    x: edit.x, y: edit.y, z: edit.z, block: edit.block,
  });
  return true;
}
