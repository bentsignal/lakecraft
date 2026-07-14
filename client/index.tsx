import { signInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChatOverlay, type LakecraftChatMessage } from "./chat";
import { GameHud, type HudMessage } from "./components";
import {
  BLOCK,
  createVoxelEngine,
  type BlockId as EngineBlockId,
  type BlockTarget,
  type PlayerPose,
  type RemotePlayer,
  type VoxelEngine,
  type VoxelPerformanceStats,
  type WorldEdit as EngineWorldEdit,
} from "./game";
import { LobbyScreen, type LobbyJoinPhase, type UsernameClaimState } from "./lobby";
import {
  ITEMS,
  addItem,
  clampHotbarIndex,
  craftRecipe,
  createEmptyEquipment,
  createSerializablePlayerState,
  createStarterInventory,
  equipArmorFromInventory,
  getMiningDrop,
  miningSeconds,
  normalizeEquipment,
  normalizeInventory,
  removeItem,
  unequipArmor,
  type ArmorSlot,
  type BlockId,
  type Equipment,
  type Inventory,
  type ItemId,
  type Recipe,
} from "../shared/game";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatMessage,
  type ClaimUsernameResult,
  type Profile,
  type SendChatResult,
} from "../shared/multiplayer";
import {
  activePlayerPresences,
  blockCoordinateKey,
  latestWorldEdits,
  type PersistedInventory,
  type PlayerPresence,
  type WorldEdit,
} from "../shared/protocol";

const APP_CSS = `
html, body, #app { height: 100%; margin: 0; overflow: hidden; }
body { background: #171b15; }
button { -webkit-tap-highlight-color: transparent; }
.lakecraft-shell { background: #171b15; height: 100%; isolation: isolate; overflow: hidden; position: relative; width: 100%; }
.lakecraft-world { cursor: crosshair; display: block; height: 100%; outline: none; width: 100%; }
.lakecraft-vignette { background: radial-gradient(circle at center, transparent 52%, rgba(13,17,12,.18) 84%, rgba(9,12,9,.48)); inset: 0; pointer-events: none; position: absolute; z-index: 8; }
.lakecraft-entry { align-items: center; background: linear-gradient(115deg, rgba(15,18,14,.86), rgba(15,18,14,.3) 52%, rgba(15,18,14,.72)); display: flex; inset: 0; justify-content: center; padding: 24px; position: absolute; z-index: 35; }
.lakecraft-entry__card { background: rgba(226,216,189,.96); box-shadow: 12px 14px 0 rgba(94,112,61,.52), 0 30px 90px rgba(0,0,0,.48); color: #24261f; max-width: 430px; padding: 32px; position: relative; transform: rotate(-.45deg); }
.lakecraft-entry__card::before { background: #667541; content: ""; height: 7px; left: 0; position: absolute; right: 0; top: 0; }
.lakecraft-entry__eyebrow { color: #9a5434; font: 10px/1.2 "Courier New", monospace; letter-spacing: .14em; text-transform: uppercase; }
.lakecraft-entry h1 { font: 900 clamp(42px, 8vw, 70px)/.84 "Trebuchet MS", sans-serif; letter-spacing: -.075em; margin: 17px 0 19px; text-transform: uppercase; }
.lakecraft-entry p { font: 12px/1.65 "Courier New", monospace; margin: 0 0 23px; max-width: 38em; }
.lakecraft-entry button { align-items: center; background: #24261f; border: 0; color: #e6dcc1; cursor: pointer; display: flex; font: 800 12px "Trebuchet MS", sans-serif; justify-content: space-between; letter-spacing: .08em; padding: 15px 17px; text-transform: uppercase; width: 100%; }
.lakecraft-entry button:hover { background: #667541; }
.lakecraft-entry button:disabled { background: #777a6d; cursor: progress; opacity: .72; }
.lakecraft-entry small { color: rgba(36,38,31,.56); display: block; font: 9px "Courier New", monospace; margin-top: 13px; }
.lakecraft-error { background: #171a16; color: #e6dcc1; display: grid; inset: 0; padding: 40px; place-content: center; position: absolute; z-index: 120; }
.lakecraft-error strong { color: #d49a45; font: 700 16px "Courier New", monospace; }.lakecraft-error p { max-width: 560px; }
.lakecraft-perf { background: rgba(9,12,9,.88); border-left: 3px solid #91ae58; color: #dce7c4; font: 11px/1.45 "Courier New", monospace; left: 14px; padding: 9px 11px; pointer-events: none; position: absolute; top: 14px; white-space: pre; z-index: 70; }
@media (max-width: 700px) { .lakecraft-entry__card { padding: 27px 24px; }.lakecraft-entry h1 { font-size: 48px; } }
`;

