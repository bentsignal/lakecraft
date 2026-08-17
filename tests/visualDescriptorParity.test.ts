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
  "leather:head:wide": "b61b53aaeec47c098f7e7bbafb0e0888875fc1ca5480bdfbc006daec9f2abcfc",
  "leather:head:slim": "b61b53aaeec47c098f7e7bbafb0e0888875fc1ca5480bdfbc006daec9f2abcfc",
  "leather:chest:wide": "a28a868711ebaa5fe67e07efd1f103aefe6efca4d1a87f558dabee979e3c6305",
  "leather:chest:slim": "bd1935b79a2b0d94e26e05e43eb02dc9382df95e2edcc1372e73ed910874111d",
  "leather:legs:wide": "fa8591b584e0a8ac9083bc6b0257f80daabd5bb6ce83007fb86c82d1e07bc35e",
  "leather:legs:slim": "fa8591b584e0a8ac9083bc6b0257f80daabd5bb6ce83007fb86c82d1e07bc35e",
  "leather:feet:wide": "742797b2b5aa062fdc44be121deb28b9a8ca705dbc08fd2af64c20a870a12270",
  "leather:feet:slim": "742797b2b5aa062fdc44be121deb28b9a8ca705dbc08fd2af64c20a870a12270",
  "iron:head:wide": "a3be462bad0a54d62c913054aa101b6aef67d9bd5e6e5be0dacc7b4299346412",
  "iron:head:slim": "a3be462bad0a54d62c913054aa101b6aef67d9bd5e6e5be0dacc7b4299346412",
  "iron:chest:wide": "22db1e2bea9e7a0e50312181f779790b8abe8c5d47ab429c5c9978bba68b2399",
  "iron:chest:slim": "465392a5c669ab093350a080b88928ddd5db94bea75ee53982259dbf350a8e9f",
  "iron:legs:wide": "76642877840c52ec3089ba3b63fd3b8fd949107a01bec4b28ec18774fa16f2b7",
  "iron:legs:slim": "76642877840c52ec3089ba3b63fd3b8fd949107a01bec4b28ec18774fa16f2b7",
  "iron:feet:wide": "e9c57b66bddc3ece7fcc9b0c99804ff55a2ea04ff58a944174c5888cc6851da2",
  "iron:feet:slim": "e9c57b66bddc3ece7fcc9b0c99804ff55a2ea04ff58a944174c5888cc6851da2",
  "golden:head:wide": "9b3966d9d17cd0ba5f9f2442cbf6298dd6bbf51b1c2a0467fb9952754e10e080",
  "golden:head:slim": "9b3966d9d17cd0ba5f9f2442cbf6298dd6bbf51b1c2a0467fb9952754e10e080",
  "golden:chest:wide": "f5be31d598a57122fd074e3649cdec21ec3a3375f1f1852907a57ab7d070d707",
  "golden:chest:slim": "9d8a4c3a5f64c40812d46a3ad7abf401846b555e4dfb3d0b5c9001589a49ad4d",
  "golden:legs:wide": "605b18ceec297845ff0988a01dea21eacd14fab3ac82e7dd464c70a7450c65b4",
  "golden:legs:slim": "605b18ceec297845ff0988a01dea21eacd14fab3ac82e7dd464c70a7450c65b4",
  "golden:feet:wide": "8d7284b145ca8da54d069fc8eec874dd7ed7d60e08f42f03326a24e72ebc8fe5",
  "golden:feet:slim": "8d7284b145ca8da54d069fc8eec874dd7ed7d60e08f42f03326a24e72ebc8fe5",
  "diamond:head:wide": "b81e44fd8bec4c21559981acd6fba6ec46d758b1c2b3ef4cc26559d138611178",
  "diamond:head:slim": "b81e44fd8bec4c21559981acd6fba6ec46d758b1c2b3ef4cc26559d138611178",
  "diamond:chest:wide": "2d5d51c44870ead3487c606de698c4d7827dacfa0ec78b1eeec10814a2b61506",
  "diamond:chest:slim": "3b91e9a37ddfe6f9109ad33aa19ce9247c6af99ac5ac77fe0b74a850a5bd6c95",
  "diamond:legs:wide": "c94c22b9d97af55e04744cc07356261822dea415c3b0e50a5b4a7f3fab89a742",
  "diamond:legs:slim": "c94c22b9d97af55e04744cc07356261822dea415c3b0e50a5b4a7f3fab89a742",
  "diamond:feet:wide": "6def72e26b634be6ffc604b389a45a38d01599a9eb308b43ce5a3f99437cfa08",
  "diamond:feet:slim": "6def72e26b634be6ffc604b389a45a38d01599a9eb308b43ce5a3f99437cfa08",
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
