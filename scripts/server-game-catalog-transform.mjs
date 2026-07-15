const PRESENTATION_FIELDS = ["label", "description", "shortLabel", "glyph", "accent", "color"];

const TUPLE_CATALOGS = [
  {
    name: "BLOCKS",
    anchor: "export const BLOCKS = defineBlocks(",
    arrayAfterAnchor: true,
    rows: 22,
    widths: [8, 9],
    scalarPresentationIndexes: [1, 2, 3, 4],
  },
  {
    name: "BLOCK_ITEM_SPECS",
    anchor: "const BLOCK_ITEM_SPECS",
    rows: 22,
    widths: [3],
    scalarPresentationIndexes: [1, 2],
  },
  {
    name: "BASIC_ITEM_SPECS",
    anchor: "const BASIC_ITEM_SPECS",
    rows: 13,
    widths: [6],
    scalarPresentationIndexes: [1, 2, 3, 4, 5],
  },
  {
    name: "UTILITY_ITEM_SPECS",
    anchor: "const UTILITY_ITEM_SPECS",
    rows: 1,
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
    rows: 7,
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
  { name: "RECIPES", anchor: "export const RECIPES", properties: ["label", "note"], expectedMatches: 26 },
  { name: "SMELTING_RECIPES", anchor: "export const SMELTING_RECIPES", properties: ["label"], expectedMatches: 6 },
];

const GENERATED_PRESENTATION_EXPRESSIONS = [
  "`${labelPrefix} ${kindLabel}`",
  "`${shortPrefix}·${kindShort}`",
  "`${labelPrefix} ${pieceLabels[index]}`",
  "`${shortPrefix}·${pieceShort}`",
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
  const strippedRows = rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || !catalog.widths.includes(row.length)) {
      fail(`${catalog.name}[${rowIndex}] expected width ${catalog.widths.join(" or ")}, received ${Array.isArray(row) ? row.length : "a non-array"}.`);
    }
    const stripped = structuredClone(row);
    for (const index of catalog.scalarPresentationIndexes) {
      if (typeof row[index] !== "string") fail(`${catalog.name}[${rowIndex}][${index}] is not a presentation string.`);
      stripped[index] = "";
    }
    for (const { index, length } of catalog.arrayPresentationIndexes ?? []) {
      if (!Array.isArray(row[index]) || row[index].length !== length || row[index].some((value) => typeof value !== "string")) {
        fail(`${catalog.name}[${rowIndex}][${index}] is not a ${length}-string presentation array.`);
      }
      stripped[index] = new Array(length).fill("");
    }
    const mechanicsBefore = row.filter((_value, index) => !presentationIndexes.has(index));
    const mechanicsAfter = stripped.filter((_value, index) => !presentationIndexes.has(index));
    if (JSON.stringify(mechanicsBefore) !== JSON.stringify(mechanicsAfter)) {
      fail(`${catalog.name}[${rowIndex}] mechanical fields changed.`);
    }
    return stripped;
  });
  return { ...range, text: JSON.stringify(strippedRows) };
}

function stripObjectCatalog(source, catalog) {
  const range = catalogArrayRange(source, catalog);
  const propertyPattern = new RegExp(`\\b(${catalog.properties.join("|")}):\\s*("(?:\\\\.|[^"\\\\])*")`, "g");
  let matches = 0;
  const text = range.text.replace(propertyPattern, (_match, property) => {
    matches += 1;
    return `${property}:""`;
  });
  if (matches !== catalog.expectedMatches) {
    fail(`${catalog.name} expected ${catalog.expectedMatches} presentation properties, received ${matches}.`);
  }
  return { ...range, text };
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
  for (const expression of GENERATED_PRESENTATION_EXPRESSIONS) {
    const first = contents.indexOf(expression);
    if (first < 0) fail(`generated presentation expression ${expression} is missing.`);
    if (contents.indexOf(expression, first + expression.length) >= 0) {
      fail(`generated presentation expression ${expression} is ambiguous.`);
    }
    contents = `${contents.slice(0, first)}""${contents.slice(first + expression.length)}`;
  }
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
      if (/\b(?:ITEMS|BLOCKS)\b/.test(match[1])) importsCatalog = true;
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
