import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  SMELTING_RECIPES,
} from "../shared/game.ts";
import { compactClientGameCatalog } from "../scripts/server-game-catalog-transform.mjs";

const source = readFileSync(new URL("../shared/game.ts", import.meta.url), "utf8");
const transformed = compactClientGameCatalog(source);

assert.doesNotMatch(transformed, /A living cap over packed earth|A durable diamond helmet|Split one log into four boards|Smelt iron/,
  "reviewed catalog presentation text is hidden inside the encoded payload");
assert.match(transformed, /new TextDecoder\(\)\.decode\(__lakecraftDecodeStaticBytes\("[^"]+",38954,\d+,true\)\)/,
  "one bounded UTF-8 payload reconstructs the reviewed catalogs");
assert.equal((transformed.match(/__lakecraftGameCatalog\[/g) ?? []).length, 12,
  "ten tuple catalogs, base recipes, and smelting recipes each use one table reference");
assert.doesNotMatch(transformed, /\beval\b|new Function|WebAssembly|DecompressionStream/,
  "catalog decoding adds no executable-code or asynchronous decompression surface");

for (const changedSource of [
  source.replace("0.75, \"shovel\"", "0.76, \"shovel\""),
  source.replace("A living cap over packed earth.", "Changed presentation text."),
  source.replace("Split one log into four boards.", "Changed recipe text."),
  source.replace("Smelt iron", "Changed smelting label"),
]) {
  assert.throws(
    () => compactClientGameCatalog(changedSource),
    /client catalog values changed/,
    "every mechanical and presentation literal is bound to the reviewed fingerprint",
  );
}
assert.throws(
  () => compactClientGameCatalog(`${source}\nconst __lakecraftGameCatalog = [];`),
  /identifier collides/,
  "the injected identifier fails closed on a source collision",
);
assert.throws(
  () => compactClientGameCatalog(source.replace('["bricks", "BRK", "▦"],', "")),
  /BLOCK_ITEM_SPECS expected 224 rows/,
  "tuple row removal fails before a compact build",
);

const directory = mkdtempSync(join(tmpdir(), "lakecraft-client-game-catalog-"));
try {
  mkdirSync(join(directory, "shared"));
  mkdirSync(join(directory, "client"));
  writeFileSync(join(directory, "shared", "game.ts"), transformed);
  cpSync(new URL("../shared/expandedBuildingCatalog.ts", import.meta.url), join(directory, "shared", "expandedBuildingCatalog.ts"));
  cpSync(new URL("../client/staticData.ts", import.meta.url), join(directory, "client", "staticData.ts"));
  const compactGame = await import(`${pathToFileURL(join(directory, "shared", "game.ts")).href}?v=${Date.now()}`);
  assert.deepEqual(compactGame.BLOCKS, BLOCKS, "every decoded block field and number is exact");
  assert.deepEqual(compactGame.ITEMS, ITEMS, "every decoded item field, glyph, color, and mechanic is exact");
  assert.deepEqual(compactGame.RECIPES, RECIPES, "base and generated recipes remain exact and ordered");
  assert.deepEqual(compactGame.SMELTING_RECIPES, SMELTING_RECIPES, "smelting recipes remain exact and ordered");
  assert.equal(compactGame.ITEMS.grass.glyph, "▨", "Unicode glyph fidelity is explicit");
  assert.equal(compactGame.ITEMS.iron_ingot.shortLabel, "I·FE", "Unicode short-label fidelity is explicit");
  assert.equal(compactGame.ITEMS.shears.glyph, "✂", "non-ASCII tool glyph fidelity is explicit");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("client game catalog compact transform guards and exact runtime parity: ok");
