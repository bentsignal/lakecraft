import assert from "node:assert/strict";
import { ITEMS, type ItemId } from "../shared/game.ts";
import { itemVisualIds } from "../shared/visualCatalog.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  createProductionContactSheetExport,
  planProductionContactSheet,
  productionContactSheetItemIds,
  renderProductionContactSheet,
} from "../client/game/contactSheetExport.ts";

type Fill = Readonly<{ color: string; x: number; y: number; width: number; height: number }>;

class RecordingContext {
  imageSmoothingEnabled = true;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  readonly fills: Fill[] = [];

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fills.push({ color: String(this.fillStyle), x, y, width, height });
  }
}

function recordingCanvas() {
  const context = new RecordingContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === "2d" ? context : null,
    toDataURL: (kind: string) => `data:${kind};base64,production-catalog`,
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

const allIds = productionContactSheetItemIds();
assert.deepEqual(allIds, itemVisualIds(), "the default sheet preserves the complete production-catalog order");
assert.equal(new Set(allIds).size, allIds.length, "the single-shot sheet contains each catalog entry exactly once");

for (const category of ["block", "material", "tool", "armor", "food"] as const) {
  const expected = itemVisualIds().filter((itemId) => ITEMS[itemId].category === category);
  assert.deepEqual(productionContactSheetItemIds({ category }), expected, `${category} filtering is exact and stable`);
}
assert.deepEqual(productionContactSheetItemIds({ category: "tool", search: "diamond pickaxe" }), ["diamond_pickaxe"]);
assert.deepEqual(productionContactSheetItemIds({ search: "no-such-lakecraft-asset" }), []);

const firstPlan = planProductionContactSheet();
const secondPlan = planProductionContactSheet();
assert.deepEqual(firstPlan, secondPlan, "identical options produce byte-stable layout inputs");
assert.equal(firstPlan.cells.length, Object.keys(ITEMS).length);
assert.equal(firstPlan.columns, 8);
assert.equal(firstPlan.iconScale, 5);
assert.ok(firstPlan.width > 1_000 && firstPlan.height > 1_000, "the full catalog is exported in one readable image");
for (const cell of firstPlan.cells) {
  assert.ok(Number.isInteger(cell.iconX) && Number.isInteger(cell.iconY));
  assert.equal(cell.label, ITEMS[cell.itemId].label);
  assert.equal(cell.category, ITEMS[cell.itemId].category);
}
assert.equal(planProductionContactSheet({ columns: 99, iconScale: 99 }).columns, 16, "layout inputs are bounded");
assert.equal(planProductionContactSheet({ columns: 0, iconScale: 0 }).columns, 1, "small layout inputs are bounded");

const { canvas, context } = recordingCanvas();
const pickaxePlan = renderProductionContactSheet(canvas, { category: "tool", search: "diamond pickaxe", columns: 1, iconScale: 4 });
assert.equal(context.imageSmoothingEnabled, false, "nearest-neighbor rendering is explicit");
assert.equal(canvas.width, pickaxePlan.width);
assert.equal(canvas.height, pickaxePlan.height);
assert.equal(pickaxePlan.cells.length, 1);
const cell = pickaxePlan.cells[0];
for (const run of getItemIconArt("diamond_pickaxe").runs) {
  assert.ok(context.fills.some((fill) => fill.color === run.color
    && fill.x === cell.iconX + run.x * pickaxePlan.iconScale
    && fill.y === cell.iconY + run.y * pickaxePlan.iconScale
    && fill.width === run.width * pickaxePlan.iconScale
    && fill.height === pickaxePlan.iconScale),
  `canonical icon run ${run.x},${run.y},${run.width},${run.color} is painted exactly`);
}
assert.ok(context.fills.length > getItemIconArt("diamond_pickaxe").runs.length,
  "the export includes deterministic bitmap labels and framing in addition to exact art runs");

const created = recordingCanvas();
const exported = createProductionContactSheetExport(
  { category: "food", columns: 3, title: "Food QA" },
  { createElement: () => created.canvas } as unknown as Pick<Document, "createElement">,
);
assert.equal(exported.filename, "lakecraft-production-catalog-food.png");
assert.equal(exported.dataUrl, "data:image/png;base64,production-catalog");
assert.deepEqual(exported.plan.cells.map((entry) => entry.itemId),
  (Object.keys(ITEMS) as ItemId[]).filter((itemId) => ITEMS[itemId].category === "food"));

console.log("deterministic production contact-sheet export tests passed");
