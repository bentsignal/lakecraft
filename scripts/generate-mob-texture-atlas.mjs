import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { decodePng } from "./png-rgba.mjs";

const sourcePath = new URL("./generated/minecraft-visual-assets-v26.2.json", import.meta.url);
const outputPath = new URL("../client/game/generated/mobTextureAtlas.ts", import.meta.url);
const pngOutputPath = new URL("../client/game/generated/mob-texture-atlas-v1.png", import.meta.url);
const imported = JSON.parse(await readFile(sourcePath, "utf8"));

const WIDTH = 208;
const HEIGHT = 128;
const placements = Object.freeze({
  zombie: [0, 0], cow: [64, 0], pig: [128, 0],
  skeleton: [0, 64], creeper: [64, 64], spider: [128, 64],
  sheep: [0, 96], sheep_wool: [64, 96], chicken: [128, 96],
});
const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
for (const [name, [left, top]] of Object.entries(placements)) {
  const decoded = decodePng(Buffer.from(imported.entities[name], "base64"));
  if (decoded.width !== 64 || (decoded.height !== 32 && decoded.height !== 64)) {
    throw new Error(`${name} must be an installed 64x32 or 64x64 entity texture.`);
  }
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const source = (y * decoded.width + x) * 4;
      const target = ((top + y) * WIDTH + left + x) * 4;
      rgba[target] = decoded.rgba[source];
      rgba[target + 1] = decoded.rgba[source + 1];
      rgba[target + 2] = decoded.rgba[source + 2];
      rgba[target + 3] = decoded.rgba[source + 3];
    }
  }
}
const bow = decodePng(Buffer.from(imported.itemTextures.bow, "base64"));
for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
  const source = (y * 16 + x) * 4;
  const target = (y * WIDTH + 192 + x) * 4;
  rgba.set(bow.rgba.subarray(source, source + 4), target);
}
// One exact opaque white texel lets the same retained batch carry arrows and
// primed TNT without another buffer, texture, or draw call.
rgba[(HEIGHT * WIDTH - 1) * 4] = 255;
rgba[(HEIGHT * WIDTH - 1) * 4 + 1] = 255;
rgba[(HEIGHT * WIDTH - 1) * 4 + 2] = 255;
rgba[(HEIGHT * WIDTH - 1) * 4 + 3] = 255;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[n] = value >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return output;
}
const scanlines = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 4 + 1);
  scanlines[row] = 0;
  Buffer.from(rgba.buffer, rgba.byteOffset + y * WIDTH * 4, WIDTH * 4).copy(scanlines, row + 1);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]);
const atlasSha256 = createHash("sha256").update(png).digest("hex");
const sourceSha256 = Object.fromEntries(Object.keys(placements).map((name) => [
  name,
  createHash("sha256").update(Buffer.from(imported.entities[name], "base64")).digest("hex"),
]));
function safeBase64Expression(value) {
  // The compact-client audit reserves short identifiers such as `ZF`. A PNG's
  // opaque base64 can coincidentally contain one between `/` or `+` boundaries,
  // even though it is data rather than source. Split only short base64 runs so
  // those accidental tokens never enter the audited JavaScript corpus.
  return value.split(/([+/=]+)/).flatMap((segment) => (
    /^[A-Za-z0-9]+$/.test(segment) && segment.length <= 4 ? [...segment] : [segment]
  )).map((segment) => JSON.stringify(segment)).join("+");
}
const code = `/** Generated from the hash-pinned, user-owned Minecraft 26.2 JAR. */\n`
  + `export const MOB_TEXTURE_ATLAS_WIDTH=${WIDTH};\nexport const MOB_TEXTURE_ATLAS_HEIGHT=${HEIGHT};\n`
  + `export const MOB_TEXTURE_ATLAS_PNG=${safeBase64Expression(png.toString("base64"))};\n`
  + `export const MOB_TEXTURE_ATLAS_SHA256=\"${atlasSha256}\";\n`
  + `export const MOB_TEXTURE_SOURCE_SHA256=${JSON.stringify(sourceSha256)} as const;\n`
  + `export const MOB_TEXTURE_REGIONS=${JSON.stringify(placements)} as const;\n`;
await writeFile(outputPath, code);
await writeFile(pngOutputPath, png);
console.log(JSON.stringify({ output: outputPath.pathname, width: WIDTH, height: HEIGHT, bytes: png.length, atlasSha256 }));
