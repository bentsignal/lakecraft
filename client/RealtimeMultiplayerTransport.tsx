import { useEffect, useRef } from "preact/hooks";
import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";
import type { RealtimeChatEvent } from "./realtimeChat.ts";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import type { HydratedPlayerSkin } from "./game/playerSkin.ts";
import type { ItemStack } from "../shared/game.ts";
import type { InventoryActionMutationResult } from "../shared/inventoryActions.ts";
import type { PersistedInventoryState } from "../shared/chestTransfers.ts";
import type { NormalizedDroppedItem } from "../shared/droppedItems.ts";
import type { WorldTerrainDescriptor } from "../shared/worldPreset.ts";
import {
  RealtimeMultiplayerClient,
  type RealtimeConnectionPhase,
  type RealtimeGameMode,
  type RealtimeWorldEdit,
  type RealtimePlayerHit,
  type RealtimeWorldSettings,
} from "./realtimeMultiplayer.ts";

export type RealtimeBlockSink = (operationId: string, edit: WorldEdit) => Promise<RealtimeWorldEdit>;
export type RealtimeChatSink = (message: string) => Promise<void>;
export type RealtimeDropSink = (
  operationId: string,
  item: ItemStack,
  pose: PlayerPose,
) => Promise<NormalizedDroppedItem>;
export type RealtimePickupSink = (operationId: string, dropId: string) => Promise<NormalizedDroppedItem>;
export type RealtimeRespawnSink = () => Promise<PlayerPose>;
export type RealtimePlayerAttackSink = (operationId: string, targetId: string) => void;
export type RealtimeSelfDamageSink = (operationId: string, damage: number) => void;
export type RealtimeInventorySink = (requestJson: string) => Promise<InventoryActionMutationResult>;

export function RealtimeMultiplayerTransport(props: {
  endpoint: string;
  ticket?: string;
  password?: string;
  serverId: string;
  demo?: { token: string; userId: string; name: string };
  localUserId: string;
  localUsername: string;
  getPose: () => PlayerPose;
  getRenderDistance?: () => number;
  getInitialInventoryJson: () => string;
  getHeldItem?: () => string | null;
  getSkin?: () => Promise<HydratedPlayerSkin>;
  getArmor?: () => { armorHead: string; armorChest: string; armorLegs: string; armorFeet: string };
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onWorldChunk?: (chunkX: number, chunkZ: number, edits: RealtimeWorldEdit[]) => void;
  onWorldChunksUnload?: (chunks: Array<{ x: number; z: number }>) => void;
  onChatEvent: (event: RealtimeChatEvent) => void;
  onGameMode: (gameMode: RealtimeGameMode) => void;
  onTerrain: (terrain: WorldTerrainDescriptor) => void;
  onWorldSettings: (settings: RealtimeWorldSettings) => void;
  onReconcilePose: (pose: PlayerPose) => void;
  onDrops: (drops: NormalizedDroppedItem[]) => void;
  onPlayerHit: (hit: RealtimePlayerHit) => void;
  onSelfHealth: (health: number) => void;
  onInventoryState: (inventory: PersistedInventoryState) => void;
  registerBlockSink: (sink: RealtimeBlockSink | null) => void;
  registerChatSink: (sink: RealtimeChatSink | null) => void;
  registerActionSink: (sink: ((kind: MotionVisualActionKind, value?: number) => void) | null) => void;
  registerDropSink: (sink: RealtimeDropSink | null) => void;
  registerPickupSink: (sink: RealtimePickupSink | null) => void;
  registerRespawnSink: (sink: RealtimeRespawnSink | null) => void;
  registerPlayerAttackSink: (sink: RealtimePlayerAttackSink | null) => void;
  registerSelfDamageSink: (sink: RealtimeSelfDamageSink | null) => void;
  registerInventorySink: (sink: RealtimeInventorySink | null) => void;
}) {
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const client = new RealtimeMultiplayerClient({
      endpoint: props.endpoint,
      ticket: props.ticket,
      password: props.password,
      serverId: props.serverId,
      demo: props.demo,
      localUserId: props.localUserId,
      localUsername: props.localUsername,
      getPose: () => propsRef.current.getPose(),
      getRenderDistance: () => propsRef.current.getRenderDistance?.() ?? 3,
      getInitialInventoryJson: () => propsRef.current.getInitialInventoryJson(),
      getHeldItem: () => propsRef.current.getHeldItem?.() ?? null,
      getSkin: () => propsRef.current.getSkin?.() ?? Promise.reject(new Error("skin_unavailable")),
      getArmor: () => propsRef.current.getArmor?.() ?? {
        armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
      },
      onPhase: (phase, detail) => propsRef.current.onPhase(phase, detail),
      onRemotePlayers: (players) => propsRef.current.onRemotePlayers(players),
      onWorldEdits: (edits, replace) => propsRef.current.onWorldEdits(edits, replace),
      onWorldChunk: (x, z, edits) => propsRef.current.onWorldChunk?.(x, z, edits),
      onWorldChunksUnload: (chunks) => propsRef.current.onWorldChunksUnload?.(chunks),
      onChatEvent: (event) => propsRef.current.onChatEvent(event),
      onGameMode: (gameMode) => propsRef.current.onGameMode(gameMode),
      onTerrain: (terrain) => propsRef.current.onTerrain(terrain),
      onWorldSettings: (settings) => propsRef.current.onWorldSettings(settings),
      onReconcilePose: (pose) => propsRef.current.onReconcilePose(pose),
      onDrops: (drops) => propsRef.current.onDrops(drops),
      onPlayerHit: (hit) => propsRef.current.onPlayerHit(hit),
      onSelfHealth: (health) => propsRef.current.onSelfHealth(health),
      onInventoryState: (inventory) => propsRef.current.onInventoryState(inventory),
    });
    props.registerBlockSink((operationId, edit) => client.submitBlockEdit(operationId, edit));
    props.registerChatSink((message) => client.submitChat(message));
    props.registerActionSink((kind, value) => client.submitAction(kind, value));
    props.registerDropSink((operationId, item, pose) => client.submitDrop(operationId, item, pose));
    props.registerPickupSink((operationId, dropId) => client.submitPickup(operationId, dropId));
    props.registerRespawnSink(() => client.submitRespawn());
    props.registerPlayerAttackSink((operationId, targetId) => client.submitPlayerAttack(operationId, targetId));
    props.registerSelfDamageSink((operationId, damage) => client.submitSelfDamage(operationId, damage));
    props.registerInventorySink((requestJson) => client.submitInventoryAction(requestJson));
    client.start();
    return () => {
      props.registerBlockSink(null);
      props.registerChatSink(null);
      props.registerActionSink(null);
      props.registerDropSink(null);
      props.registerPickupSink(null);
      props.registerRespawnSink(null);
      props.registerPlayerAttackSink(null);
      props.registerSelfDamageSink(null);
      props.registerInventorySink(null);
      client.stop();
    };
  }, [props.endpoint, props.ticket, props.password, props.serverId, props.demo?.token, props.localUserId, props.localUsername]);

  return null;
}
