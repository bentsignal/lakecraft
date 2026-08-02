import assert from "node:assert/strict";
import {
  PLAYER_KNOCKBACK_COOLDOWN_MS,
  PLAYER_KNOCKBACK_GROUNDED_LIFT,
  decidePlayerKnockback,
  resolvePlayerKnockback,
  stepPlayerKnockbackAxis,
} from "../client/game/playerKnockback.ts";
import {
  consumeMobContactDamage,
  createMobSimulation,
  type MobDamageSource,
} from "../client/game/mobs.ts";

const east = resolvePlayerKnockback(0, 0, 4, 0, 3, true)!;
assert.ok(east.x > 5 && Math.abs(east.z) < 1e-12, "an attacker west of the player pushes east");
assert.equal(east.y, PLAYER_KNOCKBACK_GROUNDED_LIFT);
const northwest = resolvePlayerKnockback(4, -4, 0, 0, 20, false)!;
assert.ok(northwest.x < 0 && northwest.z > 0, "diagonal knockback points away from the attacker");
assert.ok(Math.hypot(northwest.x, northwest.z) <= 6, "damage cannot produce an unbounded horizontal impulse");
assert.ok(northwest.y > 0 && northwest.y < east.y, "airborne hits get only a small lift");
assert.equal(resolvePlayerKnockback(0, 0, 0, 0, 3, true), null, "coincident positions cannot invent a direction");
assert.equal(resolvePlayerKnockback(0, 0, 1, 0, 0, true), null, "rejected zero-damage hits cannot move the player");

assert.equal(decidePlayerKnockback("hit-1", 1_000, 0, false, true), "accept");
assert.equal(decidePlayerKnockback("hit-1", 2_000, 0, true, true), "duplicate");
assert.equal(decidePlayerKnockback("hit-2", 1_100, 1_000 + PLAYER_KNOCKBACK_COOLDOWN_MS, false, true), "cooldown");
assert.equal(decidePlayerKnockback("hit-3", 2_000, 0, false, false), "ineligible");

let moved = 0;
const freeVelocity = stepPlayerKnockbackAxis(5, 0.05, (distance) => { moved += distance; return false; });
assert.ok(moved > 0 && freeVelocity > 0 && freeVelocity < 5, "free knockback moves then decays");
const blockedVelocity = stepPlayerKnockbackAxis(-5, 0.05, () => true);
assert.equal(blockedVelocity, 0, "wall collision cancels the blocked axis instead of tunneling");
assert.equal(stepPlayerKnockbackAxis(Number.NaN, 0.05, () => false), 0);

const contact = createMobSimulation([{
  id: "zombie-knockback",
  kind: "zombie",
  x: 2,
  y: 1,
  z: 3,
  yaw: 0,
  homeX: 2,
  homeZ: 3,
  behaviorSeed: 7,
}]);
const sources: MobDamageSource[] = [];
assert.equal(consumeMobContactDamage(contact, { x: 2.3, y: 1, z: 3 }, 0, true, undefined, sources), 3);
assert.deepEqual(sources, [{
  eventId: "contact:zombie-knockback:0",
  mobId: "zombie-knockback",
  x: 2,
  z: 3,
  damage: 3,
}], "the exact accepted contact identifies its attacker without a second simulation");
sources.length = 0;
assert.equal(consumeMobContactDamage(contact, { x: 2.3, y: 1, z: 3 }, 0.1, true, undefined, sources), 0);
assert.deepEqual(sources, [], "a contact rejected by the mob cooldown emits no knockback source");

console.log("player knockback tests passed");
