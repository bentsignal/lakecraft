import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_MUTATION_KEYS,
  PRODUCTION_QUERY_KEYS,
  RETAINED_PRODUCTION_MUTATIONS,
  RETAINED_PRODUCTION_QUERIES,
  stripRetiredLakebedGameplaySurfaces,
} from "../scripts/server-production-surface-transform.mjs";

const source = readFileSync(fileURLToPath(new URL("../server/index.ts", import.meta.url)), "utf8");
const compact = stripRetiredLakebedGameplaySurfaces(source);

for (const name of RETAINED_PRODUCTION_QUERIES) {
  assert.match(compact, new RegExp(`^    ${name}: query\\(`, "m"), `${name} remains deployed`);
}
for (const name of PRODUCTION_QUERY_KEYS.filter((name) => !RETAINED_PRODUCTION_QUERIES.includes(name))) {
  assert.doesNotMatch(compact, new RegExp(`^    ${name}: query\\(`, "m"), `${name} is retired from production`);
}
for (const name of RETAINED_PRODUCTION_MUTATIONS) {
  assert.match(compact, new RegExp(`^    ${name}: mutation\\(`, "m"), `${name} remains deployed`);
}
for (const name of PRODUCTION_MUTATION_KEYS.filter((name) => !RETAINED_PRODUCTION_MUTATIONS.includes(name))) {
  assert.doesNotMatch(compact, new RegExp(`^    ${name}: mutation\\(`, "m"), `${name} is retired from production`);
}
assert.match(compact, /redeemExternalMultiplayerJoinTicket: endpoint\(/,
  "Railway ticket redemption remains deployed");
assert.throws(() => stripRetiredLakebedGameplaySurfaces(source.replace(
  "    worldEdits: query(", "    renamedWorldEdits: query(",
)), /query source fingerprint changed/);
assert.throws(() => stripRetiredLakebedGameplaySurfaces(`${source}\n${source}`), /expected exactly one/);

console.log("production Lakebed surface retains identity and tickets while Railway owns gameplay");
