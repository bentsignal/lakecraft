import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ITEMS as clientItems,
  BLOCKS as clientBlocks,
  RECIPES as clientRecipes,
  SMELTING_RECIPES as clientSmeltingRecipes,
} from "../shared/game.ts";
import {
  SERVER_PRESENTATION_SENTINELS,
  assertNoServerGamePresentationUse,
  stripServerGamePresentation,
} from "../scripts/server-game-catalog-transform.mjs";

type GameModule = typeof import("../shared/game.ts");

function blockMechanics(blocks: GameModule["BLOCKS"]) {
  return Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id, {
    id: block.id,
    hardness: block.hardness,
    preferredTool: block.preferredTool,
    requiredDropTool: block.requiredDropTool,
    drop: block.drop,
  }]));
}

function itemMechanics(items: GameModule["ITEMS"]) {
  return Object.fromEntries(Object.entries(items).map(([id, item]) => [id, {
    id: item.id,
    category: item.category,
    maxStack: item.maxStack,
    placesBlock: item.placesBlock,
    tool: item.tool,
    armor: item.armor,
    ranged: item.ranged,
    utility: item.utility,
    food: item.food,
  }]));
}

function recipeMechanics(recipes: GameModule["RECIPES"]) {
  return recipes.map(({ id, craftingContext, ingredients, output }) => ({ id, craftingContext, ingredients, output }));
}

function smeltingMechanics(recipes: GameModule["SMELTING_RECIPES"]) {
  return recipes.map(({ id, input, output }) => ({ id, input, output }));
}

