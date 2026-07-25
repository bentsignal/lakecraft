/**
 * Charge quantization remains shared by combat feedback and focused tests.
 * Rendering now belongs to the retained WebGL first-person batch.
 */
export const BOW_FULL_CHARGE_MS = 1_000;

export function bowChargeProgress(chargeMs: number): number {
  if (!Number.isFinite(chargeMs) || chargeMs <= 0) return 0;
  return Math.min(1, chargeMs / BOW_FULL_CHARGE_MS);
}

export function bowChargeStage(progress: number): 0 | 1 | 2 {
  const bounded = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (bounded >= 0.9) return 2;
  if (bounded >= 0.55) return 1;
  return 0;
}
