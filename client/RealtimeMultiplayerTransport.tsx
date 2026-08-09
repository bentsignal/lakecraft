import { useEffect, useRef } from "preact/hooks";
import type { PlayerPose, RemotePlayer, WorldEdit } from "./game/types.ts";
import {
  RealtimeMultiplayerClient,
  type RealtimeConnectionPhase,
  type RealtimeWorldEdit,
} from "./realtimeMultiplayer.ts";

export type RealtimeBlockSink = (operationId: string, edit: WorldEdit) => Promise<RealtimeWorldEdit>;

export function RealtimeMultiplayerTransport(props: {
  endpoint: string;
  ticket?: string;
  serverId: string;
  demo?: { token: string; userId: string; name: string };
  getPose: () => PlayerPose;
  onPhase: (phase: RealtimeConnectionPhase, detail?: string) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onWorldEdits: (edits: RealtimeWorldEdit[], replace: boolean) => void;
  onReconcilePose: (pose: PlayerPose) => void;
  registerBlockSink: (sink: RealtimeBlockSink | null) => void;
}) {
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const client = new RealtimeMultiplayerClient({
      endpoint: props.endpoint,
      ticket: props.ticket,
      serverId: props.serverId,
      demo: props.demo,
      getPose: () => propsRef.current.getPose(),
      onPhase: (phase, detail) => propsRef.current.onPhase(phase, detail),
      onRemotePlayers: (players) => propsRef.current.onRemotePlayers(players),
      onWorldEdits: (edits, replace) => propsRef.current.onWorldEdits(edits, replace),
      onReconcilePose: (pose) => propsRef.current.onReconcilePose(pose),
    });
    props.registerBlockSink((operationId, edit) => client.submitBlockEdit(operationId, edit));
    client.start();
    return () => {
      props.registerBlockSink(null);
      client.stop();
    };
  }, [props.endpoint, props.ticket, props.serverId, props.demo?.token]);

  return null;
}
