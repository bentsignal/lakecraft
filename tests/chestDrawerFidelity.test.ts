import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/components/ChestDrawer.tsx", import.meta.url), "utf8");
const css = source.slice(source.indexOf("const CHEST_CSS"), source.indexOf("export type ChestTransferDirection"));
const mappingSource = source.match(/export function chestSlotIndex\([\s\S]*?^}/m)?.[0];
assert.ok(mappingSource, "canonical chest slot mapping remains directly testable");
const executableMapping = mappingSource
  .replace("export ", "")
  .replace(/: ChestTransferDirection/g, "")
  .replace(/: number/g, "");
const chestSlotIndex = Function(`${executableMapping}; return chestSlotIndex;`)() as
  (direction: "to_chest" | "to_player", visualIndex: number, slotCount: number) => number;

assert.deepEqual(
  Array.from({ length: 36 }, (_, visualIndex) => chestSlotIndex("to_chest", visualIndex, 36)),
  [...Array.from({ length: 27 }, (_, index) => index + 9), ...Array.from({ length: 9 }, (_, index) => index)],
  "player display is main inventory 9-35 followed by hotbar 0-8",
);
assert.deepEqual(
  Array.from({ length: 27 }, (_, visualIndex) => chestSlotIndex("to_player", visualIndex, 27)),
  Array.from({ length: 27 }, (_, index) => index),
  "chest display keeps its canonical 3x9 order",
);
assert.ok(source.includes("onClick={() => onTransfer(direction, index)}"), "visual slots submit their mapped canonical index");
assert.ok(source.includes('className={`lc-chest-grid${playerGrid ? " lc-chest-grid--player" : ""}`}'), "player grid receives its hotbar separator modifier");

for (const token of [
  "background:#c6c6c6",
  "border:4px solid #111",
  "--lc-chest-slot:48px",
  "grid-template-columns:repeat(9,var(--lc-chest-slot))",
  ".lc-chest-grid--player .lc-chest-slot:nth-child(n+28){margin-top:11px}",
  "width:min(500px,100%)",
]) assert.ok(css.includes(token), `chest uses compact Minecraft-style geometry: ${token}`);

for (const stale of ["#d9cfb3", "Trebuchet MS", "grid-template-columns:1fr 1fr", "Click a stack", "Every transfer is committed atomically", "eyebrow"]) {
  assert.equal(source.includes(stale), false, `chest removes stale notebook/debug presentation: ${stale}`);
}
assert.ok(source.indexOf('direction="to_player"') < source.indexOf("<h3>Inventory</h3>"), "chest rows precede player inventory rows");
assert.ok(source.indexOf("<h3>Inventory</h3>") < source.lastIndexOf('direction="to_chest"'), "inventory label precedes main/hotbar rows");
assert.ok(source.includes("aria-busy={busy}") && source.includes('aria-label="Close chest"'), "busy and close semantics remain explicit");
assert.ok(source.includes("error || status || retryAvailable ?"), "status chrome appears only for actionable state");

console.log("Minecraft-style chest layout and canonical slot mapping checks passed");
