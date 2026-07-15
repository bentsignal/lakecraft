import { ITEMS, type Inventory } from "../../shared/game";
import { ItemGlyph } from "./ItemGlyph";

const CHEST_CSS = `
.lc-chest-layer{align-items:center;background:rgba(8,10,8,.72);display:flex;inset:0;justify-content:center;padding:24px;position:fixed;z-index:66}.lc-chest{background:#d9cfb3;border:1px solid #eee5ce;box-shadow:0 24px 80px rgba(0,0,0,.58),inset 0 0 0 5px rgba(87,77,49,.13);color:#24261f;max-height:calc(100vh - 48px);overflow:auto;padding:28px;width:min(940px,100%)}.lc-chest header{align-items:end;border-bottom:2px solid rgba(36,38,31,.7);display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:12px}.lc-chest h2{font:900 30px/1 "Trebuchet MS",sans-serif;margin:4px 0 0;text-transform:uppercase}.lc-chest header small,.lc-chest-status{font:9px "Courier New",monospace}.lc-chest header button{background:#24261f;border:0;color:#e6dcc1;cursor:pointer;padding:10px 13px}.lc-chest header button:disabled{cursor:wait;opacity:.5}.lc-chest-grid-wrap{display:grid;gap:28px;grid-template-columns:1fr 1fr}.lc-chest-section-head{align-items:center;display:flex;justify-content:space-between;margin-bottom:8px}.lc-chest-section-head strong{font:11px "Trebuchet MS",sans-serif;letter-spacing:.1em;text-transform:uppercase}.lc-chest-section-head small{color:rgba(36,38,31,.58);font:8px "Courier New",monospace}.lc-chest-grid{background:rgba(36,38,31,.88);display:grid;gap:3px;grid-template-columns:repeat(9,1fr);padding:6px}.lc-chest-slot{aspect-ratio:1;background:rgba(230,220,193,.045);border:1px solid rgba(230,220,193,.14);color:#e6dcc1;cursor:pointer;min-width:0;padding:0}.lc-chest-slot:disabled{cursor:default;opacity:.48}.lc-chest-slot:hover:not(:disabled){border-color:#d49a45}.lc-chest-status-row{align-items:center;display:flex;gap:14px;justify-content:space-between;margin-top:16px}.lc-chest-status{color:rgba(36,38,31,.65);margin:0}.lc-chest-status.is-error{color:#9a5434}.lc-chest-retry{background:#9a5434;border:0;color:#fff4dd;cursor:pointer;flex:none;font:700 9px "Courier New",monospace;padding:9px 11px;text-transform:uppercase}@media(max-width:760px){.lc-chest-grid-wrap{grid-template-columns:1fr}.lc-chest{padding:20px}.lc-chest-grid{grid-template-columns:repeat(9,minmax(28px,1fr))}.lc-chest-status-row{align-items:stretch;flex-direction:column}}
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
  eyebrow?: string;
  onClose: () => void;
  onRetry?: () => void;
  onTransfer: (direction: ChestTransferDirection, index: number) => void;
}

function StorageGrid({ inventory, busy, direction, onTransfer }: { inventory: Inventory; busy: boolean; direction: ChestTransferDirection; onTransfer: ChestDrawerProps["onTransfer"] }) {
  return (
    <div className="lc-chest-grid">
      {inventory.map((stack, index) => (
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
      ))}
    </div>
  );
}

export function ChestDrawer({ open, chestInventory, playerInventory, busy = false, status, error, retryAvailable = false, eyebrow = "SHARED LAKEBED CONTAINER", onClose, onRetry, onTransfer }: ChestDrawerProps) {
  if (!open) return null;
  return (
    <div className="lc-chest-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <style>{CHEST_CSS}</style>
      <section className="lc-chest" role="dialog" aria-modal="true" aria-labelledby="lc-chest-title">
        <header><div><small>{eyebrow}</small><h2 id="lc-chest-title">Chest</h2></div><button disabled={busy} onClick={onClose} type="button">Close · E</button></header>
        <div className="lc-chest-grid-wrap">
          <section><div className="lc-chest-section-head"><strong>Chest storage</strong><small>Click a stack to take it</small></div><StorageGrid busy={busy} direction="to_player" inventory={chestInventory} onTransfer={onTransfer} /></section>
          <section><div className="lc-chest-section-head"><strong>Your pack</strong><small>Click a stack to store it</small></div><StorageGrid busy={busy} direction="to_chest" inventory={playerInventory} onTransfer={onTransfer} /></section>
        </div>
        <div className="lc-chest-status-row">
          <p className={`lc-chest-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || status || "Every transfer is committed atomically through Lakebed."}</p>
          {retryAvailable ? <button className="lc-chest-retry" onClick={onRetry} type="button">Retry reconciliation</button> : null}
        </div>
      </section>
    </div>
  );
}
