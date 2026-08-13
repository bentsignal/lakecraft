import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPlayerArmorGeometry } from "../client/game/playerArmorGeometry.ts";
import { buildPlayerSkinGeometry } from "../client/game/playerSkinGeometry.ts";
import { MOB_VERTEX_STRIDE, createMobRenderer, mobVertexCountForKind } from "../client/game/mobRenderer.ts";
import type { MobKind, MobPoseSnapshot } from "../client/game/mobs.ts";

function floatHash(values: Float32Array): string {
  return createHash("sha256")
    .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
    .digest("hex");
}

const SKIN_HASHES = {
  wide: "9161d6ed4f976285499b83897a8cb85503b0eb5d893eba76218be7f5929e7be5",
  slim: "492c2c1603988223b0dcf9859d79878eed677f0d2c797422fd0e91825120afab",
} as const;
for (const model of ["wide", "slim"] as const) {
  assert.equal(floatHash(buildPlayerSkinGeometry(model)), SKIN_HASHES[model],
    `${model} paired skin descriptors preserve every pre-pack Float32 byte`);
}

const ARMOR_HASHES: Readonly<Record<string, string>> = {
  "leather:head:wide": "1d9c718df55677626227beec193c705688574d3111c64c0c26279e2cec9ab82c",
  "leather:head:slim": "1d9c718df55677626227beec193c705688574d3111c64c0c26279e2cec9ab82c",
  "leather:chest:wide": "910b3a16bdda655be7bcf9401bd6aa6c16e9d39e3358d03f678fab8702b9c8ae",
  "leather:chest:slim": "2c7a43f4998c00e72da1e5afb20d9a27b9be2f3304c4ed9de922e337876c0298",
  "leather:legs:wide": "aa5993e6f5a0183bd9990a5b07b8a4cdfbcaf5c6b4393e8aa79c4b21f305c35e",
  "leather:legs:slim": "aa5993e6f5a0183bd9990a5b07b8a4cdfbcaf5c6b4393e8aa79c4b21f305c35e",
  "leather:feet:wide": "028248d1ed6f9f37250434d949bcb51e7763757393e424128fe839637ebb24e3",
  "leather:feet:slim": "028248d1ed6f9f37250434d949bcb51e7763757393e424128fe839637ebb24e3",
  "iron:head:wide": "9f1edec2fe2b024b5e3cbd85e30b56e552cffd13fd7a04dc3acff41cec0cd198",
  "iron:head:slim": "9f1edec2fe2b024b5e3cbd85e30b56e552cffd13fd7a04dc3acff41cec0cd198",
  "iron:chest:wide": "8278bd5abfa505e8a1ffe83bce2dcdeab494e5fd44b9c768e92fddaece6c4239",
  "iron:chest:slim": "fffb90411081201b7ae0640421a6da4830a53b107dfccd4b94382fd62492f349",
  "iron:legs:wide": "8566f7500dfa503f055ceace0cedde46644ce147d4e1399b9a958a8f62230895",
  "iron:legs:slim": "8566f7500dfa503f055ceace0cedde46644ce147d4e1399b9a958a8f62230895",
  "iron:feet:wide": "5b096309be032a573a34569354dea9f5b0135d229fd921486063adbc7c15a893",
  "iron:feet:slim": "5b096309be032a573a34569354dea9f5b0135d229fd921486063adbc7c15a893",
  "golden:head:wide": "97370cd5c286a62f289b650880203356525691738db2761f91f6a6815ffe0659",
  "golden:head:slim": "97370cd5c286a62f289b650880203356525691738db2761f91f6a6815ffe0659",
  "golden:chest:wide": "0f15effd76f7e08aff4fd13d85bd9724be39cfcb62fe8d72b9844888ea876d0b",
  "golden:chest:slim": "2427a5c8d9e5b159d8357f569f7d991777f105352cf97a803957d085b5aeecd7",
  "golden:legs:wide": "2f85d2398deee7d91eb35d1f268586879e81ea99c3a41376f5bbf28627bb11de",
  "golden:legs:slim": "2f85d2398deee7d91eb35d1f268586879e81ea99c3a41376f5bbf28627bb11de",
  "golden:feet:wide": "9dc40d325c537997979db108ac0009458d5edd80418965ce63e9a6ab3abcd771",
  "golden:feet:slim": "9dc40d325c537997979db108ac0009458d5edd80418965ce63e9a6ab3abcd771",
  "diamond:head:wide": "5a5cc64cd5d08a6eb430572b85ef65faa386c7c20225e01784b88ba3f9143c7e",
  "diamond:head:slim": "5a5cc64cd5d08a6eb430572b85ef65faa386c7c20225e01784b88ba3f9143c7e",
  "diamond:chest:wide": "455a07dcd6c6fec4bc878cd95dff673768f9ba1672fccf3adba328fd175a761f",
  "diamond:chest:slim": "03798b4b318b5a80910949cff0da9819a7cd6332df3482d95c469c719ec3d7b5",
  "diamond:legs:wide": "95c52511be5de13bfd50da19a35d51bba0ecbf9159378be83e1c364b75da8150",
  "diamond:legs:slim": "95c52511be5de13bfd50da19a35d51bba0ecbf9159378be83e1c364b75da8150",
  "diamond:feet:wide": "63c99641745bbdd37765f72f9d1da7de7eb10c6549182a5048478f060ea7efdd",
  "diamond:feet:slim": "63c99641745bbdd37765f72f9d1da7de7eb10c6549182a5048478f060ea7efdd",
};
const armorSuffix = { head: "helmet", chest: "chestplate", legs: "leggings", feet: "boots" } as const;
for (const material of ["leather", "iron", "golden", "diamond"] as const) {
  for (const slot of ["head", "chest", "legs", "feet"] as const) {
    for (const model of ["wide", "slim"] as const) {
      const key = `${material}:${slot}:${model}`;
      const itemId = `${material}_${armorSuffix[slot]}` as const;
      assert.equal(floatHash(buildPlayerArmorGeometry({ [slot]: itemId }, model)), ARMOR_HASHES[key],
        `${key} packed armor boxes preserve every pre-pack Float32 byte`);
    }
  }
}

class FakeWebGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly DYNAMIC_DRAW = 0x88e8;
  uploaded: Float32Array | null = null;
  createBuffer() { return {}; }
  bindBuffer() {}
  bufferData() {}
  bufferSubData(_target: number, _offset: number, data: Float32Array) { this.uploaded = data; }
  deleteBuffer() {}
}

let nextId = 0;
function pose(kind: MobKind, values: Partial<MobPoseSnapshot> = {}): MobPoseSnapshot {
  return {
    id: `${kind}-descriptor-${nextId++}`, kind, x: 0, y: 7, z: 4, yaw: 0,
    previousX: 0, previousY: 7, previousZ: 4, previousYaw: 0,
    behavior: "idle", health: 8, maxHealth: 20, hostileActive: false,
    sheared: false, fuseProgress: 0, sunBurning: false, deathFall: 0, ...values,
  };
}

const MOB_HASHES: Readonly<Record<string, string>> = {
  "pig:base": "f6d04ec32fa01cab58d0ff1a0cd52f000002be487cd30666715d2d2484c0fdfe",
  "pig:fallen": "ed7d42e2a12ea7596ae12bf35bfca870e4e96274236bf27ddb0dff9af180e25a",
  "pig:hurt": "d4108e7231d71d1d83b1ed25ff33179b7594b870f122df2e87db74b89a9805e0",
  "cow:base": "a2146643aadcd527612dce99a67bef63fea331e64a6330e914c68cc2f41a80b8",
  "cow:fallen": "d4bfa6656c4690d45eef2fb3ab271f7860fc91491b8404f323bdf6483599373e",
  "cow:hurt": "c88b5d0a3879a4cec32ccbb0687d31909baa2cdbef7600abcae5f84aae2fd403",
  "sheep:base": "c277bbd00beaa6089cc2da65b2ae5ba2764266ea25b96e2abb27a8a167064bf4",
  "sheep:fallen": "f38d2e33acf83bd6667c96cba23ff899eafcf75ce69b3f275632bd365cc74f97",
  "sheep:hurt": "a272af6ff5a49b195b04fd57c9f60e146a2048befe216266f09609392866c208",
  "chicken:base": "bf023f4c4583a76bcc82073d0bdf965bb6201177112680757143fa708861573a",
  "chicken:fallen": "3621ffb370ad2c00388344ac73c6e01354b0adf6bced5bec7e2897b635d872f4",
  "chicken:hurt": "5110d749f54d131184be362b724af90d7819e129a24b4d785e57a0fc18d0cfa5",
  "zombie:base": "4d5198593e18a0655c1b32587a73488110c52c0fa37356ae61c1dc664f666d4c",
  "zombie:fallen": "41795b116523092a464c8cf32d591f0b56095980f53ed7dba11c3570e248d837",
  "zombie:hurt": "a1eb3fe6ea47cd82ca328e1458a345c29fe8bf5a56a49de10afe982ce2c4053e",
  "skeleton:base": "b285ca213661d259d1db42f96e3fe0fa630b67bbfd3fbc4ce2f8d9142bb75999",
  "skeleton:fallen": "f56169dc75e7021ebed703a720f0837aa204207789264cb9d8105eb16d41afd5",
  "skeleton:hurt": "62fd4926388e7bcae61f83e0c9b08a2950ab6841cef2e104981c4848679b8b6c",
  "creeper:base": "cdb77d50eea56d00d9ce70faa94753a5ee2783aa1b5d0ae732c3d60432c29900",
  "creeper:fallen": "cf02e6afbe32fb1989a8c6818705a745c19897886d78ecb37b43208a0b081447",
  "creeper:hurt": "11ded5295aed0df781624ec867609e3157405dbd7a0a83f876255cbebb7d6414",
  "spider:base": "df94ed6ca4232ba857cfc1f18213eac0e518b59ae02c0a1eca11c1276c5885ce",
  "spider:fallen": "312be93a7d06fec93bdeb9b5c1ebe5a8ccc1d7380a98ffbe04c1b319a8a08fc6",
  "spider:hurt": "ee2319b4d4975bac5e6af9323a234ce179f8f1ba131cfb644fc283bdacd2d16b",
  "sheep:sheared": "477dad0461dee9c82795fe08b58fe21d97166772190ebde24162fd01830f5139",
  "zombie:sun": "5463dfc113b766e60148c318dfe7b94d0575ec9cdb5b9202be225af80a3f4643",
  "creeper:fused": "b300b11841ba4a91e83bdb045f8f2bb87967e3325fc25698d76c1fa2fd4e1524",
};
const gl = new FakeWebGl();
const renderer = createMobRenderer(gl as unknown as WebGLRenderingContext);
function snapshot(name: string, mob: MobPoseSnapshot, time = 0): void {
  renderer.rebuild([mob], 0, 0, 0, 1, 1, time);
  assert.ok(gl.uploaded);
  const geometry = gl.uploaded.slice(0, mobVertexCountForKind(mob.kind) * MOB_VERTEX_STRIDE);
  assert.equal(floatHash(geometry), MOB_HASHES[name], `${name} packed panels preserve every pre-pack Float32 byte`);
}
for (const kind of ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"] as const) {
  snapshot(`${kind}:base`, pose(kind));
  snapshot(`${kind}:fallen`, pose(kind, { health: 0, deathFall: 1 }));
  const hurt = pose(kind, { health: 8 });
  snapshot(`${kind}:base`, hurt, 10);
  hurt.health = 7;
  snapshot(`${kind}:hurt`, hurt, 10);
}
snapshot("sheep:sheared", pose("sheep", { sheared: true }));
snapshot("zombie:sun", pose("zombie", { sunBurning: true }));
snapshot("creeper:fused", pose("creeper", { fuseProgress: 1 }));
renderer.destroy();

console.log("packed visual descriptor pre-pack byte parity tests passed");
