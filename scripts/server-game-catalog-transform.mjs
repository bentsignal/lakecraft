import { encodeStaticBytes } from "./static-byte-encoding.mjs";

const PRESENTATION_FIELDS = ["label", "note", "description", "shortLabel", "glyph", "accent", "color"];

const TUPLE_CATALOGS = [
  {
    name: "BLOCKS",
    anchor: "export const BLOCKS = defineBlocks(",
    arrayAfterAnchor: true,
    rows: 323,
    widths: [8, 9],
    scalarPresentationIndexes: [1, 2, 3, 4],
  },
  {
    name: "BLOCK_ITEM_SPECS",
    anchor: "const BLOCK_ITEM_SPECS",
    rows: 323,
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
    name: "CONTAINER_ITEM_SPECS",
    anchor: "const CONTAINER_ITEM_SPECS",
    rows: 3,
    widths: [6],
    scalarPresentationIndexes: [1, 2, 3, 4],
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
  { name: "RECIPES", anchor: "export const RECIPES", properties: ["label", "note"], expectedMatches: 232 },
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
  // Generated catalog rows are deliberately JSON-compatible while the older
  // handwritten rows use TypeScript's unquoted keys. Strip presentation-only
  // strings from both forms or fail the exact match count below.
  const propertyPattern = new RegExp(`"?\\b(${catalog.properties.join("|")})\\b"?:\\s*("(?:\\\\.|[^"\\\\])*")\\s*,\\s*`, "g");
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
  ...CONTAINER_ITEM_SPECS.map(([id, maxStack]) => [id, {
    id, category: "material", maxStack,
    ...(id === "water_bucket" ? { placesBlock: "water" as const }
      : id === "lava_bucket" ? { placesBlock: "lava" as const } : {}),
  } as ItemDefinition] as const),
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

const CLIENT_CATALOG_IDENTIFIER = "__lakecraftGameCatalog";
const CLIENT_CATALOG_FINGERPRINT = "5df94cd8";

function compressStaticBytes(bytes) {
  const packed = [];
  for (let index = 0; index < bytes.length;) {
    const control = packed.length;
    packed.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && index < bytes.length; bit += 1) {
      let length = 0;
      let distance = 0;
      for (let source = Math.max(0, index - 4_095); source < index; source += 1) {
        let candidate = 0;
        while (candidate < 273 && index + candidate < bytes.length
          && bytes[source + candidate] === bytes[index + candidate]) candidate += 1;
        if (candidate > length) {
          length = candidate;
          distance = index - source;
        }
      }
      if (length >= 3) {
        flags |= 1 << bit;
        const value = (Math.min(length, 18) - 3) * 4_096 + distance;
        if (length >= 18) packed.push(value >> 8, value & 255, length - 18);
        else packed.push(value >> 8, value & 255);
        index += length;
      } else packed.push(bytes[index++]);
    }
    packed[control] = flags;
  }
  return packed;
}

function decompressStaticBytes(packed, size) {
  const data = new Uint8Array(size);
  let target = 0;
  for (let cursor = 0; cursor < packed.length && target < size;) {
    const flags = packed[cursor++];
    for (let bit = 0; bit < 8 && cursor < packed.length && target < size; bit += 1) {
      if (flags & 1 << bit) {
        const value = packed[cursor++] * 256 + packed[cursor++];
        let length = (value >> 12) + 3;
        if (length === 18) length += packed[cursor++];
        const distance = value & 4_095;
        if (distance < 1 || distance > target || target + length > size) fail("client presentation compression produced an invalid back-reference.");
        for (let copy = 0; copy < length; copy += 1) data[target] = data[target++ - distance];
      } else data[target++] = packed[cursor++];
    }
  }
  if (target !== size) fail(`client presentation compression decoded ${target} of ${size} bytes.`);
  return data;
}

/**
 * Replace the reviewed literal tuple, base-recipe, and smelting catalogs with
 * one compressed, fingerprinted UTF-8 table. Runtime catalog objects are
 * reconstructed by the unchanged builders.
 */
export function compactClientGameCatalog(source) {
  if (source.includes(CLIENT_CATALOG_IDENTIFIER)) {
    fail("client catalog identifier collides with source text.");
  }
  const catalogs = [];
  const replacements = [];
  for (const catalog of TUPLE_CATALOGS) {
    const range = catalogArrayRange(source, catalog);
    const rows = parseLiteralArray(range.text, catalog.name);
    if (!Array.isArray(rows) || rows.length !== catalog.rows) {
      fail(`${catalog.name} expected ${catalog.rows} rows, received ${Array.isArray(rows) ? rows.length : "a non-array"}.`);
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!Array.isArray(row) || !catalog.widths.includes(row.length)) {
        fail(`${catalog.name}[${rowIndex}] expected width ${catalog.widths.join(" or ")}, received ${Array.isArray(row) ? row.length : "a non-array"}.`);
      }
      for (const index of catalog.scalarPresentationIndexes) {
        if (typeof row[index] !== "string") fail(`${catalog.name}[${rowIndex}][${index}] is not a presentation string.`);
      }
      for (const { index, length } of catalog.arrayPresentationIndexes ?? []) {
        if (!Array.isArray(row[index]) || row[index].length !== length || row[index].some((value) => typeof value !== "string")) {
          fail(`${catalog.name}[${rowIndex}][${index}] changed shape.`);
        }
      }
    }
    const index = catalogs.length;
    catalogs.push(rows);
    replacements.push({ ...range, text: `[...${CLIENT_CATALOG_IDENTIFIER}[${index}]]` });
  }

  const parseObjectRows = (text, name, expectedRows) => {
    const rows = [];
    for (const match of text.matchAll(/^\s*(\{.*\}),\s*$/gm)) {
      const json = match[1]
        .replace(/([{,]\s*)([A-Za-z][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/,\s*([}\]])/g, "$1");
      try {
        rows.push(JSON.parse(json));
      } catch (error) {
        fail(`${name} row is no longer a JSON-compatible object (${error instanceof Error ? error.message : "parse error"}).`);
      }
    }
    if (rows.length !== expectedRows || text.replace(/^\s*(\{.*\}),\s*$/gm, "").trim()) {
      fail(`${name} expected exactly ${expectedRows} literal object rows.`);
    }
    return rows;
  };

  const recipeRange = catalogArrayRange(source, OBJECT_CATALOGS[0]);
  const recipeSpread = recipeRange.text.indexOf("...GENERATED_TOOL_RECIPES");
  if (recipeSpread < 0 || recipeRange.text.indexOf("...GENERATED_TOOL_RECIPES", recipeSpread + 1) >= 0) {
    fail("RECIPES generated spread anchor changed.");
  }
  const literalRecipeText = recipeRange.text.slice(1, recipeSpread);
  const literalRecipes = parseObjectRows(literalRecipeText, "RECIPES", 116);
  const recipeIndex = catalogs.length;
  catalogs.push(literalRecipes);
  replacements.push({
    ...recipeRange,
    text: `[...${CLIENT_CATALOG_IDENTIFIER}[${recipeIndex}],${recipeRange.text.slice(recipeSpread)}`,
  });

  const smeltingRange = catalogArrayRange(source, OBJECT_CATALOGS[1]);
  const smeltingRows = parseObjectRows(smeltingRange.text.slice(1, -1), "SMELTING_RECIPES", 10);
  const smeltingIndex = catalogs.length;
  catalogs.push(smeltingRows);
  replacements.push({ ...smeltingRange, text: `[...${CLIENT_CATALOG_IDENTIFIER}[${smeltingIndex}]]` });

  const serialized = JSON.stringify(catalogs);
  const fingerprint = sourceFingerprint(serialized);
  if (fingerprint !== CLIENT_CATALOG_FINGERPRINT) {
    fail(`client catalog values changed (expected ${CLIENT_CATALOG_FINGERPRINT}, found ${fingerprint}).`);
  }
  const bytes = new TextEncoder().encode(serialized);
  const packed = compressStaticBytes(bytes);
  if (!Buffer.from(decompressStaticBytes(packed, bytes.length)).equals(Buffer.from(bytes))) {
    fail("client presentation compression did not round-trip exactly.");
  }
  let contents = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    contents = `${contents.slice(0, replacement.start)}${replacement.text}${contents.slice(replacement.end)}`;
  }
  const payload = encodeStaticBytes(packed);
  return `import{decodeStaticBytes as __lakecraftDecodeStaticBytes}from"../client/staticData.ts";`
    + `const ${CLIENT_CATALOG_IDENTIFIER}=JSON.parse(new TextDecoder().decode(__lakecraftDecodeStaticBytes(${JSON.stringify(payload)},${bytes.length},${packed.length},true))) as any[][];`
    + contents;
}

