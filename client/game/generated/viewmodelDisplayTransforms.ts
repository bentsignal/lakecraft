/* Generated from the reviewed Minecraft 26.2 model graph. Do not hand-tune. */
export type ViewmodelDisplayTransform = Readonly<{
  rotationDegrees: readonly [number, number, number];
  translationPixels: readonly [number, number, number];
  scale: readonly [number, number, number];
}>;

/** item/handheld.json -> display.firstperson_righthand. */
export const MINECRAFT_HANDHELD_FIRST_PERSON = Object.freeze({
  rotationDegrees: Object.freeze([0, -90, 25] as const),
  translationPixels: Object.freeze([1.13, 3.2, 1.13] as const),
  scale: Object.freeze([0.68, 0.68, 0.68] as const),
}) satisfies ViewmodelDisplayTransform;

/** block/block.json -> display.firstperson_righthand. */
export const MINECRAFT_BLOCK_FIRST_PERSON = Object.freeze({
  rotationDegrees: Object.freeze([0, 315, 0] as const),
  translationPixels: Object.freeze([0, 0, 0] as const),
  scale: Object.freeze([0.4, 0.4, 0.4] as const),
}) satisfies ViewmodelDisplayTransform;

/** item/bow.json -> display.firstperson_righthand. */
export const MINECRAFT_BOW_FIRST_PERSON = MINECRAFT_HANDHELD_FIRST_PERSON;
