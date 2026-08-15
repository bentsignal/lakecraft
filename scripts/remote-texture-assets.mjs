import { createHash } from "node:crypto";

const BLOCK_SOURCE_SHA256 = "0793880d90e0f01ae8156e2342ba51c450ec4939592354a20bd70aef58c1b41a";
const MOB_SOURCE_SHA256 = "3c4ccc1ca87a3d5c8a261ee8f05ac426b3881ce82b31a3a4d4144fda47e535da";
const ASSET_ORIGINS = [
  "https://lakecraft-production.up.railway.app",
  "https://lakecraft-creative-production.up.railway.app",
];

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function exact(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Remote texture transform expected one ${label}, received ${matches.length}.`);
  return matches[0][1];
}

/**
 * Production keeps immutable image bytes on the Railway gameplay tier. Local
 * development and source tests retain the generated in-module atlas, while the
 * sealed Lakebed stage receives this small, hash-checked asynchronous loader.
 */
export function remoteBlockTextureAtlasModule(source) {
  const digest = sha256(source);
  if (digest !== BLOCK_SOURCE_SHA256) {
    throw new Error(`Block texture atlas source changed (expected ${BLOCK_SOURCE_SHA256}, found ${digest}).`);
  }
  const tileSize = exact(source, /export const TEXTURE_TILE_SIZE = (\d+);/g, "tile size");
  const columns = exact(source, /export const TEXTURE_ATLAS_COLUMNS = (\d+);/g, "column count");
  const rows = exact(source, /export const TEXTURE_ATLAS_ROWS = (\d+);/g, "row count");
  const names = exact(source, /export const TEXTURE_ATLAS_NAMES = (\[[^\n]+\]) as const;/g, "name table");
  const cells = exact(source, /export const TEXTURE_ATLAS_CELLS = (\[[^\n]+\]) as const;/g, "cell table");
  const chest = exact(source, /export const CHEST_ATLAS_COLUMN = (\d+, CHEST_ATLAS_ROW = \d+);/g, "chest cell");
  const urls = ASSET_ORIGINS.map((origin) => `${origin}/assets/block-texture-atlas-d94c19f9.png`);
  return `export const TEXTURE_TILE_SIZE=${tileSize},TEXTURE_ATLAS_COLUMNS=${columns},TEXTURE_ATLAS_ROWS=${rows};`
    + `export const TEXTURE_ATLAS_NAMES=${names} as const,TEXTURE_ATLAS_CELLS=${cells} as const;`
    + `export const CHEST_ATLAS_COLUMN=${chest};export type TextureAtlasName=typeof TEXTURE_ATLAS_NAMES[number];`
    + `const load=async()=>{let problem:unknown;for(const url of ${JSON.stringify(urls)})try{const response=await fetch(url,{cache:"force-cache",mode:"cors"});if(!response.ok)throw new Error(String(response.status));const image=await createImageBitmap(await response.blob());if(image.width!==TEXTURE_ATLAS_COLUMNS*TEXTURE_TILE_SIZE||image.height!==TEXTURE_ATLAS_ROWS*TEXTURE_TILE_SIZE){image.close();throw new Error("dimensions")}const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw new Error("canvas");context.drawImage(image,0,0);image.close();const bytes=new Uint8Array(context.getImageData(0,0,canvas.width,canvas.height).data),expected=0xd94c19f9;let hash=2166136261;for(const byte of bytes){hash^=byte;hash=Math.imul(hash,16777619)}if((hash>>>0)!==expected)throw new Error("fingerprint");return bytes}catch(error){problem=error}throw new Error("Could not load the shared Lakecraft texture atlas.",{cause:problem})};`
    + `export const TEXTURE_ATLAS_RGBA=await load();`;
}

/** Replace only the opaque mob PNG payload; dimensions and UV regions remain generated. */
export function remoteMobTextureAtlasModule(source) {
  const digest = sha256(source);
  if (digest !== MOB_SOURCE_SHA256) {
    throw new Error(`Mob texture atlas source changed (expected ${MOB_SOURCE_SHA256}, found ${digest}).`);
  }
  const width = exact(source, /export const MOB_TEXTURE_ATLAS_WIDTH=(\d+);/g, "mob atlas width");
  const height = exact(source, /export const MOB_TEXTURE_ATLAS_HEIGHT=(\d+);/g, "mob atlas height");
  const sha = exact(source, /export const MOB_TEXTURE_ATLAS_SHA256="([0-9a-f]{64})";/g, "mob atlas hash");
  const regions = exact(source, /export const MOB_TEXTURE_REGIONS=(\{[^\n]+\}) as const;/g, "mob UV regions");
  return `export const MOB_TEXTURE_ATLAS_WIDTH=${width},MOB_TEXTURE_ATLAS_HEIGHT=${height};`
    + `export const MOB_TEXTURE_ATLAS_PNG=${JSON.stringify(`${ASSET_ORIGINS[0]}/assets/mob-texture-atlas-${sha.slice(0, 8)}.png`)};`
    + `export const MOB_TEXTURE_ATLAS_SHA256=${JSON.stringify(sha)},MOB_TEXTURE_REGIONS=${regions} as const;`;
}
