import { useEffect, useRef } from "preact/hooks";
import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";
import type { RealtimeChatEvent } from "./realtimeChat.ts";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import {
  RealtimeMultiplayerClient,
  type RealtimeConnectionPhase,
  type RealtimeGameMode,
  type RealtimeWorldEdit,
} from "./realtimeMultiplayer.ts";

export type RealtimeBlockSink = (operationId: string, edit: WorldEdit) => Promise<RealtimeWorldEdit>;
export type RealtimeChatSink = (message: string) => Promise<void>;

export function RealtimeMultiplayerTransport(props: {
  endpoint: string;
  ticket?: string;
  serverId: string;
  demo?: { token: string; userId: string; name: string };
  localUserId: string;
  localUsername: string;
  getPose: () => PlayerPose;
  getHeldItem?: () => string | null;
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onChatEvent: (event: RealtimeChatEvent) => void;
  onGameMode: (gameMode: RealtimeGameMode) => void;
  onReconcilePose: (pose: PlayerPose) => void;
  registerBlockSink: (sink: RealtimeBlockSink | null) => void;
  registerChatSink: (sink: RealtimeChatSink | null) => void;
  registerActionSink: (sink: ((kind: MotionVisualActionKind, value?: number) => void) | null) => void;
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
      onPhase: (phase, detail) => propsRef.current.onPhase(phase, detail),
      onRemotePlayers: (players) => propsRef.current.onRemotePlayers(players),
      onWorldEdits: (edits, replace) => propsRef.current.onWorldEdits(edits, replace),
      onChatEvent: (event) => propsRef.current.onChatEvent(event),
      onGameMode: (gameMode) => propsRef.current.onGameMode(gameMode),
      onReconcilePose: (pose) => propsRef.current.onReconcilePose(pose),
    });
    props.registerBlockSink((operationId, edit) => client.submitBlockEdit(operationId, edit));
    props.registerChatSink((message) => client.submitChat(message));
    props.registerActionSink((kind, value) => client.submitAction(kind, value));
    client.start();
    return () => {
      props.registerBlockSink(null);
      props.registerChatSink(null);
      props.registerActionSink(null);
      client.stop();
    };
  }, [props.endpoint, props.ticket, props.serverId, props.demo?.token, props.localUserId, props.localUsername]);

  return null;
}
