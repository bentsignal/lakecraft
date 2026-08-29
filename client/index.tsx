import { ErrorBoundary, signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChatOverlay, type LakecraftChatMessage } from "./chat";
import { GameHud, type HudMessage } from "./components";
import { isCraftingTableWithinReach as isWorkstationWithinReach, type CraftingTablePosition as WorkstationPosition } from "./crafting";
import {
  BLOCK,
  isDoorBlock,
  toggledDoorBlock,
  type BlockId as EngineBlockId,
  type PlayerPose,
  type RemotePlayer,
  type VoxelPerformanceStats,
  type VoxelEngine,
  type WorldEdit as EngineWorldEdit,
} from "./game";
import { createGameplaySessionEngine, createRailwayGameplayAuthority } from "./gameplay/index.ts";
import type { WorldTerrainDescriptor } from "../shared/worldPreset.ts";
import { LobbyScreen, TitleScreen, type LobbyJoinPhase, type LobbyServerEntry, type UsernameClaimState } from "./lobby";
import { SinglePlayerApp } from "./singleplayer";
import {
  AUTH_CALLBACK_PATH,
  appRouteForLocation,
  multiplayerUrl,
  singlePlayerTitleUrl,
  titleUrl,
  type LakecraftAppRoute,
} from "./runtimeMode.ts";
import { releaseGameplayKeyboardCapture, requestGameplayKeyboardCapture, toggleGameplayFullscreen } from "./gameplayKeyboardCapture.ts";
import { requestDocumentPointerLockHandoff } from "./pointerLockHandoff.ts";
import { handleGameplayScreenshotKey } from "./gameplayDiagnostics.tsx";
import {
  audioSurfaceForBlock,
  createGameplayPointerSessionState,
  createGameplayPresentationOptions,
  ENGINE_TO_GAME,
  GameplaySessionSurface,
  ITEM_TO_ENGINE,
  gameplayChatShortcutDraft,
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
  type RealtimeMobAttackSink,
  type RealtimePlayerAttackSink,
  type RealtimeRespawnSink,
  type RealtimeSelfDamageSink,
  type RealtimeInventorySink,
} from "./RealtimeMultiplayerTransport.tsx";
import {
  applyRealtimeChatEvent,
  countUnreadRealtimeChat,
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
  clientAudioLevels,
  loadClientSettings,
  normalizeClientSettings,
  saveClientSettings,
  type ClientSettings,
} from "./settings.ts";
import { gameplayControlActionForCode } from "./gameplay/controlBindings.ts";
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
  DROPPED_ITEM_ATTRACTION_MS,
  DROPPED_ITEM_PICKUP_RADIUS,
  droppedItemForwardPosition,
  type NormalizedDroppedItem,
} from "../shared/droppedItems";
import {
  createWorldBlockOperationId,
  isDecimalRevisionAtLeast,
} from "./worldBlockEditClient";
import {
  createGameAudio,
  type GameAudio,
} from "./game/audio.ts";

