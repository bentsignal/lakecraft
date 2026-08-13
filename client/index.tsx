import { ErrorBoundary, signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChatOverlay, type LakecraftChatMessage } from "./chat";
import { GameHud, type HudMessage } from "./components";
import { isCraftingTableWithinReach as isWorkstationWithinReach, type CraftingTablePosition as WorkstationPosition } from "./crafting";
import {
  BLOCK,
  type BlockId as EngineBlockId,
  type PlayerPose,
  type RemotePlayer,
  type VoxelPerformanceStats,
  type VoxelEngine,
  type WorldEdit as EngineWorldEdit,
} from "./game";
import { createGameplaySessionEngine, createRailwayGameplayAuthority } from "./gameplay/index.ts";
import { LobbyScreen, type LobbyJoinPhase, type LobbyServerEntry, type UsernameClaimState } from "./lobby";
import { SinglePlayerApp } from "./singleplayer";
import { shouldRunSinglePlayer, singlePlayerTitleUrl } from "./runtimeMode.ts";
import { releaseGameplayKeyboardCapture, requestGameplayKeyboardCapture } from "./gameplayKeyboardCapture.ts";
import { requestDocumentPointerLockHandoff } from "./pointerLockHandoff.ts";
import { handleGameplayScreenshotKey } from "./gameplayDiagnostics.tsx";
import {
  audioSurfaceForBlock,
  createGameplayPointerSessionState,
  createGameplayPresentationOptions,
  ENGINE_TO_GAME,
  GameplaySessionSurface,
  ITEM_TO_ENGINE,
  scheduleGameplayPointerLockAfterEscapeRelease,
  transitionGameplayPointerSession,
  type GameplayPointerSessionEvent,
} from "./gameplay/index.ts";
import { hydrateSelectedPlayerSkin, type HydratedPlayerSkin } from "./game/playerSkin.ts";
import {
  RealtimeMultiplayerTransport,
  type RealtimeBlockSink,
  type RealtimeChatSink,
  type RealtimeDropSink,
  type RealtimePickupSink,
  type RealtimePlayerAttackSink,
  type RealtimeRespawnSink,
  type RealtimeSelfDamageSink,
  type RealtimeInventorySink,
} from "./RealtimeMultiplayerTransport.tsx";
import {
  applyRealtimeChatEvent,
  type RealtimeChatMessage,
} from "./realtimeChat.ts";
import {
  loadMultiplayerInvitationTokens,
  loadSavedMultiplayerServers,
  multiplayerStatusUrl,
  normalizeMultiplayerEndpoint,
  saveMultiplayerInvitationToken,
  saveMultiplayerServers,
  type RealtimeConnectionPhase,
  type RealtimeGameMode,
  type RealtimeWorldEdit,
  type SavedMultiplayerServer,
} from "./realtimeMultiplayer.ts";
import {
  multiplayerGameplayPaused,
  updateAuthoritativeKnockbackGate,
  type AuthoritativeKnockbackGate,
} from "./multiplayerGameplay.ts";
import {
  loadClientSettings,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettings,
} from "./settings.ts";
import {
  ITEMS,
  BLOCKS,
  MAX_HEALTH,
  MAX_HUNGER,
  addItemStack,
  clampHotbarIndex,
  createEmptyEquipment,
  createSerializablePlayerState,
  createStarterInventory,
  consumeFood,
  getDeterministicMiningDrop,
  type BlockId,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
  type ItemStack,
  type PlayerRespawnPoint,
  type Recipe,
} from "../shared/game";
import type { StowedInventorySnapshot } from "../shared/inventoryWorkspace";
import {
  type InventoryActionMutationResult,
  type InventoryRecipeBatch,
} from "../shared/inventoryActions.ts";
import {
  type PersistedInventoryState,
  validatePlayerStateJson,
} from "../shared/chestTransfers";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ClaimUsernameResult,
  type Profile,
} from "../shared/multiplayer";
import {
  blockCoordinateKey,
  type PersistedInventory,
} from "../shared/protocol";
import {
  classifyPresenceTransportError,
  presenceTransportQuotaResetAt,
} from "../shared/presenceMotion";
import type { MotionVisualActionKind } from "../shared/multiplayerSegments.ts";
import {
  DROPPED_ITEM_PICKUP_RADIUS,
  droppedItemForwardPosition,
  type NormalizedDroppedItem,
} from "../shared/droppedItems";
import { planDeathDrops } from "../shared/deathDrops.ts";
import {
  createWorldBlockOperationId,
  isDecimalRevisionAtLeast,
} from "./worldBlockEditClient";
import {
  createGameAudio,
  type GameAudio,
} from "./game/audio.ts";

const APP_CSS = `
@font-face { font-display: swap; font-family: "Pixelify Sans"; font-style: normal; font-weight: 400 700; src: url("https://fonts.gstatic.com/s/pixelifysans/v3/CHylV-3HFUT7aC4iv1TxGDR9Jn0Eiw.woff2") format("woff2"); }
:root { --lc-pixel-font: "Pixelify Sans", "Courier New", monospace; }
html, body, #app { height: 100vh; height: 100dvh; margin: 0; overflow: hidden; width: 100%; }
body { background: #171b15; }
button { -webkit-tap-highlight-color: transparent; }
.lakecraft-shell { background: #171b15; height: 100vh; height: 100dvh; inset: 0; isolation: isolate; overflow: hidden; position: fixed; width: 100vw; }
.lakecraft-world { cursor: none; display: block; height: 100%; outline: none; width: 100%; }
.lakecraft-error { background: #171a16; color: #e6dcc1; display: grid; inset: 0; padding: 40px; place-content: center; position: absolute; z-index: 120; }
.lakecraft-error strong { color: #d49a45; font: 700 16px "Courier New", monospace; }.lakecraft-error p { max-width: 560px; }
`;

const QUERY_RECOVERY_CSS = `
.lakecraft-query-recovery{background:linear-gradient(#78a7d2 0 45%,#5f8738 45% 100%);box-sizing:border-box;color:#fff;display:grid;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;min-height:100dvh;padding:24px;place-items:center;position:fixed;text-align:center;text-shadow:2px 2px #202020}
.lakecraft-query-recovery section{background:rgba(0,0,0,.72);border:2px solid #111;box-shadow:inset 0 0 0 2px #555;padding:24px;width:min(560px,100%)}
.lakecraft-query-recovery h1{font-size:clamp(18px,4vw,30px);font-weight:400;margin:0 0 16px}.lakecraft-query-recovery p{line-height:1.5;margin:0 0 20px}
.lakecraft-query-recovery button{background:#777;border:2px solid;border-color:#aaa #333 #333 #aaa;color:#fff;cursor:pointer;font:16px var(--lc-pixel-font,"Courier New",monospace);padding:10px 20px;text-shadow:2px 2px #333}.lakecraft-query-recovery button:active{border-color:#333 #aaa #aaa #333}
`;

type ExternalMultiplayerServer = {
  id: string;
  name: string;
  description: string;
  canonicalWssUrl: string;
  status?: "online" | "busy" | "maintenance" | "offline";
  capacity?: number;
};

type ClientBootstrap = readonly [
  unknown,
  PersistedInventory | null,
  Profile | null,
  ExternalMultiplayerServer[],
];

type ExternalJoinTicketResult =
  | { ok: true; ticket: string; serverId: string; canonicalWssUrl: string; expiresAt: number }
  | { ok: false; reason: string };

type RealtimeSession = {
  ticket?: string;
  serverId: string;
  endpoint: string;
  demo?: { token: string; userId: string; name: string };
};


function droppedItemOperationId(): string {
  return `lc_${crypto.randomUUID()}`;
}

type PendingInventoryAction = {
  operationId: string;
  requestJson: string;
  transportFailures: number;
  authorityConflicts: number;
  session: number;
  action:
    | { kind: "initialize" }
    | { kind: "select_hotbar"; selectedHotbar: number }
    | { kind: "eat"; sourceSlot: number; expectedItemId: ItemId }
    | { kind: "place_block"; sourceSlot: number; expectedItemId: ItemId }
    | { kind: "world_debit"; sourceSlot: number; stack: ItemStack }
    | { kind: "world_credit"; stack: ItemStack }
    | { kind: "death_settle"; eventId: string }
    | {
        kind: "workspace_commit";
        playerStateJson: string;
        recipes: InventoryRecipeBatch[];
        craftingContext: CraftingContext;
        workstationCoordKey: string;
      };
};

type PendingWorldBlockEdit = {
  operationId: string;
  optimisticEdit: EngineWorldEdit;
  previousBlock: EngineBlockId;
  expectedHeldItem: ItemId | null;
  sourceSlot: number;
};

