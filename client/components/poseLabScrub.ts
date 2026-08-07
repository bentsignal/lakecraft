/** Four pixels per discrete step keeps vertical scrubbing controllable on trackpads and mice. */
export function poseLabScrubValue(
  startValue: number,
  upwardPixels: number,
  step: number,
  minimum = Number.NEGATIVE_INFINITY,
): number {
  const safeMinimum = Number.isFinite(minimum) ? minimum : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(startValue) || !Number.isFinite(upwardPixels) || !Number.isFinite(step) || step <= 0) {
    return Math.max(safeMinimum, Number.isFinite(startValue) ? startValue : 0);
  }
  const steps = Math.round(upwardPixels / 4);
  return Math.max(safeMinimum, Number((startValue + steps * step).toFixed(4)));
}
