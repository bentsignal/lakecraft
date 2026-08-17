import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodePng, encodePngRgba } from "./png-rgba.mjs";
import { encodeStaticBytes } from "./static-byte-encoding.mjs";

const [manifestArgument, outputArgument, pngOutputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) throw new Error("Usage: node scripts/generate-player-armor-texture.ts visual-assets.json output.ts");
const imported = JSON.parse(await readFile(resolve(manifestArgument), "utf8")) as Readonly<{
  armorTextures: Readonly<Record<string, string>>;
}>;
const materials = ["leather", "iron", "gold", "diamond"] as const;
const layers = ["humanoid", "humanoid_leggings"] as const;
const width = 64; const tileHeight = 32; const height = materials.length * layers.length * tileHeight;
const rgba = new Uint8Array(width * height * 4);
for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
  const material = materials[materialIndex];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const image = decodePng(Buffer.from(imported.armorTextures[`${material}_${layer}`], "base64"));
    const overlay = material === "leather"
      ? decodePng(Buffer.from(imported.armorTextures[`leather_${layer}_overlay`], "base64")) : null;
    for (let pixel = 0; pixel < width * tileHeight; pixel += 1) {
      const input = pixel * 4; const output = ((materialIndex * 2 + layerIndex) * width * tileHeight + pixel) * 4;
      let red = image.rgba[input]; let green = image.rgba[input + 1]; let blue = image.rgba[input + 2]; let alpha = image.rgba[input + 3];
      if (overlay) {
        red = Math.round(red * 160 / 255); green = Math.round(green * 101 / 255); blue = Math.round(blue * 64 / 255);
        const overlayAlpha = overlay.rgba[input + 3] / 255;
        red = Math.round(red * (1 - overlayAlpha) + overlay.rgba[input] * overlayAlpha);
        green = Math.round(green * (1 - overlayAlpha) + overlay.rgba[input + 1] * overlayAlpha);
        blue = Math.round(blue * (1 - overlayAlpha) + overlay.rgba[input + 2] * overlayAlpha);
        alpha = Math.max(alpha, overlay.rgba[input + 3]);
      }
      rgba.set([red, green, blue, alpha], output);
    }
  }
}

const palette: number[] = []; const paletteIndexes = new Map<string, number>(); const indexes: number[] = [];
for (let pixel = 0; pixel < width * height; pixel += 1) {
  const color = [...rgba.subarray(pixel * 4, pixel * 4 + 4)]; const key = color.join(",");
  let paletteIndex = paletteIndexes.get(key);
  if (paletteIndex === undefined) { paletteIndex = palette.length / 4; paletteIndexes.set(key, paletteIndex); palette.push(...color); }
  indexes.push(paletteIndex);
}
if (palette.length / 4 > 256) throw new Error("Armor atlas exceeds 256 colors.");
const decoded = [...palette, ...indexes]; const packed: number[] = [];
for (let index = 0; index < decoded.length;) {
  const control = packed.length; packed.push(0); let flags = 0;
  for (let bit = 0; bit < 8 && index < decoded.length; bit += 1) {
    let length = 0; let distance = 0;
    for (let source = Math.max(0, index - 4_095); source < index; source += 1) {
      let candidate = 0;
      while (candidate < 273 && index + candidate < decoded.length && decoded[source + candidate] === decoded[index + candidate]) candidate += 1;
      if (candidate > length) { length = candidate; distance = index - source; }
    }
    if (length >= 3) {
      if (length === 18) length = 17;
      flags |= 1 << bit; const value = (Math.min(length, 18) - 3) * 4_096 + distance;
      packed.push(value >> 8, value & 255); if (length > 17) packed.push(length - 18); index += length;
    } else packed.push(decoded[index++]);
  }
  packed[control] = flags;
}
const payload = encodeStaticBytes(packed);
const png = encodePngRgba(width, height, rgba);
const pngSha256 = createHash("sha256").update(png).digest("hex");
const source = `// Generated from the user-authorized local Minecraft 26.2 armor textures.\n`
  + `import { decodeStaticBytes } from "../../staticData.ts";\n`
  + `const data=decodeStaticBytes(${JSON.stringify(payload)},${decoded.length},${packed.length},true);\n`
  + `export const PLAYER_ARMOR_ATLAS_RGBA=new Uint8Array(${rgba.length});\n`
  + `for(let p=0;p<${width * height};p++){const i=data[${palette.length}+p]*4;PLAYER_ARMOR_ATLAS_RGBA.set(data.subarray(i,i+4),p*4)}\n`
  + `export const PLAYER_ARMOR_ATLAS_PNG_SHA256=${JSON.stringify(pngSha256)};\n`;
await writeFile(resolve(outputArgument), source);
if (pngOutputArgument) await writeFile(resolve(pngOutputArgument), png);
console.log(JSON.stringify({ colors: palette.length / 4, packedBytes: packed.length, pngBytes: png.length, pngSha256, sourceBytes: Buffer.byteLength(source), rgbaSha256: createHash("sha256").update(rgba).digest("hex") }));
