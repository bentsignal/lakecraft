import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const jar = process.argv[2];
const output = process.argv[3];
if (!jar || !output) throw new Error("Usage: generate-minecraft-ascii-font.mjs <minecraft.jar> <output.ts>");

function decodeAtlas(entry) {
  const png = execFileSync("unzip", ["-p", jar, entry]);
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  if (width !== 128 || height % 8 !== 0 || bitDepth !== 1 || colorType !== 3) {
    throw new Error(`Unexpected Minecraft font atlas ${entry}: ${width}x${height}, depth ${bitDepth}, type ${colorType}.`);
  }
  const packedStride = width / 8, raw = inflateSync(Buffer.concat(idat));
  const rows = Array.from({ length: height }, () => Buffer.alloc(packedStride));
  let sourceAt = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceAt++], row = rows[y], prior = rows[y - 1];
    for (let x = 0; x < packedStride; x += 1) {
      const value = raw[sourceAt++], left = row[x - 1] ?? 0, up = prior?.[x] ?? 0, upperLeft = prior?.[x - 1] ?? 0;
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 255;
      else if (filter === 2) row[x] = (value + up) & 255;
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        row[x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255;
      } else throw new Error(`Unsupported PNG filter ${filter}.`);
    }
  }
  return { lit: (x, y) => Boolean(rows[y][x >> 3] & (128 >> (x & 7))) };
}

const providerSource = JSON.parse(execFileSync("unzip", ["-p", jar, "assets/minecraft/font/include/default.json"], { encoding: "utf8" }));
// Exact non-ASCII characters rendered by the production client. Keeping this
// list audited avoids both system-font fallback and importing an entire large
// Unicode provider into the Lakebed capsule.
const REQUIRED_NON_ASCII = new Set(Array.from("°·×–—…→↑↓↔●"));
const mappings = [];
const atlases = new Map();
for (const provider of providerSource.providers) {
  if (provider.type !== "bitmap" || !provider.file?.startsWith("minecraft:font/")) continue;
  const entry = `assets/minecraft/textures/${provider.file.slice("minecraft:".length)}`;
  if (!entry.endsWith("ascii.png") && !entry.endsWith("nonlatin_european.png")) continue;
  const atlas = atlases.get(entry) ?? decodeAtlas(entry);
  atlases.set(entry, atlas);
  provider.chars.forEach((row, rowIndex) => Array.from(row).forEach((character, column) => {
    const code = character.codePointAt(0);
    if (!code || (entry.endsWith("nonlatin_european.png") && !REQUIRED_NON_ASCII.has(character))) return;
    mappings.push({ code, cell: rowIndex * 16 + column, atlas });
  }));
}
mappings.sort((left, right) => left.code - right.code);
if (![...REQUIRED_NON_ASCII].every((character) => mappings.some(({ code }) => code === character.codePointAt(0)))) {
  throw new Error("Minecraft font providers do not cover every required interface glyph.");
}

const u16 = (value) => { const out = Buffer.alloc(2); out.writeUInt16BE(value & 65535); return out; };
const i16 = (value) => { const out = Buffer.alloc(2); out.writeInt16BE(value); return out; };
const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value >>> 0); return out; };
const fixed = (value) => u32(Math.round(value * 65536));
const align4 = (value) => (value + 3) & ~3;
const padded = (value) => Buffer.concat([value, Buffer.alloc(align4(value.length) - value.length)]);
const checksum = (value) => {
  const bytes = padded(value); let sum = 0;
  for (let at = 0; at < bytes.length; at += 4) sum = (sum + bytes.readUInt32BE(at)) >>> 0;
  return sum;
};

const SCALE = 128;
function glyphFor(atlas, cell, code) {
  const cellX = (cell & 15) * 8, cellY = (cell >> 4) * 8;
  const contours = [];
  let rightmost = code === 32 ? 2 : 0;
  for (let row = 0; row < 8; row += 1) {
    let column = 0;
    while (column < 8) {
      while (column < 8 && !atlas.lit(cellX + column, cellY + row)) column += 1;
      const start = column;
      while (column < 8 && atlas.lit(cellX + column, cellY + row)) column += 1;
      if (start === column) continue;
      rightmost = Math.max(rightmost, column);
      const x0 = start * SCALE, x1 = column * SCALE;
      const y1 = (8 - row) * SCALE, y0 = y1 - SCALE;
      contours.push([[x0,y0],[x0,y1],[x1,y1],[x1,y0]]);
    }
  }
  if (!contours.length) return { bytes: Buffer.alloc(10), advance: Math.max(4, rightmost + 1) * SCALE };
  const points = contours.flat();
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const header = Buffer.concat([
    i16(contours.length), i16(Math.min(...xs)), i16(Math.min(...ys)), i16(Math.max(...xs)), i16(Math.max(...ys)),
  ]);
  const ends = Buffer.concat(contours.map((_, index) => u16((index + 1) * 4 - 1)));
  const flags = Buffer.alloc(points.length, 1);
  const xDeltas = [], yDeltas = [];
  let lastX = 0, lastY = 0;
  for (const [x, y] of points) { xDeltas.push(i16(x - lastX)); lastX = x; yDeltas.push(i16(y - lastY)); lastY = y; }
  return {
    bytes: Buffer.concat([header, ends, u16(0), flags, ...xDeltas, ...yDeltas]),
    advance: Math.max(2, rightmost + 1) * SCALE,
  };
}

