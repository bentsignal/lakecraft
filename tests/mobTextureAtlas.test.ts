import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MOB_TEXTURE_ATLAS_HEIGHT,
  MOB_TEXTURE_ATLAS_PNG,
  MOB_TEXTURE_ATLAS_SHA256,
  MOB_TEXTURE_ATLAS_WIDTH,
  MOB_TEXTURE_REGIONS,
  MOB_TEXTURE_SOURCE_SHA256,
} from "../client/game/generated/mobTextureAtlas.ts";
import { decodePng } from "../scripts/png-rgba.mjs";

const imported=JSON.parse(readFileSync(new URL("../scripts/generated/minecraft-visual-assets-v26.2.json",import.meta.url),"utf8"));
const atlasBytes=Buffer.from(MOB_TEXTURE_ATLAS_PNG,"base64");
assert.equal(createHash("sha256").update(atlasBytes).digest("hex"),MOB_TEXTURE_ATLAS_SHA256);
const atlas=decodePng(atlasBytes);
assert.deepEqual([atlas.width,atlas.height],[MOB_TEXTURE_ATLAS_WIDTH,MOB_TEXTURE_ATLAS_HEIGHT]);
for(const [name,[left,top]] of Object.entries(MOB_TEXTURE_REGIONS)){
  const sourceBytes=Buffer.from(imported.entities[name],"base64");
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"),MOB_TEXTURE_SOURCE_SHA256[name as keyof typeof MOB_TEXTURE_SOURCE_SHA256]);
  const source=decodePng(sourceBytes);
  for(let y=0;y<source.height;y+=1)for(let x=0;x<source.width;x+=1){
    const a=((top+y)*atlas.width+left+x)*4,s=(y*source.width+x)*4;
    assert.deepEqual([...atlas.rgba.subarray(a,a+4)],[...source.rgba.subarray(s,s+4)],`${name} ${x},${y}`);
  }
}
const bow=decodePng(Buffer.from(imported.itemTextures.bow,"base64"));
for(let y=0;y<16;y+=1)for(let x=0;x<16;x+=1){
  const a=(y*atlas.width+192+x)*4,s=(y*16+x)*4;
  assert.deepEqual([...atlas.rgba.subarray(a,a+4)],[...bow.rgba.subarray(s,s+4)],`skeleton bow ${x},${y}`);
}
const generator=readFileSync(new URL("../scripts/generate-mob-texture-atlas.mjs",import.meta.url),"utf8");
assert.match(generator,/minecraft-visual-assets-v26\.2\.json/);
assert.match(generator,/deflateSync\(scanlines, \{ level: 9 \}\)/);
console.log("hash-pinned exact mob texture atlas parity tests passed");
