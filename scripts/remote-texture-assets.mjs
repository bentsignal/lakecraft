import { createHash } from "node:crypto";

const BLOCK_SOURCE_SHA256 = "86634345db872108492c3ce63cca8419ca85c972765cc207eb6a82fba7469d79";
const BLOCK_PNG_SHA256 = "0f3a9517c9850c970514a2a88873eee2bed205272cc318b484dde0bfbb7973e1";
const MOB_SOURCE_SHA256 = "3c4ccc1ca87a3d5c8a261ee8f05ac426b3881ce82b31a3a4d4144fda47e535da";
const ARMOR_SOURCE_SHA256 = "e77cba5f4fa363d9c0978c9bf244fda9154aae234a5a1ff8239814e9e7bc9a62";
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
  const urls = ASSET_ORIGINS.map((origin) => `${origin}/assets/block-texture-atlas-0f3a9517.png`);
  return `export const TEXTURE_TILE_SIZE=${tileSize},TEXTURE_ATLAS_COLUMNS=${columns},TEXTURE_ATLAS_ROWS=${rows};`
    + `export const TEXTURE_ATLAS_NAMES=${names} as const,TEXTURE_ATLAS_CELLS=${cells} as const;`
    + `export const CHEST_ATLAS_COLUMN=${chest};export type TextureAtlasName=typeof TEXTURE_ATLAS_NAMES[number];`
    + `const load=async()=>{let problem:unknown;for(const url of ${JSON.stringify(urls)})try{const response=await fetch(url,{cache:"force-cache",mode:"cors"});if(!response.ok)throw new Error(String(response.status));const buffer=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",buffer))].map(byte=>byte.toString(16).padStart(2,"0")).join("");if(digest!==${JSON.stringify(BLOCK_PNG_SHA256)})throw new Error("fingerprint");const image=await createImageBitmap(new Blob([buffer],{type:"image/png"}));if(image.width!==TEXTURE_ATLAS_COLUMNS*TEXTURE_TILE_SIZE||image.height!==TEXTURE_ATLAS_ROWS*TEXTURE_TILE_SIZE){image.close();throw new Error("dimensions")}const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw new Error("canvas");context.drawImage(image,0,0);image.close();return new Uint8Array(context.getImageData(0,0,canvas.width,canvas.height).data)}catch(error){problem=error}throw new Error("Could not load the shared Lakecraft texture atlas.",{cause:problem})};`
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

/** Keep exact armor pixels in the reviewed source while loading the immutable PNG in compact production. */
export function remotePlayerArmorTextureModule(source) {
  const digest = sha256(source);
  if (digest !== ARMOR_SOURCE_SHA256) {
    throw new Error(`Player armor texture source changed (expected ${ARMOR_SOURCE_SHA256}, found ${digest}).`);
  }
  const sha = exact(source, /export const PLAYER_ARMOR_ATLAS_PNG_SHA256="([0-9a-f]{64})";/g, "player armor atlas hash");
  const url = `https://raw.githubusercontent.com/bentsignal/lakecraft/main/client/game/generated/player-armor-atlas-${sha.slice(0, 8)}.png`;
  return `export const PLAYER_ARMOR_ATLAS_RGBA=${JSON.stringify(url)},PLAYER_ARMOR_ATLAS_PNG_SHA256=${JSON.stringify(sha)};`;
}
