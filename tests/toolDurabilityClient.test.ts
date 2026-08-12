import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const glyph = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");

assert.equal(multiplayer.includes("recordConfirmedToolUse"), false);
assert.doesNotMatch(multiplayer, /attackMob|attackPlayer|editWorldBlock/,
  "Railway actions cannot spend tools through retired Lakebed mutations");
assert.match(multiplayer, /await sink\(pending\.operationId, pending\.optimisticEdit\)/);
assert.match(singleplayer, /applyConfirmedDurableItemUse/);
assert.match(glyph, /className="lc-durability"/);

console.log("tool durability authority tests passed");
