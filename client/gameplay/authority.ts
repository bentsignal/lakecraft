import type { VoxelEngineOptions } from "../game/types.ts";

export type GameplayAuthorityKind = "local" | "railway";

export type GameplayAuthorityCapabilities = Readonly<{
  persistentWorld: boolean;
  realtimePeers: boolean;
  authoritativeDrops: boolean;
  localSimulation: boolean;
}>;

export interface GameplayAuthorityAdapter {
  readonly kind: GameplayAuthorityKind;
  readonly capabilities: GameplayAuthorityCapabilities;
  /**
   * Authority-owned engine callbacks. Presentation, camera, audio and UI
   * callbacks belong to the shared gameplay session rather than this adapter.
   */
  readonly engineOptions: VoxelEngineOptions;
}

const LOCAL_CAPABILITIES: GameplayAuthorityCapabilities = Object.freeze({
  persistentWorld: true,
  realtimePeers: false,
  authoritativeDrops: false,
  localSimulation: true,
});

const RAILWAY_CAPABILITIES: GameplayAuthorityCapabilities = Object.freeze({
  persistentWorld: true,
  realtimePeers: true,
  authoritativeDrops: true,
  localSimulation: false,
});

function createAuthority(
  kind: GameplayAuthorityKind,
  capabilities: GameplayAuthorityCapabilities,
  engineOptions: VoxelEngineOptions,
): GameplayAuthorityAdapter {
  if (kind === "local") {
    if (!engineOptions.acceptWorldEdits || !engineOptions.onBlockEdit) {
      throw new Error("Local gameplay authority requires synchronous edit reservation and commit callbacks.");
    }
  } else {
    if (!engineOptions.canEditBlock || !engineOptions.onBlockEdit) {
      throw new Error("Railway gameplay authority requires a pending-edit gate and authoritative edit callback.");
    }
    if (engineOptions.acceptWorldEdits || engineOptions.onSimulationStep || engineOptions.twoBlockBeds) {
      throw new Error("Railway gameplay authority cannot enable offline world ownership.");
    }
  }
  return Object.freeze({ kind, capabilities, engineOptions: Object.freeze({ ...engineOptions }) });
}

export function createLocalGameplayAuthority(engineOptions: VoxelEngineOptions): GameplayAuthorityAdapter {
  return createAuthority("local", LOCAL_CAPABILITIES, engineOptions);
}

export function createRailwayGameplayAuthority(engineOptions: VoxelEngineOptions): GameplayAuthorityAdapter {
  return createAuthority("railway", RAILWAY_CAPABILITIES, engineOptions);
}

