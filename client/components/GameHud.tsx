import {
  availableRecipes,
  equippedArmorProtection,
  type ArmorSlot,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type Recipe,
} from "../../shared/game";
import { Hotbar } from "./Hotbar";
import { HudStyles } from "./HudStyles";
import { FirstPersonHeldItem } from "./FirstPersonHeldItem";
import { InventoryCraftingDrawer } from "./InventoryDrawer";
import { MobileUnsupportedOverlay } from "./MobileUnsupportedOverlay";
import { PauseMenu } from "./PauseMenu";
import { PlayerList, type PlayerListEntry } from "./PlayerList";
import { SurvivalHud } from "./StatusStrip";
import { ToastSurface, type HudMessage } from "./ToastSurface";

export type GameHudProps = {
  inventory: Inventory;
  equipment: Equipment;
  selectedIndex: number;
  inventoryOpen: boolean;
  craftingContext: CraftingContext;
  messages?: readonly HudMessage[];
  health?: number;
  maxHealth?: number;
  hunger?: number;
  maxHunger?: number;
  miningProgress?: number;
  handActionToken?: number;
  hideFirstPersonFeedback?: boolean;
  mobileUnsupported?: boolean;
  pauseOpen?: boolean;
  showPlayerList?: boolean;
  players?: readonly PlayerListEntry[];
  onSelectHotbar: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
  onEquipArmor: (inventoryIndex: number) => void;
  onUnequipArmor: (slot: ArmorSlot) => void;
  onUseItem?: (inventoryIndex: number) => void;
  onCloseInventory: () => void;
  onResume?: () => void;
  onOptions?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
  onDisconnect?: () => void;
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
  craftingContext,
  messages = [],
  health = 20,
  maxHealth = 20,
  hunger = 20,
  maxHunger = 20,
  miningProgress = 0,
  handActionToken = 0,
  hideFirstPersonFeedback = false,
  mobileUnsupported = false,
  pauseOpen = false,
  showPlayerList = false,
  players = [],
  onSelectHotbar,
  onCraft,
  onEquipArmor,
  onUnequipArmor,
  onUseItem,
  onCloseInventory,
  onResume,
  onOptions,
  soundMuted = false,
  onToggleSound,
  onDisconnect,
  onDismissMessage,
  onContinueMobile,
}: GameHudProps) {
  const armor = equippedArmorProtection(equipment);
  return (
    <>
      <HudStyles />
      <div className="lc-hud">
        <FirstPersonHeldItem
          actionToken={handActionToken}
          hidden={hideFirstPersonFeedback || inventoryOpen || mobileUnsupported}
          miningProgress={miningProgress}
          paused={pauseOpen}
          stack={inventory[selectedIndex] ?? null}
        />
        {!pauseOpen && !inventoryOpen ? <Crosshair /> : null}
        <div className="lc-survival-wrap">
          <SurvivalHud armor={armor} health={health} hunger={hunger} maxHealth={maxHealth} maxHunger={maxHunger} />
          <Hotbar disabled={pauseOpen} inventory={inventory} selectedIndex={selectedIndex} onSelect={onSelectHotbar} />
        </div>
        <PlayerList players={players} visible={showPlayerList && !pauseOpen} />
        <ToastSurface messages={messages} onDismiss={onDismissMessage} />
      </div>
      <PauseMenu
        onBack={onResume}
        onDisconnect={onDisconnect}
        onOptions={onOptions}
        onToggleSound={onToggleSound}
        open={pauseOpen}
        soundMuted={soundMuted}
      />
      <InventoryCraftingDrawer craftingContext={craftingContext} equipment={equipment} inventory={inventory} onClose={onCloseInventory} onCraft={onCraft} onEquipArmor={onEquipArmor} onSelectSlot={onSelectHotbar} onUnequipArmor={onUnequipArmor} onUseItem={onUseItem} open={inventoryOpen} recipes={availableRecipes(craftingContext)} selectedIndex={selectedIndex} />
      <MobileUnsupportedOverlay visible={mobileUnsupported} onContinue={onContinueMobile} />
    </>
  );
}
