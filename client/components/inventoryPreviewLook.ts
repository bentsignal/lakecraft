export function inventoryPreviewLook(
  pointer: readonly [number, number],
  bounds: readonly [number, number, number, number],
): readonly [number, number] {
  if (pointer[0] === 0 && pointer[1] === 0) return [0, 0];
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return [
    clamp((pointer[0] - bounds[0] - bounds[2] / 2) / (bounds[2] * 1.35)),
    clamp((pointer[1] - bounds[1] - bounds[3] / 2) / (bounds[3] * 1.35)),
  ];
}
