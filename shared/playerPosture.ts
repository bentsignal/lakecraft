/** Eye heights accepted by both the dependency-free client and Lakebed authority. */
export const PLAYER_STANDING_EYE_HEIGHT = 1.62;
export const PLAYER_SNEAKING_EYE_HEIGHT = 1.36;
export const PLAYER_INTERACTION_EYE_HEIGHTS = Object.freeze([
  PLAYER_STANDING_EYE_HEIGHT,
  PLAYER_SNEAKING_EYE_HEIGHT,
] as const);