export function stripServerGamePresentation(source) {
  const replacements = [
    ...TUPLE_CATALOGS.map((catalog) => stripTupleCatalog(source, catalog)),
    ...OBJECT_CATALOGS.map((catalog) => stripObjectCatalog(source, catalog)),
  ].sort((left, right) => right.start - left.start);
  let contents = source;
  for (const replacement of replacements) {
    contents = `${contents.slice(0, replacement.start)}${replacement.text}${contents.slice(replacement.end)}`;
  }
  contents = replaceAnchoredRange(contents, "function defineBlocks(", "export const BLOCKS = defineBlocks(", SERVER_DEFINE_BLOCKS, "block mechanics builder", "79dcea12");
  contents = replaceAnchoredRange(contents, "function blockItem(", "type BasicItemSpec =", SERVER_ITEM_BUILDERS, "item mechanics builders", "0eb24b09");
  contents = replaceAnchoredRange(contents, "const ITEM_ENTRIES:", "export const ITEMS =", SERVER_ITEM_ENTRIES, "item mechanics catalog", "cadb670e");
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
  itemShortLabel: "D·OR",
  itemGlyph: "▨",
  toolDescription: "A light pick for fieldstone.",
  armorDescription: "A durable diamond helmet.",
  recipeLabel: "Saw planks",
  recipeNote: "Split one log into four boards.",
  smeltingLabel: "Smelt iron",
});
