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

/** Fixed inventory camera used by the same 3D player renderer as F5. */
export function inventoryPreviewViewProjection(aspect: number): Float32Array {
  const f = 1 / Math.tan(21 * Math.PI / 180);
  const depth = -3.2;
  const a = 20.1 / -19.9;
  const b = 4 / -19.9;
  return new Float32Array([
    f / Math.max(.1, aspect),0,0,0,
    0,f,0,0,
    0,0,a,-1,
    0,-f,a * depth + b,-depth,
  ]);
}
