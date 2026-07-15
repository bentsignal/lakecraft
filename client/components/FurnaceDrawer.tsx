import {
  FURNACE_COAL_BURN_MS,
  FURNACE_COOK_MS,
  materializeFurnace,
  type FurnaceState,
  type FurnaceTransferAction,
} from "../../shared/furnaces";
import { ITEMS, SMELTING_RECIPES, type Inventory, type ItemStack } from "../../shared/game";
import { useEffect, useRef, useState } from "preact/hooks";
import { ItemGlyph } from "./ItemGlyph";

const FURNACE_INPUTS = new Set(SMELTING_RECIPES.map(({ input }) => input));
const MAIN_INVENTORY_SLOTS = 27;
const HOTBAR_SLOTS = 9;

export type FurnaceDrawerProps = {
  open: boolean;
  inventory: Inventory;
  furnace: FurnaceState | null;
  busy: boolean;
  status?: string;
  error?: string;
  onClose: () => void;
  onTransfer: (action: FurnaceTransferAction) => void;
};

function percent(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, value / maximum * 100));
}

function furnaceAction(kind: "input" | "fuel" | "output", stack: ItemStack): FurnaceTransferAction {
  return {
    kind: kind === "input" ? "take_input" : kind === "fuel" ? "take_fuel" : "take_output",
    count: stack.count,
  };
}

function FurnaceSlot({
  kind,
  stack,
  busy,
  onTransfer,
}: {
  kind: "input" | "fuel" | "output";
  stack: ItemStack | null;
  busy: boolean;
  onTransfer: FurnaceDrawerProps["onTransfer"];
}) {
  const label = kind === "input" ? "Furnace input" : kind === "fuel" ? "Furnace fuel" : "Furnace output";
  return (
    <button
      aria-label={stack ? `${label}: ${ITEMS[stack.itemId].label}, ${stack.count}; take stack` : `${label}: empty`}
      className={`lc-furnace-slot lc-furnace-slot--${kind}`}
      disabled={busy || !stack}
      onClick={() => stack && onTransfer(furnaceAction(kind, stack))}
      title={stack ? `Take ${stack.count} ${ITEMS[stack.itemId].label}` : label}
      type="button"
    >
      <ItemGlyph stack={stack} compact />
    </button>
  );
}

function inventoryDepositAction(stack: ItemStack, inventorySlot: number): FurnaceTransferAction | null {
  if (stack.itemId === "coal") {
    return { kind: "deposit_fuel", inventorySlot, count: stack.count };
  }
  if (FURNACE_INPUTS.has(stack.itemId)) {
    return { kind: "deposit_input", inventorySlot, count: stack.count };
  }
  return null;
}

function InventorySlot({
  stack,
  inventorySlot,
  busy,
  furnace,
  onTransfer,
}: {
  stack: ItemStack | null;
  inventorySlot: number;
  busy: boolean;
  furnace: FurnaceState | null;
  onTransfer: FurnaceDrawerProps["onTransfer"];
}) {
  const action = stack ? inventoryDepositAction(stack, inventorySlot) : null;
  const target = action?.kind === "deposit_fuel" ? furnace?.fuel : furnace?.input;
  const capacity = stack && action
    ? ITEMS[stack.itemId].maxStack - (target?.itemId === stack.itemId ? target.count : target ? ITEMS[stack.itemId].maxStack : 0)
    : 0;
  const eligible = Boolean(action && furnace && capacity >= (stack?.count ?? 0));
  const title = stack
    ? action
      ? eligible ? `Move ${stack.count} ${ITEMS[stack.itemId].label} into the furnace` : "Furnace slot cannot hold this full stack"
      : `${ITEMS[stack.itemId].label} cannot be smelted or used as fuel`
    : "Empty inventory slot";
  return (
    <button
      aria-label={stack ? `${ITEMS[stack.itemId].label}, ${stack.count}${eligible ? "; place in furnace" : ""}` : "Empty inventory slot"}
      className={`lc-furnace-inventory-slot${eligible ? " is-eligible" : ""}`}
      disabled={busy || !eligible}
      onClick={() => action && eligible && onTransfer(action)}
      title={title}
      type="button"
    >
      <ItemGlyph stack={stack} compact />
    </button>
  );
}

