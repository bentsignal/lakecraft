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

export type GameHudProps = {
  inventory: Inventory;
  equipment: Equipment;
  selectedIndex: number;
  inventoryOpen: boolean;
  modalOpen?: boolean;
  craftingContext: CraftingContext;
  messages?: readonly HudMessage[];
  health?: number;
  maxHealth?: number;
  hunger?: number;
  maxHunger?: number;
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
  onCrafted: (recipe: Recipe, craftedCount: number) => void;
  onCloseInventory: () => void;
  onResume?: () => void;
  onOptions?: () => void;
  optionsOpen?: boolean;
  mouseSensitivity?: number;
  onSensitivityChange?: (value: number) => void;
  onCloseOptions?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
  onSave?: () => void;
  saveStatusText?: string;
  lastSavedText?: string;
  saveDisabled?: boolean;
  saveInProgress?: boolean;
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
  craftingContext,
  messages = [],
  health = 20,
  maxHealth = 20,
  hunger = 20,
  maxHunger = 20,
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
  onCrafted,
  onCloseInventory,
  onResume,
  onOptions,
  optionsOpen = false,
  mouseSensitivity = 100,
  onSensitivityChange,
  onCloseOptions,
  soundMuted = false,
  onToggleSound,
  onSave,
  saveStatusText,
  lastSavedText,
  saveDisabled = false,
  saveInProgress = false,
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
      <div className="lc-hud">
        {!deathScreenOpen && !pauseOpen && !inventoryOpen && !modalOpen ? <Crosshair /> : null}
        {!deathScreenOpen && !inventoryOpen && !modalOpen && !pauseOpen ? (
          <div className="lc-survival-wrap">
            <SurvivalHud armor={armor} health={health} hunger={hunger} maxHealth={maxHealth} maxHunger={maxHunger} />
            <Hotbar inventory={inventory} selectedIndex={selectedIndex} onSelect={onSelectHotbar} />
          </div>
        ) : null}
        <PlayerList players={players} visible={showPlayerList && !pauseOpen && !modalOpen && !deathScreenOpen} />
        {!deathScreenOpen ? <ToastSurface messages={messages} onDismiss={onDismissMessage} /> : null}
      </div>
      <PauseMenu
        onBack={onResume}
        onDisconnect={onDisconnect}
        onOptions={onOptions}
        onResetWorld={onResetWorld}
        onSave={onSave}
        disconnectLabel={disconnectLabel}
        lastSavedText={lastSavedText}
        open={pauseOpen && !optionsOpen && !deathScreenOpen}
        saveDisabled={saveDisabled}
        saveInProgress={saveInProgress}
        saveStatusText={saveStatusText}
        title={pauseTitle}
      />
      {onCloseOptions && onSensitivityChange && onToggleSound ? (
        <OptionsDialog
          mouseSensitivity={mouseSensitivity}
          onBack={onCloseOptions}
          onSensitivityChange={onSensitivityChange}
          onToggleSound={onToggleSound}
          open={optionsOpen && pauseOpen && !deathScreenOpen}
          returnFocusId="lc-game-menu-options"
          soundMuted={soundMuted}
        />
      ) : null}
      <DeathScreen cause={deathCause} onRespawn={onRespawn} onTitleScreen={onTitleScreen} open={deathScreenOpen} respawnError={respawnError} respawning={respawning} respawnStatus={respawnStatus} score={deathScore} />
      <InventoryCraftingDrawer authorityEpoch={inventoryAuthorityEpoch} craftingContext={craftingContext} equipment={equipment} inventory={inventory} onClose={onCloseInventory} onCrafted={onCrafted} onWorkspaceChange={onInventoryWorkspaceChange} onWorkspacePreview={onInventoryWorkspacePreview} open={inventoryOpen && !deathScreenOpen} recipes={availableRecipes(craftingContext)} selectedIndex={selectedIndex} />
      <MobileUnsupportedOverlay visible={mobileUnsupported} onContinue={onContinueMobile} />
    </>
  );
}
