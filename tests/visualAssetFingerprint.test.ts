import assert from "node:assert/strict";
import { ITEMS, type ItemId } from "../shared/game.ts";
import { itemIconFingerprint } from "../client/game/visualAssetFingerprint.ts";

const fingerprints = (Object.keys(ITEMS) as ItemId[]).map((itemId) => itemIconFingerprint(itemId));
assert.equal(fingerprints.length, 104);
assert.ok(fingerprints.every((value) => /^[0-9a-f]{8}$/.test(value)));
assert.equal(new Set(fingerprints).size, fingerprints.length,
  "every canonical inventory sprite has a distinct review fingerprint");
assert.equal(itemIconFingerprint("diamond_pickaxe"), itemIconFingerprint("diamond_pickaxe"));

console.log("per-item visual fingerprint tests passed");
