import assert from "node:assert/strict";
import {
  canApplyAuthoritativeKnockback,
  multiplayerGameplayPaused,
  updateAuthoritativeKnockbackGate,
  type MultiplayerGameplayBlockers,
} from "../client/multiplayerGameplay.ts";

const active: MultiplayerGameplayBlockers = {
  foreground: true,
  mobileUnsupported: false,
  death: false,
  pause: false,
  inventory: false,
  chat: false,
  furnace: false,
  chest: false,
  bed: false,
};
assert.equal(multiplayerGameplayPaused(active), false);
for (const blocker of ["mobileUnsupported", "death", "pause", "inventory", "chat", "furnace", "chest", "bed"] as const) {
  assert.equal(multiplayerGameplayPaused({ ...active, [blocker]: true }), true, `${blocker} blocks authoritative knockback`);
}
assert.equal(multiplayerGameplayPaused({ ...active, foreground: false }), true, "background input is blocked");

const gate = { paused: false, pauseEpoch: 0 };
const requestPauseEpoch = gate.pauseEpoch;
assert.equal(canApplyAuthoritativeKnockback(gate, requestPauseEpoch, true), true, "active pointer-locked damage remains eligible");
updateAuthoritativeKnockbackGate(gate, true);
assert.equal(canApplyAuthoritativeKnockback(gate, requestPauseEpoch, true), false, "damage resolving under a menu cannot move the player");
updateAuthoritativeKnockbackGate(gate, false);
assert.equal(canApplyAuthoritativeKnockback(gate, requestPauseEpoch, true), false, "closing the menu cannot revive its old promise");
assert.equal(canApplyAuthoritativeKnockback(gate, gate.pauseEpoch, false), false, "pointer release closes the pre-render modal race");
assert.equal(canApplyAuthoritativeKnockback(gate, gate.pauseEpoch, true), true, "a new post-menu gameplay claim remains eligible");

console.log("multiplayer knockback eligibility tests passed");
