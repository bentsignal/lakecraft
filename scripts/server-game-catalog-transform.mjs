const PRESENTATION_FIELDS = ["label", "note", "description", "shortLabel", "glyph", "accent", "color"];

const TUPLE_CATALOGS = [
  {
    name: "BLOCKS",
    anchor: "export const BLOCKS = defineBlocks(",
    arrayAfterAnchor: true,
    rows: 30,
    widths: [8, 9],
    scalarPresentationIndexes: [1, 2, 3, 4],
  },
  {
    name: "BLOCK_ITEM_SPECS",
    anchor: "const BLOCK_ITEM_SPECS",
    rows: 30,
    widths: [3],
    scalarPresentationIndexes: [1, 2],
  },
  {
    name: "BASIC_ITEM_SPECS",
    anchor: "const BASIC_ITEM_SPECS",
    rows: 18,
    widths: [6],
    scalarPresentationIndexes: [1, 2, 3, 4, 5],
  },
  {
    name: "UTILITY_ITEM_SPECS",
    anchor: "const UTILITY_ITEM_SPECS",
    rows: 2,
    widths: [7],
    scalarPresentationIndexes: [1, 2, 3, 4, 5],
  },
  {
    name: "RANGED_ITEM_SPECS",
    anchor: "const RANGED_ITEM_SPECS",
    rows: 1,
    widths: [10],
    scalarPresentationIndexes: [1, 2, 3, 6, 7],
  },
  {
    name: "FOOD_ITEM_SPECS",
    anchor: "const FOOD_ITEM_SPECS",
    rows: 10,
    widths: [7],
    scalarPresentationIndexes: [1, 2, 4, 5, 6],
  },
  {
    name: "TOOL_KIND_SPECS",
    anchor: "const TOOL_KIND_SPECS",
    rows: 4,
    widths: [4],
    scalarPresentationIndexes: [1, 2, 3],
  },
  {
    name: "TOOL_TIER_SPECS",
    anchor: "const TOOL_TIER_SPECS",
    rows: 5,
    widths: [6],
    scalarPresentationIndexes: [1, 2, 4],
    arrayPresentationIndexes: [{ index: 5, length: 4 }],
  },
  {
    name: "ARMOR_PIECE_SPECS",
    anchor: "const ARMOR_PIECE_SPECS",
    rows: 4,
    widths: [4],
    scalarPresentationIndexes: [1, 3],
  },
  {
    name: "ARMOR_MATERIAL_SPECS",
    anchor: "const ARMOR_MATERIAL_SPECS",
    rows: 4,
    widths: [8],
    scalarPresentationIndexes: [1, 2, 3],
    arrayPresentationIndexes: [{ index: 5, length: 4 }, { index: 7, length: 4 }],
  },
];

const OBJECT_CATALOGS = [
  { name: "RECIPES", anchor: "export const RECIPES", properties: ["label", "note"], expectedMatches: 42 },
  { name: "SMELTING_RECIPES", anchor: "export const SMELTING_RECIPES", properties: ["label"], expectedMatches: 10 },
];

function fail(message) {
  throw new Error(`Unsafe server game-catalog transform: ${message}`);
}

function uniqueAnchor(source, anchor, name) {
  const first = source.indexOf(anchor);
  if (first < 0) fail(`${name} anchor is missing.`);
  if (source.indexOf(anchor, first + anchor.length) >= 0) fail(`${name} anchor is ambiguous.`);
  return first;
}

function balancedArrayRange(source, startAt, name) {
  const start = source.indexOf("[", startAt);
  if (start < 0) fail(`${name} array initializer is missing.`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1, text: source.slice(start, index + 1) };
      if (depth < 0) fail(`${name} array initializer closes unexpectedly.`);
    }
  }
  fail(`${name} array initializer is unterminated.`);
}

function catalogArrayRange(source, catalog) {
  const anchor = uniqueAnchor(source, catalog.anchor, catalog.name);
  if (catalog.arrayAfterAnchor) return balancedArrayRange(source, anchor + catalog.anchor.length, catalog.name);
  const assignment = source.indexOf("=", anchor + catalog.anchor.length);
  if (assignment < 0) fail(`${catalog.name} assignment is missing.`);
  return balancedArrayRange(source, assignment + 1, catalog.name);
}

function parseLiteralArray(text, name) {
  try {
    return JSON.parse(text.replace(/,\s*([\]}])/g, "$1"));
  } catch (error) {
    fail(`${name} is no longer a literal JSON-compatible array (${error instanceof Error ? error.message : "parse error"}).`);
  }
}

