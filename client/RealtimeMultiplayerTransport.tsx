import { useEffect, useRef } from "preact/hooks";
import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";
import type { RealtimeChatEvent } from "./realtimeChat.ts";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import type { HydratedPlayerSkin } from "./game/playerSkin.ts";
import type { ItemStack } from "../shared/game.ts";
import type { NormalizedDroppedItem } from "../shared/droppedItems.ts";
import {
  RealtimeMultiplayerClient,
  type RealtimeConnectionPhase,
  type RealtimeGameMode,
  type RealtimeWorldEdit,
  type RealtimePlayerHit,
} from "./realtimeMultiplayer.ts";

export type RealtimeBlockSink = (operationId: string, edit: WorldEdit) => Promise<RealtimeWorldEdit>;
export type RealtimeChatSink = (message: string) => Promise<void>;
export type RealtimeDropSink = (operationId: string, item: ItemStack, pose: PlayerPose) => Promise<NormalizedDroppedItem>;
export type RealtimePickupSink = (operationId: string, dropId: string) => Promise<NormalizedDroppedItem>;
export type RealtimeRespawnSink = () => Promise<PlayerPose>;
export type RealtimePlayerAttackSink = (operationId: string, targetId: string) => void;

export function RealtimeMultiplayerTransport(props: {
  endpoint: string;
  ticket?: string;
  serverId: string;
  demo?: { token: string; userId: string; name: string };
  localUserId: string;
  localUsername: string;
  getPose: () => PlayerPose;
  getHeldItem?: () => string | null;
  getSkin?: () => Promise<HydratedPlayerSkin>;
  getArmor?: () => { armorHead: string; armorChest: string; armorLegs: string; armorFeet: string };
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onChatEvent: (event: RealtimeChatEvent) => void;
  onGameMode: (gameMode: RealtimeGameMode) => void;
  onReconcilePose: (pose: PlayerPose) => void;
  onDrops: (drops: NormalizedDroppedItem[]) => void;
  onPlayerHit: (hit: RealtimePlayerHit) => void;
  onSelfHealth: (health: number) => void;
  registerBlockSink: (sink: RealtimeBlockSink | null) => void;
  registerChatSink: (sink: RealtimeChatSink | null) => void;
  registerActionSink: (sink: ((kind: MotionVisualActionKind, value?: number) => void) | null) => void;
  registerDropSink: (sink: RealtimeDropSink | null) => void;
  registerPickupSink: (sink: RealtimePickupSink | null) => void;
  registerRespawnSink: (sink: RealtimeRespawnSink | null) => void;
  registerPlayerAttackSink: (sink: RealtimePlayerAttackSink | null) => void;
}) {
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const client = new RealtimeMultiplayerClient({
      endpoint: props.endpoint,
      ticket: props.ticket,
      serverId: props.serverId,
      demo: props.demo,
      localUserId: props.localUserId,
      localUsername: props.localUsername,
      getPose: () => propsRef.current.getPose(),
      getHeldItem: () => propsRef.current.getHeldItem?.() ?? null,
      getSkin: () => propsRef.current.getSkin?.() ?? Promise.reject(new Error("skin_unavailable")),
      getArmor: () => propsRef.current.getArmor?.() ?? {
        armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
      },
      onPhase: (phase, detail) => propsRef.current.onPhase(phase, detail),
      onRemotePlayers: (players) => propsRef.current.onRemotePlayers(players),
      onWorldEdits: (edits, replace) => propsRef.current.onWorldEdits(edits, replace),
      onChatEvent: (event) => propsRef.current.onChatEvent(event),
      onGameMode: (gameMode) => propsRef.current.onGameMode(gameMode),
      onReconcilePose: (pose) => propsRef.current.onReconcilePose(pose),
      onDrops: (drops) => propsRef.current.onDrops(drops),
      onPlayerHit: (hit) => propsRef.current.onPlayerHit(hit),
      onSelfHealth: (health) => propsRef.current.onSelfHealth(health),
    });
    props.registerBlockSink((operationId, edit) => client.submitBlockEdit(operationId, edit));
    props.registerChatSink((message) => client.submitChat(message));
    props.registerActionSink((kind, value) => client.submitAction(kind, value));
    props.registerDropSink((operationId, item, pose) => client.submitDrop(operationId, item, pose));
    props.registerPickupSink((operationId, dropId) => client.submitPickup(operationId, dropId));
    props.registerRespawnSink(() => client.submitRespawn());
    props.registerPlayerAttackSink((operationId, targetId) => client.submitPlayerAttack(operationId, targetId));
    client.start();
    return () => {
      props.registerBlockSink(null);
      props.registerChatSink(null);
      props.registerActionSink(null);
      props.registerDropSink(null);
      props.registerPickupSink(null);
      props.registerRespawnSink(null);
      props.registerPlayerAttackSink(null);
      client.stop();
    };
  }, [props.endpoint, props.ticket, props.serverId, props.demo?.token, props.localUserId, props.localUsername]);

  return null;
}
