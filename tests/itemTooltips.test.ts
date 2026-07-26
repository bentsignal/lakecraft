import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeItemTooltipTarget,
  itemTooltipAttributes,
  itemTooltipContent,
  itemTooltipDescribedBy,
  positionItemTooltip,
  reconcileItemTooltipSources,
  setItemTooltipSource,
  type ItemTooltipRect,
  type ItemTooltipSources,
} from "../client/components/itemTooltipModel.ts";

assert.equal(itemTooltipContent(null), null, "empty slots expose no tooltip");
assert.deepEqual(itemTooltipAttributes(null), {}, "empty slots emit no delegated tooltip attributes");

assert.equal(itemTooltipContent({ itemId: "grass", count: 64 }), "Grass\nCount 64\nBuilding block");
assert.equal(itemTooltipContent({ itemId: "diamond", count: 7 }), "Diamond\nCount 7\nMaterial");
assert.equal(itemTooltipContent({ itemId: "cooked_beef", count: 3 }), "Steak\nCount 3\nFood · +8 hunger");
assert.equal(itemTooltipContent({ itemId: "bow", count: 1, durability: 120 }), "Bow\nCount 1\nRanged weapon\nDurability 120 / 384");
assert.equal(itemTooltipContent({ itemId: "shears", count: 1, durability: 17 }), "Shears\nCount 1\nUtility tool\nDurability 17 / 238");
assert.equal(itemTooltipContent({ itemId: "iron_pickaxe", count: 1, durability: 37 }), "Iron Pickaxe\nCount 1\nIron pickaxe · 4 attack\nDurability 37 / 250");
assert.equal(itemTooltipContent({ itemId: "diamond_chestplate", count: 1, durability: 101 }), "Diamond Chestplate\nCount 1\nChest armor · 8 protection\nDurability 101 / 528");
assert.deepEqual(itemTooltipAttributes({ itemId: "iron_pickaxe", count: 1, durability: 37 }), {
  "data-tip": "Iron Pickaxe\nCount 1\nIron pickaxe · 4 attack\nDurability 37 / 250",
});

const focusedSlot = { id: "focused" };
const hoveredSlot = { id: "hovered" };
const sources: ItemTooltipSources<{ id: string }> = { pointer: null, focus: null };
assert.equal(setItemTooltipSource(sources, "focus", focusedSlot), true);
assert.equal(activeItemTooltipTarget(sources), focusedSlot, "keyboard focus activates its populated slot");
assert.equal(setItemTooltipSource(sources, "pointer", hoveredSlot), true);
assert.equal(activeItemTooltipTarget(sources), hoveredSlot, "pointer hover temporarily takes visual priority");
assert.equal(activeItemTooltipTarget(sources, true), null, "a carried cursor stack suspends the surface");
assert.equal(setItemTooltipSource(sources, "pointer", hoveredSlot), false, "pointermove within one slot causes no refresh");
assert.equal(activeItemTooltipTarget(sources, true), null, "pointermove during a drag keeps the surface suspended");
assert.equal(setItemTooltipSource(sources, "pointer", null), true);
assert.equal(activeItemTooltipTarget(sources), focusedSlot, "pointer exit restores the still-focused slot");
assert.equal(activeItemTooltipTarget(sources, true), null);
assert.equal(activeItemTooltipTarget(sources, false), focusedSlot, "ending a carried stack restores focus");
assert.equal(setItemTooltipSource(sources, "focus", null), true);
assert.equal(activeItemTooltipTarget(sources), null, "leaving both sources hides the shared surface");

type DragSlot = {
  id: string;
  connected: boolean;
  dataTip: string | null;
  visible: boolean;
};