function stripTupleCatalog(source, catalog) {
  const range = catalogArrayRange(source, catalog);
  const rows = parseLiteralArray(range.text, catalog.name);
  if (!Array.isArray(rows) || rows.length !== catalog.rows) {
    fail(`${catalog.name} expected ${catalog.rows} rows, received ${Array.isArray(rows) ? rows.length : "a non-array"}.`);
  }
  const presentationIndexes = new Set([
    ...catalog.scalarPresentationIndexes,
    ...(catalog.arrayPresentationIndexes ?? []).map(({ index }) => index),
  ]);
  const mechanicsRows = rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || !catalog.widths.includes(row.length)) {
      fail(`${catalog.name}[${rowIndex}] expected width ${catalog.widths.join(" or ")}, received ${Array.isArray(row) ? row.length : "a non-array"}.`);
    }
    for (const index of catalog.scalarPresentationIndexes) {
      if (typeof row[index] !== "string") fail(`${catalog.name}[${rowIndex}][${index}] is not a presentation string.`);
    }
    for (const { index, length } of catalog.arrayPresentationIndexes ?? []) {
      if (!Array.isArray(row[index]) || row[index].length !== length || row[index].some((value) => typeof value !== "string")) {
        fail(`${catalog.name}[${rowIndex}][${index}] is not a ${length}-string presentation array.`);
      }
    }
    return row.filter((_value, index) => !presentationIndexes.has(index));
  });
  return { ...range, text: JSON.stringify(mechanicsRows) };
}

function stripObjectCatalog(source, catalog) {
  const range = catalogArrayRange(source, catalog);
  const propertyPattern = new RegExp(`\\b(${catalog.properties.join("|")}):\\s*("(?:\\\\.|[^"\\\\])*")\\s*,\\s*`, "g");
  let matches = 0;
  const text = range.text.replace(propertyPattern, () => {
    matches += 1;
    return "";
  });
  if (matches !== catalog.expectedMatches) {
    fail(`${catalog.name} expected ${catalog.expectedMatches} presentation properties, received ${matches}.`);
  }
  return { ...range, text };
}

