import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPlayerArmorGeometry } from "../client/game/playerArmorGeometry.ts";
import { buildPlayerSkinGeometry } from "../client/game/playerSkinGeometry.ts";
import { createMobRenderer, mobVertexCountForKind } from "../client/game/mobRenderer.ts";
import type { MobKind, MobPoseSnapshot } from "../client/game/mobs.ts";

function floatHash(values: Float32Array): string {
  return createHash("sha256")
    .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
    .digest("hex");
}

const SKIN_HASHES = {
  wide: "9161d6ed4f976285499b83897a8cb85503b0eb5d893eba76218be7f5929e7be5",
  slim: "1c237b522327cfc32e97cd516da2cd5899748f39ecee6a10f33fbfd5e2f654ef",
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
  "pig:base": "5f27fed4be3f8e9f308f7741db1aaf4f544bfd06846bdd210a75030aeefc9d92",
  "pig:fallen": "ebd939c5efb60caa1e1fd244fad36c9a166a19454556edce84beebf2df7ae507",
  "pig:hurt": "83bcd21ff8f5e7a9985f5baae9cc4648a4e0940ccae27c964dbe38b7196397b7",
  "cow:base": "8f7fa9792996ea03560df801d7a54b655ded36a22c9179a1e433fe0bb12a2707",
  "cow:fallen": "9b16ae4a51129be8730ca6aa10c95c903b7c7b22bc0839bd22f61581c34214fd",
  "cow:hurt": "bbdad2b7be595c5db648d97aa4009aa35d7b8a7128d262a12f666d41549f543c",
  "sheep:base": "035287bb9ab17caa0300f7040406935fc588d38d040c8d58f8ba930d6753f73b",
  "sheep:fallen": "14b93838a35aa9efad63eeb7c53575c88677adf5d62b7096595b8ad8b30dbcc3",
  "sheep:hurt": "b0c5cf37ae97b71b3347c567cc3ef1899f83dbcb4286158d269f47cb5674a485",
  "chicken:base": "d0560abfbb3553d40c261c1555a60936a8c1df87e00bc924e1077b0337d14910",
  "chicken:fallen": "b68ff162b7827846b0847f55eb7fe1a5bbb1c082f914fa620764125dd18e5846",
  "chicken:hurt": "0111b7489245323102a9d9d4acc09465ce6d684fdfdf71df823acb6c8fa983df",
  "zombie:base": "1a7a1da1c75312e27258606c0801e99f898ea43738560e7faf98bf106769067c",
  "zombie:fallen": "8f70f6c7a36f3c96ec901a7e303742c7764325fcf8e520a9fa57412e4efa2d40",
  "zombie:hurt": "def42c1863ab8ea754721952ed82639e77ac265bc0698484e876bbf07fc1ab73",
  "skeleton:base": "d3c02d43fa06de0db54135de668dc95b8a1d8b5e62871c18d2aeea5fbe9db20e",
  "skeleton:fallen": "dd23b6c3ce692e2d5c20d7a7058b5bb2df1f9a59bc7250cfe347b590076f4961",
  "skeleton:hurt": "4152e92ad9bd473350bf06ed662b32c760d546cb81cbb5c423c7020c7c9c1113",
  "creeper:base": "b5945585cd59c5b95fd50bfa07319d05dc4e0432fe6d7b7cd66205550c6034b3",
  "creeper:fallen": "40b8eb252ec9bdcd28ea71a208da43e5d98f2a125344f9f32375aea78591082d",
  "creeper:hurt": "e15b529c563cd3f091b45b22a73310f73553b9b641369daa85bc7b3ffb0db1d2",
  "spider:base": "c73f8cb99ef1c0860303ea530865bf454c0f56c55aef529e44d7c9347ae464b9",
  "spider:fallen": "f9dfb43b21ee401bf151226fd02cf37b4f70981bdf93b1cafd467818b961188e",
  "spider:hurt": "be21b40cd5b9a56454e7fc8129410086040ce7144903096d8481c800c552ba19",
  "sheep:sheared": "9ac5bddd21ebc17086a73c13d03636b3bf17d71fa0a954b46334aed56d67a3ed",
  "zombie:sun": "413702339f7440178be6319ce956b0d8e10b70f0d9d6817a459a59e7ef31aee1",
  "creeper:fused": "940e2fa535463a0fb243b2ee78d0153fa0b4e493149abc1b57b8ed5e52abd51d",
};
const gl = new FakeWebGl();
const renderer = createMobRenderer(gl as unknown as WebGLRenderingContext);
function snapshot(name: string, mob: MobPoseSnapshot, time = 0): void {
  renderer.rebuild([mob], 0, 0, 0, 1, 1, time);
  assert.ok(gl.uploaded);
  const geometry = gl.uploaded.slice(0, mobVertexCountForKind(mob.kind) * 6);
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