async function run() {
const source = readFileSync(new URL("../shared/game.ts", import.meta.url), "utf8");
const transformed = stripServerGamePresentation(source);
assert.throws(
  () => stripServerGamePresentation(source.replace("pickaxe: 2", "pickaxe: 20")),
  /item mechanics builders body changed/,
  "server mechanics builders must fail closed instead of restoring stale frozen mechanics",
);

for (const [kind, sentinel] of Object.entries(SERVER_PRESENTATION_SENTINELS)) {
  assert.equal(source.includes(sentinel), true, `${kind} sentinel must remain in local/client source`);
  assert.equal(transformed.includes(sentinel), false, `${kind} sentinel must be absent from server source`);
}

const directory = mkdtempSync(join(tmpdir(), "lakecraft-server-game-"));
const transformedPath = join(directory, "game.ts");
writeFileSync(transformedPath, transformed);
try {
  const serverGame = await import(`${pathToFileURL(transformedPath).href}?v=${Date.now()}`) as GameModule;
  assert.deepEqual(blockMechanics(serverGame.BLOCKS), blockMechanics(clientBlocks));
  assert.deepEqual(itemMechanics(serverGame.ITEMS), itemMechanics(clientItems));
  assert.deepEqual(recipeMechanics(serverGame.RECIPES), recipeMechanics(clientRecipes));
  assert.deepEqual(smeltingMechanics(serverGame.SMELTING_RECIPES), smeltingMechanics(clientSmeltingRecipes));

  for (const block of Object.values(serverGame.BLOCKS)) {
    for (const field of ["label", "description", "color", "accent"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(block, field), false, `server block omits ${field}`);
    }
  }
  for (const item of Object.values(serverGame.ITEMS)) {
    for (const field of ["label", "shortLabel", "description", "glyph", "color"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, field), false, `server item omits ${field}`);
    }
  }
  for (const recipe of serverGame.RECIPES) {
    assert.equal(Object.prototype.hasOwnProperty.call(recipe, "label"), false, "server recipe omits label");
    assert.equal(Object.prototype.hasOwnProperty.call(recipe, "note"), false, "server recipe omits note");
  }
  for (const recipe of serverGame.SMELTING_RECIPES) {
    assert.equal(Object.prototype.hasOwnProperty.call(recipe, "label"), false, "server smelting recipe omits label");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

assert.doesNotThrow(() => assertNoServerGamePresentationUse([{
  path: "/capsule/shared/example.ts",
  source: 'import { ITEMS } from "./game.ts"; export const durability = ITEMS.wooden_pickaxe.tool?.maxDurability;',
}]));
assert.throws(() => assertNoServerGamePresentationUse([{
  path: "/capsule/shared/example.ts",
  source: 'import { ITEMS } from "./game.ts"; export const name = ITEMS.wooden_pickaxe.label;',
}]), /names presentation field "label"/);
assert.throws(() => assertNoServerGamePresentationUse([{
  path: "/capsule/shared/example.ts",
  source: 'import * as game from "./game.ts"; export const item = game.ITEMS.wooden_pickaxe;',
}]), /namespace import/);
assert.throws(() => assertNoServerGamePresentationUse([{
  path: "/capsule/shared/example.ts",
  source: 'import { RECIPES } from "./game.ts"; export const name = RECIPES[0].label;',
}]), /names presentation field "label"/);
for (const access of ["RECIPES[0].note", 'RECIPES[0]["note"]']) {
  assert.throws(() => assertNoServerGamePresentationUse([{
    path: "/capsule/shared/example.ts",
    source: `import { RECIPES } from "./game.ts"; export const note = ${access};`,
  }]), /names presentation field "note"/);
}
assert.throws(() => assertNoServerGamePresentationUse([{
  path: "/capsule/shared/example.ts",
  source: 'import { SMELTING_RECIPES } from "./game.ts"; export const name = SMELTING_RECIPES[0].label;',
}]), /names presentation field "label"/);

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const prepareSource = readFileSync(join(repositoryRoot, "scripts/prepare-lakebed-deploy.mjs"), "utf8");
assert.match(prepareSource, /LAKEBED_COMPACT_BUNDLE/);
assert.match(prepareSource, /minify: process\.env\.LAKEBED_COMPACT_BUNDLE === "1"/);
const stage = mkdtempSync(join(tmpdir(), "lakecraft-server-stage-"));
try {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/prepare-lakebed-deploy.mjs"), stage], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  const clientBundle = readFileSync(join(stage, "client/index.tsx"), "utf8");
  const serverBundle = readFileSync(join(stage, "server/index.ts"), "utf8");
  const sourceMapPrefix = "//# sourceMappingURL=data:application/json;base64,";
  const clientSourceMapOffset = clientBundle.lastIndexOf(sourceMapPrefix);
  assert.notEqual(clientSourceMapOffset, -1, "client stage declares an upstream source-map boundary");
  assert.deepEqual(JSON.parse(Buffer.from(
    clientBundle.slice(clientSourceMapOffset + sourceMapPrefix.length).trim(),
    "base64",
  ).toString("utf8")), {
    version: 3,
    sources: ["lakecraft-client-stage.tsx"],
    sourcesContent: [null],
    names: [],
    mappings: "AAAA",
  });
  const sourceMapOffset = serverBundle.lastIndexOf(sourceMapPrefix);
  assert.notEqual(sourceMapOffset, -1, "server stage declares an upstream source-map boundary");
  const boundaryMap = JSON.parse(Buffer.from(
    serverBundle.slice(sourceMapOffset + sourceMapPrefix.length).trim(),
    "base64",
  ).toString("utf8"));
  assert.deepEqual(boundaryMap, {
    version: 3,
    sources: ["lakecraft-server-stage.ts"],
    sourcesContent: [null],
    names: [],
    mappings: "AAAA",
  });
  for (const [kind, sentinel] of Object.entries(SERVER_PRESENTATION_SENTINELS)) {
    assert.equal(clientBundle.includes(sentinel), true, `${kind} remains available to the staged client`);
    assert.equal(serverBundle.includes(sentinel), false, `${kind} is absent from the staged server`);
  }
  for (const mechanics of [
    "pickaxe:2,axe:3,shovel:1,sword:4",
    "wood:59,gold:32,stone:131,iron:250,diamond:1561",
    "leather:5,gold:7,iron:15,diamond:33",
    "head:11,chest:16,legs:15,feet:13",
  ]) assert.equal(serverBundle.includes(mechanics), true, `server retains mechanical table ${mechanics}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

console.log("server game catalog deploy transform checks passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