const glyphs = [{ bytes: Buffer.alloc(10), advance: 8 * SCALE }];
for (const mapping of mappings) glyphs.push(glyphFor(mapping.atlas, mapping.cell, mapping.code));
const loca = [0], glyfParts = [];
for (const glyph of glyphs) { const bytes = padded(glyph.bytes); glyfParts.push(bytes); loca.push(loca.at(-1) + bytes.length); }
const glyf = Buffer.concat(glyfParts);
const hmtx = Buffer.concat(glyphs.map((glyph) => Buffer.concat([u16(glyph.advance), i16(0)])));
const locaTable = Buffer.concat(loca.map(u32));

const cmapSegments = [...mappings.map(({ code }, index) => ({ code, delta: index + 1 - code })), { code: 65535, delta: 1 }];
const segCount = cmapSegments.length, searchPower = 2 ** Math.floor(Math.log2(segCount));
const cmapFormat4 = Buffer.concat([
  u16(4), u16(16 + segCount * 8), u16(0), u16(segCount * 2), u16(searchPower * 2),
  u16(Math.log2(searchPower)), u16(segCount * 2 - searchPower * 2),
  ...cmapSegments.map(({ code }) => u16(code)), u16(0),
  ...cmapSegments.map(({ code }) => u16(code)),
  ...cmapSegments.map(({ delta }) => u16(delta)),
  ...cmapSegments.map(() => u16(0)),
]);
const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), cmapFormat4]);

const names = [[1, "Minecraft ASCII"], [2, "Regular"], [4, "Minecraft ASCII Regular"], [6, "MinecraftASCII-Regular"]];
const nameStrings = names.map(([, value]) => Buffer.from(value, "utf16le").swap16());
let nameOffset = 0;
const nameRecords = names.map(([id], index) => {
  const value = Buffer.concat([u16(3), u16(1), u16(0x409), u16(id), u16(nameStrings[index].length), u16(nameOffset)]);
  nameOffset += nameStrings[index].length;
  return value;
});
const name = Buffer.concat([u16(0), u16(names.length), u16(6 + 12 * names.length), ...nameRecords, ...nameStrings]);

const averageAdvance = Math.round(glyphs.slice(1).reduce((sum, glyph) => sum + glyph.advance, 0) / mappings.length);
const os2 = Buffer.concat([
  u16(0), i16(averageAdvance), u16(400), u16(5), u16(0),
  i16(650), i16(700), i16(0), i16(140), i16(650), i16(700), i16(0), i16(480),
  i16(50), i16(300), i16(0), Buffer.alloc(10), u32(1), u32(0), u32(0), u32(0),
  Buffer.from("LCRF"), u16(0x40), u16(mappings[0].code), u16(mappings.at(-1).code), i16(896), i16(-128), i16(0), u16(896), u16(128),
]);
const post = Buffer.concat([fixed(3), fixed(0), i16(0), i16(0), u32(0), u32(0), u32(0), u32(0), u32(0)]);
const maxp = Buffer.concat([fixed(1), u16(glyphs.length), u16(128), u16(32), u16(0), u16(0), u16(2), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0)]);
const hhea = Buffer.concat([fixed(1), i16(896), i16(-128), i16(0), u16(1024), i16(0), i16(0), i16(1024), i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(glyphs.length)]);
const head = Buffer.concat([
  fixed(1), fixed(1), u32(0), u32(0x5f0f3cf5), u16(11), u16(1024), Buffer.alloc(16),
  i16(0), i16(0), i16(1024), i16(1024), u16(0), u16(8), i16(2), i16(1), i16(0),
]);

const tables = new Map([
  ["OS/2", os2], ["cmap", cmap], ["glyf", glyf], ["head", head], ["hhea", hhea],
  ["hmtx", hmtx], ["loca", locaTable], ["maxp", maxp], ["name", name], ["post", post],
]);
const tags = [...tables.keys()].sort();
const numTables = tags.length, power = 2 ** Math.floor(Math.log2(numTables));
const header = Buffer.concat([u32(0x00010000), u16(numTables), u16(power * 16), u16(Math.log2(power)), u16(numTables * 16 - power * 16)]);
let tableOffset = 12 + numTables * 16;
const directory = [], bodies = [], offsets = new Map();
for (const tag of tags) {
  const body = tables.get(tag), aligned = padded(body);
  directory.push(Buffer.concat([Buffer.from(tag), u32(checksum(body)), u32(tableOffset), u32(body.length)]));
  offsets.set(tag, tableOffset); bodies.push(aligned); tableOffset += aligned.length;
}
const font = Buffer.concat([header, ...directory, ...bodies]);
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, offsets.get("head") + 8);
const base64 = font.toString("base64");
const source = `/** Generated from the user-owned Minecraft 26.2 bitmap font atlases (ASCII plus required interface glyphs). */\nexport const MINECRAFT_ASCII_TTF_BASE64 = ${JSON.stringify(base64)};\n`;
writeFileSync(output, source);
console.log(JSON.stringify({ bytes: font.length, base64Bytes: base64.length, glyphs: glyphs.length }));