const ENGINE_TO_PROTOCOL: Record<EngineBlockId, "air" | "grass" | "dirt" | "stone" | "wood" | "leaves" | "planks" | "crafting_table"> = {
  [BLOCK.AIR]: "air",
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.WOOD]: "wood",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks",
  [BLOCK.CRAFTING_TABLE]: "crafting_table",
};

const PROTOCOL_TO_ENGINE: Record<string, EngineBlockId> = {
  air: BLOCK.AIR,
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  wood: BLOCK.WOOD,
  log: BLOCK.WOOD,
  leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE,
};

const ENGINE_TO_GAME: Partial<Record<EngineBlockId, BlockId>> = {
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.WOOD]: "log",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks",
  [BLOCK.CRAFTING_TABLE]: "crafting_table",
};

const ITEM_TO_ENGINE: Partial<Record<ItemId, EngineBlockId>> = {
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  log: BLOCK.WOOD,
  leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE,
};

function playerColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  const red = 96 + ((hash >>> 0) & 95);
  const green = 104 + ((hash >>> 8) & 95);
  const blue = 88 + ((hash >>> 16) & 95);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function remoteColor(value: string): readonly [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const number = Number.parseInt(match[1], 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function toEngineEdits(events: WorldEdit[]): EngineWorldEdit[] {
  return latestWorldEdits(events).flatMap((event) => {
    const block = PROTOCOL_TO_ENGINE[event.blockType];
    const x = Number(event.x);
    const y = Number(event.y);
    const z = Number(event.z);
    return block == null || ![x, y, z].every(Number.isInteger) ? [] : [{ x, y, z, block }];
  });
}

function parsePlayerState(row: PersistedInventory | null): { inventory: Inventory; selectedHotbar: number; equipment: Equipment } | null {
  if (!row) return null;
  try {
    const value = JSON.parse(row.inventoryJson) as { inventory?: unknown; selectedHotbar?: unknown };
    return {
      inventory: normalizeInventory(value.inventory),
      selectedHotbar: clampHotbarIndex(typeof value.selectedHotbar === "number" ? value.selectedHotbar : 0),
      equipment: normalizeEquipment((value as { equipment?: unknown }).equipment),
    };
  } catch {
    return null;
  }
}

export function App() {
  const auth = useAuth();
  const worldEvents = useQuery<WorldEdit[]>("worldEdits") ?? [];
  const [activeSince] = useState(() => String(Date.now() - 30_000));
  const presenceEvents = useQuery<PlayerPresence[], string>("recentPlayers", activeSince) ?? [];
  const savedInventory = useQuery<PersistedInventory | null>("myInventory");
  const profile = useQuery<Profile | null>("myProfile");
  const chatEvents = useQuery<ChatMessage[]>("recentChat") ?? [];

  const setBlock = useMutation<[coordKey: string, x: string, y: string, z: string, blockType: string], void>("setBlock");
  const removeBlockMutation = useMutation<[coordKey: string, x: string, y: string, z: string], void>("removeBlock");
  const heartbeatPlayer = useMutation<[displayName: string, color: string, x: string, y: string, z: string, yaw: string, pitch: string, heartbeatAt: string], void>("heartbeatPlayer");
  const leavePlayer = useMutation<[heartbeatAt: string], void>("leavePlayer");
  const saveInventory = useMutation<[inventoryJson: string], void>("saveInventory");
  const claimUsername = useMutation<[requestedUsername: string], ClaimUsernameResult>("claimUsername");
  const sendChat = useMutation<[rawMessage: string], SendChatResult>("sendChat");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const poseRef = useRef<PlayerPose>({ x: 0.5, y: 8, z: 0.5, yaw: 0, pitch: 0 });
  const poseDirtyRef = useRef(true);
  const lastPresenceSentRef = useRef(0);
  const targetRef = useRef<BlockTarget | null>(null);
  const inventoryRef = useRef<Inventory>(createStarterInventory());
  const selectedRef = useRef(2);
  const hydratedRef = useRef(false);
  const hydratedUserRef = useRef("");
  const toastCounter = useRef(0);

  const [inventory, setInventory] = useState<Inventory>(() => createStarterInventory());
  const [equipment, setEquipment] = useState<Equipment>(() => createEmptyEquipment());
  const [selectedHotbar, setSelectedHotbar] = useState(2);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [mobileUnsupported, setMobileUnsupported] = useState(false);
  const [messages, setMessages] = useState<HudMessage[]>([]);
  const [engineError, setEngineError] = useState("");
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [inWorld, setInWorld] = useState(false);
  const [joinPhase, setJoinPhase] = useState<LobbyJoinPhase>("idle");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameClaimState>("idle");
  const [usernameError, setUsernameError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const [performanceStats, setPerformanceStats] = useState<VoxelPerformanceStats | null>(null);
  const [showPerformance, setShowPerformance] = useState(false);

  function notify(text: string, detail?: string, tone: HudMessage["tone"] = "info") {
    const id = `note-${++toastCounter.current}`;
    setMessages((current) => [...current.slice(-2), { id, text, detail, tone }]);
    window.setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), 3_500);
  }

  function updateInventory(next: Inventory) {
    inventoryRef.current = next;
    setInventory(next);
  }

  function handleBlockEdit(edit: EngineWorldEdit, previousBlock: EngineBlockId) {
    const key = blockCoordinateKey(edit.x, edit.y, edit.z);
    if (edit.block === BLOCK.AIR) {
      const gameBlock = ENGINE_TO_GAME[previousBlock];
      let droppedItem: ItemId | null = null;
      let droppedCount = 0;
      if (gameBlock) {
        const drop = getMiningDrop(gameBlock);
        if (drop) {
          const added = addItem(inventoryRef.current, drop.itemId, drop.count);
          droppedItem = drop.itemId;
          droppedCount = drop.count - added.remainder;
          updateInventory(added.inventory);
          notify(`Collected ${ITEMS[drop.itemId].label}`, added.remainder ? "Your pack is full." : "Added to the field kit.", added.remainder ? "warning" : "success");
        }
      }
      void removeBlockMutation(key, String(edit.x), String(edit.y), String(edit.z)).then(() => setConnected(true)).catch(() => {
        engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
        if (droppedItem && droppedCount) updateInventory(removeItem(inventoryRef.current, droppedItem, droppedCount).inventory);
        setConnected(false);
        notify("Mine rolled back", "Lakebed rejected the save, so the block and field kit were restored.", "warning");
      });
      return;
    }

    const selected = inventoryRef.current[selectedRef.current];
    const placedItem = selected && ITEM_TO_ENGINE[selected.itemId] === edit.block ? selected.itemId : null;
    if (placedItem) {
      updateInventory(removeItem(inventoryRef.current, selected.itemId, 1).inventory);
    }
    void setBlock(key, String(edit.x), String(edit.y), String(edit.z), ENGINE_TO_PROTOCOL[edit.block]).then(() => setConnected(true)).catch(() => {
      engineRef.current?.applyWorldEdits([{ ...edit, block: previousBlock }]);
      if (placedItem) updateInventory(addItem(inventoryRef.current, placedItem, 1).inventory);
      setConnected(false);
      notify("Placement rolled back", "Lakebed rejected the save, so the block and field kit were restored.", "warning");
    });
  }

  useEffect(() => {
    inventoryRef.current = inventory;
    selectedRef.current = selectedHotbar;
    const selected = inventory[selectedHotbar];
    engineRef.current?.setSelectedBlock(selected ? ITEM_TO_ENGINE[selected.itemId] ?? BLOCK.AIR : BLOCK.AIR);
  }, [inventory, selectedHotbar]);

  useEffect(() => {
    if (!auth.isAuthenticated || auth.isGuest || hydratedUserRef.current === auth.userId || savedInventory === undefined) return;
    if (savedInventory && savedInventory.userId !== auth.userId) return;
    hydratedRef.current = true;
    hydratedUserRef.current = auth.userId;
    const saved = parsePlayerState(savedInventory);
    if (saved) {
      updateInventory(saved.inventory);
      selectedRef.current = saved.selectedHotbar;
      setSelectedHotbar(saved.selectedHotbar);
      setEquipment(saved.equipment);
      notify("Field kit restored", "Lakebed recovered your last inventory.", "success");
    }
    setInventoryReady(true);
  }, [savedInventory, auth.userId, auth.isAuthenticated, auth.isGuest]);

  useEffect(() => {
    if (!hydratedRef.current || !auth.isAuthenticated || auth.isGuest) return;
    const timer = window.setTimeout(() => {
      const state = createSerializablePlayerState(inventory, selectedHotbar, equipment);
      void saveInventory(JSON.stringify(state)).then(() => setConnected(true)).catch(() => {
        setConnected(false);
        notify("Field kit save delayed", "Inventory will retry after your next change.", "warning");
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inventory, selectedHotbar, equipment, auth.isAuthenticated, auth.isGuest]);

  useEffect(() => {
    if (!inWorld || !inventoryReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const engine = createVoxelEngine(canvas, {
        worldRadius: 18,
        selectedBlock: ITEM_TO_ENGINE[inventoryRef.current[selectedRef.current]?.itemId ?? "stick"] ?? BLOCK.AIR,
        getMiningDuration: (block) => {
          const gameBlock = ENGINE_TO_GAME[block];
          const heldItem = inventoryRef.current[selectedRef.current]?.itemId;
          return gameBlock ? miningSeconds(gameBlock, heldItem) : 0.2;
        },
        onBlockEdit: handleBlockEdit,
        onPoseChange: (pose) => {
          poseRef.current = pose;
          poseDirtyRef.current = true;
        },
        onTargetChange: (target) => { targetRef.current = target; },
        onPointerLockChange: setPointerLocked,
        onPerformanceStats: setPerformanceStats,
      });
      engineRef.current = engine;
      engine.start();
      return () => {
        engine.destroy();
        engineRef.current = null;
      };
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : "Unable to start the WebGL world.");
    }
  }, [inWorld, inventoryReady]);

  useEffect(() => {
    engineRef.current?.applyWorldEdits(toEngineEdits(worldEvents));
  }, [worldEvents]);

  useEffect(() => {
    const active = activePlayerPresences(presenceEvents).filter((player) => player.userId !== auth.userId);
    const remotes: RemotePlayer[] = active.map((player) => ({
      id: player.userId,
      name: player.displayName,
      x: Number(player.x),
      y: Number(player.y),
      z: Number(player.z),
      yaw: Number(player.yaw),
      pitch: Number(player.pitch),
      color: remoteColor(player.color),
    })).filter((player) => [player.x, player.y, player.z, player.yaw, player.pitch].every(Number.isFinite));
    engineRef.current?.setRemotePlayers(remotes);
  }, [presenceEvents, auth.userId]);

  useEffect(() => {
    if (!inWorld || auth.isLoading || !auth.isAuthenticated || auth.isGuest || !profile) return;
    const sendHeartbeat = (force = false) => {
      const now = Date.now();
      if (!force && !poseDirtyRef.current && now - lastPresenceSentRef.current < 12_000) return;
      const pose = engineRef.current?.getPose() ?? poseRef.current;
      poseRef.current = pose;
      poseDirtyRef.current = false;
      lastPresenceSentRef.current = now;
      void heartbeatPlayer(profile.username, playerColor(auth.userId), String(pose.x), String(pose.y), String(pose.z), String(pose.yaw), String(pose.pitch), String(now)).then(() => setConnected(true)).catch(() => setConnected(false));
    };
    sendHeartbeat(true);
    const interval = window.setInterval(() => sendHeartbeat(), 2_000);
    return () => {
      window.clearInterval(interval);
      void leavePlayer(String(Date.now())).catch(() => undefined);
    };
  }, [inWorld, auth.userId, auth.isLoading, auth.isAuthenticated, auth.isGuest, profile?.username]);

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
      if (event.code === "F3" && !event.repeat) {
        event.preventDefault();
        setShowPerformance((shown) => !shown);
        return;
      }
      if (chatOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setChatOpen(false);
          setLastSeenChatCount(chatEvents.length);
        }
        return;
      }
      if ((event.code === "KeyT" || event.code === "Enter") && !event.repeat && !inventoryOpen) {
        event.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        setChatOpen(true);
        setLastSeenChatCount(chatEvents.length);
        setChatError("");
        return;
      }
      if (/^Digit[1-9]$/.test(event.code)) setSelectedHotbar(clampHotbarIndex(Number(event.code.slice(5)) - 1));
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        if (!hydratedRef.current) return;
        setInventoryOpen((open) => {
          if (!open && document.pointerLockElement) document.exitPointerLock();
          return !open;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inWorld, chatOpen, inventoryOpen, chatEvents.length]);

  const activePlayers = activePlayerPresences(presenceEvents);

  function handleCraft(recipe: Recipe) {
    if (!hydratedRef.current) return;
    const result = craftRecipe(inventoryRef.current, recipe);
    if (!result.ok) {
      notify("Recipe unavailable", result.reason === "inventory_full" ? "Make room in your pack first." : "Gather the marked ingredients.", "warning");
      return;
    }
    updateInventory(result.inventory);
    notify(`Made ${ITEMS[result.crafted.itemId].label}`, `Added ${result.crafted.count} to your field kit.`, "success");
  }

  function handleEquipArmor(index: number) {
    const equippedItem = inventory[index]?.itemId;
    const result = equipArmorFromInventory(inventory, equipment, index);
    if (!result.ok) return;
    updateInventory(result.inventory);
    setEquipment(result.equipment);
    notify("Armor equipped", equippedItem ? ITEMS[equippedItem].label : undefined, "success");
  }

  function handleUnequipArmor(slot: ArmorSlot) {
    const result = unequipArmor(inventory, equipment, slot);
    if (!result.ok) {
      if (result.reason === "inventory_full") notify("Pack is full", "Clear a pocket before removing armor.", "warning");
      return;
    }
    updateInventory(result.inventory);
    setEquipment(result.equipment);
  }

  function handleUsernameClaim(value: string) {
    setUsernameState("saving");
    setUsernameError("");
    void claimUsername(value).then((result) => {
      if (result.ok) {
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

  function enterWorld() {
    if (!profile) return;
    setJoinPhase("joining");
    window.setTimeout(() => {
      if (!hydratedRef.current) {
        setJoinPhase("waiting");
        return;
      }
      setJoinPhase("ready");
      window.setTimeout(() => {
        setInWorld(true);
        setJoinPhase("idle");
      }, 180);
    }, 260);
  }

  useEffect(() => {
    if (joinPhase !== "waiting" || !inventoryReady || !profile) return;
    setJoinPhase("ready");
    const timer = window.setTimeout(() => {
      setInWorld(true);
      setJoinPhase("idle");
    }, 180);
    return () => window.clearTimeout(timer);
  }, [joinPhase, inventoryReady, profile?.id]);

  useEffect(() => {
    if (inWorld && !auth.isLoading && (!auth.isAuthenticated || auth.isGuest)) {
      if (document.pointerLockElement) document.exitPointerLock();
      setInWorld(false);
      setChatOpen(false);
    }
  }, [inWorld, auth.isLoading, auth.isAuthenticated, auth.isGuest]);

  function handleChatSubmit(value: string) {
    setChatSending(true);
    setChatError("");
    void sendChat(value).then((result) => {
      if (result.ok) {
        setChatDraft("");
        setLastSeenChatCount(chatEvents.length + 1);
        return;
      }
      if (result.reason === "rate_limited") {
        setChatError(`Slow down — try again in ${Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 100) / 10)}s.`);
      } else if (result.reason === "too_long") {
        setChatError(`Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`);
      } else if (result.reason === "profile_required") {
        setChatError("Choose an explorer tag before chatting.");
      } else {
        setChatError("Lakebed could not send that message.");
      }
    }).catch(() => setChatError("Chat lost contact with Lakebed. Try again.")).finally(() => setChatSending(false));
  }

  const signedIn = auth.isAuthenticated && !auth.isGuest;
  const lobbyAuthState = auth.isLoading || (signedIn && profile === undefined)
    ? "loading"
    : !signedIn
      ? "signed_out"
      : profile
        ? "ready"
        : "needs_username";
  const chatMessages: LakecraftChatMessage[] = chatEvents.map((message) => ({
    id: message.id,
    username: message.username,
    body: message.message,
    sentAt: Number(message.sentAt),
    own: message.userId === auth.userId,
  }));
  const unreadChat = chatOpen ? 0 : Math.max(0, chatMessages.length - lastSeenChatCount);

  if (!inWorld) {
    return (
      <LobbyScreen
        authState={lobbyAuthState}
        buildLabel="MULTIPLAYER ALPHA"
        displayName={profile?.username ?? auth.displayName}
        email={auth.email}
        joinPhase={joinPhase}
        onlineCount={activePlayers.length}
        onJoinWorld={enterWorld}
        onSignInWithGoogle={() => {
          setUsernameError("");
          void signInWithGoogle().catch(() => {
            setUsernameState("error");
            setUsernameError("Google sign-in could not start. Please try again.");
          });
        }}
        onSignOut={() => {
          signOut();
          setUsernameDraft("");
          setUsernameState("idle");
          setInventoryReady(false);
          hydratedRef.current = false;
          hydratedUserRef.current = "";
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
        worldDescription="One persistent world, synchronized through Lakebed even though Lakebed was absolutely not designed for this."
        worldName="Fern Hollow"
        worldStatus="online"
      />
    );
  }

  return (
    <main className="lakecraft-shell">
      <style>{APP_CSS}</style>
      <canvas aria-label="Lakecraft voxel world" className="lakecraft-world" data-testid="voxel-world" ref={canvasRef} tabIndex={0} />
      <div className="lakecraft-vignette" />

      {!pointerLocked && !inventoryOpen && !chatOpen && !engineError ? (
        <section className="lakecraft-entry" aria-label="Enter Lakecraft">
          <div className="lakecraft-entry__card">
            <span className="lakecraft-entry__eyebrow">survey 01 / shared world online</span>
            <h1>Fern<br />Hollow</h1>
            <p>Walk the ridge, fell oak, quarry stone, and leave a shelter for the next wayfarer. Every block edit is shared through Lakebed.</p>
            <button data-testid="enter-world" disabled={!inventoryReady} onClick={() => engineRef.current?.requestPointerLock()} type="button"><span>{inventoryReady ? "Enter the world" : "Restoring field kit…"}</span><span>→</span></button>
            <small>{inventoryReady ? "WASD to move · mouse to look · E opens the field kit" : "Synchronizing this wayfarer with Lakebed"}</small>
          </div>
        </section>
      ) : null}

      <GameHud
        connected={connected}
        equipment={equipment}
        inventory={inventory}
        inventoryOpen={inventoryOpen}
        messages={messages}
        mobileUnsupported={mobileUnsupported}
        onlineCount={Math.max(1, activePlayers.length)}
        onCloseInventory={() => setInventoryOpen(false)}
        onContinueMobile={() => setMobileUnsupported(false)}
        onCraft={handleCraft}
        onDismissControls={() => setShowControls(false)}
        onDismissMessage={(id) => setMessages((current) => current.filter((message) => message.id !== id))}
        onEquipArmor={handleEquipArmor}
        onSelectHotbar={(index) => setSelectedHotbar(clampHotbarIndex(index))}
        onUnequipArmor={handleUnequipArmor}
        playerName={profile?.username ?? auth.displayName}
        roomCode="FERN-01"
        selectedIndex={selectedHotbar}
        showControls={showControls && !inventoryOpen && !chatOpen}
        worldName="Fern Hollow"
      />

      <ChatOverlay
        connected={connected}
        draft={chatDraft}
        error={chatError}
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        messages={chatMessages}
        onClose={() => {
          setChatOpen(false);
          setLastSeenChatCount(chatMessages.length);
        }}
        onDraftChange={setChatDraft}
        onOpen={() => {
          if (document.pointerLockElement) document.exitPointerLock();
          setChatOpen(true);
          setLastSeenChatCount(chatMessages.length);
          setChatError("");
        }}
        onSubmit={handleChatSubmit}
        open={chatOpen}
        sending={chatSending}
        unreadCount={unreadChat}
      />

      {showPerformance && performanceStats ? (
        <output className="lakecraft-perf" aria-label="Performance statistics">{`FPS ${performanceStats.fps.toFixed(0)}  p95 ${performanceStats.p95FrameTimeMs.toFixed(1)}ms\nDRAW ${performanceStats.drawCalls}  CHUNKS ${performanceStats.visibleChunkCount}/${performanceStats.chunkCount}\nVERT ${performanceStats.worldVertexCount.toLocaleString()}  MESH ${performanceStats.lastMeshRebuildMs.toFixed(1)}ms`}</output>
      ) : null}

      {engineError ? <section className="lakecraft-error" role="alert"><strong>WEBGL FIELD ERROR</strong><p>{engineError}</p></section> : null}
    </main>
  );
}
