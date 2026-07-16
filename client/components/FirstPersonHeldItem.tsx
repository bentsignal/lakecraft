import { useRef } from "preact/hooks";
import { ITEMS, type ItemStack } from "../../shared/game";
import { shouldAnimateFirstPersonAction } from "./firstPersonAction";
import { HeldBlockVoxel, isHeldVoxelBlock, ItemIcon } from "./ItemGlyph";

export type FirstPersonHeldItemProps = {
  /** The currently selected hotbar stack. Null still renders the player's hand. */
  stack: ItemStack | null;
  /** Increment for each mine, place, attack, or use action to replay the swing. */
  actionToken?: number;
  /** Hides all first-person feedback for drawers, chat capture, and cinematic UI. */
  hidden?: boolean;
  /** Explicit pause guard for callers outside GameHud. */
  paused?: boolean;
};

const HELD_SPRITE_DEPTH_SLICES = [0, 1, 2, 3, 4] as const;

/**
 * Repeats the canonical pixel sprite through a tiny, fixed depth stack. The
 * silhouette remains the exact inventory art, but its dark rear slices make a
 * pickaxe, sword, torch, or food item read as an object instead of a HUD icon.
 */
function HeldSpriteExtrusion({ stack }: { stack: ItemStack }) {
  return (
    <span className="lc-held-sprite" data-held-item={stack.itemId}>
      {HELD_SPRITE_DEPTH_SLICES.map((slice) => (
        <span
          className={`lc-held-sprite__slice${slice === HELD_SPRITE_DEPTH_SLICES.length - 1 ? " is-front" : ""}`}
          key={slice}
          style={{ "--lc-held-sprite-offset": `${(HELD_SPRITE_DEPTH_SLICES.length - 1 - slice) * -2}px` } as Record<string, string>}
        >
          <ItemIcon compact stack={{ itemId: stack.itemId, count: 1 }} />
        </span>
      ))}
    </span>
  );
}

function VoxelArmSegment({ material }: { material: "sleeve" | "skin" }) {
  return (
    <span className={`lc-first-person__arm-segment lc-first-person__arm-segment--${material}`}>
      <i className="lc-first-person__arm-face lc-first-person__arm-face--front" />
      <i className="lc-first-person__arm-face lc-first-person__arm-face--left" />
      <i className="lc-first-person__arm-face lc-first-person__arm-face--top" />
    </span>
  );
}

/**
 * Fixed-cost first-person feedback. Full blocks become a large three-face voxel;
 * tools and non-cubic items retain the canonical 16x16 sprite used by the hotbar.
 */
export function FirstPersonHeldItem({
  stack,
  actionToken = 0,
  hidden = false,
  paused = false,
}: FirstPersonHeldItemProps) {
  const lastActionToken = useRef(actionToken);
  const animatedActionToken = useRef<number | null>(null);
  const actionChanged = shouldAnimateFirstPersonAction(
    lastActionToken.current,
    actionToken,
    hidden,
    paused,
  );
  lastActionToken.current = actionToken;
  if (hidden || paused) animatedActionToken.current = null;
  else if (actionChanged) animatedActionToken.current = actionToken;
  if (hidden || paused) return null;
  const family = stack ? ITEMS[stack.itemId].category : "hand";
  const heldAsVoxel = stack ? isHeldVoxelBlock(stack.itemId) : false;

  return (
    <span
      aria-hidden="true"
      className="lc-first-person"
      data-held-family={family}
      data-held-mode={heldAsVoxel ? "voxel" : stack ? "sprite" : "hand"}
    >
      <span
        className={`lc-first-person__rig${animatedActionToken.current === actionToken ? " is-swinging" : ""}`}
        key={`held-action-${actionToken}`}
      >
        <span className="lc-first-person__scene">
          {stack ? (
            <span className="lc-first-person__item">
              {heldAsVoxel
                ? <HeldBlockVoxel blockId={stack.itemId} />
                : <HeldSpriteExtrusion stack={stack} />}
            </span>
          ) : null}
          <span className="lc-first-person__arm">
            <VoxelArmSegment material="sleeve" />
            <VoxelArmSegment material="skin" />
          </span>
        </span>
      </span>
    </span>
  );
}
