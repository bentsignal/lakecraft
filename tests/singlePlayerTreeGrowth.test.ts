import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const saveSource = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const interactionStart = source.indexOf("target.block.block === BLOCK.SAPLING");
const craftingStart = source.indexOf("target.block.block === BLOCK.CRAFTING_TABLE", interactionStart);
assert.ok(interactionStart >= 0 && craftingStart > interactionStart, "sapling use is dispatched before ordinary block UI interactions");
const interaction = source.slice(interactionStart, craftingStart);

assert.match(source, /\[BLOCK\.SAPLING\]:\s*"sapling"/);
assert.match(source, /sapling:\s*BLOCK\.SAPLING/);
assert.match(saveSource, /candidate\.block, BLOCK\.AIR, BLOCK\.BEDROCK/, "offline saves retain saplings and later append-only block edits");
assert.match(interaction, /itemId === "bone_meal"/, "growth requires selected bone meal");
assert.ok(
  interaction.indexOf("planOakTreeGrowth") < interaction.indexOf("stack.count - 1"),
  "support and full clearance are proven before bone meal is consumed",
);
assert.match(interaction, /index !== selectedRef\.current/, "bone meal is removed from the selected held slot");
assert.match(interaction, /localEngine\.applyWorldEdits\(growthEdits\)/, "the whole tree is applied as one bounded renderer batch");
assert.ok(
  interaction.indexOf("editsRef.current =") < interaction.indexOf("updateInventory(nextInventory)"),
  "tree edits and item consumption are persisted as one synchronous offline action",
);
assert.doesNotMatch(interaction, /setInterval|setTimeout|useQuery|useMutation|fetch\(/, "offline growth adds no timer or network loop");

console.log("single-player deterministic oak growth integration tests passed");