function sourceFingerprint(source) {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function replaceAnchoredRange(source, startAnchor, endAnchor, replacement, name, expectedFingerprint) {
  const start = uniqueAnchor(source, startAnchor, `${name} start`);
  const end = uniqueAnchor(source, endAnchor, `${name} end`);
  if (end <= start) fail(`${name} anchors are out of order.`);
  const actualFingerprint = sourceFingerprint(source.slice(start, end));
  if (actualFingerprint !== expectedFingerprint) {
    fail(`${name} body changed (expected ${expectedFingerprint}, found ${actualFingerprint}).`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

const SERVER_DEFINE_BLOCKS = `function defineBlocks(specs: readonly (readonly any[])[]): Record<BlockId, BlockDefinition> {
  return Object.fromEntries(specs.map(([id, hardness, preferredTool, drop, minimumTier]) => [id, {
    id, hardness, preferredTool,
    ...(minimumTier ? { requiredDropTool: { kind: "pickaxe" as const, minimumTier } } : {}),
    drop,
  }])) as Record<BlockId, BlockDefinition>;
}

`;

const SERVER_ITEM_BUILDERS = `function blockItem(id: BlockId): ItemDefinition {
  return { id, category: "block", maxStack: 64, placesBlock: id } as ItemDefinition;
}

function toolItem(id: ToolId, kind: Exclude<ToolKind, "hand">, tier: Exclude<ToolTier, "none">): ItemDefinition {
  const tierBonus = tier === "diamond" ? 3 : tier === "iron" ? 2 : tier === "stone" ? 1 : 0;
  const attackDamage = ({ pickaxe: 2, axe: 3, shovel: 1, sword: 4 } as const)[kind] + tierBonus;
  const maxDurability = ({ wood: 59, gold: 32, stone: 131, iron: 250, diamond: 1561 } as const)[tier];
  return { id, category: "tool", maxStack: 1, tool: { kind, tier, attackDamage, maxDurability } } as ItemDefinition;
}

function armorItem(id: ArmorId, slot: ArmorSlot, protection: number, material: "leather" | "iron" | "gold" | "diamond"): ItemDefinition {
  const durabilityBase = ({ leather: 5, gold: 7, iron: 15, diamond: 33 } as const)[material];
  const slotMultiplier = ({ head: 11, chest: 16, legs: 15, feet: 13 } as const)[slot];
  return { id, category: "armor", maxStack: 1, armor: { slot, protection, maxDurability: durabilityBase * slotMultiplier } } as ItemDefinition;
}

function foodItem(id: ItemId, hunger: number): ItemDefinition {
  return { id, category: "food", maxStack: 64, food: { hunger } } as ItemDefinition;
}

`;

const SERVER_ITEM_ENTRIES = `const ITEM_ENTRIES: Array<readonly [ItemId, ItemDefinition]> = [
  ...BLOCK_ITEM_SPECS.map(([id]) => [id, blockItem(id)] as const),
  ...BASIC_ITEM_SPECS.map(([id]) => [id, { id, category: "material", maxStack: 64 } as ItemDefinition] as const),
  ...UTILITY_ITEM_SPECS.map(([id, maxDurability]) => [id, { id, category: "tool", maxStack: 1, utility: { maxDurability } } as ItemDefinition] as const),
  ...RANGED_ITEM_SPECS.map(([id, category, maxStack, maxDurability, maxChargeMs]) => [id, { id, category, maxStack, ranged: { maxDurability, maxChargeMs } } as ItemDefinition] as const),
  ...FOOD_ITEM_SPECS.map(([id, hunger]) => [id, foodItem(id, hunger)] as const),
  ...TOOL_TIER_SPECS.flatMap(([idPrefix, tier]) => TOOL_KIND_SPECS.map(([kind]) => {
    const id = \`${"${idPrefix}_${kind}"}\` as ToolId;
    return [id, toolItem(id, kind, tier)] as const;
  })),
  ...ARMOR_MATERIAL_SPECS.flatMap(([idPrefix, material, protections]) => ARMOR_PIECE_SPECS.map(([piece, slot], index) => {
    const id = \`${"${idPrefix}_${piece}"}\` as ArmorId;
    return [id, armorItem(id, slot, protections[index], material)] as const;
  })),
];

`;

const SERVER_CRAFTING_TABLE_RECIPE = `function craftingTableRecipe(id: ItemId, ingredients: readonly RecipeIngredientSpec[]): Recipe {
  return {
    id,
    craftingContext: "crafting_table",
    ingredients: ingredients.map(([itemId, count]) => ({ itemId, count })),
    output: { itemId: id, count: 1 },
  } as Recipe;
}

`;

export function stripServerGamePresentation(source) {
  const replacements = [
    ...TUPLE_CATALOGS.map((catalog) => stripTupleCatalog(source, catalog)),
    ...OBJECT_CATALOGS.map((catalog) => stripObjectCatalog(source, catalog)),
  ].sort((left, right) => right.start - left.start);
  let contents = source;
  for (const replacement of replacements) {
    contents = `${contents.slice(0, replacement.start)}${replacement.text}${contents.slice(replacement.end)}`;
  }
  contents = replaceAnchoredRange(contents, "function defineBlocks(", "export const BLOCKS = defineBlocks(", SERVER_DEFINE_BLOCKS, "block mechanics builder", "e45cb2fa");
  contents = replaceAnchoredRange(contents, "function blockItem(", "type BasicItemSpec =", SERVER_ITEM_BUILDERS, "item mechanics builders", "0eb24b09");
  contents = replaceAnchoredRange(contents, "const ITEM_ENTRIES:", "export const ITEMS =", SERVER_ITEM_ENTRIES, "item mechanics catalog", "f62069d2");
  contents = replaceAnchoredRange(contents, "function craftingTableRecipe(", "const GENERATED_TOOL_RECIPES =", SERVER_CRAFTING_TABLE_RECIPE, "recipe mechanics builder", "6fb8bfa0");
  return contents;
}

/**
 * Conservative source guard for every module in the server bundle except the
 * catalog implementation itself. Catalog consumers may use mechanics, but a
 * deploy fails if they name a presentation field while importing ITEMS/BLOCKS.
 */
export function assertNoServerGamePresentationUse(inputs) {
  const importPattern = /import\s+(?!type\b)([\s\S]*?)\s+from\s+["'][^"']*\/game(?:\.ts)?["']/g;
  const namespacePattern = /\*\s+as\s+/;
  const presentationPattern = new RegExp(`\\b(${PRESENTATION_FIELDS.join("|")})\\b`);
  for (const { path, source } of inputs) {
    if (path.endsWith("/shared/game.ts") || path.endsWith("\\shared\\game.ts")) continue;
    let importsCatalog = false;
    for (const match of source.matchAll(importPattern)) {
      if (namespacePattern.test(match[1])) fail(`${path} uses a namespace import from shared/game.ts.`);
      if (/\b(?:ITEMS|BLOCKS|RECIPES|SMELTING_RECIPES)\b/.test(match[1])) importsCatalog = true;
    }
    if (importsCatalog) {
      const field = presentationPattern.exec(source)?.[1];
      if (field) fail(`${path} imports ITEMS/BLOCKS and names presentation field "${field}".`);
    }
  }
}

export const SERVER_PRESENTATION_SENTINELS = Object.freeze({
  blockLabel: "Grass",
  blockDescription: "A living cap over packed earth.",
  blockColor: "#718447",
  itemShortLabel: "GRS",
  itemGlyph: "▨",
  toolDescription: "A light pick for fieldstone.",
  armorDescription: "A durable diamond helmet.",
  recipeLabel: "Saw planks",
  recipeNote: "Split one log into four boards.",
  smeltingLabel: "Smelt iron",
});
