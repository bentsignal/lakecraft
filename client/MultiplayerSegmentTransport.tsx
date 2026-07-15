import { useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PlayerPose, RemotePlayer } from "./game/types.ts";
import {
  SEGMENT_DISCOVERY_INTERVAL_MULTIPLIER,
  SEGMENT_REPLAY_TICK_MS,
  MotionSegmentRecorder,
  SegmentReplayCollection,
  createCompositeRequest,
  decideAndReserveSegmentTraffic,
  loadSegmentBudget,
  pauseSegmentTrafficForQuota,
  persistSegmentBudget,
  segmentQuotaPlan,
  segmentQuotaResetAt,
  type MultiplayerCompositeResult,
  type MobWorldCompositeSnapshot,
  type PublishMotionSegmentsResult,
  type SegmentTelemetry,
} from "./multiplayerSegmentClient.ts";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance.ts";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";

export interface MultiplayerSegmentTransportProps {
  userId: string;
  sessionId: string;
  paused: boolean;
  getPose: () => PlayerPose;
  mobIds: readonly string[];
  onConnected: (connected: boolean) => void;
  onMobWorldAuthority: (snapshot: MobWorldCompositeSnapshot) => void;
  onRemotePlayers: (players: RemotePlayer[]) => void;
  onTelemetry: (telemetry: SegmentTelemetry) => void;
  registerActionSink: (sink: ((kind: MotionVisualActionKind, value?: number) => void) | null) => void;
}

function replayVisualToRemotePlayer(player: ReturnType<SegmentReplayCollection["step"]>[number]): RemotePlayer {
  const appearance = normalizeAvatarAppearance(
    player.heldItem,
    player.armorHead,
    player.armorChest,
    player.armorLegs,
    player.armorFeet,
  );
  return {
    id: player.id,
    name: player.stale ? `${player.name} (stale)` : player.name,
    color: player.color,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    heldItem: appearance.heldItem || null,
    armorHead: appearance.armorHead || null,
    armorChest: appearance.armorChest || null,
    armorLegs: appearance.armorLegs || null,
    armorFeet: appearance.armorFeet || null,
    visualActions: player.actions,
  };
}

function MultiplayerCompositeQuery({
  request,
  onResult,
}: {
  request: string;
  onResult: (result: MultiplayerCompositeResult | undefined) => void;
}) {
  const result = useQuery<MultiplayerCompositeResult, string>("multiplayerComposite", request);
  useEffect(() => onResult(result), [result]);
  return null;
}

/**
 * Renderless Lakebed-only transport. The parent mounts it only inside an active
 * multiplayer world; unmounting on pause guarantees its timers cannot spend
 * quota while menus are open. `useQuery` is intentionally consolidated to one
 * proximity snapshot whose argument changes only at the granted cadence.
 */