let worldBlockOperationSequence = 0;
function createInventoryActionOperationId(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `inv_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
}

function relatedInventoryOperationId(kind: string, operationId: string): string {
  return `${kind}_${operationId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}

const WORLD_RADIUS = 18;
const DEFAULT_PLAYER_POSE: Readonly<PlayerPose> = Object.freeze({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 });
function miningRequirementDetail(blockId: BlockId): string {
  const block = BLOCKS[blockId];
  const requirement = block.requiredDropTool;
  if (!requirement) return `${block.label} cannot be recovered with the held item.`;
  const tier = requirement.minimumTier === "wood" ? "wooden" : requirement.minimumTier;
  const article = tier === "iron" ? "an" : "a";
  return `${block.label} only drops when mined with ${article} ${tier} ${requirement.kind} or better.`;
}

function parsePlayerState(row: PersistedInventory | null) {
  if (!row) return null;
  const canonical = validatePlayerStateJson(row.inventoryJson);
  return canonical.ok ? canonical.state : null;
}

function LobbyBootstrapRecovery({ error, retry }: { error: Error; retry: () => void }) {
  const [remainingMs, setRemainingMs] = useState(0);
  const quota = classifyPresenceTransportError(error) === "quota";
  const [resetAt] = useState(() => quota ? presenceTransportQuotaResetAt(error, Date.now()) : null);

  useEffect(() => {
    if (resetAt === null) return;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      const remaining = Math.max(0, resetAt - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0) {
        retry();
        return;
      }
      timer = window.setTimeout(tick, Math.min(1_000, remaining));
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resetAt, retry]);

  return (
    <main className="lakecraft-query-recovery" role="status" aria-live="polite">
      <style>{QUERY_RECOVERY_CSS}</style>
      <section>
        <h1>{quota ? "ACCOUNT SERVICES PAUSED" : "ACCOUNT SERVICES UNAVAILABLE"}</h1>
        <p>{quota
          ? `The server directory will retry automatically in ${Math.max(1, Math.ceil(remainingMs / 1_000))}s. No refresh is needed.`
          : "Lakecraft could not load your account and server directory. A running Railway world is never disconnected by this lobby request."}</p>
        {!quota ? <button type="button" onClick={retry}>Retry now</button> : null}
      </section>
    </main>
  );
}

function LobbyBootstrapQuery({
  identity,
  onResult,
}: {
  identity: string;
  onResult: (identity: string, result: ClientBootstrap) => void;
}) {
  const result = useQuery<ClientBootstrap>("clientBootstrap");
  useEffect(() => {
    if (Array.isArray(result) && result.length === 4) onResult(identity, result);
  }, [identity, onResult, result]);
  return null;
}

function RailwayMultiplayerSession({
  inWorld,
  setInWorld,
  onJoinSingleplayer,
}: {
  inWorld: boolean;
  setInWorld: (inWorld: boolean) => void;
  onJoinSingleplayer: () => void;
}) {
  const auth = useAuth();
  const [clientSettings, setClientSettings] = useState(() => loadClientSettings(window.localStorage));
  const clientSettingsRef = useRef(clientSettings);
  clientSettingsRef.current = clientSettings;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [segmentRemotePlayers, setSegmentRemotePlayers] = useState<RemotePlayer[]>([]);
  const [bootstrapIdentity, setBootstrapIdentity] = useState("");
  const [savedInventory, setSavedInventory] = useState<PersistedInventory | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [externalMultiplayerServers, setExternalMultiplayerServers] = useState<ExternalMultiplayerServer[]>([]);

  const createExternalMultiplayerJoinTicket = useMutation<[serverId: string], ExternalJoinTicketResult>(
    "createExternalMultiplayerJoinTicket",
  );
  const applyInventoryActionMutation = useMutation<[requestJson: string], InventoryActionMutationResult>("applyInventoryAction");
  const claimUsername = useMutation<[requestedUsername: string], ClaimUsernameResult>("claimUsername");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const selectedSkinPromiseRef = useRef<Promise<HydratedPlayerSkin> | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const poseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const inventoryRef = useRef<Inventory>(createStarterInventory());
  const equipmentRef = useRef<Equipment>(createEmptyEquipment());
  const inventoryAuthorityEpochRef = useRef(0);
  const respawnPointRef = useRef<PlayerRespawnPoint | null>(null);
  const hungerRef = useRef(MAX_HUNGER);
  const selectedRef = useRef(2);
  const hydratedRef = useRef(false);
  const hydratedUserRef = useRef("");
  const inventoryTokenRef = useRef("");
  const inventoryRevisionRef = useRef("0");
  const inventoryAuthoritySessionRef = useRef(0);
  const lastCommittedPlayerJsonRef = useRef("");
  const inventoryActionQueueRef = useRef<PendingInventoryAction[]>([]);
  const inventoryActionPromiseRef = useRef<Promise<boolean> | null>(null);
  const realtimeInventorySinkRef = useRef<RealtimeInventorySink | null>(null);
  const realtimeInventoryAuthorityRef = useRef(false);
  const pendingWorldBlockEditRef = useRef<PendingWorldBlockEdit | null>(null);
  const authoritativeWorldEditRef = useRef(new Map<string, EngineWorldEdit>());
  const latestSavedInventoryRef = useRef<PersistedInventory | null | undefined>(undefined);
  const activeWorkstationRef = useRef<{ kind: "crafting_table" | "furnace"; position: WorkstationPosition } | null>(null);
  const toastCounter = useRef(0);
  const droppedItemBusyRef = useRef(false);
  const intentionalPointerUnlockRef = useRef(false);
  const pointerSessionRef = useRef(createGameplayPointerSessionState(false));
  const realtimeDropsRef = useRef<NormalizedDroppedItem[]>([]);
  const droppedPickupAttemptRef = useRef(new Map<string, number>());
  const appliedPickupDropsRef = useRef(new Set<string>());
  const lastDroppedPickupSweepRef = useRef(0);
  const respawnRequestInFlightRef = useRef(false);
  const realtimeDeathSettlementRef = useRef<{ eventId: string; task: Promise<boolean> } | null>(null);
  const motionActionSinkRef = useRef<((kind: MotionVisualActionKind, value?: number) => void) | null>(null);
  const realtimeRespawnSinkRef = useRef<RealtimeRespawnSink | null>(null);
  const realtimePlayerAttackSinkRef = useRef<RealtimePlayerAttackSink | null>(null);
  const realtimeSelfDamageSinkRef = useRef<RealtimeSelfDamageSink | null>(null);
  const entryPointerLockHandoffRef = useRef(false);
  const realtimeCrouchingRef = useRef(false);
  const previousSegmentPoseRef = useRef<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const authorityTrafficPausedRef = useRef(false);
  const authoritativeKnockbackGateRef = useRef<AuthoritativeKnockbackGate | null>(null);
  const chatEscapeRecaptureRef = useRef(0);

  const selectedSkin = () => selectedSkinPromiseRef.current ??=
    hydrateSelectedPlayerSkin(window.localStorage);

  const [inventory, setInventory] = useState<Inventory>(() => createStarterInventory());
  const [equipment, setEquipment] = useState<Equipment>(() => createEmptyEquipment());
  const [inventoryAuthorityEpoch, setInventoryAuthorityEpoch] = useState(0);
  const [respawnPoint, setRespawnPoint] = useState<PlayerRespawnPoint | null>(null);
  const [hunger, setHunger] = useState(MAX_HUNGER);
  const [selectedHotbar, setSelectedHotbar] = useState(2);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [craftingContext, setCraftingContext] = useState<CraftingContext>("field");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [mobileUnsupported, setMobileUnsupported] = useState(false);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [diagnosticPose, setDiagnosticPose] = useState<PlayerPose>({ ...DEFAULT_PLAYER_POSE });
  const [performanceStats, setPerformanceStats] = useState<VoxelPerformanceStats | null>(null);
  const [engineError, setEngineError] = useState("");
  const [worldReady, setWorldReady] = useState(false);
  const [pointerCaptureNeeded, setPointerCaptureNeeded] = useState(false);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [transportReady, setTransportReady] = useState(false);
  const [transportForeground, setTransportForeground] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const [joinPhase, setJoinPhase] = useState<LobbyJoinPhase>("idle");
  const [joinError, setJoinError] = useState("");
  const [savedMultiplayerServers, setSavedMultiplayerServers] = useState<SavedMultiplayerServer[]>(
    () => loadSavedMultiplayerServers(window.localStorage),
  );
  const [selectedServerId, setSelectedServerId] = useState("");
  const [directConnectValue, setDirectConnectValue] = useState("");
  const [directConnectToken, setDirectConnectToken] = useState("");
  const [demoServerTokens, setDemoServerTokens] = useState<Record<string, string>>(
    () => loadMultiplayerInvitationTokens(window.localStorage),
  );
  const [serverStatuses, setServerStatuses] = useState<Record<string, {
    status: "online" | "offline";
    onlinePlayers: number;
    capacity: number;
  }>>({});
  const [realtimeSession, setRealtimeSession] = useState<RealtimeSession | null>(null);
  const realtimeBlockSinkRef = useRef<RealtimeBlockSink | null>(null);
  const realtimeChatSinkRef = useRef<RealtimeChatSink | null>(null);
  const realtimeDropSinkRef = useRef<RealtimeDropSink | null>(null);
  const realtimePickupSinkRef = useRef<RealtimePickupSink | null>(null);
  const realtimeGameModeRef = useRef<RealtimeGameMode>("survival");
  const [realtimeChatMessages, setRealtimeChatMessages] = useState<RealtimeChatMessage[]>([]);
  const [realtimeGameMode, setRealtimeGameMode] = useState<RealtimeGameMode>("survival");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameClaimState>("idle");
  const [usernameError, setUsernameError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const [playerHealth, setPlayerHealth] = useState(20);
  const playerHealthRef = useRef(20);
  const [deathScreenOpen, setDeathScreenOpen] = useState(false);
  const [respawning, setRespawning] = useState(false);
  const lakebedIdentity = auth.isLoading ? "" : auth.userId ?? "guest";
  const bootstrapReady = lakebedIdentity !== "" && bootstrapIdentity === lakebedIdentity;
  const acceptBootstrap = (identity: string, result: ClientBootstrap) => {
    if (identity !== (auth.userId ?? "guest")) return;
    setSavedInventory(result[1]);
    setProfile(result[2]);
    setExternalMultiplayerServers(result[3]);
    setBootstrapIdentity(identity);
  };
  const multiplayerPaused = multiplayerGameplayPaused({
    foreground: transportForeground,
    mobileUnsupported,
    death: deathScreenOpen,
    pause: pauseOpen,
    inventory: inventoryOpen,
    chat: chatOpen,
    furnace: false,
    chest: false,
    bed: false,
  });
  const registeredServers = externalMultiplayerServers.flatMap((server) => {
    const endpoint = normalizeMultiplayerEndpoint(server.canonicalWssUrl);
    return endpoint ? [{ ...server, canonicalWssUrl: endpoint }] : [];
  });
  const combinedServers = [...registeredServers.map((server): SavedMultiplayerServer => ({
    id: server.id,
    name: server.name,
    endpoint: server.canonicalWssUrl,
  }))];
  for (const saved of savedMultiplayerServers) {
    if (combinedServers.some((server) => server.endpoint === saved.endpoint)) continue;
    combinedServers.push(saved);
  }
  const serverProbeKey = combinedServers.map((server) => `${server.id}\u0000${server.endpoint}`).join("\u0001");
  const lobbyServers: LobbyServerEntry[] = combinedServers.map((server) => {
    const registered = registeredServers.find((candidate) => candidate.id === server.id);
    const probe = serverStatuses[server.endpoint];
    return {
      id: server.id,
      name: registered?.name ?? server.name,
      description: registered?.description ?? "Direct Connect · community server",
      endpoint: server.endpoint,
      status: registered?.status === "maintenance" ? "maintenance" : probe?.status ?? "busy",
      onlinePlayers: probe?.onlinePlayers ?? 0,
      capacity: probe?.capacity ?? registered?.capacity ?? 20,
    };
  });
  const activeServerName = lobbyServers.find((server) => server.id === realtimeSession?.serverId)?.name
    ?? lobbyServers.find((server) => server.id === selectedServerId)?.name
    ?? "Community Server";

  useEffect(() => {
    setRealtimeChatMessages([]);
    setLastSeenChatCount(0);
    setChatError("");
    realtimeGameModeRef.current = "survival";
    setRealtimeGameMode("survival");
  }, [realtimeSession?.endpoint]);

  useEffect(() => {
    if (!serverProbeKey) return;
    const controller = new AbortController();
    for (const server of combinedServers.slice(0, 24)) {
      const statusUrl = multiplayerStatusUrl(server.endpoint);
      if (!statusUrl) continue;
      void fetch(statusUrl, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw 0;
        const body = await response.json() as Record<string, unknown>;
        if (body.ok !== true || body.status !== "online" || body.protocolVersion !== 1) {
          throw 0;
        }
        setServerStatuses((current) => ({
          ...current,
          [server.endpoint]: {
            status: "online",
            onlinePlayers: typeof body.players === "number" && Number.isFinite(body.players)
              ? Math.max(0, Math.floor(body.players)) : 0,
            capacity: typeof body.capacity === "number" && Number.isFinite(body.capacity)
              ? Math.max(1, Math.floor(body.capacity)) : 20,
          },
        }));
      }).catch(() => {
        if (controller.signal.aborted) return;
        setServerStatuses((current) => ({
          ...current,
          [server.endpoint]: { status: "offline", onlinePlayers: 0, capacity: current[server.endpoint]?.capacity ?? 20 },
        }));
      });
    }
    return () => controller.abort();
  }, [serverProbeKey]);

  useEffect(() => {
    if (selectedServerId && combinedServers.some((server) => server.id === selectedServerId)) return;
    setSelectedServerId(combinedServers[0]?.id ?? "");
  }, [serverProbeKey, selectedServerId]);
  if (!authoritativeKnockbackGateRef.current) {
    authoritativeKnockbackGateRef.current = { paused: multiplayerPaused, pauseEpoch: multiplayerPaused ? 1 : 0 };
  } else updateAuthoritativeKnockbackGate(authoritativeKnockbackGateRef.current, multiplayerPaused);
  authorityTrafficPausedRef.current = multiplayerPaused;

  useEffect(() => {
    const update = () => setTransportForeground(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  useEffect(() => {
    if (!inWorld || deathScreenOpen) setOptionsOpen(false);
  }, [inWorld, deathScreenOpen]);

  function updateClientSettings(value: ClientSettings): void {
    const next = normalizeClientSettings(value);
    const soundChanged = clientSettingsRef.current.soundMuted !== next.soundMuted;
    clientSettingsRef.current = next;
    setClientSettings(next);
    saveClientSettings(window.localStorage, next);
    if (soundChanged) audioRef.current?.setMuted(next.soundMuted);
  }

  useEffect(() => {
    const audio = createGameAudio({ muted: clientSettingsRef.current.soundMuted, maxVoices: 16 });
    audioRef.current = audio;
    const unlock = () => { void audio.unlock(); };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button:not(:disabled)")) {
        audio.play("uiClick", { seed: `${target.tagName}:${performance.now().toFixed(0)}`, intensity: 0.48 });
      }
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("click", click, true);
      audio.destroy();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  function notify(text: string, detail?: string, tone: HudMessage["tone"] = "info") {
    const id = `note-${++toastCounter.current}`;
    setMessages((current) => [...current.slice(-2), { id, text, detail, tone }]);
    window.setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), 3_500);
  }

  function settleRealtimeDeath(eventId: string): Promise<boolean> {
    const current = realtimeDeathSettlementRef.current;
    if (current?.eventId === eventId) return current.task;
    const task = (async () => {
      const sink = realtimeDropSinkRef.current;
      const localUserId = realtimeSession?.demo?.userId ?? auth.userId ?? "";
      if (!sink || !localUserId) return false;
      const deathPose = poseRef.current;
      const plan = planDeathDrops({
        identity: { userId: localUserId, eventId },
        inventory: inventoryRef.current,
        equipment: equipmentRef.current,
        deathPose: { x: deathPose.x, y: deathPose.y, z: deathPose.z },
      });
      if (!plan.ok) return false;
      droppedItemBusyRef.current = true;
      try {
        await Promise.all(plan.drops.map((drop) => sink(drop.operationId, drop.stack, {
          ...drop.position,
          yaw: deathPose.yaw,
          pitch: deathPose.pitch,
        })));
        updateInventory(plan.carriedState.inventory);
        updateEquipment(plan.carriedState.equipment);
        hungerRef.current = MAX_HUNGER;
        setHunger(MAX_HUNGER);
        advanceInventoryAuthorityEpoch();
        // The active Railway server owns both the durable pack and world
        // entities for multiplayer. The shared inventory transition still
        // provides the exact same conservation rules as local gameplay.
        void enqueueInventoryAction({ kind: "death_settle", eventId });
        return true;
      } catch {
        notify("Death drops delayed", "The server could not place the entire pack yet. Respawn will stay locked so no items are duplicated.", "warning");
        return false;
      } finally {
        droppedItemBusyRef.current = false;
      }
    })();
    realtimeDeathSettlementRef.current = { eventId, task };
    return task;
  }

  function requestRailwayRespawn(): void {
    if (respawnRequestInFlightRef.current) return;
    const engine = engineRef.current;
    const sink = realtimeRespawnSinkRef.current;
    if (!engine || !sink) return;
    const pointerLock = engine.requestPointerLock();
    respawnRequestInFlightRef.current = true;
    setRespawning(true);
    void (async () => {
      const settlement = realtimeDeathSettlementRef.current;
      if (settlement && !await settlement.task) throw new Error("death_settlement_incomplete");
      return sink();
    })().then((pose) => {
      if (engineRef.current !== engine) return;
      playerHealthRef.current = MAX_HEALTH;
      setPlayerHealth(MAX_HEALTH);
      realtimeCrouchingRef.current = false;
      previousSegmentPoseRef.current = pose;
      poseRef.current = pose;
      engine.respawnAt(pose);
      realtimeDeathSettlementRef.current = null;
      setDeathScreenOpen(false);
      void pointerLock.then((locked) => setPointerCaptureNeeded(!locked));
    }).catch(() => {
      void pointerLock.then((locked) => { if (locked) exitPointerLockForUi(); });
      notify("Respawn rejected", "The realtime server could not move this player safely.", "warning");
    }).finally(() => {
      respawnRequestInFlightRef.current = false;
      setRespawning(false);
    });
  }

  function exitPointerLockForUi(): void {
    pointerSessionRef.current = transitionGameplayPointerSession(pointerSessionRef.current, {
      type: "intentional_release",
    }).state;
    if (!document.pointerLockElement) return;
    intentionalPointerUnlockRef.current = true;
    document.exitPointerLock();
  }

  function openRealtimeDeath(): void {
    exitPointerLockForUi();
    setPauseOpen(false);
    setInventoryOpen(false);
    setChatOpen(false);
    setShowPlayerList(false);
    setPointerCaptureNeeded(false);
    setDeathScreenOpen(true);
  }

  function applyGameplayPointerEvent(event: GameplayPointerSessionEvent): void {
    const transition = transitionGameplayPointerSession(pointerSessionRef.current, event);
    pointerSessionRef.current = transition.state;
    if (transition.openPause) {
      setOptionsOpen(false);
      setPauseOpen(true);
      setShowPlayerList(false);
    }
    if (transition.closePause) setPauseOpen(false);
    if (event.type === "lock_change" && event.locked) setPointerCaptureNeeded(false);
    if (transition.showCaptureAffordance) setPointerCaptureNeeded(true);
    if (transition.requestPointerLock) {
      void engineRef.current?.requestPointerLock().then((locked) => {
        setPointerCaptureNeeded(!locked);
      });
    }
  }

  function closeChatFromEscape(): void {
    setChatOpen(false);
    setLastSeenChatCount(realtimeChatMessages.length);
    const generation = ++chatEscapeRecaptureRef.current;
    requestGameplayKeyboardCapture();
    applyGameplayPointerEvent({ type: "close_ui_escape", now: performance.now() });
    scheduleGameplayPointerLockAfterEscapeRelease(window, () => (
      generation === chatEscapeRecaptureRef.current
      && document.visibilityState === "visible"
      && engineRef.current !== null
    ), () => {
      requestGameplayKeyboardCapture();
      void engineRef.current?.requestPointerLock().then((locked) => setPointerCaptureNeeded(!locked));
    });
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
  }

  function updateEquipment(next: Equipment) {
    equipmentRef.current = next;
    setEquipment(next);
  }

  function advanceInventoryAuthorityEpoch() {
    inventoryAuthorityEpochRef.current += 1;
    setInventoryAuthorityEpoch(inventoryAuthorityEpochRef.current);
  }

  function closeInventory() {
    activeWorkstationRef.current = null;
    setCraftingContext("field");
    setInventoryOpen(false);
  }

  function currentPlayerStateJson(): string {
    const raw = JSON.stringify(createSerializablePlayerState(
      inventoryRef.current,
      selectedRef.current,
      equipmentRef.current,
      respawnPointRef.current,
      hungerRef.current,
    ));
    const canonical = validatePlayerStateJson(raw);
    return canonical.ok ? canonical.playerStateJson : raw;
  }

  function loadCanonicalPlayer(row: PersistedInventoryState | null): boolean {
    if (!row) {
      inventoryTokenRef.current = "";
      inventoryRevisionRef.current = "0";
      lastCommittedPlayerJsonRef.current = "";
      return true;
    }
    if (row.revision !== inventoryRevisionRef.current
      && isDecimalRevisionAtLeast(inventoryRevisionRef.current, row.revision)) return true;
    const canonical = validatePlayerStateJson(row.inventoryJson);
    if (!canonical.ok) return false;
    const saved = canonical.state;
    inventoryTokenRef.current = row.updatedAt;
    inventoryRevisionRef.current = row.revision;
    lastCommittedPlayerJsonRef.current = canonical.playerStateJson;
    updateInventory(saved.inventory);
    selectedRef.current = saved.selectedHotbar;
    setSelectedHotbar(saved.selectedHotbar);
    updateEquipment(saved.equipment);
    respawnPointRef.current = saved.respawnPoint;
    setRespawnPoint(saved.respawnPoint);
    if (saved.respawnPoint) engineRef.current?.setRespawnPoint(saved.respawnPoint);
    hungerRef.current = saved.hunger;
    setHunger(saved.hunger);
    advanceInventoryAuthorityEpoch();
    return true;
  }

  function enqueueInventoryAction(
    action: PendingInventoryAction["action"],
    operationId = createInventoryActionOperationId(),
  ): Promise<boolean> {
    const queued = inventoryActionQueueRef.current;
    const last = queued[queued.length - 1];
    if (action.kind === "select_hotbar" && last?.action.kind === "select_hotbar" && !last.requestJson) {
      last.action = action;
      return flushInventoryActions();
    }
    inventoryActionQueueRef.current.push({
      operationId,
      requestJson: "",
      transportFailures: 0,
      authorityConflicts: 0,
      session: inventoryAuthoritySessionRef.current,
      action,
    });
    return flushInventoryActions();
  }

  function flushInventoryActions(): Promise<boolean> {
    if (inventoryActionPromiseRef.current) return inventoryActionPromiseRef.current;
    if (inventoryActionQueueRef.current.length === 0) {
      return Promise.resolve(currentPlayerStateJson() === lastCommittedPlayerJsonRef.current);
    }
    const task = (async (): Promise<boolean> => {
      while (inventoryActionQueueRef.current.length > 0) {
        const pending = inventoryActionQueueRef.current[0];
        if (!pending.requestJson) {
          pending.requestJson = JSON.stringify({
            operationId: pending.operationId,
            expectedRevision: inventoryRevisionRef.current,
            ...pending.action,
          });
        }
        let result: InventoryActionMutationResult;
        try {
          const realtimeSink = realtimeSession ? realtimeInventorySinkRef.current : null;
          if (realtimeSession && !realtimeSink) throw new Error("realtime_inventory_not_ready");
          result = realtimeSink
            ? await realtimeSink(pending.requestJson)
            : await applyInventoryActionMutation(pending.requestJson);
          if (pending.session !== inventoryAuthoritySessionRef.current) return false;
          pending.transportFailures = 0;
        } catch {
          if (pending.session !== inventoryAuthoritySessionRef.current) return false;
          pending.transportFailures += 1;
          if (pending.transportFailures <= 3) {
            const retryDelay = 500 * 2 ** (pending.transportFailures - 1);
            notify("Pack action delayed", `${realtimeSession ? "The game server" : "Lakebed"} will reconcile the same action in ${retryDelay / 1_000}s.`, "warning");
            await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelay));
            continue;
          }
          notify("Pack action paused", `${realtimeSession ? "The game server" : "Lakebed"} could not confirm the action. It remains queued with the same operation ID.`, "warning");
          return false;
        }
        if (!result.ok) {
          const returnedInventory = "inventory" in result ? result.inventory : undefined;
          if (result.reason === "conflict" && returnedInventory && pending.authorityConflicts < 3) {
            pending.authorityConflicts += 1;
            pending.requestJson = "";
            if (!loadCanonicalPlayer(returnedInventory)) return false;
            continue;
          }
          inventoryActionQueueRef.current.length = 0;
          const fallbackInventory = latestSavedInventoryRef.current;
          const reconciled = returnedInventory
            ? loadCanonicalPlayer(returnedInventory)
            : fallbackInventory && fallbackInventory.userId === auth.userId
              ? loadCanonicalPlayer(fallbackInventory)
              : false;
          notify(
            result.reason === "conflict" ? "Pack reconciled" : "Pack action rejected",
            reconciled
              ? `${realtimeSession ? "The game server" : "Lakebed"} restored the authoritative inventory; the unconfirmed action was discarded (${result.reason}).`
              : `${realtimeSession ? "The game server" : "Lakebed"} rejected ${pending.action.kind.replaceAll("_", " ")} (${result.reason}); no unconfirmed items were committed.`,
            "warning",
          );
          return false;
        }
        inventoryActionQueueRef.current.shift();
        const superseded = result.inventory.revision !== inventoryRevisionRef.current
          && isDecimalRevisionAtLeast(inventoryRevisionRef.current, result.inventory.revision);
        if (!superseded) {
          inventoryTokenRef.current = result.inventory.updatedAt;
          inventoryRevisionRef.current = result.inventory.revision;
          lastCommittedPlayerJsonRef.current = result.inventory.inventoryJson;
        }
        if (inventoryActionQueueRef.current.length === 0 && !loadCanonicalPlayer(result.inventory)) {
          notify("Pack reconciliation failed", "Lakebed returned a damaged canonical inventory.", "warning");
          return false;
        }
      }
      return currentPlayerStateJson() === lastCommittedPlayerJsonRef.current;
    })();
    inventoryActionPromiseRef.current = task;
    void task.finally(() => {
      if (inventoryActionPromiseRef.current === task) inventoryActionPromiseRef.current = null;
    });
    return task;
  }

  async function handleDropSelected(dropWholeStack = false): Promise<void> {
    if (!hydratedRef.current || droppedItemBusyRef.current || pendingWorldBlockEditRef.current) return;
    const sourceSlot = selectedRef.current;
    const stack = inventoryRef.current[sourceSlot];
    if (!stack) return;
    droppedItemBusyRef.current = true;
    const operationId = droppedItemOperationId();
    let debited = false;
    try {
      const count = dropWholeStack ? stack.count : 1;
      const item = { ...stack, count };
      debited = await enqueueInventoryAction(
        { kind: "world_debit", sourceSlot, stack: item },
        relatedInventoryOperationId("drop", operationId),
      );
      if (!debited) throw new Error("inventory_rejected");
      const sink = realtimeDropSinkRef.current;
      if (!sink) throw new Error("multiplayer_not_connected");
      const pose = poseRef.current;
      const position = droppedItemForwardPosition(pose);
      const dropped = await sink(operationId, item, {
        ...pose,
        ...position,
      }, true);
      droppedPickupAttemptRef.current.set(dropped.dropId, dropped.droppedAt);
      audioRef.current?.play("blockPlace", { seed: dropped.dropId, intensity: 0.45, surface: "generic" });
    } catch {
      if (debited) {
        await enqueueInventoryAction(
          { kind: "world_credit", stack: { ...stack, count: dropWholeStack ? stack.count : 1 } },
          relatedInventoryOperationId("drop_refund", operationId),
        );
      }
      notify("Drop lost contact", "The item stayed in your inventory. Try again.", "warning");
    } finally {
      droppedItemBusyRef.current = false;
    }
  }

  async function pickupNearbyDroppedItem(drop: NormalizedDroppedItem): Promise<void> {
    if (!hydratedRef.current || droppedItemBusyRef.current || pendingWorldBlockEditRef.current) return;
    droppedItemBusyRef.current = true;
    try {
      if (addItemStack(inventoryRef.current, drop.item).remainder > 0) return;
      const sink = realtimePickupSinkRef.current;
      if (!sink) throw new Error("multiplayer_not_connected");
      const confirmed = await sink(`pickup:${drop.dropId}`.slice(0, 96), drop.dropId);
      if (appliedPickupDropsRef.current.has(confirmed.dropId)) return;
      const credited = await enqueueInventoryAction(
        { kind: "world_credit", stack: confirmed.item },
        relatedInventoryOperationId("pickup", confirmed.dropId),
      );
      if (!credited) {
        const returnSink = realtimeDropSinkRef.current;
        if (returnSink) await returnSink(
          `return:${confirmed.dropId}`.slice(0, 96),
          confirmed.item,
          { ...poseRef.current, x: confirmed.x, y: confirmed.y, z: confirmed.z },
        );
        throw new Error("inventory_changed");
      }
      appliedPickupDropsRef.current.add(confirmed.dropId);
      if (appliedPickupDropsRef.current.size > 512) {
        appliedPickupDropsRef.current.delete(appliedPickupDropsRef.current.values().next().value!);
      }
      audioRef.current?.play("pickup", { seed: drop.dropId, intensity: 0.72 });
    } catch {
    } finally {
      droppedItemBusyRef.current = false;
    }
  }

  function maybePickupNearbyDroppedItem(pose: PlayerPose): void {
    if (playerHealthRef.current <= 0) return;
    const now = Date.now();
    const localUserId = realtimeSession?.demo?.userId ?? auth.userId ?? "";
    const nearby = realtimeDropsRef.current
      .filter((drop) => drop.expiresAt > now
        && (drop.ownerUserId !== localUserId || (!drop.ownerPickupBlocked && drop.ownerPickupAt <= now)))
      .map((drop) => ({ drop, distance: Math.hypot(drop.x - pose.x, drop.y - pose.y, drop.z - pose.z) }))
      .filter(({ distance }) => distance <= DROPPED_ITEM_PICKUP_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0]?.drop;
    if (nearby && now - (droppedPickupAttemptRef.current.get(nearby.dropId) ?? 0) >= 350) {
      droppedPickupAttemptRef.current.set(nearby.dropId, now);
      void pickupNearbyDroppedItem(nearby);
    }
  }

  // Item attraction is time-based, not movement-based. A stationary player
  // standing over a newly-mined or Q-dropped item must be able to collect it
  // immediately after the server's owner delay without waiting for another
  // pose event or drop broadcast.
  useEffect(() => {
    if (!inWorld || !realtimeSession) return;
    const timer = window.setInterval(() => maybePickupNearbyDroppedItem(poseRef.current), 125);
    return () => window.clearInterval(timer);
  }, [inWorld, deathScreenOpen, realtimeSession?.endpoint, realtimeSession?.demo?.userId]);

  function releasePendingWorldBlockEdit(pending: PendingWorldBlockEdit): void {
    if (pendingWorldBlockEditRef.current !== pending) return;
    pendingWorldBlockEditRef.current = null;
  }

  function rollbackPendingWorldBlockEdit(
    pending: PendingWorldBlockEdit,
    title: string,
    detail: string,
    transportFailed: boolean,
  ): void {
    if (pendingWorldBlockEditRef.current !== pending) return;
    const coordKey = blockCoordinateKey(
      pending.optimisticEdit.x,
      pending.optimisticEdit.y,
      pending.optimisticEdit.z,
    );
    const authoritative = authoritativeWorldEditRef.current.get(coordKey);
    engineRef.current?.applyWorldEdits([
      authoritative ?? { ...pending.optimisticEdit, block: pending.previousBlock },
    ]);
    const latestInventory = latestSavedInventoryRef.current;
    if (latestInventory
      && latestInventory.revision !== inventoryRevisionRef.current
      && currentPlayerStateJson() === lastCommittedPlayerJsonRef.current) {
      loadCanonicalPlayer(latestInventory);
    }
    releasePendingWorldBlockEdit(pending);
    notify(title, detail, "warning");
  }

  async function submitPendingWorldBlockEdit(pending: PendingWorldBlockEdit): Promise<void> {
    const sink = realtimeBlockSinkRef.current;
    if (!sink) {
      rollbackPendingWorldBlockEdit(
        pending,
        "Edit paused",
        "The realtime server is still reconnecting. The block was restored.",
        true,
      );
      return;
    }
    const placementItem = pending.optimisticEdit.block !== BLOCK.AIR
      && pending.previousBlock === BLOCK.AIR
      && realtimeGameModeRef.current !== "creative"
      ? ENGINE_TO_GAME[pending.optimisticEdit.block]
      : null;
    let placementPaid = false;
    try {
      if (placementItem) {
        if (placementItem !== pending.expectedHeldItem) throw new Error("placement_item_mismatch");
        placementPaid = await enqueueInventoryAction(
          { kind: "place_block", sourceSlot: pending.sourceSlot, expectedItemId: placementItem },
          relatedInventoryOperationId("place", pending.operationId),
        );
        if (!placementPaid) throw new Error("placement_inventory_rejected");
      }
      let confirmed: RealtimeWorldEdit;
      try {
        confirmed = await sink(pending.operationId, pending.optimisticEdit);
      } catch {
        // The first acknowledgement can be lost after Railway commits. Its
        // operation ledger makes this exact retry return the same block patch.
        confirmed = await sink(pending.operationId, pending.optimisticEdit);
      }
      if (pendingWorldBlockEditRef.current !== pending) return;
      authoritativeWorldEditRef.current.set(
        blockCoordinateKey(confirmed.x, confirmed.y, confirmed.z),
        confirmed,
      );
      engineRef.current?.applyWorldEdits([confirmed]);
      const seed = `${pending.operationId}:${confirmed.x},${confirmed.y},${confirmed.z}`;
      if (confirmed.block === BLOCK.AIR && pending.previousBlock !== BLOCK.AIR) {
        audioRef.current?.play("blockBreak", { seed, surface: audioSurfaceForBlock(pending.previousBlock) });
        engineRef.current?.spawnBlockParticles({
          action: "break", block: pending.previousBlock, x: confirmed.x, y: confirmed.y, z: confirmed.z,
        });
        if (realtimeGameModeRef.current !== "creative") {
          const block = ENGINE_TO_GAME[pending.previousBlock];
          const drop = block ? getDeterministicMiningDrop(
            block,
            pending.expectedHeldItem,
            confirmed.x,
            confirmed.y,
            confirmed.z,
          ) : null;
          const dropSink = realtimeDropSinkRef.current;
          if (drop && dropSink) {
            const dropOperationId = `mine:${pending.operationId}`.slice(0, 96);
            const dropPose = {
              x: confirmed.x + 0.5,
              y: confirmed.y + 0.45,
              z: confirmed.z + 0.5,
              yaw: 0,
              pitch: 0,
            };
            try {
              await dropSink(dropOperationId, drop, dropPose);
            } catch {
              try {
                await dropSink(dropOperationId, drop, dropPose);
              } catch {
                notify("Drop connection lost", "The block broke, but the server could not publish its item drop.");
              }
            }
          }
        }
      } else if (confirmed.block !== BLOCK.AIR) {
        if (placementItem && confirmed.block !== pending.optimisticEdit.block) throw new Error("placement_block_mismatch");
        audioRef.current?.play("blockPlace", { seed, surface: audioSurfaceForBlock(confirmed.block) });
      }
      releasePendingWorldBlockEdit(pending);
    } catch {
      if (placementPaid && placementItem) {
        await enqueueInventoryAction(
          { kind: "world_credit", stack: { itemId: placementItem, count: 1 } },
          relatedInventoryOperationId("place_refund", pending.operationId),
        );
      }
      rollbackPendingWorldBlockEdit(
        pending,
        pending.optimisticEdit.block === BLOCK.AIR ? "Mine rejected" : "Placement restored",
        placementPaid
          ? "The game server did not confirm this placement. The block was restored and the item was returned."
          : "The game server could not reserve that inventory item, so the local block was restored.",
        true,
      );
    }

  }

  function handleBlockEdit(edit: EngineWorldEdit, previousBlock: EngineBlockId) {
    if (pendingWorldBlockEditRef.current) {
      engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
      return;
    }
    worldBlockOperationSequence += 1;
    const selectedHotbar = selectedRef.current;
    const pending: PendingWorldBlockEdit = {
      operationId: createWorldBlockOperationId(worldBlockOperationSequence),
      optimisticEdit: { ...edit },
      previousBlock,
      expectedHeldItem: inventoryRef.current[selectedHotbar]?.itemId ?? null,
      sourceSlot: selectedHotbar,
    };
    pendingWorldBlockEditRef.current = pending;
    void submitPendingWorldBlockEdit(pending);
  }

  useEffect(() => {
    inventoryRef.current = inventory;
    equipmentRef.current = equipment;
    selectedRef.current = selectedHotbar;
    const selected = inventory[selectedHotbar];
    engineRef.current?.setSelectedBlock(selected ? ITEM_TO_ENGINE[selected.itemId] ?? BLOCK.AIR : BLOCK.AIR);
    engineRef.current?.setSelectedItem(selected?.itemId ?? null);
    engineRef.current?.setPlayerArmor({
      head: equipment.head?.itemId ?? null,
      chest: equipment.chest?.itemId ?? null,
      legs: equipment.legs?.itemId ?? null,
      feet: equipment.feet?.itemId ?? null,
    });
  }, [inventory, selectedHotbar, equipment]);

  useEffect(() => {
    engineRef.current?.setPaused(multiplayerPaused);
    engineRef.current?.setFirstPersonFeedbackHidden(multiplayerPaused);
  }, [multiplayerPaused]);

  useEffect(() => {
    if (!auth.isAuthenticated || auth.isGuest || hydratedUserRef.current === auth.userId || savedInventory === undefined) return;
    if (savedInventory && savedInventory.userId !== auth.userId) return;
    hydratedRef.current = true;
    hydratedUserRef.current = auth.userId;
    inventoryAuthoritySessionRef.current += 1;
    inventoryTokenRef.current = savedInventory?.updatedAt ?? "";
    inventoryRevisionRef.current = savedInventory?.revision ?? "0";
    if (savedInventory) {
      const canonical = validatePlayerStateJson(savedInventory.inventoryJson);
      lastCommittedPlayerJsonRef.current = canonical.ok ? canonical.playerStateJson : savedInventory.inventoryJson;
    } else {
      lastCommittedPlayerJsonRef.current = "";
    }
    const saved = parsePlayerState(savedInventory);
    if (saved) {
      updateInventory(saved.inventory);
      selectedRef.current = saved.selectedHotbar;
      setSelectedHotbar(saved.selectedHotbar);
      updateEquipment(saved.equipment);
      respawnPointRef.current = saved.respawnPoint;
      setRespawnPoint(saved.respawnPoint);
      hungerRef.current = saved.hunger;
      setHunger(saved.hunger);
      notify("Field kit restored", "Lakebed recovered your last inventory.", "success");
      advanceInventoryAuthorityEpoch();
      setInventoryReady(true);
      return;
    }
    setInventoryReady(false);
    void enqueueInventoryAction({ kind: "initialize" }).then((committed) => {
      if (hydratedUserRef.current !== auth.userId) return;
      if (committed || inventoryTokenRef.current) {
        advanceInventoryAuthorityEpoch();
        setInventoryReady(true);
      }
    });
  }, [savedInventory, auth.userId, auth.isAuthenticated, auth.isGuest]);

  useEffect(() => {
    latestSavedInventoryRef.current = savedInventory;
    if (realtimeSession) return;
    if (!savedInventory || savedInventory.userId !== auth.userId) return;
    const pending = pendingWorldBlockEditRef.current;
    if (!pending
      && inventoryActionQueueRef.current.length === 0
      && savedInventory.revision !== inventoryRevisionRef.current
      && currentPlayerStateJson() === lastCommittedPlayerJsonRef.current
      && loadCanonicalPlayer(savedInventory)) {
      return;
    }
    if (!pending && inventoryActionQueueRef.current.length === 0
      && savedInventory.inventoryJson === lastCommittedPlayerJsonRef.current) {
      inventoryTokenRef.current = savedInventory.updatedAt;
      inventoryRevisionRef.current = savedInventory.revision;
    }
  }, [savedInventory, auth.userId, realtimeSession?.endpoint]);

  useEffect(() => {
    if (!realtimeSession) realtimeInventoryAuthorityRef.current = false;
  }, [realtimeSession?.endpoint]);


  useEffect(() => {
    if (!inWorld || !inventoryReady || !realtimeSession) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (!audioRef.current) throw new Error("Gameplay audio was not initialized.");
      const presentationOptions = createGameplayPresentationOptions({
        getSettings: () => clientSettingsRef.current,
        getInventory: () => inventoryRef.current,
        getEquipment: () => equipmentRef.current,
        getSelectedHotbar: () => selectedRef.current,
        getGameMode: () => realtimeGameModeRef.current,
        getHunger: () => hungerRef.current,
        selectHotbar: handleSelectHotbar,
        audio: audioRef.current,
        footstepSeedPrefix: "shared-step",
        onPerformanceStats: setPerformanceStats,
      });
      const engine = createGameplaySessionEngine(canvas, createRailwayGameplayAuthority({
        initialPose: poseRef.current,
        preserveInitialPose: true,
        worldRadius: WORLD_RADIUS,
        streamingChunkRadius: clientSettingsRef.current.renderDistance,
        canEditBlock: () => pendingWorldBlockEditRef.current === null,
        isRangedWeaponSelected: () => false,
        onUseSelectedItem: () => handleUseItem(),
        onRemotePlayerAttack: (target) => {
          realtimePlayerAttackSinkRef.current?.(`attack:${crypto.randomUUID()}`, target.id);
        },
        onMiningHit: (target) => {
          const surface = audioSurfaceForBlock(target.block.block);
          const seed = `${target.block.x},${target.block.y},${target.block.z}:${performance.now().toFixed(0)}`;
          audioRef.current?.play("miningHit", { seed, surface, intensity: 0.6 });
          engineRef.current?.spawnBlockParticles({
            action: "hit",
            block: target.block.block,
            x: target.block.x,
            y: target.block.y,
            z: target.block.z,
            normalX: target.place.x - target.block.x,
            normalY: target.place.y - target.block.y,
            normalZ: target.place.z - target.block.z,
          });
        },
        onMobIdle: (kind, mobId, intensity, pan) => audioRef.current?.play("mobIdle", {
          seed: mobId,
          mob: kind,
          intensity,
          pan,
        }),
        onHandAction: (action) => {
          if (action === "attack") audioRef.current?.play("playerAttack", { seed: performance.now().toFixed(0), intensity: 0.44 });
          motionActionSinkRef.current?.(action === "use" ? "use" : "swing");
        },
        onMovementModeChange: (mode) => {
          const crouching = mode === "sneak";
          if (crouching === realtimeCrouchingRef.current) return;
          realtimeCrouchingRef.current = crouching;
          motionActionSinkRef.current?.(crouching ? "crouch_on" : "crouch_off");
        },
        onPlayerDamage: (amount, cause) => {
          audioRef.current?.play("mobAttack", { seed: `mob:${amount}:${performance.now().toFixed(0)}`, intensity: 0.7 });
          audioRef.current?.play("playerHurt", { seed: `${amount}:${performance.now().toFixed(0)}`, intensity: 0.78 });
          if (cause === "fall") {
            realtimeSelfDamageSinkRef.current?.(`fall:${crypto.randomUUID()}`, amount);
            return false;
          }
        },
        onPlayerHealthChange: (health) => {
          playerHealthRef.current = health;
          setPlayerHealth(health);
        },
        onBlockEdit: (edit, previousBlock) => {
          handleBlockEdit(edit, previousBlock);
        },
        onPoseChange: (pose) => {
          const previousSegmentPose = previousSegmentPoseRef.current;
          if (pose.y - previousSegmentPose.y > 0.08) motionActionSinkRef.current?.("jump");
          previousSegmentPoseRef.current = pose;
          poseRef.current = pose;
          setDiagnosticPose((current) => Math.floor(current.x) === Math.floor(pose.x)
            && Math.floor(current.y) === Math.floor(pose.y)
            && Math.floor(current.z) === Math.floor(pose.z) ? current : pose);
          const pickupSweepAt = performance.now();
          if (pickupSweepAt - lastDroppedPickupSweepRef.current >= 250) {
            lastDroppedPickupSweepRef.current = pickupSweepAt;
            maybePickupNearbyDroppedItem(pose);
          }
          const workstation = activeWorkstationRef.current;
          if (workstation && !isWorkstationWithinReach(pose, workstation.position)) {
            const label = workstation.kind === "furnace" ? "Furnace" : "Workbench";
            closeInventory();
            notify(`${label} out of reach`, `Move back to the ${workstation.kind === "furnace" ? "furnace" : "crafting table"} to keep using it.`, "warning");
          }
        },
        onPointerLockChange: (locked) => {
          intentionalPointerUnlockRef.current = false;
          applyGameplayPointerEvent({
            type: "lock_change",
            locked,
            now: performance.now(),
            uiBlocked: authorityTrafficPausedRef.current && !pointerSessionRef.current.pauseOpen,
          });
        },
        onInteractBlock: (target) => {
          closeInventory();
          setChatOpen(false);
          exitPointerLockForUi();
          if (target.block.block === BLOCK.CRAFTING_TABLE) {
            activeWorkstationRef.current = { kind: "crafting_table", position: { x: target.block.x, y: target.block.y, z: target.block.z } };
            setCraftingContext("crafting_table");
            setInventoryOpen(true);
            return true;
          }
          notify(
            "Server interaction unavailable",
            "This interaction needs a Railway authority command before it can safely run in multiplayer.",
            "warning",
          );
          return true;
        },
      }), presentationOptions);
      engineRef.current = engine;
      void selectedSkin().then((skin) => {
        if (engineRef.current === engine) engine.setPlayerSkin(skin.source, skin.model);
      });
      engine.setPaused(multiplayerPaused);
      engine.setFirstPersonFeedbackHidden(multiplayerPaused);
      if (respawnPointRef.current) engine.setRespawnPoint(respawnPointRef.current);
      engine.start();
      setWorldReady(true);
      if (entryPointerLockHandoffRef.current && document.pointerLockElement === document.documentElement) {
        entryPointerLockHandoffRef.current = false;
        engine.requestPointerLock();
      } else setPointerCaptureNeeded(true);
      return () => {
        respawnRequestInFlightRef.current = false;
        engine.destroy();
        engineRef.current = null;
        setWorldReady(false);
        setPointerCaptureNeeded(false);
        releaseGameplayKeyboardCapture();
      };
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : "Unable to start the WebGL world.");
    }
  }, [inWorld, inventoryReady]);

  useEffect(() => {
    for (const [dropId, attemptedAt] of droppedPickupAttemptRef.current) {
      if (Number.isFinite(attemptedAt)) droppedPickupAttemptRef.current.delete(dropId);
    }
  }, [inventory]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    const update = () => setMobileUnsupported(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!inWorld) return;
      if (handleGameplayScreenshotKey(event, engineRef.current, notify)) return;
      if (event.code === "Tab") {
        event.preventDefault();
        if (!event.repeat && !pauseOpen && !chatOpen && !inventoryOpen) {
          setShowPlayerList(true);
        }
        return;
      }
      if (optionsOpen) {
        if (event.code === "Escape" && !event.repeat) {
          event.preventDefault();
          setOptionsOpen(false);
        }
        return;
      }
      if (pauseOpen) {
        if (event.code === "Escape" && !event.repeat) {
          event.preventDefault();
          applyGameplayPointerEvent({ type: "escape", now: performance.now(), repeat: false, uiBlocked: false });
        }
        return;
      }
      if (chatOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          closeChatFromEscape();
        }
        return;
      }
      if (inventoryOpen) {
        if (event.code === "Escape" || event.code === "KeyE") {
          event.preventDefault();
          closeInventory();
          applyGameplayPointerEvent(event.code === "Escape"
            ? { type: "close_ui_escape", now: performance.now() }
            : { type: "resume" });
        }
        return;
      }
      if (event.code === "Escape" && !event.repeat) {
        event.preventDefault();
        applyGameplayPointerEvent({ type: "escape", now: performance.now(), repeat: false, uiBlocked: false });
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      if (event.code === "KeyQ" && !event.repeat) {
        event.preventDefault();
        if (inventoryOpen) return;
        void handleDropSelected(event.ctrlKey || event.metaKey);
        return;
      }
      if ((event.code === "KeyT" || event.code === "Enter") && !event.repeat && !inventoryOpen) {
        event.preventDefault();
        exitPointerLockForUi();
        setChatOpen(true);
        setLastSeenChatCount(realtimeChatMessages.length);
        setChatError("");
        return;
      }
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        if (!hydratedRef.current) return;
        activeWorkstationRef.current = null;
        setCraftingContext("field");
        exitPointerLockForUi();
        setInventoryOpen(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Tab") setShowPlayerList(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [inWorld, optionsOpen, pauseOpen, chatOpen, inventoryOpen, realtimeChatMessages.length]);

  const worldConnected = transportReady;
  const playerListEntries = segmentRemotePlayers.map((player) => ({
    id: player.id,
    name: player.name,
    isSelf: false,
    connected: true,
  }));
  if (profile && !playerListEntries.some(({ isSelf }) => isSelf)) {
    playerListEntries.unshift({ id: auth.userId, name: profile.username, isSelf: true, connected: worldConnected });
  }

  function handleInventoryWorkspaceChange(
    snapshot: StowedInventorySnapshot,
    expectedAuthorityEpoch: number,
    recipes: readonly InventoryRecipeBatch[],
  ): boolean {
    if (!hydratedRef.current
      || expectedAuthorityEpoch !== inventoryAuthorityEpochRef.current
      || pendingWorldBlockEditRef.current
      || droppedItemBusyRef.current) return false;
    updateInventory(snapshot.inventory);
    updateEquipment(snapshot.equipment);
    if (realtimeGameModeRef.current === "creative") return true;
    const workstation = activeWorkstationRef.current;
    const actionContext: CraftingContext = workstation?.kind === "crafting_table" ? "crafting_table" : "field";
    const workstationCoordKey = actionContext === "crafting_table" && workstation
      ? `${workstation.position.x}:${workstation.position.y}:${workstation.position.z}`
      : "";
    const playerStateJson = currentPlayerStateJson();
    if (recipes.length === 0 && playerStateJson === lastCommittedPlayerJsonRef.current) return true;
    void enqueueInventoryAction({
      kind: "workspace_commit",
      playerStateJson,
      recipes: recipes.map(({ recipeId, crafts }) => ({ recipeId, crafts })),
      craftingContext: actionContext,
      workstationCoordKey,
    });
    return true;
  }

  function handleCrafted(recipe: Recipe, craftedCount: number) {
    audioRef.current?.play("craft", { seed: `${recipe.id}:${craftedCount}`, intensity: 0.72, surface: "wood" });
  }

  function handleUseItem(inventoryIndex = selectedRef.current): boolean {
    if (pendingWorldBlockEditRef.current) return false;
    const result = consumeFood(inventoryRef.current, inventoryIndex, hungerRef.current);
    if (!result.ok) {
      if (result.reason === "hunger_full") notify("You are already full", "Save that food for later.");
      return false;
    }
    updateInventory(result.inventory);
    hungerRef.current = result.hunger;
    setHunger(result.hunger);
    void enqueueInventoryAction({
      kind: "eat",
      sourceSlot: inventoryIndex,
      expectedItemId: result.consumed,
    });
    return true;
  }

  function handleSelectHotbar(index: number): void {
    const selectedHotbar = clampHotbarIndex(index);
    if (!hydratedRef.current || selectedHotbar === selectedRef.current) return;
    selectedRef.current = selectedHotbar;
    setSelectedHotbar(selectedHotbar);
    motionActionSinkRef.current?.("slot", selectedHotbar);
    if (realtimeGameModeRef.current === "creative") return;
    void enqueueInventoryAction({ kind: "select_hotbar", selectedHotbar });
  }

  function handleUsernameClaim(value: string) {
    setUsernameState("saving");
    setUsernameError("");
    void claimUsername(value).then((result) => {
      if (result.ok) {
        setProfile(result.profile);
        setUsernameDraft(result.profile.username);
        setUsernameState("claimed");
        return;
      }
      if (result.reason === "taken") {
        setUsernameState("taken");
        setUsernameError("Another explorer already claimed that name.");
      } else if (result.reason === "username_locked") {
        setUsernameState("error");
        setUsernameError("This account already has an explorer tag.");
      } else if (result.reason === "authentication_required") {
        setUsernameState("error");
        setUsernameError("Sign in again before claiming a name.");
      } else {
        setUsernameState("error");
        setUsernameError("That explorer tag is not valid.");
      }
    }).catch(() => {
      setUsernameState("error");
      setUsernameError("Lakebed did not answer. Try claiming the name again.");
    });
  }

  function addDirectServer() {
    const endpoint = normalizeMultiplayerEndpoint(directConnectValue);
    if (!endpoint) {
      setJoinPhase("error");
      setJoinError("Enter a valid wss:// or https:// Railway server address.");
      return;
    }
    const registered = registeredServers.find((server) => server.canonicalWssUrl === endpoint);
    const id = registered?.id ?? `direct:${endpoint}`;
    const enteredToken = directConnectToken.trim();
    const persistedTokens = loadMultiplayerInvitationTokens(window.localStorage);
    const invitationToken = enteredToken.length >= 16
      ? enteredToken
      : demoServerTokens[endpoint] || persistedTokens[endpoint] || "";
    const next = [
      { id, name: registered?.name ?? new URL(endpoint).host, endpoint },
      ...savedMultiplayerServers.filter((server) => server.endpoint !== endpoint),
    ].slice(0, 24);
    setSavedMultiplayerServers(next);
    saveMultiplayerServers(window.localStorage, next);
    if (invitationToken) {
      saveMultiplayerInvitationToken(window.localStorage, endpoint, invitationToken);
      setDemoServerTokens((current) => ({ ...current, [endpoint]: invitationToken }));
    }
    setSelectedServerId(id);
    setDirectConnectValue("");
    setDirectConnectToken("");
    setJoinPhase("idle");
    setJoinError(registered || invitationToken
      ? ""
      : "This address was saved. Add it again with its private invitation token before joining.");
  }

  function enterWorld(serverId = selectedServerId) {
    if (!profile || joinPhase === "joining" || joinPhase === "waiting" || joinPhase === "ready") return;
    const selected = combinedServers.find((server) => server.id === serverId);
    const registered = selected && registeredServers.find((server) => server.id === selected.id);
    const persistedTokens = loadMultiplayerInvitationTokens(window.localStorage);
    const demoToken = selected ? demoServerTokens[selected.endpoint] || persistedTokens[selected.endpoint] || "" : "";
    if (!selected || (!registered && (!demoToken || demoToken.length < 16))) {
      setJoinPhase("error");
      setJoinError("This server is not registered with Lakebed. Add it again with its private invitation token.");
      return;
    }
    entryPointerLockHandoffRef.current = requestDocumentPointerLockHandoff();
    requestGameplayKeyboardCapture();
    setJoinError("");
    setJoinPhase("joining");
    void flushInventoryActions().then(async () => {
      let session: RealtimeSession;
      if (!registered) {
        session = {
          serverId: selected.id,
          endpoint: selected.endpoint,
          demo: { token: demoToken, userId: auth.userId, name: profile.username },
        };
      } else {
        const ticket = await createExternalMultiplayerJoinTicket(registered.id);
        if (!ticket.ok || ticket.expiresAt <= Date.now()) {
          throw new Error(ticket.ok ? "join_ticket_expired" : ticket.reason);
        }
        session = {
          ticket: ticket.ticket,
          serverId: ticket.serverId,
          endpoint: normalizeMultiplayerEndpoint(ticket.canonicalWssUrl) ?? registered.canonicalWssUrl,
        };
      }
      setRealtimeSession(session);
      window.setTimeout(() => {
      if (!hydratedRef.current) {
        setJoinPhase("waiting");
        return;
      }
      setJoinPhase("ready");
      window.setTimeout(() => {
        setInWorld(true);
        setOptionsOpen(false);
        setPauseOpen(false);
        setJoinPhase("idle");
      }, 180);
      }, 100);
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "join_failed";
      setRealtimeSession(null);
      setJoinPhase("error");
      releaseGameplayKeyboardCapture();
      setJoinError(detail === "join_ticket_expired"
        ? "The join ticket expired before the server connection opened. Try again."
        : "Lakebed could not authorize this server connection.");
    });
  }

  useEffect(() => {
    if (joinPhase !== "waiting" || !inventoryReady || !profile) return;
    let cancelled = false;
    let timer = 0;
    void flushInventoryActions().then(() => {
      if (cancelled) return;
      setJoinPhase("ready");
      timer = window.setTimeout(() => {
        setInWorld(true);
        setOptionsOpen(false);
        setPauseOpen(false);
        setJoinPhase("idle");
      }, 180);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [joinPhase, inventoryReady, profile?.id, realtimeSession?.ticket]);

  useEffect(() => {
    if (inWorld && !auth.isLoading && (!auth.isAuthenticated || auth.isGuest)) {
      exitPointerLockForUi();
      setInWorld(false);
      setChatOpen(false);
      closeInventory();
    }
  }, [inWorld, auth.isLoading, auth.isAuthenticated, auth.isGuest]);

  function handleChatSubmit(value: string) {
    setChatError("");
    const sink = realtimeChatSinkRef.current;
    if (!sink) {
      setChatError("Chat is reconnecting to this server.");
      return;
    }
    setChatDraft("");
    setLastSeenChatCount(realtimeChatMessages.length + 1);
    void sink(value).catch(() => setChatError("Chat is reconnecting to this server."));
  }

  const signedIn = auth.isAuthenticated && !auth.isGuest;
  const lobbyAuthState = auth.isLoading || (signedIn && profile === undefined)
    ? "loading"
    : !signedIn
      ? "signed_out"
      : profile
        ? "ready"
        : "needs_username";
  const chatMessages: LakecraftChatMessage[] = realtimeChatMessages.map((message) => ({
    id: message.id,
    username: message.username,
    body: message.message,
    sentAt: message.sentAt,
    own: message.userId === (realtimeSession?.demo?.userId ?? auth.userId),
    delivery: message.delivery,
  }));
  const unreadChat = chatOpen ? 0 : Math.max(0, chatMessages.length - lastSeenChatCount);
  if (!inWorld) {
    return (
      <>
      <ErrorBoundary fallback={(error, retry) => <LobbyBootstrapRecovery error={error} retry={retry} />}>
        {transportForeground && lakebedIdentity !== "" && !bootstrapReady ? (
          <LobbyBootstrapQuery identity={lakebedIdentity} onResult={acceptBootstrap} />
        ) : null}
      </ErrorBoundary>
      <LobbyScreen
        authState={lobbyAuthState}
        buildLabel="MULTIPLAYER ALPHA"
        displayName={profile?.username ?? auth.displayName}
        email={auth.email}
        joinPhase={joinPhase}
        joinError={joinError}
        servers={lobbyServers}
        selectedServerId={selectedServerId}
        directConnectValue={directConnectValue}
        directConnectToken={directConnectToken}
        settings={clientSettings}
        onAddDirectServer={addDirectServer}
        onDirectConnectChange={(value) => {
          setDirectConnectValue(value);
          if (joinPhase === "error") setJoinPhase("idle");
          setJoinError("");
        }}
        onDirectConnectTokenChange={(value) => {
          setDirectConnectToken(value);
          if (joinPhase === "error") setJoinPhase("idle");
          setJoinError("");
        }}
        onJoinWorld={() => enterWorld()}
        onJoinServer={enterWorld}
        onSelectServer={(serverId) => {
          setSelectedServerId(serverId);
          setJoinPhase("idle");
          setJoinError("");
        }}
        onJoinSingleplayer={onJoinSingleplayer}
        onSettingsChange={updateClientSettings}
        onSignInWithGoogle={() => {
          setUsernameError("");
          void signInWithGoogle().catch(() => {
            setUsernameState("error");
            setUsernameError("Google sign-in could not start. Please try again.");
          });
        }}
        onSignOut={() => {
          signOut();
          setBootstrapIdentity("");
          setSavedInventory(undefined);
          setProfile(undefined);
          setExternalMultiplayerServers([]);
          updateInventory(createStarterInventory());
          const emptyEquipment = createEmptyEquipment();
          updateEquipment(emptyEquipment);
          advanceInventoryAuthorityEpoch();
          respawnPointRef.current = null;
          setRespawnPoint(null);
          hungerRef.current = MAX_HUNGER;
          setHunger(MAX_HUNGER);
          selectedRef.current = 2;
          setSelectedHotbar(2);
          poseRef.current = { ...DEFAULT_PLAYER_POSE };
          setUsernameDraft("");
          setUsernameState("idle");
          setInventoryReady(false);
          hydratedRef.current = false;
          hydratedUserRef.current = "";
          inventoryTokenRef.current = "";
          inventoryRevisionRef.current = "0";
          inventoryAuthoritySessionRef.current += 1;
          lastCommittedPlayerJsonRef.current = "";
          inventoryActionQueueRef.current.length = 0;
          inventoryActionPromiseRef.current = null;
          pendingWorldBlockEditRef.current = null;
          authoritativeWorldEditRef.current.clear();
          latestSavedInventoryRef.current = undefined;
        }}
        onUsernameChange={(value) => {
          setUsernameDraft(value);
          setUsernameState("idle");
          setUsernameError("");
        }}
        onUsernameSubmit={handleUsernameClaim}
        username={profile?.username ?? usernameDraft}
        usernameError={usernameError}
        usernameState={profile ? "claimed" : usernameState}
        worldDescription="Survival · Lakebed shared world"
        worldName="Fern Hollow"
        worldStatus="online"
      />
      </>
    );
  }

  return (
    <GameplaySessionSurface
      authority="railway"
      canvasClassName="lakecraft-world"
      canvasLabel="Lakecraft voxel world"
      canvasRef={canvasRef}
      canvasTestId="voxel-world"
      diagnostics={{
        gameMode: realtimeSession ? realtimeGameMode : "survival",
        pose: diagnosticPose,
        stats: performanceStats,
      }}
      pointerCapture={{
        visible: pointerCaptureNeeded && !multiplayerPaused,
        onRequest: () => {
          requestGameplayKeyboardCapture();
          applyGameplayPointerEvent({ type: "resume" });
        },
      }}
      ready={worldReady}
      rootClassName="lakecraft-shell"
      rootStyle={APP_CSS}
    >
      {realtimeSession ? (
        <RealtimeMultiplayerTransport
          endpoint={realtimeSession.endpoint}
          ticket={realtimeSession.ticket}
          serverId={realtimeSession.serverId}
          demo={realtimeSession.demo}
          localUserId={realtimeSession.demo?.userId ?? auth.userId ?? ""}
          localUsername={realtimeSession.demo?.name ?? profile?.username ?? "Player"}
          getPose={() => engineRef.current?.getPose() ?? poseRef.current}
          getInitialInventoryJson={currentPlayerStateJson}
          getHeldItem={() => inventoryRef.current[selectedRef.current]?.itemId ?? null}
          getSkin={selectedSkin}
          getArmor={() => ({
            armorHead: equipmentRef.current.head?.itemId ?? "",
            armorChest: equipmentRef.current.chest?.itemId ?? "",
            armorLegs: equipmentRef.current.legs?.itemId ?? "",
            armorFeet: equipmentRef.current.feet?.itemId ?? "",
          })}
          onPhase={(phase: RealtimeConnectionPhase, detail?: string) => {
            setTransportReady(phase === "online");
            if (phase === "error" && detail) notify("Server connection rejected", detail, "warning");
          }}
          onReconcilePose={(pose) => engineRef.current?.reconcilePose(pose)}
          onRemotePlayers={(players) => {
            setSegmentRemotePlayers(players);
            engineRef.current?.setRemotePlayers(players);
          }}
          onWorldEdits={(edits, replace) => {
            if (replace) authoritativeWorldEditRef.current.clear();
            for (const edit of edits) {
              authoritativeWorldEditRef.current.set(blockCoordinateKey(edit.x, edit.y, edit.z), edit);
            }
            engineRef.current?.applyWorldEdits(edits);
          }}
          onChatEvent={(event) => setRealtimeChatMessages((messages) => applyRealtimeChatEvent(messages, event))}
          onGameMode={(gameMode) => {
            if (realtimeGameModeRef.current === gameMode) return;
            realtimeGameModeRef.current = gameMode;
            setRealtimeGameMode(gameMode);
            advanceInventoryAuthorityEpoch();
          }}
          onDrops={(drops) => {
            realtimeDropsRef.current = drops;
            engineRef.current?.setDroppedItems(drops);
            maybePickupNearbyDroppedItem(poseRef.current);
          }}
          onSelfHealth={(health) => {
            playerHealthRef.current = health;
            setPlayerHealth(health);
            engineRef.current?.setPlayerHealth(health);
            if (health <= 0 && !respawnRequestInFlightRef.current) openRealtimeDeath();
            else setDeathScreenOpen(false);
            if (health <= 0 && !realtimeDeathSettlementRef.current) {
              void settleRealtimeDeath(`death:self:${Date.now().toString(36)}`);
            }
          }}
          onInventoryState={(authoritativeInventory) => {
            if (!realtimeInventoryAuthorityRef.current) {
              realtimeInventoryAuthorityRef.current = true;
              inventoryAuthoritySessionRef.current += 1;
              inventoryActionQueueRef.current.length = 0;
              inventoryActionPromiseRef.current = null;
              inventoryRevisionRef.current = "0";
              lastCommittedPlayerJsonRef.current = "";
            }
            if (loadCanonicalPlayer(authoritativeInventory)) setInventoryReady(true);
          }}
          onPlayerHit={(hit) => {
            const localUserId = realtimeSession.demo?.userId ?? auth.userId ?? "";
            if (hit.targetId !== localUserId) return;
            playerHealthRef.current = hit.health;
            setPlayerHealth(hit.health);
            engineRef.current?.setPlayerHealth(hit.health);
            audioRef.current?.play("playerHurt", { seed: hit.operationId, intensity: 0.82 });
            if (!authorityTrafficPausedRef.current && document.pointerLockElement) {
              engineRef.current?.applyConfirmedMobKnockback(
                hit.operationId, hit.attackerX, hit.attackerZ, hit.damage, performance.now(),
              );
            }
            if (hit.killed && !respawnRequestInFlightRef.current) openRealtimeDeath();
            if (hit.killed) void settleRealtimeDeath(hit.operationId);
          }}
          registerBlockSink={(sink) => { realtimeBlockSinkRef.current = sink; }}
          registerChatSink={(sink) => { realtimeChatSinkRef.current = sink; }}
          registerActionSink={(sink) => { motionActionSinkRef.current = sink; }}
          registerDropSink={(sink) => { realtimeDropSinkRef.current = sink; }}
          registerPickupSink={(sink) => { realtimePickupSinkRef.current = sink; }}
          registerRespawnSink={(sink) => { realtimeRespawnSinkRef.current = sink; }}
          registerPlayerAttackSink={(sink) => { realtimePlayerAttackSinkRef.current = sink; }}
          registerSelfDamageSink={(sink) => { realtimeSelfDamageSinkRef.current = sink; }}
          registerInventorySink={(sink) => { realtimeInventorySinkRef.current = sink; }}
        />
      ) : null}

      <GameHud
        connected={worldConnected}
        equipment={equipment}
        craftingContext={craftingContext}
        deathCause="You died"
        deathScreenOpen={deathScreenOpen}
        health={playerHealth}
        hunger={hunger}
        maxHunger={MAX_HUNGER}
        inventory={inventory}
        inventoryAuthorityEpoch={inventoryAuthorityEpoch}
        creativeInventory={Boolean(realtimeSession) && realtimeGameMode === "creative"}
        inventoryOpen={inventoryOpen}
        modalOpen={chatOpen}
        messages={messages}
        mobileUnsupported={mobileUnsupported}
        onlineCount={Math.max(1, segmentRemotePlayers.length + 1)}
        showSurvivalStatus={realtimeGameMode !== "creative"}
        onCloseInventory={() => {
          closeInventory();
          applyGameplayPointerEvent({ type: "resume" });
        }}
        onContinueMobile={() => setMobileUnsupported(false)}
        onCrafted={handleCrafted}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onDisconnect={() => {
          void flushInventoryActions();
          exitPointerLockForUi();
          releaseGameplayKeyboardCapture();
          setOptionsOpen(false);
          setPauseOpen(false);
          setShowPlayerList(false);
          setInWorld(false);
          setChatOpen(false);
          closeInventory();
          setRealtimeSession(null);
          setSegmentRemotePlayers([]);
        }}
        onInventoryWorkspaceChange={handleInventoryWorkspaceChange}
        fovDegrees={clientSettings.fovDegrees}
        mouseSensitivity={clientSettings.mouseSensitivity}
        renderDistance={clientSettings.renderDistance}
        onCloseOptions={() => setOptionsOpen(false)}
        onOptions={() => setOptionsOpen(true)}
        onFovChange={(fovDegrees) => updateClientSettings({ ...clientSettingsRef.current, fovDegrees })}
        onSensitivityChange={(mouseSensitivity) => updateClientSettings({ ...clientSettingsRef.current, mouseSensitivity })}
        onRenderDistanceChange={(renderDistance) => {
          updateClientSettings({ ...clientSettingsRef.current, renderDistance });
          engineRef.current?.setRenderDistance(renderDistance);
        }}
        optionsOpen={optionsOpen}
        onRespawn={requestRailwayRespawn}
        soundMuted={clientSettings.soundMuted}
        onToggleSound={() => {
          const nextMuted = !clientSettingsRef.current.soundMuted;
          updateClientSettings({ ...clientSettingsRef.current, soundMuted: nextMuted });
          if (!nextMuted) {
            void audioRef.current?.unlock().then(() => {
              audioRef.current?.play("uiConfirm", { seed: "sound-on", intensity: 0.52 });
            });
          }
        }}
        onResume={() => {
          setOptionsOpen(false);
          requestGameplayKeyboardCapture();
          applyGameplayPointerEvent({ type: "resume" });
        }}
        onSelectHotbar={handleSelectHotbar}
        onTitleScreen={() => {
          void flushInventoryActions();
          exitPointerLockForUi();
          releaseGameplayKeyboardCapture();
          setDeathScreenOpen(false);
          setRespawning(false);
          setOptionsOpen(false);
          setPauseOpen(false);
          setShowPlayerList(false);
          setInWorld(false);
          setChatOpen(false);
          closeInventory();
          setRealtimeSession(null);
          setSegmentRemotePlayers([]);
        }}
        playerName={profile?.username ?? auth.displayName}
        pauseOpen={pauseOpen}
        players={playerListEntries}
        roomCode="RAILWAY"
        selectedIndex={selectedHotbar}
        respawning={respawning}
        showPlayerList={showPlayerList}
        worldName={activeServerName}
      />

      <ChatOverlay
        connected={worldConnected}
        draft={chatDraft}
        error={chatError}
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        messages={chatMessages}
        onClose={() => {
          closeChatFromEscape();
        }}
        onDraftChange={setChatDraft}
        onOpen={() => {
          exitPointerLockForUi();
          setChatOpen(true);
          setLastSeenChatCount(chatMessages.length);
          setChatError("");
        }}
        onSubmit={handleChatSubmit}
        open={chatOpen}
        sending={false}
        unreadCount={unreadChat}
      />

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </GameplaySessionSurface>
  );
}

function LakebedMultiplayerApp({ onJoinSingleplayer }: { onJoinSingleplayer: () => void }) {
  const [inWorld, setInWorld] = useState(false);
  return <RailwayMultiplayerSession inWorld={inWorld} setInWorld={setInWorld} onJoinSingleplayer={onJoinSingleplayer} />;
}

export function App() {
  const [singlePlayer, setSinglePlayer] = useState(
    () => shouldRunSinglePlayer(window.location.hostname, window.location.search),
  );

  function joinSingleplayer(): void {
    const url = new URL(window.location.href);
    url.searchParams.set("singleplayer", "1");
    window.history.replaceState(window.history.state, "", url);
    setSinglePlayer(true);
  }

  function leaveSingleplayer(): void {
    window.history.replaceState(window.history.state, "", singlePlayerTitleUrl(window.location.href));
    setSinglePlayer(false);
  }

  return singlePlayer
    ? <SinglePlayerApp onExit={leaveSingleplayer} />
    : <LakebedMultiplayerApp onJoinSingleplayer={joinSingleplayer} />;
}
