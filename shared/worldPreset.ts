export type WorldPreset = "default" | "superflat";

export interface WorldTerrainDescriptor {
  preset: WorldPreset;
  /** Inclusive grass surface Y. Ignored by the default terrain preset. */
  superflatGroundY: number;
  /** Missing/2 preserves shipped terrain; new local worlds opt into biome generation with 3. */
  generatorVersion?: 2 | 3;
}
export const DEFAULT_SUPERFLAT_GROUND_Y = 20;
export const SUPERFLAT_MIN_GROUND_Y = 11;
export const SUPERFLAT_MAX_GROUND_Y = 64;
export const SUPERFLAT_BEDROCK_Y = 1;
export const SUPERFLAT_DIRT_LAYERS = 3;

export function isWorldTerrainDescriptor(value: unknown): value is WorldTerrainDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.preset === "default" || candidate.preset === "superflat")
    && Number.isSafeInteger(candidate.superflatGroundY)
    && (candidate.superflatGroundY as number) >= SUPERFLAT_MIN_GROUND_Y
    && (candidate.superflatGroundY as number) <= SUPERFLAT_MAX_GROUND_Y
    && (candidate.generatorVersion === undefined || candidate.generatorVersion === 2 || candidate.generatorVersion === 3);
}
