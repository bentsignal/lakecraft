import assert from "node:assert/strict";
import {
  TNT_FUSE_MS,
  FLINT_AND_STEEL_MAX_DURABILITY,
  authorizeTntExplosion,
  authorizeTntIgnition,
  createTntFuse,
  decideTntReceipt,
  electTntExplosionClaimer,
  normalizeStoredTntFuse,
  spendFlintAndSteelIgnitionDurability,
  tntExplosionFingerprint,
  tntIgnitionFingerprint,
  validateTntExplosionRequestJson,
  validateTntIgnitionRequestJson,
} from "../shared/tntAuthority.ts";

const ignition = validateTntIgnitionRequestJson(JSON.stringify({
  operationId: "ignite_0123456789abcdef",
  x: 7, y: 4, z: -2,
  blockInstanceToken: "worldedit_abc123:1725000000000",
}));
assert.ok(ignition);
for (const forged of ["center", "radius", "damage", "victims", "blocks", "dueAt"]) {
  assert.equal(validateTntIgnitionRequestJson(JSON.stringify({ ...ignition, [forged]: [] })), null);
}
assert.equal(authorizeTntIgnition(ignition, {
  currentBlock: "tnt", blockInstanceToken: ignition.blockInstanceToken,
  withinReach: true, heldItem: "flint_and_steel", activeFuseAtCoordinate: false,
}).ok, true);
assert.equal(authorizeTntIgnition(ignition, {
  currentBlock: "tnt", blockInstanceToken: "replaced_abc:1725000000001",
  withinReach: true, heldItem: "flint_and_steel", activeFuseAtCoordinate: false,
}).ok, false);
assert.deepEqual(authorizeTntIgnition(ignition, {
  currentBlock: "tnt", blockInstanceToken: ignition.blockInstanceToken,
  withinReach: true, heldItem: "torch", activeFuseAtCoordinate: false,
}), { ok: false, reason: "flint_and_steel_required" });
assert.deepEqual(spendFlintAndSteelIgnitionDurability({
  itemId: "flint_and_steel", count: 1, durability: FLINT_AND_STEEL_MAX_DURABILITY,
}), {
  ok: true,
  nextStack: { itemId: "flint_and_steel", count: 1, durability: FLINT_AND_STEEL_MAX_DURABILITY - 1 },
  broke: false,
  remainingDurability: FLINT_AND_STEEL_MAX_DURABILITY - 1,
});
assert.deepEqual(spendFlintAndSteelIgnitionDurability({
  itemId: "flint_and_steel", count: 1, durability: 1,
}), { ok: true, nextStack: null, broke: true, remainingDurability: 0 });
assert.deepEqual(spendFlintAndSteelIgnitionDurability({
  itemId: "flint_and_steel", count: 1,
}), { ok: false, reason: "invalid_durability" });

const fuse = createTntFuse(ignition, "user-a", 1_725_000_000_000);
assert.ok(fuse);
assert.equal(fuse.dueAt - fuse.ignitedAt, TNT_FUSE_MS);
assert.deepEqual(normalizeStoredTntFuse({
  ...fuse, x: String(fuse.x), y: String(fuse.y), z: String(fuse.z),
  ignitedAt: String(fuse.ignitedAt), dueAt: String(fuse.dueAt),
}), fuse);
const explosion = validateTntExplosionRequestJson(JSON.stringify({ eventId: fuse.eventId, ignitionId: fuse.ignitionId }));
assert.ok(explosion);
assert.equal(validateTntExplosionRequestJson(JSON.stringify({ ...explosion, center: [7, 4, -2] })), null);
assert.deepEqual(authorizeTntExplosion(explosion, fuse, fuse.dueAt - 1), { ok: false, reason: "fuse_active", retryAfterMs: 1 });
assert.equal(authorizeTntExplosion(explosion, fuse, fuse.dueAt).ok, true);
assert.equal(authorizeTntExplosion(explosion, fuse, fuse.dueAt + 86_400_000).ok, true, "late tabs cannot strand a fuse");

assert.equal(electTntExplosionClaimer(fuse, [
  { userId: "z", x: 8, y: 4, z: -2 },
  { userId: "a", x: 8, y: 4, z: -2 },
]), "a");
assert.equal(electTntExplosionClaimer(fuse, [{ userId: "far", x: 1_000, y: 4, z: 1_000 }]), null);
const ignitionFp = tntIgnitionFingerprint(ignition);
const explosionFp = tntExplosionFingerprint(explosion);
assert.equal(decideTntReceipt(null, ignitionFp), "commit");
assert.equal(decideTntReceipt(ignitionFp, ignitionFp), "replay");
assert.equal(decideTntReceipt(ignitionFp, explosionFp), "operation_id_reused");
console.log("lakecraft TNT authority tests: ok");
