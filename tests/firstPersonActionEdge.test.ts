import assert from "node:assert/strict";
import { shouldAnimateFirstPersonAction } from "../client/components/firstPersonAction.ts";

assert.equal(shouldAnimateFirstPersonAction(0, 0, false), false, "the initial token is not an action edge");
assert.equal(shouldAnimateFirstPersonAction(7, 7, false), false, "a historical token does not replay on reveal");
assert.equal(shouldAnimateFirstPersonAction(6, 7, false), true, "one new visible token animates once");
assert.equal(shouldAnimateFirstPersonAction(6, 7, true), false, "hidden feedback consumes the edge without animation");
assert.equal(shouldAnimateFirstPersonAction(6, 7, false, true), false, "paused feedback consumes the edge without animation");

console.log("first-person action edge tests passed");
