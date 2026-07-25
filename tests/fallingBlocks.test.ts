import assert from "node:assert/strict";
import {
  FALLING_BLOCK_MAX_MOVES,
  FALLING_BLOCK_MAX_VERTICAL_CELLS,
  resolveFallingBlocks,
  type AuthoritativeFallingBlockCell,
  type FallingBlockCellBlock,
  type FallingBlockTrigger,
} from "../shared/fallingBlocks.ts";
import { WORLD_EDIT_MIN_Y } from "../shared/worldChunks.ts";

const x = 17;
const z = -9;
const cell = (y: number, block: FallingBlockCellBlock, token: string | null = null): AuthoritativeFallingBlockCell => ({
  x, y, z, coordKey: `${x}:${y}:${z}`, block, blockInstanceToken: token,
});
const trigger = (
  y: number,
  previousBlock: FallingBlockCellBlock,
  nextBlock: FallingBlockCellBlock,
): FallingBlockTrigger => ({ x, y, z, coordKey: `${x}:${y}:${z}`, previousBlock, nextBlock });

const placed = resolveFallingBlocks({
  trigger: trigger(6, "air", "sand"),
  authoritativeCells: [cell(7, "air"), cell(3, "stone"), cell(6, "sand", "worldedit_sand0001:1725000000000"),
    cell(5, "air"), cell(4, "air")],
});
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error(placed.reason);
assert.deepEqual(placed.moves, [{
  block: "sand",
  source: { x, y: 6, z, coordKey: `${x}:6:${z}`, blockInstanceToken: "worldedit_sand0001:1725000000000" },
  destination: { x, y: 4, z, coordKey: `${x}:4:${z}` },
  fallDistance: 2,
}]);
assert.deepEqual(placed.edits.map(({ phase, coordKey, block }) => [phase, coordKey, block]), [
  ["vacate", `${x}:6:${z}`, "air"],
  ["settle", `${x}:4:${z}`, "sand"],
]);
assert.deepEqual(placed.finalBlocks, { [`${x}:4:${z}`]: "sand", [`${x}:6:${z}`]: "air" });

const stackedFacts = [
  cell(9, "air"), cell(8, "sand"), cell(7, "gravel", "worldedit_gravel01:1725000000001"),
  cell(6, "sand"), cell(5, "air"), cell(4, "air"), cell(3, "stone"),
];
const stacked = resolveFallingBlocks({
  trigger: trigger(5, "dirt", "air"),
  authoritativeCells: stackedFacts,
});
assert.equal(stacked.ok, true);
if (!stacked.ok) throw new Error(stacked.reason);
assert.deepEqual(stacked.moves.map((move) => [move.block, move.source.y, move.destination.y, move.fallDistance]), [
  ["sand", 6, 4, 2], ["gravel", 7, 5, 2], ["sand", 8, 6, 2],
]);
assert.deepEqual(stacked.finalBlocks, {
  [`${x}:4:${z}`]: "sand",
  [`${x}:5:${z}`]: "gravel",
  [`${x}:6:${z}`]: "sand",
  [`${x}:7:${z}`]: "air",
  [`${x}:8:${z}`]: "air",
});
assert.deepEqual(
  resolveFallingBlocks({ trigger: trigger(5, "dirt", "air"), authoritativeCells: [...stackedFacts].reverse() }),
  stacked,
  "database row order cannot alter the finite settlement plan",
);

const occupiedFloor = resolveFallingBlocks({
  trigger: trigger(6, "air", "gravel"), authoritativeCells: [cell(7, "air"), cell(6, "gravel"), cell(5, "grass")],
});
assert.deepEqual(occupiedFloor, { ok: true, moves: [], edits: [], finalBlocks: {} });

const longStack = resolveFallingBlocks({
  trigger: trigger(2, "stone", "air"),
  authoritativeCells: [cell(0, "stone"), cell(1, "air"), cell(2, "air"),
    ...Array.from({ length: FALLING_BLOCK_MAX_MOVES + 3 }, (_, index) => cell(3 + index, index % 2 ? "gravel" : "sand"))],
});
assert.equal(longStack.ok, true);
if (longStack.ok) {
  assert.equal(longStack.moves.length, FALLING_BLOCK_MAX_MOVES);
  assert.equal(longStack.edits.length, FALLING_BLOCK_MAX_MOVES * 2);
  assert.ok(longStack.moves.every((move) => move.fallDistance === 2));
}

const worldFloor = resolveFallingBlocks({
  trigger: trigger(WORLD_EDIT_MIN_Y + 2, "air", "sand"),
  authoritativeCells: [
    cell(WORLD_EDIT_MIN_Y, "air"), cell(WORLD_EDIT_MIN_Y + 1, "air"),
    cell(WORLD_EDIT_MIN_Y + 2, "sand"), cell(WORLD_EDIT_MIN_Y + 3, "air"),
  ],
});
assert.equal(worldFloor.ok, true);
if (worldFloor.ok) assert.equal(worldFloor.moves[0].destination.y, WORLD_EDIT_MIN_Y);

assert.deepEqual(resolveFallingBlocks({
  trigger: trigger(6, "air", "sand"), authoritativeCells: [cell(4, "air"), cell(6, "sand"), cell(7, "air")],
}), { ok: false, reason: "invalid_cell" }, "gapped snapshots fail closed");
assert.deepEqual(resolveFallingBlocks({
  trigger: trigger(6, "air", "sand"), authoritativeCells: [cell(5, "air"), cell(6, "sand"), cell(7, "air")],
}), { ok: false, reason: "incomplete_column" }, "an unproven floor cannot invent a landing");
assert.deepEqual(resolveFallingBlocks({
  trigger: trigger(5, "stone", "air"), authoritativeCells: [cell(3, "stone"), cell(4, "air"), cell(5, "air"), cell(6, "sand")],
}), { ok: false, reason: "incomplete_column" }, "an unproven stack top cannot be erased");
assert.deepEqual(resolveFallingBlocks({
  trigger: trigger(5, "stone", "air"),
  authoritativeCells: Array.from({ length: FALLING_BLOCK_MAX_VERTICAL_CELLS + 1 }, (_, index) => cell(index - 20, "air")),
}), { ok: false, reason: "too_many_cells" });
assert.deepEqual(resolveFallingBlocks({
  trigger: trigger(5, "stone", "air"), authoritativeCells: [{ ...cell(5, "air"), coordKey: "forged" }],
}), { ok: false, reason: "invalid_cell" });

console.log("lakecraft bounded falling-block authority tests: ok");
