import {
  availableRecipes,
  equippedArmorProtection,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type Recipe,
} from "../../shared/game";
import type { StowedInventorySnapshot } from "../../shared/inventoryWorkspace";
import type { InventoryRecipeBatch } from "../../shared/inventoryActions";
import { Hotbar } from "./Hotbar";
import { HudStyles } from "./HudStyles";
import { DeathScreen } from "./DeathScreen";
import { InventoryCraftingDrawer } from "./InventoryDrawer";
import { ItemTooltip } from "./ItemTooltip";
import { MobileUnsupportedOverlay } from "./MobileUnsupportedOverlay";
import { OptionsDialog } from "./OptionsDialog";
import { PauseMenu } from "./PauseMenu";
import { PlayerList, type PlayerListEntry } from "./PlayerList";
import { SurvivalHud } from "./StatusStrip";
import { ToastSurface, type HudMessage } from "./ToastSurface";
import type { GameplayControlBindings } from "../gameplay/controlBindings.ts";

export type GameHudProps = {
  inventory: Inventory;
  equipment: Equipment;
  selectedIndex: number;
  inventoryOpen: boolean;
  modalOpen?: boolean;
  hudVisible?: boolean;
  craftingContext: CraftingContext;
  messages?: readonly HudMessage[];
  health?: number;
  maxHealth?: number;
  hunger?: number;
  maxHunger?: number;
  showSurvivalStatus?: boolean;
  mobileUnsupported?: boolean;
  pauseOpen?: boolean;
  deathScreenOpen?: boolean;
  deathCause?: string;
  deathScore?: number;
  respawning?: boolean;
  respawnStatus?: string;
  respawnError?: string;
  showPlayerList?: boolean;
  players?: readonly PlayerListEntry[];
  onSelectHotbar: (index: number) => void;
  inventoryAuthorityEpoch: number;
  onInventoryWorkspaceChange: (
    snapshot: StowedInventorySnapshot,
    expectedAuthorityEpoch: number,
    recipes: readonly InventoryRecipeBatch[],
  ) => boolean;
  onInventoryWorkspacePreview?: (snapshot: StowedInventorySnapshot) => void;
  creativeInventory?: boolean;
  onCrafted: (recipe: Recipe, craftedCount: number) => void;
  onCloseInventory: (keyboardCode?: "Escape" | "KeyE") => void;
  onResume?: () => void;
  onOptions?: () => void;
  optionsOpen?: boolean;
  mouseSensitivity?: number;
  onSensitivityChange?: (value: number) => void;
  fovDegrees?: number;
  onFovChange?: (value: number) => void;
  renderDistance?: number;
  onRenderDistanceChange?: (value: number) => void;
  onCloseOptions?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
  masterVolume?: number;
  musicVolume?: number;
  blocksVolume?: number;
  hostileVolume?: number;
  passiveVolume?: number;
  playersVolume?: number;
  uiVolume?: number;
  onVolumeChange?: (category: "masterVolume" | "musicVolume" | "blocksVolume" | "hostileVolume" | "passiveVolume" | "playersVolume" | "uiVolume", value: number) => void;
  keyBindings?: GameplayControlBindings;
  onKeyBindingsChange?: (bindings: GameplayControlBindings) => void;
  autosaveStatusText?: string;
  lastAutosavedText?: string;
  disconnectDisabled?: boolean;
  onResetWorld?: () => void;
  onDisconnect?: () => void;
  pauseTitle?: string;
  disconnectLabel?: string;
  onRespawn?: () => void;
  onTitleScreen?: () => void;
  onDismissMessage?: (id: string) => void;
  onContinueMobile?: () => void;
  /** Backward-compatible world metadata; normal gameplay deliberately does not render it. */
  connected?: boolean;
  latencyMs?: number | null;
  onlineCount?: number;
  playerName?: string;
  roomCode?: string;
  worldName?: string;
  showControls?: boolean;
  onDismissControls?: () => void;
};

export function Crosshair() {
  return <span className="lc-crosshair" aria-hidden="true" />;
}

