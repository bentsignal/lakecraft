import type { ItemId } from "../../shared/game.ts";
import { itemVisual } from "../../shared/visualCatalog.ts";
import { getBowIconArt, getItemIconArt } from "../components/itemIconArt.ts";
import { appendBlockItemCubeGeometry, blockIdForCubeItem } from "./blockItemCubeGeometry.ts";
import {
  appendItemSpriteGeometry,
  ITEM_SPRITE_VERTEX_FLOATS,
  type ItemSpriteGeometryOptions,
} from "./itemSpriteGeometry.ts";
import {
  currentThirdPersonTuning,
  thirdPersonPoseGroupForItem,
  type ThirdPersonTuning,
} from "./thirdPersonTuning.ts";

/** Resolves the catalog's 16-unit third-person transform onto the right-hand socket. */
export function thirdPersonHeldItemPresentation(
  itemId: ItemId,
  tuning: ThirdPersonTuning = currentThirdPersonTuning().tuning,
): ItemSpriteGeometryOptions {
  const visual = itemVisual(itemId);
  const display = visual.display.thirdPersonRight;
  const delta = tuning[thirdPersonPoseGroupForItem(itemId)];
  const specialBlockSprite = itemId === "chest" || itemId === "torch";
  const baseSize = blockIdForCubeItem(itemId) !== null ? 1.25 : 0.82;
  const socketY = visual.parent === "bow" ? 0.875 : 0.53;
  const socketZ = visual.parent === "bow" ? 0.05 : 0.17;
  return Object.freeze({
    center: [
      0.39 + display.translation[0] / 16 + delta.position[0],
      socketY + display.translation[1] / 16 + delta.position[1] + (specialBlockSprite ? 0.03125 : 0),
      socketZ + display.translation[2] / 16 + delta.position[2] + (specialBlockSprite ? 0.0625 : 0),
    ],
    size: baseSize * display.scale[0] * delta.scale * (specialBlockSprite ? 1.47 : 1),
    depth: Math.max(0.028, 0.052 * display.scale[2] * delta.scale),
    rotationDegrees: [
      display.rotationDegrees[0] + delta.rotationDegrees[0] - (specialBlockSprite ? 75 : 0),
      display.rotationDegrees[1] + delta.rotationDegrees[1] - (specialBlockSprite ? 45 : 0),
      display.rotationDegrees[2] + delta.rotationDegrees[2],
    ],
    pivotPixels: display.pivot ? [display.pivot[0], display.pivot[1]] : undefined,
  });
}

/** Canonical colored geometry used by both the local F5 and remote-player rigs. */
export function buildThirdPersonHeldItemGeometry(
  itemId: ItemId,
  tuning: ThirdPersonTuning = currentThirdPersonTuning().tuning,
  bowDrawing = false,
): Float32Array {
  const output: number[] = [];
  const presentation = thirdPersonHeldItemPresentation(itemId, tuning);
  if (blockIdForCubeItem(itemId) !== null) {
    appendBlockItemCubeGeometry(output, itemId, presentation);
  }
  else appendItemSpriteGeometry(output, itemId === "bow" && bowDrawing ? getBowIconArt(3) : getItemIconArt(itemId), presentation);
  return new Float32Array(output);
}

export function thirdPersonHeldItemVertexCount(geometry: Float32Array): number {
  return geometry.length / ITEM_SPRITE_VERTEX_FLOATS;
}
