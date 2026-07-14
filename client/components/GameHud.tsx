import type { ArmorSlot, Equipment, Inventory, Recipe } from "../../shared/game";
import { ControlsCard } from "./ControlsCard";
import { Hotbar } from "./Hotbar";
import { HudStyles } from "./HudStyles";
import { InventoryCraftingDrawer } from "./InventoryDrawer";
import { MobileUnsupportedOverlay } from "./MobileUnsupportedOverlay";
import { StatusStrip, type StatusStripProps } from "./StatusStrip";
import { ToastSurface, type HudMessage } from "./ToastSurface";

export type GameHudProps = StatusStripProps & {
  inventory: Inventory;
  equipment: Equipment;
  selectedIndex: number;
  inventoryOpen: boolean;
  messages?: readonly HudMessage[];
  showControls?: boolean;
  mobileUnsupported?: boolean;
  onSelectHotbar: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
  onEquipArmor: (inventoryIndex: number) => void;
  onUnequipArmor: (slot: ArmorSlot) => void;
  onUseItem?: (inventoryIndex: number) => void;
  onCloseInventory: () => void;
  onDismissControls?: () => void;
  onDismissMessage?: (id: string) => void;
  onContinueMobile?: () => void;
};

export function Crosshair() {
  return <span className="lc-crosshair" aria-hidden="true" />;
}

export function GameHud({
  inventory,
  equipment,
  selectedIndex,
  inventoryOpen,
  messages = [],
  showControls = true,
  mobileUnsupported = false,
  onSelectHotbar,
  onCraft,
  onEquipArmor,
  onUnequipArmor,
  onUseItem,
  onCloseInventory,
  onDismissControls,
  onDismissMessage,
  onContinueMobile,
  ...status
}: GameHudProps) {
  return (
    <>
      <HudStyles />
      <div className="lc-hud">
        <StatusStrip {...status} />
        <Crosshair />
        <ControlsCard visible={showControls} onDismiss={onDismissControls} />
        <Hotbar inventory={inventory} selectedIndex={selectedIndex} onSelect={onSelectHotbar} />
        <ToastSurface messages={messages} onDismiss={onDismissMessage} />
      </div>
      <InventoryCraftingDrawer equipment={equipment} inventory={inventory} onClose={onCloseInventory} onCraft={onCraft} onEquipArmor={onEquipArmor} onSelectSlot={onSelectHotbar} onUnequipArmor={onUnequipArmor} onUseItem={onUseItem} open={inventoryOpen} selectedIndex={selectedIndex} />
      <MobileUnsupportedOverlay visible={mobileUnsupported} onContinue={onContinueMobile} />
    </>
  );
}
