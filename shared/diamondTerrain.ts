/** Inclusive absolute world-height band where deterministic diamond veins may begin. */
export const DIAMOND_ORE_MIN_Y = 1;
export const DIAMOND_ORE_MAX_Y = 20;
export const DIAMOND_ORE_PEAK_MIN_Y = 8;
export const DIAMOND_ORE_PEAK_MAX_Y = 10;

/**
 * Deterministic vein activation profile by the vein anchor's absolute Y.
 * The peak is intentionally narrow around y=8..10, while a small linear tail
 * keeps every height in the y=1..20 progression band eligible.
 */
export function diamondOreVeinChance(anchorY: number): number {
  if (!Number.isInteger(anchorY) || anchorY < DIAMOND_ORE_MIN_Y || anchorY > DIAMOND_ORE_MAX_Y) return 0;
  const distance = anchorY < DIAMOND_ORE_PEAK_MIN_Y
    ? DIAMOND_ORE_PEAK_MIN_Y - anchorY
    : anchorY > DIAMOND_ORE_PEAK_MAX_Y
      ? anchorY - DIAMOND_ORE_PEAK_MAX_Y
      : 0;
  // The integrated 1..20 activation mass is 0.685, close to the legacy
  // twelve-layer 0.66 budget, so changing depth does not flood progression.
  return 0.005 + 0.05 * Math.max(0, 1 - distance / 10);
}
