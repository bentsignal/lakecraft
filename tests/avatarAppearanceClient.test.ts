import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance.ts";

assert.deepEqual(
  normalizeAvatarAppearance(
    "iron_sword",
    "iron_helmet",
    "iron_chestplate",
    "iron_leggings",
    "iron_boots",
  ),
  {
    heldItem: "iron_sword",
    armorHead: "iron_helmet",
    armorChest: "iron_chestplate",
    armorLegs: "iron_leggings",
    armorFeet: "iron_boots",
  },
  "a local inventory/equipment sample stays canonical on the presence wire",
);

assert.deepEqual(
  normalizeAvatarAppearance("obsidian_sword", "iron_boots", "iron_sword", "stone", "<script>"),
  { heldItem: "", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
  "malformed remote appearance data is never forwarded to the renderer",
);
assert.deepEqual(
  normalizeAvatarAppearance(undefined, undefined, undefined, undefined, undefined),
  { heldItem: "", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
  "legacy presence rows render with empty appearance slots",
);

const source = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.equal(
  source.match(/void heartbeatPlayer\(/g)?.length ?? 0,
  1,
  "appearance must reuse the one sparse-presence heartbeat call path",
);
assert.equal(
  source.match(/normalizeAvatarAppearance\(/g)?.length ?? 0,
  2,
  "appearance is normalized once on send and once on receive",
);

const mutationStart = source.indexOf("const heartbeatPlayer = useMutation");
const mutationEnd = source.indexOf(";", mutationStart);
assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, "heartbeat mutation declaration exists");
const mutationDeclaration = source.slice(mutationStart, mutationEnd);
const mutationFields = ["vz: string", "heldItem: string", "armorHead: string", "armorChest: string", "armorLegs: string", "armorFeet: string"];
let previousField = -1;
for (const field of mutationFields) {
  const fieldIndex = mutationDeclaration.indexOf(field);
  assert.ok(fieldIndex > previousField, `${field} follows the existing velocity fields in wire order`);
  previousField = fieldIndex;
}

const schedulerGate = source.indexOf("if (!decision.send) return;");
const outboundNormalization = source.indexOf("const worn = equipmentRef.current;", schedulerGate);
const heartbeatCall = source.indexOf("void heartbeatPlayer(", outboundNormalization);
assert.ok(
  schedulerGate >= 0 && outboundNormalization > schedulerGate && heartbeatCall > outboundNormalization,
  "inventory/equipment are sampled only after the existing quota scheduler approves a write",
);
for (const field of ["worn.head?.itemId", "worn.chest?.itemId", "worn.legs?.itemId", "worn.feet?.itemId"]) {
  assert.ok(
    source.slice(outboundNormalization, heartbeatCall).includes(field),
    `${field} keeps durable equipment metadata off the sparse presence wire`,
  );
}
const heartbeatEnd = source.indexOf(").then(", heartbeatCall);
const heartbeatArguments = source.slice(heartbeatCall, heartbeatEnd);
const outboundFields = [
  "decision.fields.vz",
  "appearance.heldItem",
  "appearance.armorHead",
  "appearance.armorChest",
  "appearance.armorLegs",
  "appearance.armorFeet",
];
previousField = -1;
for (const field of outboundFields) {
  const fieldIndex = heartbeatArguments.indexOf(field);
  assert.ok(fieldIndex > previousField, `${field} is sent in the server contract order`);
  previousField = fieldIndex;
}

const remoteMappingStart = source.indexOf("const remotes: RemotePlayer[]");
const remoteMappingEnd = source.indexOf("engineRef.current?.setRemotePlayers(remotes);", remoteMappingStart);
const remoteMapping = source.slice(remoteMappingStart, remoteMappingEnd);
for (const field of [
  "player.heldItem",
  "player.armorHead",
  "player.armorChest",
  "player.armorLegs",
  "player.armorFeet",
  "heldItem: appearance.heldItem || null",
  "armorHead: appearance.armorHead || null",
  "armorChest: appearance.armorChest || null",
  "armorLegs: appearance.armorLegs || null",
  "armorFeet: appearance.armorFeet || null",
]) {
  assert.ok(remoteMapping.includes(field), `remote mapping includes ${field}`);
}

console.log("avatar appearance client integration tests passed");