export function MultiplayerSegmentTransport({
  userId,
  sessionId,
  paused,
  getPose,
  mobIds,
  onConnected,
  onMobWorldAuthority,
  onRemotePlayers,
  onTelemetry,
  registerActionSink,
}: MultiplayerSegmentTransportProps) {
  const publishMotionSegments = useMutation<[requestJson: string], PublishMotionSegmentsResult>("publishMotionSegments");
  const [compositeRequest, setCompositeRequest] = useState(() => createCompositeRequest([], Date.now(), mobIds));
  const [composite, setComposite] = useState<MultiplayerCompositeResult | undefined>(undefined);
  const [queryEnabled, setQueryEnabled] = useState(false);
  const recorderRef = useRef<MotionSegmentRecorder | null>(null);
  const replayRef = useRef<SegmentReplayCollection | null>(null);
  const budgetRef = useRef(loadSegmentBudget(userId, Date.now()));
  const nearbyPlayersRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const queryInFlightRef = useRef(false);
  const lastPublishAttemptRef = useRef(0);
  const lastCompositeAdvanceRef = useRef(Date.now());
  const telemetryModeRef = useRef<SegmentTelemetry["mode"]>("discovery");

  if (!recorderRef.current || recorderRef.current.sessionId !== sessionId) {
    recorderRef.current = new MotionSegmentRecorder(sessionId);
  }
  if (!replayRef.current) replayRef.current = new SegmentReplayCollection();

  const emitTelemetry = (now: number, mode = telemetryModeRef.current) => {
    telemetryModeRef.current = mode;
    const plan = segmentQuotaPlan(nearbyPlayersRef.current);
    const visuals = replayRef.current!.step(now);
    onTelemetry({
      mode,
      publishIntervalMs: plan.mutationIntervalMs,
      compositeIntervalMs: plan.snapshotIntervalMs,
      mutationAttempts: budgetRef.current.mutationAttempts,
      mutationGrant: plan.mutationsPerPlayerPerSession,
      requestAttempts: budgetRef.current.requestAttempts,
      requestGrant: plan.requestsPerPlayerPerSession,
      nearbyPlayers: nearbyPlayersRef.current,
      stalePlayers: visuals.filter((player) => player.stale).length,
      stalestRemoteMs: visuals.reduce((maximum, player) => Math.max(maximum, player.ageMs), 0),
      quotaPausedUntil: budgetRef.current.quotaPausedUntil,
    });
    return { plan, visuals };
  };

  useEffect(() => {
    if (!composite) return;
    queryInFlightRef.current = false;
    setQueryEnabled(false);
    const now = Date.now();
    if (!composite.ok) {
      telemetryModeRef.current = composite.reason === "quota_exhausted" ? "quota_paused" : "discovery";
      if (composite.reason === "quota_exhausted") {
        pauseSegmentTrafficForQuota(budgetRef.current, segmentQuotaResetAt(composite.reason, now), now);
        persistSegmentBudget(userId, budgetRef.current);
      }
      onConnected(false);
      emitTelemetry(now);
      return;
    }
    nearbyPlayersRef.current = composite.nearbyPlayers.filter((player) => player.userId !== userId && player.online).length;
    replayRef.current!.ingest(composite, now, userId);
    onMobWorldAuthority(composite.mobWorld);
    onConnected(true);
    const { visuals } = emitTelemetry(now, nearbyPlayersRef.current > 0 ? "active" : "discovery");
    onRemotePlayers(visuals.map(replayVisualToRemotePlayer));
  }, [composite, userId]);

  useEffect(() => {
    let cancelled = false;
    const recorder = recorderRef.current!;
    const replay = replayRef.current!;
    registerActionSink((kind, value) => {
      recorder.action(kind, getPose(), Date.now(), value);
    });

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const visible = document.visibilityState === "visible";
      const focused = document.hasFocus();
      const plan = segmentQuotaPlan(nearbyPlayersRef.current);
      recorder.configurePublishInterval(plan.mutationIntervalMs);
      recorder.sample(getPose(), now);
      if (paused || !visible || !focused || budgetRef.current.quotaPausedUntil > now) {
        setQueryEnabled(false);
        queryInFlightRef.current = false;
      }

      const replayPlayers = replay.step(now);
      onRemotePlayers(replayPlayers.map(replayVisualToRemotePlayer));

      const compositeInterval = nearbyPlayersRef.current > 0
        ? plan.snapshotIntervalMs
        : plan.snapshotIntervalMs * SEGMENT_DISCOVERY_INTERVAL_MULTIPLIER;
      if (!queryInFlightRef.current && now - lastCompositeAdvanceRef.current >= compositeInterval) {
        const decision = decideAndReserveSegmentTraffic({
          budget: budgetRef.current,
          kind: "request",
          now,
          multiplayer: true,
          authenticated: true,
          visible,
          focused,
          paused,
          nearbyPlayers: nearbyPlayersRef.current,
          grant: plan.requestsPerPlayerPerSession,
        });
        telemetryModeRef.current = decision.allow ? decision.mode : decision.reason;
        if (decision.allow) {
          lastCompositeAdvanceRef.current = now;
          persistSegmentBudget(userId, budgetRef.current);
          setCompositeRequest(createCompositeRequest(replay.known(), now, mobIds));
          queryInFlightRef.current = true;
          setQueryEnabled(true);
        } else {
          setQueryEnabled(false);
        }
      }

      if (!mutationInFlightRef.current && now - lastPublishAttemptRef.current >= plan.mutationIntervalMs) {
        const decision = decideAndReserveSegmentTraffic({
          budget: budgetRef.current,
          kind: "mutation",
          now,
          multiplayer: true,
          authenticated: true,
          visible,
          focused,
          paused,
          nearbyPlayers: nearbyPlayersRef.current,
          grant: plan.mutationsPerPlayerPerSession,
        });
        telemetryModeRef.current = decision.allow ? decision.mode : decision.reason;
        if (decision.allow) {
          lastPublishAttemptRef.current = now;
          persistSegmentBudget(userId, budgetRef.current);
          const batch = recorder.prepare(now, getPose());
          if (batch) {
            mutationInFlightRef.current = true;
            void publishMotionSegments(JSON.stringify(batch)).then((result) => {
              if (cancelled) return;
              if (result.ok) {
                recorder.accept(result.acceptedThrough);
                onConnected(true);
              } else {
                if (result.reason === "stale_sequence"
                  && Number.isSafeInteger(result.acceptedThrough)
                  && result.acceptedThrough! >= batch.lastSequence) {
                  recorder.accept(result.acceptedThrough!);
                  onConnected(true);
                  return;
                }
                onConnected(false);
                if (result.reason === "quota_exhausted" || (result.retryAfterMs ?? 0) > 0) {
                  pauseSegmentTrafficForQuota(
                    budgetRef.current,
                    result.retryAfterMs ? Date.now() + result.retryAfterMs : segmentQuotaResetAt(result.reason, Date.now()),
                    Date.now(),
                  );
                }
              }
            }).catch((error: unknown) => {
              if (cancelled) return;
              onConnected(false);
              const text = error instanceof Error ? error.message : String(error ?? "");
              if (/\b429\b|quota|rate.?limit/i.test(text)) {
                pauseSegmentTrafficForQuota(budgetRef.current, segmentQuotaResetAt(error, Date.now()), Date.now());
              }
              // Pending batch is deliberately retained; the next granted attempt
              // sends byte-for-byte the same idempotent operation.
            }).finally(() => {
              mutationInFlightRef.current = false;
              persistSegmentBudget(userId, budgetRef.current);
            });
          }
        }
      }
      emitTelemetry(now);
    };
    const timer = window.setInterval(tick, SEGMENT_REPLAY_TICK_MS);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      registerActionSink(null);
      onRemotePlayers([]);
    };
  }, [sessionId, userId, paused, mobIds]);

  return queryEnabled
    ? <MultiplayerCompositeQuery request={compositeRequest} onResult={setComposite} />
    : null;
}
