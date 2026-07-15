import assert from "node:assert/strict";
import {
  TNT_CHAIN_MAX_DEPTH,
  TNT_CHAIN_MAX_FUSE_MS,
  TNT_CHAIN_MAX_PER_EXPLOSION,
  TNT_CHAIN_MIN_FUSE_MS,
  deriveTntChainPrimingPlan,
  normalizeStoredTntChainFuse,
  type ActiveTntFuse,
  type AuthoritativeTntBlastCell,
  type TntChainSource,
} from "../shared/tntChainAuthority.ts";
import { TNT_MAX_ACTIVE_FUSES } from "../shared/tntAuthority.ts";

const source: TntChainSource = {
  eventId: "tnt_parent_01234567",
  sourceCoordKey: "0:4:0",
  explodedAt: 1_725_000_004_000,
  igniterUserId: "user-a",
  cascadeDepth: 0,
};
const cell = (x: number, distanceSquared: number, previousBlock: "tnt" | "stone" = "tnt"): AuthoritativeTntBlastCell => ({
  x, y: 4, z: 0, coordKey: `${x}:4:0`, distanceSquared, previousBlock,
  blockInstanceToken: previousBlock === "tnt" ? `worldedit_${String(x).replace("-", "n").padStart(8, "0")}:1725000000000` : null,
});
const cells = [cell(2, 4), cell(0, 0), cell(1, 1), cell(3, 9), cell(20, 400, "stone")];

const first = deriveTntChainPrimingPlan({ source, authoritativeCells: cells, activeFuses: [] });
assert.equal(first.ok, true);
if (!first.ok) throw new Error(first.reason);
assert.deepEqual(first.creates.map((fuse) => fuse.coordKey), ["1:4:0", "2:4:0", "3:4:0"]);
assert.deepEqual(first.suppressedDropCoordKeys, ["0:4:0", "1:4:0", "2:4:0", "3:4:0"],
  "both the exploding source and every secondary TNT are excluded from ordinary drops");
assert.deepEqual(first.skipped, [{ coordKey: "0:4:0", reason: "source" }]);
for (const fuse of first.creates) {
  assert.equal(fuse.parentEventId, source.eventId);
  assert.equal(fuse.cascadeDepth, 1);
  assert.ok(fuse.dueAt - fuse.ignitedAt >= TNT_CHAIN_MIN_FUSE_MS);
  assert.ok(fuse.dueAt - fuse.ignitedAt <= TNT_CHAIN_MAX_FUSE_MS);
  assert.match(fuse.eventId, /^tnt_[0-9a-z]+_[0-9a-z]{7}$/);
  assert.match(fuse.ignitionId, /^chain_[0-9a-z]{7}_[0-9a-z]{7}$/);
  assert.deepEqual(normalizeStoredTntChainFuse({
    ...fuse,
    x: String(fuse.x), y: String(fuse.y), z: String(fuse.z),
    ignitedAt: String(fuse.ignitedAt), dueAt: String(fuse.dueAt), cascadeDepth: String(fuse.cascadeDepth),
  }), fuse);
}

const reordered = deriveTntChainPrimingPlan({ source, authoritativeCells: [...cells].reverse(), activeFuses: [] });
assert.deepEqual(reordered, first, "authoritative database row order cannot alter identities or timing");
const replayed = deriveTntChainPrimingPlan({ source, authoritativeCells: cells, activeFuses: first.creates });
assert.equal(replayed.ok, true);
if (replayed.ok) {
  assert.deepEqual(replayed.creates, []);
  assert.deepEqual(replayed.replays, first.creates, "an exact retry recognizes the same deterministic rows");
}

const occupied = { ...first.creates[0], eventId: "tnt_other_01234567" } satisfies ActiveTntFuse;
const overlap = deriveTntChainPrimingPlan({ source, authoritativeCells: cells, activeFuses: [occupied] });
assert.equal(overlap.ok, true);
if (overlap.ok) {
  assert.ok(overlap.skipped.some((entry) => entry.coordKey === occupied.coordKey && entry.reason === "already_primed"));
  assert.ok(!overlap.creates.some((fuse) => fuse.coordKey === occupied.coordKey));
}
const colliding = { ...first.creates[0], dueAt: first.creates[0].dueAt + 1 } satisfies ActiveTntFuse;
const collision = deriveTntChainPrimingPlan({ source, authoritativeCells: cells, activeFuses: [colliding] });
assert.equal(collision.ok, true);
if (collision.ok) assert.deepEqual(collision.skipped[1], { coordKey: colliding.coordKey, reason: "event_collision" });

const manyCells = Array.from({ length: TNT_CHAIN_MAX_PER_EXPLOSION + 4 }, (_, index) => cell(index + 1, index + 1));
const bounded = deriveTntChainPrimingPlan({ source, authoritativeCells: manyCells, activeFuses: [] });
assert.equal(bounded.ok, true);
if (bounded.ok) assert.equal(bounded.creates.length, TNT_CHAIN_MAX_PER_EXPLOSION);

const deep = deriveTntChainPrimingPlan({
  source: { ...source, cascadeDepth: TNT_CHAIN_MAX_DEPTH }, authoritativeCells: [cell(1, 1)], activeFuses: [],
});
assert.equal(deep.ok, true);
if (deep.ok) {
  assert.deepEqual(deep.creates, []);
  assert.deepEqual(deep.skipped, [{ coordKey: "1:4:0", reason: "cascade_cap" }]);
}

const activeAtCapacity = Array.from({ length: TNT_MAX_ACTIVE_FUSES }, (_, index): ActiveTntFuse => ({
  eventId: `tnt_active_${String(index).padStart(8, "0")}`,
  ignitionId: `active_${String(index).padStart(16, "0")}`,
  coordKey: `${100 + index}:4:0`, x: 100 + index, y: 4, z: 0,
  blockInstanceToken: `worldedit_active${String(index).padStart(8, "0")}:1725000000000`,
  igniterUserId: "user-b", ignitedAt: source.explodedAt, dueAt: source.explodedAt + 4_000,
}));
const capped = deriveTntChainPrimingPlan({ source, authoritativeCells: [cell(1, 1)], activeFuses: activeAtCapacity });
assert.equal(capped.ok, true);
if (capped.ok) assert.deepEqual(capped.skipped, [{ coordKey: "1:4:0", reason: "active_cap" }]);

assert.deepEqual(deriveTntChainPrimingPlan({
  source, authoritativeCells: [{ ...cell(1, 1), blockInstanceToken: null }], activeFuses: [],
}), { ok: false, reason: "invalid_authoritative_cell" }, "TNT must carry the authoritative placed-block token");
assert.deepEqual(deriveTntChainPrimingPlan({
  source: { ...source, explodedAt: Number.MAX_SAFE_INTEGER }, authoritativeCells: [cell(1, 1)], activeFuses: [],
}), { ok: false, reason: "invalid_source" }, "server timing overflow fails closed");

console.log("lakecraft bounded TNT chain authority tests: ok");