const APP_CSS = `
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
  password?: string;
  serverId: string;
  endpoint: string;
  demo?: { token: string; userId: string; name: string };
};

const PINNED_MULTIPLAYER_SERVERS:readonly SavedMultiplayerServer[] = Object.freeze([
  {id:"pinned:creative",name:"Lakecraft Creative",endpoint:"wss://lake"+"craft-creative-production.up.railway.app/ws"},
  {id:"pinned:survival",name:"Lakecraft Survival",endpoint:"wss://lake"+"craft-production.up.railway.app/ws"},
]);


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
  followups: readonly Readonly<{ edit: EngineWorldEdit; previousBlock: EngineBlockId }>[];
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
  onBack,
}: {
  inWorld: boolean;
  setInWorld: (inWorld: boolean) => void;
  onBack: () => void;
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
  const droppedPickupAttractionRef = useRef<{ dropId: string; startedAt: number } | null>(null);
  const appliedPickupDropsRef = useRef(new Set<string>());
  const lastDroppedPickupSweepRef = useRef(0);
  const respawnRequestInFlightRef = useRef(false);
  const realtimeDeathSettlementRef = useRef<{ eventId: string; task: Promise<boolean> } | null>(null);
  const motionActionSinkRef = useRef<((kind: MotionVisualActionKind, value?: number) => void) | null>(null);
  const realtimeRespawnSinkRef = useRef<RealtimeRespawnSink | null>(null);
  const realtimePlayerAttackSinkRef = useRef<RealtimePlayerAttackSink | null>(null);
  const realtimeMobAttackSinkRef = useRef<RealtimeMobAttackSink | null>(null);
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
  const [debugOverlayVisible, setDebugOverlayVisible] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [engineError, setEngineError] = useState("");
  const [worldReady, setWorldReady] = useState(false);
  const initialWorldChunksReadyRef = useRef(false);
  const revealWorldPresentationRef = useRef<(() => void) | null>(null);
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
    accessMode: "token"|"public"|"password"|"whitelist"|"closed";
  }>>({});
  const [realtimeSession, setRealtimeSession] = useState<RealtimeSession | null>(null);
  const realtimeBlockSinkRef = useRef<RealtimeBlockSink | null>(null);
  const realtimeChatSinkRef = useRef<RealtimeChatSink | null>(null);
  const realtimeDropSinkRef = useRef<RealtimeDropSink | null>(null);
  const realtimePickupSinkRef = useRef<RealtimePickupSink | null>(null);
  const realtimeGameModeRef = useRef<RealtimeGameMode>("survival");
  const [realtimeChatMessages, setRealtimeChatMessages] = useState<RealtimeChatMessage[]>([]);
  const [realtimeGameMode, setRealtimeGameMode] = useState<RealtimeGameMode>("survival");
  const [realtimeTerrain, setRealtimeTerrain] = useState<WorldTerrainDescriptor | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameClaimState>("idle");
  const [usernameError, setUsernameError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [lastSeenChatSequence, setLastSeenChatSequence] = useState(0);
  const latestRealtimeChatSequence = realtimeChatMessages.reduce(
    (latest, message) => Math.max(latest, message.sequence), 0,
  );
  const [playerHealth, setPlayerHealth] = useState(20);
  const [playerAir, setPlayerAir] = useState(10);
  const playerHealthRef = useRef(20);
  const [deathScreenOpen, setDeathScreenOpen] = useState(false);
  const [respawning, setRespawning] = useState(false);
  const signedIn = auth.isAuthenticated && !auth.isGuest;
  const lakebedIdentity = auth.isLoading || !signedIn ? "" : auth.userId ?? "";
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
  const multiplayerAuthorityPaused = multiplayerPaused || !transportReady;
  const registeredServers = externalMultiplayerServers.flatMap((server) => {
    const endpoint = normalizeMultiplayerEndpoint(server.canonicalWssUrl);
    return endpoint ? [{ ...server, canonicalWssUrl: endpoint }] : [];
  });
  const combinedServers:SavedMultiplayerServer[] = PINNED_MULTIPLAYER_SERVERS.map((pinned)=>{
    const registered=registeredServers.find((server)=>server.canonicalWssUrl===pinned.endpoint);
    return registered?{id:registered.id,name:registered.name,endpoint:registered.canonicalWssUrl}:{...pinned};
  });
  for(const server of registeredServers){
    if(combinedServers.some((candidate)=>candidate.endpoint===server.canonicalWssUrl))continue;
    combinedServers.push({id:server.id,name:server.name,endpoint:server.canonicalWssUrl});
  }
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
      description: registered?.description ?? (server.id.startsWith("pinned:") ? "Official Lakecraft world · pinned" : "Direct Connect · community server"),
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
    setLastSeenChatSequence(0);
    setChatError("");
    realtimeGameModeRef.current = "survival";
    setRealtimeGameMode("survival");
  }, [realtimeSession?.endpoint]);

  useEffect(() => {
    if (!bootstrapReady || !profile || !serverProbeKey) return;
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
            accessMode: body.accessMode === "public" || body.accessMode === "password" || body.accessMode === "whitelist" || body.accessMode === "closed"
              ? body.accessMode : "token",
          },
        }));
      }).catch(() => {
        if (controller.signal.aborted) return;
        setServerStatuses((current) => ({
          ...current,
          [server.endpoint]: { status: "offline", onlinePlayers: 0, capacity: current[server.endpoint]?.capacity ?? 20, accessMode:current[server.endpoint]?.accessMode??"token" },
        }));
      });
    }
    return () => controller.abort();
  }, [bootstrapReady, profile?.id, serverProbeKey]);

  useEffect(() => {
    if (selectedServerId && combinedServers.some((server) => server.id === selectedServerId)) return;
    setSelectedServerId(combinedServers[0]?.id ?? "");
  }, [serverProbeKey, selectedServerId]);
  if (!authoritativeKnockbackGateRef.current) {
    authoritativeKnockbackGateRef.current = { paused: multiplayerAuthorityPaused, pauseEpoch: multiplayerAuthorityPaused ? 1 : 0 };
  } else updateAuthoritativeKnockbackGate(authoritativeKnockbackGateRef.current, multiplayerAuthorityPaused);
  authorityTrafficPausedRef.current = multiplayerAuthorityPaused;

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
    const renderDistanceChanged = clientSettingsRef.current.renderDistance !== next.renderDistance;
    clientSettingsRef.current = next;
    setClientSettings(next);
    saveClientSettings(window.localStorage, next);
    if (soundChanged) audioRef.current?.setMuted(next.soundMuted);
    audioRef.current?.setLevels(clientAudioLevels(next));
    if (renderDistanceChanged) engineRef.current?.setRenderDistance(next.renderDistance);
  }

  useEffect(() => {
    const audio = createGameAudio({ muted: clientSettingsRef.current.soundMuted, levels: clientAudioLevels(clientSettingsRef.current), maxVoices: 16 });
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
      if (!realtimeInventorySinkRef.current) return false;
      droppedItemBusyRef.current = true;
      try {
        // Railway derives every drop from its canonical pack and clears that
        // pack in the same transaction; the browser never enumerates stacks.
        return await enqueueInventoryAction({ kind: "death_settle", eventId });
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
      void pointerLock;
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
    if (transition.requestPointerLock) {
      void engineRef.current?.requestPointerLock();
    }
  }

  function closeChatFromEscape(): void {
    setChatOpen(false);
    setLastSeenChatSequence(latestRealtimeChatSequence);
    const generation = ++chatEscapeRecaptureRef.current;
    requestGameplayKeyboardCapture();
    applyGameplayPointerEvent({ type: "close_ui_escape", now: performance.now() });
    scheduleGameplayPointerLockAfterEscapeRelease(window, () => (
      generation === chatEscapeRecaptureRef.current
      && document.visibilityState === "visible"
      && engineRef.current !== null
    ), () => {
      requestGameplayKeyboardCapture();
      void engineRef.current?.requestPointerLock();
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
    try {
      const count = dropWholeStack ? stack.count : 1;
      const item = { ...stack, count };
      const sink = realtimeDropSinkRef.current;
      if (!sink) throw new Error("multiplayer_not_connected");
      const pose = poseRef.current;
      const position = droppedItemForwardPosition(pose);
      const dropped = await sink(operationId, item, {
        ...pose,
        ...position,
      }, sourceSlot);
      droppedPickupAttemptRef.current.set(dropped.dropId, dropped.droppedAt);
      audioRef.current?.play("blockPlace", { seed: dropped.dropId, intensity: 0.45, surface: "generic" });
    } catch {
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
    const nearby = realtimeDropsRef.current
      .filter((drop) => drop.expiresAt > now
        && drop.ownerPickupAt <= now)
      .map((drop) => ({ drop, distance: Math.hypot(drop.x - pose.x, drop.y - pose.y, drop.z - pose.z) }))
      .filter(({ distance }) => distance <= DROPPED_ITEM_PICKUP_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0]?.drop;
    if (!nearby) {
      droppedPickupAttractionRef.current = null;
      return;
    }
    const attraction = droppedPickupAttractionRef.current;
    if (!attraction || attraction.dropId !== nearby.dropId) {
      droppedPickupAttractionRef.current = { dropId: nearby.dropId, startedAt: now };
      return;
    }
    if (now - attraction.startedAt >= DROPPED_ITEM_ATTRACTION_MS
      && now - (droppedPickupAttemptRef.current.get(nearby.dropId) ?? 0) >= 350) {
      droppedPickupAttemptRef.current.set(nearby.dropId, now);
      void pickupNearbyDroppedItem(nearby);
    }
  }

  // Item attraction is time-based, not movement-based. A stationary player
  // standing over a newly-mined or Q-dropped item must be able to collect it
  // immediately after the server's universal delay without waiting for another
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
      ...pending.followups.map(({ edit, previousBlock }) => ({ ...edit, block: previousBlock })),
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
    try {
      if (placementItem && placementItem !== pending.expectedHeldItem) throw new Error("placement_item_mismatch");
      let confirmed: RealtimeWorldEdit;
      try {
        confirmed = await sink(pending.operationId, pending.optimisticEdit, {
          previousBlock: pending.previousBlock,
          selectedHotbar: pending.sourceSlot,
          expectedHeldItem: pending.expectedHeldItem,
          expectedInventoryRevision: inventoryRevisionRef.current,
        });
      } catch {
        // The first acknowledgement can be lost after Railway commits. Its
        // operation ledger makes this exact retry return the same block patch.
        confirmed = await sink(pending.operationId, pending.optimisticEdit, {
          previousBlock: pending.previousBlock,
          selectedHotbar: pending.sourceSlot,
          expectedHeldItem: pending.expectedHeldItem,
          expectedInventoryRevision: inventoryRevisionRef.current,
        });
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
        // Railway atomically resolves tool wear, the block revision, and one
        // persisted ground drop. A second client-authored drop would mint it.
      } else if (confirmed.block !== BLOCK.AIR) {
        if (placementItem && confirmed.block !== pending.optimisticEdit.block) throw new Error("placement_block_mismatch");
        audioRef.current?.play("blockPlace", { seed, surface: audioSurfaceForBlock(confirmed.block) });
      }
      releasePendingWorldBlockEdit(pending);
      const [next, ...remaining] = pending.followups;
      if (next) beginPendingWorldBlockEdit(next.edit, next.previousBlock, remaining);
    } catch {
      rollbackPendingWorldBlockEdit(
        pending,
        pending.optimisticEdit.block === BLOCK.AIR ? "Mine rejected" : "Placement restored",
        "The game server could not reserve that inventory item, so the local block was restored.",
        true,
      );
    }

  }

  function beginPendingWorldBlockEdit(
    edit: EngineWorldEdit,
    previousBlock: EngineBlockId,
    followups: PendingWorldBlockEdit["followups"],
  ): void {
    worldBlockOperationSequence += 1;
    const selectedHotbar = selectedRef.current;
    const pending: PendingWorldBlockEdit = {
      operationId: createWorldBlockOperationId(worldBlockOperationSequence),
      optimisticEdit: { ...edit },
      previousBlock,
      expectedHeldItem: inventoryRef.current[selectedHotbar]?.itemId ?? null,
      sourceSlot: selectedHotbar,
      followups,
    };
    pendingWorldBlockEditRef.current = pending;
    void submitPendingWorldBlockEdit(pending);
  }

  function handleBlockEdit(
    edit: EngineWorldEdit,
    previousBlock: EngineBlockId,
    journalEdits: readonly EngineWorldEdit[] = [],
  ) {
    if (pendingWorldBlockEditRef.current) {
      engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
      return;
    }
    const followups = isDoorBlock(previousBlock) && isDoorBlock(edit.block)
      ? journalEdits.flatMap((next) => {
        const previous = toggledDoorBlock(next.block);
        return previous !== null && isDoorBlock(previous) ? [{ edit: next, previousBlock: previous }] : [];
      })
      : [];
    beginPendingWorldBlockEdit(edit, previousBlock, followups);
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
    engineRef.current?.setPaused(multiplayerAuthorityPaused || !worldReady);
    engineRef.current?.setFirstPersonFeedbackHidden(multiplayerAuthorityPaused || !worldReady || !hudVisible);
  }, [multiplayerAuthorityPaused, worldReady, hudVisible]);

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
    initialWorldChunksReadyRef.current = false;
    revealWorldPresentationRef.current = null;
    setWorldReady(false);
  }, [realtimeSession?.endpoint]);


  useEffect(() => {
    if (!inWorld || !inventoryReady || !realtimeSession || !realtimeTerrain) return;
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
        initialEdits: [...authoritativeWorldEditRef.current.values()],
        preserveInitialPose: true,
        terrain: realtimeTerrain,
        worldRadius: WORLD_RADIUS,
        streamingChunkRadius: clientSettingsRef.current.renderDistance,
        canEditBlock: () => pendingWorldBlockEditRef.current === null,
        isRangedWeaponSelected: () => false,
        onUseSelectedItem: () => handleUseItem(),
        onRemotePlayerAttack: (target) => {
          realtimePlayerAttackSinkRef.current?.(`attack:${crypto.randomUUID()}`, target.id);
        },
        onMobAttack: (target) => {
          realtimeMobAttackSinkRef.current?.(`mob_attack:${crypto.randomUUID()}`, target.id);
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
          if (cause === "fall" || cause === "drowning" || cause === "lava") {
            realtimeSelfDamageSinkRef.current?.(`${cause}:${crypto.randomUUID()}`, amount, cause);
            return false;
          }
        },
        onBreathChange: (air) => setPlayerAir(air),
        onPlayerHealthChange: (health) => {
          playerHealthRef.current = health;
          setPlayerHealth(health);
        },
        onBlockEdit: (edit, previousBlock, journalEdits) => {
          handleBlockEdit(edit, previousBlock, journalEdits);
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
      }), {...presentationOptions, worldContinuesWhilePaused: true});
      engineRef.current = engine;
      const revealWorldPresentation = () => {
        void engine.waitForWorldPresentation().then((presented) => {
          if (!presented || engineRef.current !== engine || !initialWorldChunksReadyRef.current) return;
          setWorldReady(true);
          if (entryPointerLockHandoffRef.current && document.pointerLockElement === document.documentElement) {
            entryPointerLockHandoffRef.current = false;
            void engine.requestPointerLock();
          }
        });
      };
      revealWorldPresentationRef.current = revealWorldPresentation;
      engine.setDroppedItems(realtimeDropsRef.current);
      engine.setPlayerHealth(playerHealthRef.current);
      void selectedSkin().then((skin) => {
        if (engineRef.current === engine) engine.setPlayerSkin(skin.source, skin.model);
      });
      engine.setPaused(true);
      engine.setFirstPersonFeedbackHidden(true);
      if (respawnPointRef.current) engine.setRespawnPoint(respawnPointRef.current);
      engine.start();
      if (initialWorldChunksReadyRef.current) revealWorldPresentation();
      return () => {
        respawnRequestInFlightRef.current = false;
        if (revealWorldPresentationRef.current === revealWorldPresentation) {
          revealWorldPresentationRef.current = null;
        }
        engine.destroy();
        engineRef.current = null;
        setWorldReady(false);
        releaseGameplayKeyboardCapture();
      };
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : "Unable to start the WebGL world.");
    }
  }, [inWorld, inventoryReady, realtimeTerrain?.preset, realtimeTerrain?.superflatGroundY, realtimeTerrain?.generatorVersion]);

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
      const action = gameplayControlActionForCode(clientSettingsRef.current.keyBindings, event.code);
      const globalGameplayShortcutAllowed = !optionsOpen && !pauseOpen && !chatOpen && !inventoryOpen;
      if (globalGameplayShortcutAllowed) {
        if (handleGameplayScreenshotKey(event, engineRef.current, notify, clientSettingsRef.current.keyBindings.screenshot)) return;
        if (action === "debug" && !event.repeat) {
          event.preventDefault();
          setDebugOverlayVisible((visible) => !visible);
          return;
        }
        if (action === "fullscreen" && !event.repeat && toggleGameplayFullscreen()) {
          event.preventDefault();
          return;
        }
        if (action === "toggleHud" && !event.repeat) {
          event.preventDefault(); setHudVisible((visible) => !visible); return;
        }
        if (action === "playerList") {
          event.preventDefault();
          if (!event.repeat) setShowPlayerList(true);
          return;
        }
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
        if (event.code === "Escape" || action === "inventory") {
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
      if (action === "drop" && !event.repeat) {
        event.preventDefault();
        if (inventoryOpen) return;
        void handleDropSelected(event.ctrlKey || event.metaKey);
        return;
      }
      const chatShortcutDraft = gameplayChatShortcutDraft(event, clientSettingsRef.current.keyBindings);
      if (chatShortcutDraft !== null && !inventoryOpen) {
        event.preventDefault();
        exitPointerLockForUi();
        setChatDraft(chatShortcutDraft);
        setChatOpen(true);
        setLastSeenChatSequence(latestRealtimeChatSequence);
        setChatError("");
        return;
      }
      if (action === "inventory" && !event.repeat) {
        event.preventDefault();
        if (!hydratedRef.current) return;
        activeWorkstationRef.current = null;
        setCraftingContext("field");
        exitPointerLockForUi();
        setInventoryOpen(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === clientSettingsRef.current.keyBindings.playerList) setShowPlayerList(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [inWorld, optionsOpen, pauseOpen, chatOpen, inventoryOpen, latestRealtimeChatSequence]);

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
    const invitationToken = enteredToken.length >= 8
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
    const accessMode=selected?serverStatuses[selected.endpoint]?.accessMode:"token";
    const openDirect=accessMode==="public"||accessMode==="whitelist"||accessMode==="closed";
    if (!selected || (!registered && !openDirect && (!demoToken || (accessMode!=="password"&&demoToken.length<16)))) {
      setJoinPhase("error");
      setJoinError(accessMode==="password"?"Enter this server's password in Direct Connect before joining.":"This server still requires its private invitation token.");
      return;
    }
    entryPointerLockHandoffRef.current = requestDocumentPointerLockHandoff();
    requestGameplayKeyboardCapture();
    setJoinError("");
    setJoinPhase("joining");
    setRealtimeTerrain(null);
    void flushInventoryActions().then(async () => {
      let session: RealtimeSession;
      if (!registered) {
        session = {
          serverId: selected.id,
          endpoint: selected.endpoint,
          ...(accessMode==="password"?{password:demoToken}:{}),
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
    setLastSeenChatSequence(latestRealtimeChatSequence);
    void sink(value).catch(() => setChatError("Chat is reconnecting to this server."));
  }

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
    tone: message.userId === "server" ? "system" : undefined,
    delivery: message.delivery,
  }));
  const unreadChat = chatOpen ? 0 : countUnreadRealtimeChat(realtimeChatMessages, lastSeenChatSequence);
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
        onBack={onBack}
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
        onSettingsChange={updateClientSettings}
        onSignInWithGoogle={() => {
          setUsernameError("");
          void signInWithGoogle({
            callbackPath: AUTH_CALLBACK_PATH,
            returnTo: multiplayerUrl(window.location.href),
          }).catch(() => {
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
        visible: debugOverlayVisible && hudVisible,
      }}
      ready={worldReady}
      rootClassName="lakecraft-shell"
      rootStyle={APP_CSS}
    >
      {realtimeSession ? (
        <RealtimeMultiplayerTransport
          endpoint={realtimeSession.endpoint}
          ticket={realtimeSession.ticket}
          password={realtimeSession.password}
          serverId={realtimeSession.serverId}
          demo={realtimeSession.demo}
          localUserId={realtimeSession.demo?.userId ?? auth.userId ?? ""}
          localUsername={realtimeSession.demo?.name ?? profile?.username ?? "Player"}
          getPose={() => engineRef.current?.getPose() ?? poseRef.current}
          getRenderDistance={() => clientSettingsRef.current.renderDistance}
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
            if (phase !== "online") {
              initialWorldChunksReadyRef.current = false;
              setWorldReady(false);
            }
            if (phase === "error" && detail) notify("Server connection rejected", detail, "warning");
          }}
          onReconcilePose={(pose) => {
            poseRef.current = pose;
            engineRef.current?.reconcilePose(pose);
          }}
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
          onWorldChunk={(chunkX, chunkZ, edits) => {
            for (const [key, edit] of authoritativeWorldEditRef.current) {
              if (Math.floor(edit.x / 8) === chunkX && Math.floor(edit.z / 8) === chunkZ) {
                authoritativeWorldEditRef.current.delete(key);
              }
            }
            for (const edit of edits) {
              authoritativeWorldEditRef.current.set(blockCoordinateKey(edit.x, edit.y, edit.z), edit);
            }
            engineRef.current?.replaceWorldChunkEdits(chunkX, chunkZ, edits);
          }}
          onWorldChunksReady={() => {
            initialWorldChunksReadyRef.current = true;
            revealWorldPresentationRef.current?.();
          }}
          onWorldChunksUnload={(chunks) => {
            const removed = new Set(chunks.map((chunk) => `${chunk.x},${chunk.z}`));
            for (const [key, edit] of authoritativeWorldEditRef.current) {
              if (removed.has(`${Math.floor(edit.x / 8)},${Math.floor(edit.z / 8)}`)) {
                authoritativeWorldEditRef.current.delete(key);
              }
            }
            for (const chunk of chunks) engineRef.current?.replaceWorldChunkEdits(chunk.x, chunk.z, []);
          }}
          onChatEvent={(event) => setRealtimeChatMessages((messages) => applyRealtimeChatEvent(messages, event))}
          onGameMode={(gameMode) => {
            if (realtimeGameModeRef.current === gameMode) return;
            realtimeGameModeRef.current = gameMode;
            setRealtimeGameMode(gameMode);
            advanceInventoryAuthorityEpoch();
          }}
          onTerrain={(terrain) => setRealtimeTerrain((current) => current
            && current.preset === terrain.preset
            && current.superflatGroundY === terrain.superflatGroundY
            && current.generatorVersion === terrain.generatorVersion ? current : terrain)}
          onWorldSettings={(settings) => {
            engineRef.current?.setDayNightClock({epochMs:Date.now(),epochPhase:settings.dayPhase});
            engineRef.current?.setDaylightCycle(settings.daylightCycle);
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
          onMobSnapshot={(poses, states, serverNow) => {
            const offset = serverNow - Date.now();
            engineRef.current?.applyMobMotionSnapshot(poses, offset);
            engineRef.current?.applyMobCombatStates(states, offset);
          }}
          onMobHit={(hit) => {
            engineRef.current?.applyMobCombatStates([hit.state]);
            const localUserId = realtimeSession.demo?.userId ?? auth.userId ?? "";
            if (hit.attackerId !== localUserId) return;
            if (!hit.killed) {
              engineRef.current?.applyConfirmedPlayerHitMobKnockback(
                hit.operationId,
                hit.state.mobId,
                poseRef.current.x,
                poseRef.current.z,
                hit.damage,
              );
            }
            audioRef.current?.play(hit.killed ? "mobDeath" : "mobHurt", {
              seed: hit.operationId,
              mob: hit.state.kind,
              intensity: 0.8,
            });
          }}
          registerBlockSink={(sink) => { realtimeBlockSinkRef.current = sink; }}
          registerChatSink={(sink) => { realtimeChatSinkRef.current = sink; }}
          registerActionSink={(sink) => { motionActionSinkRef.current = sink; }}
          registerDropSink={(sink) => { realtimeDropSinkRef.current = sink; }}
          registerPickupSink={(sink) => { realtimePickupSinkRef.current = sink; }}
          registerRespawnSink={(sink) => { realtimeRespawnSinkRef.current = sink; }}
          registerPlayerAttackSink={(sink) => { realtimePlayerAttackSinkRef.current = sink; }}
          registerMobAttackSink={(sink) => { realtimeMobAttackSinkRef.current = sink; }}
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
        air={playerAir}
        hudVisible={hudVisible}
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
          setRealtimeTerrain(null);
          setSegmentRemotePlayers([]);
        }}
        onInventoryWorkspaceChange={handleInventoryWorkspaceChange}
        onInventoryWorkspacePreview={(snapshot) => {
          updateInventory(snapshot.inventory);
          updateEquipment(snapshot.equipment);
        }}
        onCloseOptions={() => setOptionsOpen(false)}
        onOptions={() => setOptionsOpen(true)}
        optionsOpen={optionsOpen}
        settings={clientSettings}
        onSettingsChange={updateClientSettings}
        onRespawn={requestRailwayRespawn}
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
          setRealtimeTerrain(null);
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

      {hudVisible || chatOpen ? <ChatOverlay
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
          setLastSeenChatSequence(latestRealtimeChatSequence);
          setChatError("");
        }}
        onSubmit={handleChatSubmit}
        open={chatOpen}
        sending={false}
        unreadCount={unreadChat}
      /> : null}

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </GameplaySessionSurface>
  );
}

function LakebedMultiplayerApp({ onBack }: { onBack: () => void }) {
  const [inWorld, setInWorld] = useState(false);
  return <RailwayMultiplayerSession inWorld={inWorld} setInWorld={setInWorld} onBack={onBack} />;
}

function LakecraftTitleScreen({ onJoinSingleplayer, onJoinMultiplayer }: {
  onJoinSingleplayer: () => void;
  onJoinMultiplayer: () => void;
}) {
  const [settings, setSettings] = useState(() => loadClientSettings(window.localStorage));

  function updateSettings(next: ClientSettings): void {
    const normalized = normalizeClientSettings(next);
    setSettings(normalized);
    saveClientSettings(window.localStorage, normalized);
  }

  return <TitleScreen
    onJoinMultiplayer={onJoinMultiplayer}
    onJoinSingleplayer={onJoinSingleplayer}
    onSettingsChange={updateSettings}
    settings={settings}
  />;
}

function currentAppRoute(): LakecraftAppRoute {
  return appRouteForLocation(window.location.hostname, window.location.pathname, window.location.search);
}

export function App() {
  const [route, setRoute] = useState<LakecraftAppRoute>(currentAppRoute);

  useEffect(() => {
    const syncRoute = () => setRoute(currentAppRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  function joinSingleplayer(): void {
    const url = new URL(titleUrl(window.location.href));
    url.searchParams.set("singleplayer", "1");
    window.history.replaceState(window.history.state, "", url);
    setRoute("singleplayer");
  }

  function joinMultiplayer(): void {
    const previousState = window.history.state;
    const state = previousState && typeof previousState === "object" ? previousState : {};
    window.history.pushState({ ...state, lakecraftMultiplayerEntry: true }, "", multiplayerUrl(window.location.href));
    setRoute("multiplayer");
  }

  function leaveSingleplayer(): void {
    window.history.replaceState(window.history.state, "", singlePlayerTitleUrl(window.location.href));
    setRoute("title");
  }

  function leaveMultiplayer(): void {
    if (window.history.state?.lakecraftMultiplayerEntry === true) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", titleUrl(window.location.href));
    setRoute("title");
  }

  if (route === "singleplayer") return <SinglePlayerApp onExit={leaveSingleplayer} />;
  if (route === "auth_callback") return <LakebedMultiplayerApp onBack={leaveMultiplayer} />;
  if (route === "multiplayer") return <LakebedMultiplayerApp onBack={leaveMultiplayer} />;
  return <LakecraftTitleScreen onJoinMultiplayer={joinMultiplayer} onJoinSingleplayer={joinSingleplayer} />;
}
