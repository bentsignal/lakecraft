import { ITEMS, type ItemId } from "../../shared/game.ts";
import { itemVisualIds } from "../../shared/visualCatalog.ts";
import { atlasBlockItemGuiIcon } from "../components/atlasBlockItemIcon.ts";
import {
  ITEM_ICON_SIZE,
  getItemIconArt,
  type ItemIconFamily,
} from "../components/itemIconArt.ts";

export type ProductionContactSheetCategory = "all" | ItemIconFamily;

export type ProductionContactSheetOptions = Readonly<{
  category?: ProductionContactSheetCategory;
  search?: string;
  columns?: number;
  iconScale?: number;
  title?: string;
}>;

export type ProductionContactSheetCell = Readonly<{
  itemId: ItemId;
  label: string;
  category: ItemIconFamily;
  column: number;
  row: number;
  x: number;
  y: number;
  iconX: number;
  iconY: number;
}>;

export type ProductionContactSheetPlan = Readonly<{
  width: number;
  height: number;
  columns: number;
  rows: number;
  iconScale: number;
  iconSize: number;
  cardWidth: number;
  cardHeight: number;
  headerHeight: number;
  category: ProductionContactSheetCategory;
  search: string;
  title: string;
  cells: readonly ProductionContactSheetCell[];
}>;

export type ProductionContactSheetExport = Readonly<{
  canvas: HTMLCanvasElement;
  dataUrl: string;
  filename: string;
  plan: ProductionContactSheetPlan;
}>;

const SHEET_MARGIN = 16;
const SHEET_GAP = 8;
const HEADER_HEIGHT = 82;
const LABEL_SCALE = 2;
const LABEL_GLYPH_STEP = 6 * LABEL_SCALE;
const FONT_HEIGHT = 7;

const COLORS = Object.freeze({
  background: "#0e120e",
  header: "#171d16",
  headerAccent: "#92aa79",
  card: "#1c221b",
  cardEdge: "#46503f",
  label: "#edf0e8",
  category: "#99a292",
});

/** Original 5×7 bitmap glyphs, one base-32 row mask per character. */
const FONT_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/: ";
const FONT = "ehhvhhhuhhuhhufgggggfuhhhhhuvgguggvvggugggfggnhhfhhhvhhhv44444v7222iichikokihggggggvhrllhhhhpljhhhehhhhheuhhugggehhhliduhhukihfgge11uv444444hhhhhhehhhhha4hhhlllahha4ahhhha4444v1248gvehjlphe4c4444eeh1248vu11e11u26aiv22vggu11uegguhhev124888ehhehheehhf11e000v000122488g04404400000000";

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value!))) : fallback;
}

function normalizedCategory(category: ProductionContactSheetCategory | undefined): ProductionContactSheetCategory {
  return category === "block" || category === "material" || category === "tool"
    || category === "armor" || category === "food" ? category : "all";
}

export function productionContactSheetItemIds(
  options: Pick<ProductionContactSheetOptions, "category" | "search"> = {},
): readonly ItemId[] {
  const category = normalizedCategory(options.category);
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  return Object.freeze(itemVisualIds().filter((itemId) => {
    const item = ITEMS[itemId];
    return (category === "all" || item.category === category)
      && (!search || itemId.includes(search) || item.label.toLocaleLowerCase().includes(search));
  }));
}

export function planProductionContactSheet(
  options: ProductionContactSheetOptions = {},
): ProductionContactSheetPlan {
  const columns = boundedInteger(options.columns, 8, 1, 16);
  const iconScale = boundedInteger(options.iconScale, 5, 1, 8);
  const iconSize = ITEM_ICON_SIZE * iconScale;
  const cardWidth = Math.max(144, iconSize + 32);
  const cardHeight = iconSize + 62;
  const category = normalizedCategory(options.category);
  const search = options.search?.trim() ?? "";
  const itemIds = productionContactSheetItemIds({ category, search });
  const rows = Math.max(1, Math.ceil(itemIds.length / columns));
  const width = SHEET_MARGIN * 2 + columns * cardWidth + (columns - 1) * SHEET_GAP;
  const height = HEADER_HEIGHT + SHEET_MARGIN + rows * cardHeight + (rows - 1) * SHEET_GAP + SHEET_MARGIN;
  const cells = itemIds.map((itemId, index): ProductionContactSheetCell => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = SHEET_MARGIN + column * (cardWidth + SHEET_GAP);
    const y = HEADER_HEIGHT + SHEET_MARGIN + row * (cardHeight + SHEET_GAP);
    return Object.freeze({
      itemId,
      label: ITEMS[itemId].label,
      category: ITEMS[itemId].category,
      column,
      row,
      x,
      y,
      iconX: x + Math.floor((cardWidth - iconSize) / 2),
      iconY: y + 10,
    });
  });
  return Object.freeze({
    width,
    height,
    columns,
    rows,
    iconScale,
    iconSize,
    cardWidth,
    cardHeight,
    headerHeight: HEADER_HEIGHT,
    category,
    search,
    title: options.title?.trim().slice(0, 48) || "LAKECRAFT PRODUCTION CATALOG",
    cells: Object.freeze(cells),
  });
}

function drawBitmapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
): void {
  context.fillStyle = color;
  for (let glyphIndex = 0; glyphIndex < text.length; glyphIndex += 1) {
    const found = FONT_CHARACTERS.indexOf(text[glyphIndex].toUpperCase());
    const fontIndex = found < 0 ? FONT_CHARACTERS.length - 1 : found;
    for (let row = 0; row < FONT_HEIGHT; row += 1) for (let column = 0; column < 5; column += 1) {
      if (Number.parseInt(FONT[fontIndex * FONT_HEIGHT + row], 32) & 1 << (4 - column)) {
        context.fillRect(x + (glyphIndex * 6 + column) * scale, y + row * scale, scale, scale);
      }
    }
  }
}

function wrappedLabel(label: string, maximumCharacters: number): readonly string[] {
  const words = label.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const previous = lines[lines.length - 1];
    if (previous && `${previous} ${word}`.length <= maximumCharacters) lines[lines.length - 1] = `${previous} ${word}`;
    else if (lines.length < 2) lines.push(word.slice(0, maximumCharacters));
    else break;
  }
  return lines.length ? lines : [""];
}

export function renderProductionContactSheet(
  canvas: HTMLCanvasElement,
  options: ProductionContactSheetOptions = {},
): ProductionContactSheetPlan {
  const plan = planProductionContactSheet(options);
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas is required to export the production catalog.");
  context.imageSmoothingEnabled = false;
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, plan.width, plan.height);
  context.fillStyle = COLORS.header;
  context.fillRect(0, 0, plan.width, plan.headerHeight);
  drawBitmapText(context, plan.title, SHEET_MARGIN, 16, 2, COLORS.label);
  const filterText = `${plan.cells.length} ASSETS / ${plan.category === "all" ? "ALL CATEGORIES" : plan.category.toUpperCase()}`;
  drawBitmapText(context, filterText, SHEET_MARGIN, 48, 1, COLORS.headerAccent);

  for (const cell of plan.cells) {
    context.fillStyle = COLORS.cardEdge;
    context.fillRect(cell.x, cell.y, plan.cardWidth, plan.cardHeight);
    context.fillStyle = COLORS.card;
    context.fillRect(cell.x + 1, cell.y + 1, plan.cardWidth - 2, plan.cardHeight - 2);
    const art = getItemIconArt(cell.itemId);
    const guiBlock = atlasBlockItemGuiIcon(cell.itemId);
    const iconRuns = guiBlock?.runs ?? art.runs;
    const pixelScale = plan.iconSize / (guiBlock?.size ?? ITEM_ICON_SIZE);
    for (const run of iconRuns) {
      context.fillStyle = run.color;
      context.fillRect(
        cell.iconX + run.x * pixelScale,
        cell.iconY + run.y * pixelScale,
        run.width * pixelScale,
        pixelScale,
      );
    }
    const maximumCharacters = Math.max(1, Math.floor((plan.cardWidth - 16) / LABEL_GLYPH_STEP));
    const labelLines = wrappedLabel(cell.label, maximumCharacters);
    const labelTop = cell.iconY + plan.iconSize + 8;
    for (let index = 0; index < labelLines.length; index += 1) {
      const line = labelLines[index];
      const width = Math.max(0, line.length * LABEL_GLYPH_STEP - LABEL_SCALE);
      drawBitmapText(context, line, cell.x + Math.floor((plan.cardWidth - width) / 2), labelTop + index * 17, LABEL_SCALE, COLORS.label);
    }
    drawBitmapText(context, cell.category.toUpperCase(), cell.x + 7, cell.y + plan.cardHeight - 10, 1, COLORS.category);
  }
  return plan;
}

/** Renders and encodes the filtered production catalog as one deterministic PNG. */
export function createProductionContactSheetExport(
  options: ProductionContactSheetOptions = {},
  ownerDocument: Pick<Document, "createElement"> = document,
): ProductionContactSheetExport {
  const canvas = ownerDocument.createElement("canvas");
  const plan = renderProductionContactSheet(canvas, options);
  const categorySuffix = plan.category === "all" ? "all" : plan.category;
  return Object.freeze({
    canvas,
    dataUrl: canvas.toDataURL("image/png"),
    filename: `lakecraft-production-catalog-${categorySuffix}.png`,
    plan,
  });
}
