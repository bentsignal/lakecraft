import type { ItemId } from "../../shared/game.ts";
import { getItemIconArt } from "../components/itemIconArt.ts";

/** Stable per-item fingerprint for Visual Lab review and screenshot evidence. */
export function itemIconFingerprint(itemId: ItemId): string {
  const art = getItemIconArt(itemId);
  const source = `${art.family}|${art.variant}|${art.runs.map((run) => `${run.x},${run.y},${run.width},${run.color}`).join(";")}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