function dragRestorationCase(
  name: string,
  initial: { pointer: boolean; focus: boolean },
  drop: "same" | "other" | "empty" | "removed" | "offscreen",
) {
  const original: DragSlot = { id: `${name}-original`, connected: true, dataTip: "Stone\nCount 1", visible: true };
  const destination: DragSlot = { id: `${name}-destination`, connected: true, dataTip: null, visible: true };
  const state: ItemTooltipSources<DragSlot> = {
    pointer: initial.pointer ? original : null,
    focus: initial.focus ? original : null,
  };
  const candidate = (target: DragSlot | null) => (
    target?.connected && target.dataTip && target.visible ? target : null
  );
  const reconcile = (
    wasSuspended: boolean,
    suspended: boolean,
    hovered: DragSlot | null,
    focused: DragSlot | null,
  ) => reconcileItemTooltipSources(
    state,
    wasSuspended && !suspended,
    suspended,
    candidate(hovered),
    candidate(focused),
    (target) => target.connected,
    (target) => Boolean(target.dataTip),
  );

  original.dataTip = null;
  reconcile(false, true, initial.pointer ? original : null, initial.focus ? original : null);
  assert.equal(activeItemTooltipTarget(state, true), null, `${name}: inserting the cursor suspends the surface`);
  assert.equal(state.pointer, initial.pointer ? original : null, `${name}: suspension retains physical hover identity`);
  assert.equal(state.focus, initial.focus ? original : null, `${name}: suspension retains physical focus identity`);

  let hovered = initial.pointer ? original : null;
  let focused = initial.focus ? original : null;
  if (drop === "same") {
    original.dataTip = "Stone\nCount 1";
  } else if (drop === "other") {
    destination.dataTip = "Stone\nCount 1";
    hovered = destination;
  } else if (drop === "removed") {
    original.connected = false;
    hovered = null;
    focused = null;
  } else if (drop === "offscreen") {
    original.dataTip = "Stone\nCount 1";
    original.visible = false;
  }
  reconcile(true, false, hovered, focused);

  const expectedPointer = drop === "same" && initial.pointer
    ? original
    : drop === "other" ? destination : null;
  const expectedFocus = drop === "same" && initial.focus ? original : null;
  assert.equal(state.pointer, expectedPointer, `${name}: event-free resume reacquires only a populated visible hover`);
  assert.equal(state.focus, expectedFocus, `${name}: event-free resume reacquires only a populated visible focus`);
  assert.equal(activeItemTooltipTarget(state), expectedPointer ?? expectedFocus, `${name}: resume selects the current live source`);
}

dragRestorationCase("hover-only same-slot drop", { pointer: true, focus: false }, "same");
dragRestorationCase("focus-only same-slot drop", { pointer: false, focus: true }, "same");
dragRestorationCase("hover and focus same-slot drop", { pointer: true, focus: true }, "same");
dragRestorationCase("drop onto another formerly-empty slot", { pointer: true, focus: true }, "other");
dragRestorationCase("drop leaves the reached slot empty", { pointer: true, focus: false }, "empty");
dragRestorationCase("source removed during drag", { pointer: true, focus: true }, "removed");
dragRestorationCase("source moved offscreen during drag", { pointer: true, focus: true }, "offscreen");

assert.equal(itemTooltipDescribedBy(null, "lc-item-tooltip"), "lc-item-tooltip");
assert.equal(itemTooltipDescribedBy("help errors", "lc-item-tooltip"), "help errors lc-item-tooltip");
assert.equal(itemTooltipDescribedBy("help lc-item-tooltip", "lc-item-tooltip"), "help lc-item-tooltip");
const preDragDescription = "help errors";
let dragDescription = itemTooltipDescribedBy(preDragDescription, "lc-item-tooltip");
assert.equal(dragDescription, "help errors lc-item-tooltip");
dragDescription = preDragDescription;
assert.equal(dragDescription, "help errors", "suspension restores the exact pre-drag description");
dragDescription = itemTooltipDescribedBy(preDragDescription, "lc-item-tooltip");
assert.equal(dragDescription, "help errors lc-item-tooltip", "event-free resume describes the reacquired slot once");
dragDescription = preDragDescription;
assert.equal(dragDescription, "help errors", "final cleanup restores the exact pre-drag description again");

function overlaps(
  point: { x: number; y: number },
  size: { width: number; height: number },
  anchor: ItemTooltipRect,
): boolean {
  return point.x < anchor.right && point.x + size.width > anchor.left
    && point.y < anchor.bottom && point.y + size.height > anchor.top;
}

const slot = { left: 100, right: 148, top: 100, bottom: 148, width: 48, height: 48 };
const tooltip = { width: 180, height: 70 };
const desktop = positionItemTooltip(slot, tooltip, { width: 1280, height: 720 });
assert.ok(desktop);
assert.equal(overlaps(desktop, tooltip, slot), false, "pointer tooltip never obscures its slot");
assert.ok(desktop.x >= 8 && desktop.y >= 8);
assert.ok(desktop.x + tooltip.width <= 1272 && desktop.y + tooltip.height <= 712);

const rightEdgeSlot = { left: 740, right: 788, top: 300, bottom: 348, width: 48, height: 48 };
const rightEdge = positionItemTooltip(rightEdgeSlot, { width: 220, height: 72 }, { width: 800, height: 720 });
assert.ok(rightEdge);
assert.equal(overlaps(rightEdge, { width: 220, height: 72 }, rightEdgeSlot), false);
assert.ok(rightEdge.x >= 8 && rightEdge.x + 220 <= 792, "focus tooltip stays clamped near the viewport edge");

const narrowSlot = { left: 136, right: 184, top: 132, bottom: 180, width: 48, height: 48 };
const narrowTooltip = { width: 280, height: 84 };
const narrow = positionItemTooltip(narrowSlot, narrowTooltip, { width: 320, height: 568 });
assert.ok(narrow);
assert.equal(overlaps(narrow, narrowTooltip, narrowSlot), false, "narrow viewports move the tooltip above or below");
assert.ok(narrow.x >= 8 && narrow.x + narrowTooltip.width <= 312);

