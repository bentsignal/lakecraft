import { ITEMS, type ItemStack } from "../../shared/game";
import { HeldBlockVoxel, isHeldVoxelBlock, ItemIcon } from "./ItemGlyph";
import { miningCrackStage } from "./firstPersonFeedback";

export type FirstPersonHeldItemProps = {
  /** The currently selected hotbar stack. Null still renders the player's hand. */
  stack: ItemStack | null;
  /** Normalized hold-to-mine progress. Zero and one both hide the crack overlay. */
  miningProgress?: number;
  /** Increment for each mine, place, attack, or use action to replay the swing. */
  actionToken?: number;
  /** Hides all first-person feedback for drawers, chat capture, and cinematic UI. */
  hidden?: boolean;
  /** Explicit pause guard for callers outside GameHud. */
  paused?: boolean;
};

const CRACK_SEGMENTS = [
  "M64 64 L54 50 L43 46",
  "M54 50 L51 35 L39 27",
  "M43 46 L28 49 L18 39",
  "M64 64 L78 53 L91 54",
  "M78 53 L83 37 L97 29",
  "M91 54 L106 47 L116 53",
  "M64 64 L55 77 L42 81",
  "M55 77 L50 94 L35 104",
  "M64 64 L77 76 L82 91",
  "M82 91 L95 101 L108 99",
] as const;

/**
 * Fixed-cost first-person feedback. Full blocks become a large three-face voxel;
 * tools and non-cubic items retain the canonical 16x16 sprite used by the hotbar.
 */
export function FirstPersonHeldItem({
  stack,
  miningProgress = 0,
  actionToken = 0,
  hidden = false,
  paused = false,
}: FirstPersonHeldItemProps) {
  if (hidden || paused) return null;
  const family = stack ? ITEMS[stack.itemId].category : "hand";
  const heldAsVoxel = stack ? isHeldVoxelBlock(stack.itemId) : false;
  const crackStage = miningCrackStage(miningProgress);

  return (
    <>
      {crackStage >= 0 ? (
        <svg
          aria-hidden="true"
          className="lc-block-cracks"
          data-crack-stage={crackStage}
          focusable="false"
          shape-rendering="crispEdges"
          viewBox="0 0 128 128"
        >
          {CRACK_SEGMENTS.map((path, index) => (
            <path className={index <= crackStage ? "is-visible" : ""} d={path} key={path} />
          ))}
        </svg>
      ) : null}
      <span
        aria-hidden="true"
        className="lc-first-person"
        data-held-family={family}
        data-held-mode={heldAsVoxel ? "voxel" : stack ? "sprite" : "hand"}
      >
        <span
          className={`lc-first-person__rig${actionToken > 0 ? " is-swinging" : ""}`}
          key={`held-action-${actionToken}`}
        >
          {stack ? (
            <span className="lc-first-person__item">
              {heldAsVoxel
                ? <HeldBlockVoxel blockId={stack.itemId} />
                : <ItemIcon compact stack={{ itemId: stack.itemId, count: 1 }} />}
            </span>
          ) : null}
          <span className="lc-first-person__arm">
            <i className="lc-first-person__sleeve" />
            <i className="lc-first-person__skin lc-first-person__skin--front" />
          </span>
        </span>
      </span>
    </>
  );
}
