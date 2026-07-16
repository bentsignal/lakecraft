import { ITEMS, type Inventory } from "../../shared/game";
import { ItemGlyph } from "./ItemGlyph";

const CHEST_CSS = `
.lc-chest-layer{align-items:center;background:rgba(0,0,0,.56);display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);image-rendering:pixelated;inset:0;justify-content:center;padding:20px;position:fixed;z-index:66}.lc-chest{--lc-chest-slot:48px;background:#c6c6c6;border:4px solid #111;box-shadow:inset 4px 4px #fff,inset -4px -4px #555,0 18px 56px rgba(0,0,0,.66);box-sizing:border-box;color:#3f3f3f;max-height:calc(100dvh - 40px);overflow:auto;padding:18px 22px 16px;width:min(500px,100%)}.lc-chest header{align-items:center;display:flex;justify-content:space-between;margin-bottom:8px}.lc-chest h2,.lc-chest h3{font:16px/1 var(--lc-pixel-font,"Courier New",monospace);font-weight:400;margin:0;text-shadow:1px 1px #fff}.lc-chest h3{font-size:13px;margin:15px 0 7px}.lc-chest header button{align-items:center;background:none;border:0;color:#3f3f3f;cursor:pointer;display:flex;font:10px/1 var(--lc-pixel-font,"Courier New",monospace);gap:7px;padding:0}.lc-chest header button:disabled{cursor:wait;opacity:.45}.lc-chest header kbd{background:#8b8b8b;border:2px solid;border-color:#fff #373737 #373737 #fff;color:#fff;font:10px/1 var(--lc-pixel-font,"Courier New",monospace);padding:4px 6px;text-shadow:1px 1px #333}.lc-chest-grid{display:grid;grid-template-columns:repeat(9,var(--lc-chest-slot));justify-content:center}.lc-chest-grid--player .lc-chest-slot:nth-child(n+28){margin-top:11px}.lc-chest-slot{appearance:none;background:#8b8b8b;border:2px solid;border-color:#373737 #fff #fff #373737;color:#fff;cursor:pointer;height:var(--lc-chest-slot);min-width:0;padding:0;position:relative;width:var(--lc-chest-slot)}.lc-chest-slot:hover:not(:disabled){background:#a5a5a5}.lc-chest-slot:disabled{cursor:default;opacity:1}.lc-chest-slot .lc-item-glyph{min-height:calc(var(--lc-chest-slot) - 4px)}.lc-chest-slot .lc-item-icon__svg{height:min(40px,calc(100% - 4px));width:min(40px,calc(100% - 4px))}.lc-chest-status-row{align-items:center;display:flex;gap:12px;justify-content:space-between;margin-top:14px}.lc-chest-status{color:#555;font:9px/1.4 var(--lc-pixel-font,"Courier New",monospace);margin:0;text-shadow:1px 1px #fff}.lc-chest-status.is-error{color:#a40000}.lc-chest-retry{background:#777;border:2px solid #111;box-shadow:inset 2px 2px #aaa,inset -2px -2px #555;color:#fff;cursor:pointer;flex:none;font:9px/1 var(--lc-pixel-font,"Courier New",monospace);padding:7px 9px;text-shadow:1px 1px #333}@media(max-width:560px){.lc-chest-layer{padding:10px}.lc-chest{--lc-chest-slot:min(48px,calc((100vw - 72px)/9));max-height:calc(100dvh - 20px);padding:15px 17px 14px;width:100%}.lc-chest-status-row{align-items:stretch;flex-direction:column}}
`;

export type ChestTransferDirection = "to_chest" | "to_player";

export interface ChestDrawerProps {
  open: boolean;
  chestInventory: Inventory;
  playerInventory: Inventory;
  busy?: boolean;
  status?: string;
  error?: string;
  retryAvailable?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onTransfer: (direction: ChestTransferDirection, index: number) => void;
}

export function chestSlotIndex(direction: ChestTransferDirection, visualIndex: number, slotCount: number): number {
  return direction === "to_chest" && slotCount === 36 ? (visualIndex + 9) % 36 : visualIndex;
}

function StorageGrid({ inventory, busy, direction, onTransfer }: { inventory: Inventory; busy: boolean; direction: ChestTransferDirection; onTransfer: ChestDrawerProps["onTransfer"] }) {
  const playerGrid = direction === "to_chest" && inventory.length === 36;
  return (
    <div aria-label={playerGrid ? "Player inventory" : "Chest storage"} className={`lc-chest-grid${playerGrid ? " lc-chest-grid--player" : ""}`} role="group">
      {Array.from({ length: inventory.length }, (_, visualIndex) => {
        const index = chestSlotIndex(direction, visualIndex, inventory.length);
        const stack = inventory[index] ?? null;
        return (
          <button
            aria-label={stack ? `${ITEMS[stack.itemId].label}, ${stack.count}; move stack` : "Empty slot"}
            className="lc-chest-slot"
            disabled={busy || !stack}
            key={index}
            onClick={() => onTransfer(direction, index)}
            title={stack ? `Move ${ITEMS[stack.itemId].label}` : "Empty"}
            type="button"
          >
            <ItemGlyph stack={stack} />
          </button>
        );
      })}
    </div>
  );
}

export function ChestDrawer({ open, chestInventory, playerInventory, busy = false, status, error, retryAvailable = false, onClose, onRetry, onTransfer }: ChestDrawerProps) {
  if (!open) return null;
  return (
    <div className="lc-chest-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <style>{CHEST_CSS}</style>
      <section aria-busy={busy} className="lc-chest" role="dialog" aria-modal="true" aria-labelledby="lc-chest-title">
        <header><h2 id="lc-chest-title">Chest</h2><button aria-label="Close chest" disabled={busy} onClick={onClose} type="button">Done <kbd>E</kbd></button></header>
        <StorageGrid busy={busy} direction="to_player" inventory={chestInventory} onTransfer={onTransfer} />
        <h3>Inventory</h3>
        <StorageGrid busy={busy} direction="to_chest" inventory={playerInventory} onTransfer={onTransfer} />
        {error || status || retryAvailable ? <div className="lc-chest-status-row">
          {error || status ? <p className={`lc-chest-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || status}</p> : <span />}
          {retryAvailable ? <button className="lc-chest-retry" onClick={onRetry} type="button">Retry</button> : null}
        </div> : null}
      </section>
    </div>
  );
}