const viewport = { width: 800, height: 720 };
assert.equal(positionItemTooltip({ ...slot, top: -60, bottom: -12 }, tooltip, viewport), null, "vertical offscreen anchors suspend");
assert.equal(positionItemTooltip({ ...slot, left: -60, right: -12 }, tooltip, viewport), null, "horizontal offscreen anchors suspend");
assert.equal(positionItemTooltip({ ...slot, width: 0, right: slot.left }, tooltip, viewport), null, "hidden zero-area anchors suspend");
const partial = positionItemTooltip({ ...slot, left: -20, right: 28 }, tooltip, viewport);
assert.ok(partial, "partially visible anchors remain eligible");
assert.ok(partial.x >= 8 && partial.x + tooltip.width <= 792, "partially visible anchors keep the surface clamped");

const component = readFileSync(new URL("../client/components/ItemTooltip.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
const hud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const slots = [
  "Hotbar.tsx",
  "InventoryDrawer.tsx",
  "CraftingGrid.tsx",
  "ChestDrawer.tsx",
  "FurnaceDrawer.tsx",
].map((file) => [file, readFileSync(new URL(`../client/components/${file}`, import.meta.url), "utf8")] as const);

assert.ok(hud.includes("<ItemTooltip />"), "one shared surface serves HUD and sibling drawers");
for (const [file, source] of slots) {
  assert.ok(source.includes("itemTooltipAttributes"), `${file} delegates populated slot metadata`);
  assert.equal(/\stitle=/.test(source), false, `${file} does not show duplicate native or empty-slot tooltips`);
  assert.ok(source.includes("aria-label="), `${file} retains explicit screen-reader labels`);
}
for (const event of ["pointerover", "pointerout", "focusin", "focusout"]) {
  assert.ok(component.includes(`"${event}"`), `the shared controller handles ${event}`);
}
assert.equal(component.includes('"pointermove"'), false, "pointer motion within a trigger causes no listener or layout churn");
assert.ok(component.includes("document.addEventListener(name, onEvent, true)"));
assert.ok(component.includes("new MutationObserver"), "content replacement and drawer removal refresh or clear the active tooltip");
assert.ok(component.includes("records.every((record) => surface.contains(record.target))"), "surface text mutations do not churn the body observer");
assert.ok(component.includes("document.querySelector(CURSOR_SELECTOR)"), "carried stacks suspend without slot-local drag listeners");
assert.ok(component.includes('document.querySelector(`${TOOLTIP_SELECTOR}:hover`)'), "ending a drag reacquires a stationary hovered slot");
assert.ok(component.includes("resumableTarget(document.activeElement)"), "ending a drag reacquires the still-focused slot");
assert.ok(component.includes("childList: true"));
assert.ok(component.includes('attributeFilter: ["data-tip"]'));
assert.ok(component.includes('role="tooltip"'));
assert.ok(component.includes("id={TOOLTIP_ID}"), "the shared surface exposes one stable description target");
assert.ok(component.includes('getAttribute("aria-describedby")'));
assert.ok(component.includes('removeAttribute("aria-describedby")'));
assert.ok(component.includes('setAttribute("aria-describedby", previousValue)'), "cleanup restores the exact prior description");
assert.ok(component.includes("if (sources[source] === target) return"), "same-target source events skip layout work");
assert.ok(component.includes("if (!point)"), "scrolling a focused slot fully offscreen suspends its surface");
assert.equal(component.includes("setTimeout"), false, "the shared tooltip uses no reveal or cleanup timer");
assert.equal(component.includes("setInterval"), false, "the shared tooltip uses no polling loop");
assert.ok(styles.includes(".lc-item-tooltip"));
assert.ok(styles.includes("pointer-events: none"), "the tooltip cannot intercept slot click or drag interactions");
assert.match(styles, /z-index:\s*120/, "the one surface sits above every drawer without changing drawer layout");

const crafting = slots.find(([file]) => file === "CraftingGrid.tsx")![1];
assert.ok(crafting.includes("aria-disabled={outputDisabled || undefined}"));
assert.ok(crafting.includes("if (!outputDisabled) onTakeOutput"), "focusable disabled output never crafts");
const furnace = slots.find(([file]) => file === "FurnaceDrawer.tsx")![1];
assert.ok(furnace.includes("disabled={!stack}"), "populated ineligible furnace inventory remains keyboard-focusable");
assert.ok(furnace.includes("stack && !busy && onTransfer"), "busy furnace stations remain focusable but inert");
assert.ok(furnace.includes("action && eligible && !busy && onTransfer(action)"), "aria-disabled furnace slots never transfer");
const chest = slots.find(([file]) => file === "ChestDrawer.tsx")![1];
assert.ok(chest.includes("if (!busy) onTransfer"), "busy storage slots remain focusable but inert");

console.log("central Minecraft-style item tooltip tests passed");