export function GameHud({
  inventory,
  equipment,
  selectedIndex,
  inventoryOpen,
  modalOpen = false,
  hudVisible = true,
  craftingContext,
  messages = [],
  health = 20,
  maxHealth = 20,
  hunger = 20,
  maxHunger = 20,
  showSurvivalStatus = true,
  mobileUnsupported = false,
  pauseOpen = false,
  deathScreenOpen = false,
  deathCause,
  deathScore = 0,
  respawning = false,
  respawnStatus,
  respawnError,
  showPlayerList = false,
  players = [],
  onSelectHotbar,
  inventoryAuthorityEpoch,
  onInventoryWorkspaceChange,
  onInventoryWorkspacePreview,
  creativeInventory = false,
  onCrafted,
  onCloseInventory,
  onResume,
  onOptions,
  optionsOpen = false,
  mouseSensitivity = 100,
  onSensitivityChange,
  fovDegrees = 90,
  onFovChange,
  renderDistance,
  onRenderDistanceChange,
  onCloseOptions,
  soundMuted = false,
  onToggleSound,
  masterVolume = 100,
  musicVolume = 100,
  blocksVolume = 100,
  hostileVolume = 100,
  passiveVolume = 100,
  playersVolume = 100,
  uiVolume = 100,
  onVolumeChange,
  keyBindings,
  onKeyBindingsChange,
  autosaveStatusText,
  lastAutosavedText,
  disconnectDisabled = false,
  onResetWorld,
  onDisconnect,
  pauseTitle,
  disconnectLabel,
  onRespawn,
  onTitleScreen,
  onDismissMessage,
  onContinueMobile,
}: GameHudProps) {
  const armor = equippedArmorProtection(equipment);
  return (
    <>
      <HudStyles />
      <ItemTooltip />
      {hudVisible ? <div className="lc-hud">
        {!deathScreenOpen && !pauseOpen && !inventoryOpen && !modalOpen ? <Crosshair /> : null}
        {!deathScreenOpen && !inventoryOpen && !modalOpen && !pauseOpen ? (
          <div className="lc-survival-wrap">
            {showSurvivalStatus ? <SurvivalHud armor={armor} health={health} hunger={hunger} maxHealth={maxHealth} maxHunger={maxHunger} /> : null}
            <Hotbar inventory={inventory} selectedIndex={selectedIndex} onSelect={onSelectHotbar} />
          </div>
        ) : null}
        <PlayerList players={players} visible={showPlayerList && !pauseOpen && !modalOpen && !deathScreenOpen} />
        {!deathScreenOpen ? <ToastSurface messages={messages} onDismiss={onDismissMessage} /> : null}
      </div> : null}
      <PauseMenu
        autosaveStatusText={autosaveStatusText}
        disconnectDisabled={disconnectDisabled}
        onBack={onResume}
        onDisconnect={onDisconnect}
        onOptions={onOptions}
        onResetWorld={onResetWorld}
        disconnectLabel={disconnectLabel}
        lastAutosavedText={lastAutosavedText}
        open={pauseOpen && !optionsOpen && !deathScreenOpen}
        title={pauseTitle}
      />
      {onCloseOptions && onSensitivityChange && onFovChange && onToggleSound && onVolumeChange && keyBindings && onKeyBindingsChange ? (
        <OptionsDialog
          blocksVolume={blocksVolume}
          fovDegrees={fovDegrees}
          mouseSensitivity={mouseSensitivity}
          hostileVolume={hostileVolume}
          keyBindings={keyBindings}
          masterVolume={masterVolume}
          musicVolume={musicVolume}
          onBack={onCloseOptions}
          onFovChange={onFovChange}
          onSensitivityChange={onSensitivityChange}
          onRenderDistanceChange={onRenderDistanceChange}
          onToggleSound={onToggleSound}
          onKeyBindingsChange={onKeyBindingsChange}
          onVolumeChange={onVolumeChange}
          open={optionsOpen && pauseOpen && !deathScreenOpen}
          returnFocusId="lc-game-menu-options"
          soundMuted={soundMuted}
          passiveVolume={passiveVolume}
          playersVolume={playersVolume}
          uiVolume={uiVolume}
          renderDistance={renderDistance}
        />
      ) : null}
      <DeathScreen cause={deathCause} onRespawn={onRespawn} onTitleScreen={onTitleScreen} open={deathScreenOpen} respawnError={respawnError} respawning={respawning} respawnStatus={respawnStatus} score={deathScore} />
      <InventoryCraftingDrawer authorityEpoch={inventoryAuthorityEpoch} closeKeyCode={keyBindings?.inventory} craftingContext={craftingContext} creative={creativeInventory} equipment={equipment} inventory={inventory} onClose={onCloseInventory} onCrafted={onCrafted} onWorkspaceChange={onInventoryWorkspaceChange} onWorkspacePreview={onInventoryWorkspacePreview} open={inventoryOpen && !deathScreenOpen} recipes={availableRecipes(craftingContext)} selectedIndex={selectedIndex} />
      <MobileUnsupportedOverlay visible={mobileUnsupported} onContinue={onContinueMobile} />
    </>
  );
}