export function FurnaceDrawer({
  open,
  inventory,
  furnace,
  busy,
  status,
  error,
  onClose,
  onTransfer,
}: FurnaceDrawerProps) {
  const [displayFurnace, setDisplayFurnace] = useState<FurnaceState | null>(furnace);
  const progressAnchorRef = useRef<{ state: FurnaceState; receivedAt: number } | null>(null);

  useEffect(() => {
    progressAnchorRef.current = furnace ? { state: furnace, receivedAt: performance.now() } : null;
    setDisplayFurnace(furnace);
  }, [furnace]);

  useEffect(() => {
    if (!open) return;
    const renderProgress = () => {
      const anchor = progressAnchorRef.current;
      if (!anchor || busy) return;
      const trustedNow = Math.max(
        anchor.state.lastMaterializedAtMs,
        Math.round(anchor.state.lastMaterializedAtMs + Math.max(0, performance.now() - anchor.receivedAt)),
      );
      const projected = materializeFurnace(anchor.state, trustedNow);
      if (projected.ok) setDisplayFurnace(projected.state);
    };
    renderProgress();
    const timer = window.setInterval(renderProgress, 50);
    return () => window.clearInterval(timer);
  }, [open, busy]);

  if (!open) return null;
  const burnPercent = percent(displayFurnace?.burnRemainingMs ?? 0, FURNACE_COAL_BURN_MS);
  const cookPercent = percent(displayFurnace?.cookProgressMs ?? 0, FURNACE_COOK_MS);
  const mainSlots = Array.from({ length: MAIN_INVENTORY_SLOTS }, (_, offset) => offset + HOTBAR_SLOTS);
  const hotbarSlots = Array.from({ length: HOTBAR_SLOTS }, (_, index) => index);

  return (
    <div
      className="lc-furnace-layer"
      role="presentation"
      onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}
    >
      <section className="lc-furnace" role="dialog" aria-modal="true" aria-labelledby="lc-furnace-title">
        <header className="lc-furnace__header">
          <h2 id="lc-furnace-title">Furnace</h2>
          <button aria-label="Close furnace" disabled={busy} onClick={onClose} type="button">Done <kbd>E</kbd></button>
        </header>

        <div className="lc-furnace__station" aria-label="Furnace slots and progress">
          <div className="lc-furnace__source">
            <FurnaceSlot busy={busy} kind="input" onTransfer={onTransfer} stack={displayFurnace?.input ?? null} />
            <span className="lc-furnace__flame" aria-label={`Fuel burn ${Math.round(burnPercent)} percent`} role="img">
              <i style={{ height: `${burnPercent}%` }} />
            </span>
            <FurnaceSlot busy={busy} kind="fuel" onTransfer={onTransfer} stack={displayFurnace?.fuel ?? null} />
          </div>
          <span className="lc-furnace__arrow" aria-label={`Cooking ${Math.round(cookPercent)} percent`} role="img">
            <i style={{ width: `${cookPercent}%` }} />
          </span>
          <FurnaceSlot busy={busy} kind="output" onTransfer={onTransfer} stack={displayFurnace?.output ?? null} />
        </div>

        <section className="lc-furnace__inventory" aria-labelledby="lc-furnace-inventory-title">
          <h3 id="lc-furnace-inventory-title">Inventory</h3>
          <div className="lc-furnace-inventory-grid" role="grid" aria-label="Main inventory">
            {mainSlots.map((inventorySlot) => (
              <InventorySlot
                busy={busy}
                furnace={displayFurnace}
                inventorySlot={inventorySlot}
                key={inventorySlot}
                onTransfer={onTransfer}
                stack={inventory[inventorySlot] ?? null}
              />
            ))}
          </div>
          <div className="lc-furnace-inventory-grid lc-furnace-inventory-grid--hotbar" role="grid" aria-label="Hotbar">
            {hotbarSlots.map((inventorySlot) => (
              <InventorySlot
                busy={busy}
                furnace={displayFurnace}
                inventorySlot={inventorySlot}
                key={inventorySlot}
                onTransfer={onTransfer}
                stack={inventory[inventorySlot] ?? null}
              />
            ))}
          </div>
        </section>

        <p className={`lc-furnace__status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
          {error || (busy ? "Updating furnace…" : status || "Click smeltable items or coal to move a full stack.")}
        </p>
      </section>
    </div>
  );
}
