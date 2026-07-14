export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  PLANKS: 6,
  CRAFTING_TABLE: 7,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export interface WorldEdit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
}

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RemotePlayer extends PlayerPose {
  id: string;
  name?: string;
  color?: readonly [number, number, number] | string;
}

export interface BlockTarget {
  block: WorldEdit;
  place: { x: number; y: number; z: number };
  distance: number;
}

export interface VoxelEngineOptions {
  seed?: number;
  worldRadius?: number;
  initialEdits?: readonly WorldEdit[];
  initialPose?: Partial<PlayerPose>;
  selectedBlock?: BlockId;
  reach?: number;
  /** previousBlock lets inventory code distinguish mining from placement. */
  onBlockEdit?: (edit: WorldEdit, previousBlock: BlockId) => void;
  /** Seconds the primary action must be held before a block is mined. */
  getMiningDuration?: (block: BlockId) => number;
  onPoseChange?: (pose: PlayerPose) => void;
  onTargetChange?: (target: BlockTarget | null) => void;
  onPointerLockChange?: (locked: boolean) => void;
}

export interface VoxelEngine {
  start(): void;
  destroy(): void;
  applyWorldEdits(edits: readonly WorldEdit[]): void;
  setSelectedBlock(block: BlockId): void;
  setRemotePlayers(players: readonly RemotePlayer[]): void;
  getPose(): PlayerPose;
  getTarget(): BlockTarget | null;
  requestPointerLock(): void;
}
