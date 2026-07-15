import { deflateSync, inflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  throw new Error(`Texture sheet: ${message}`);
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 256) fail(`${label} must be an integer from 1 to 256.`);
  return parsed;
}

function parseArguments(argv) {
  const positional = [];
  const options = { columns: 4, rows: 4, tileSize: 16, inset: 0.04, names: [], ts: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) fail(`${argument} requires a value.`);
    index += 1;
    if (argument === "--columns") options.columns = parsePositiveInteger(value, "columns");
    else if (argument === "--rows") options.rows = parsePositiveInteger(value, "rows");
    else if (argument === "--tile-size") options.tileSize = parsePositiveInteger(value, "tile size");
    else if (argument === "--inset") {
      options.inset = Number(value);
      if (!Number.isFinite(options.inset) || options.inset < 0 || options.inset >= 0.25) fail("inset must be from 0 through 0.249.");
    } else if (argument === "--names") options.names = value.split(",").map((name) => name.trim()).filter(Boolean);
    else if (argument === "--ts") options.ts = value;
    else fail(`unknown option ${argument}.`);
  }
  if (positional.length !== 2) {
    fail("usage: node scripts/pixelate-texture-sheet.mjs input.png output.png [--columns 4 --rows 4 --tile-size 16 --inset 0.04 --names a,b,... --ts output.ts]");
  }
  if (options.names.length && options.names.length !== options.columns * options.rows) {
    fail(`--names must contain exactly ${options.columns * options.rows} comma-separated names.`);
  }
  return { input: resolve(positional[0]), output: resolve(positional[1]), ...options };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail("input is not a PNG file.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail("truncated PNG chunk.");
    if (type === "IHDR") {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") imageData.push(bytes.subarray(dataStart, dataEnd));
    else if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  if (!width || !height || width > 8192 || height > 8192) fail("invalid or excessive PNG dimensions.");
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    fail("only non-interlaced 8-bit RGB or RGBA PNG input is supported.");
  }
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(imageData));
  if (inflated.length !== (rowBytes + 1) * height) fail("unexpected PNG data length.");
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (rowBytes + 1)];
    const sourceStart = y * (rowBytes + 1) + 1;
    const targetStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[sourceStart + x];
      const left = x >= channels ? raw[targetStart + x - channels] : 0;
      const up = y > 0 ? raw[targetStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? raw[targetStart - rowBytes + x - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : fail(`unsupported PNG row filter ${filter}.`);
      raw[targetStart + x] = (encoded + predictor) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = raw[pixel * channels];
    rgba[pixel * 4 + 1] = raw[pixel * channels + 1];
    rgba[pixel * 4 + 2] = raw[pixel * channels + 2];
    rgba[pixel * 4 + 3] = channels === 4 ? raw[pixel * channels + 3] : 255;
  }
  return { width, height, rgba };
}

function quantizeChannel(value) {
  // A 16-level channel palette avoids photographic noise while preserving
  // enough range for readable ore flecks and surface variation.
  return Math.max(0, Math.min(255, Math.round(value / 17) * 17));
}

function pixelateSheet(image, columns, rows, tileSize, insetRatio) {
  if (image.width < columns * tileSize || image.height < rows * tileSize) fail("input sheet is too small for the requested grid.");
  const atlasWidth = columns * tileSize;
  const atlasHeight = rows * tileSize;
  const atlas = new Uint8Array(atlasWidth * atlasHeight * 4);
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const minX = tileX * cellWidth + cellWidth * insetRatio;
      const maxX = (tileX + 1) * cellWidth - cellWidth * insetRatio;
      const minY = tileY * cellHeight + cellHeight * insetRatio;
      const maxY = (tileY + 1) * cellHeight - cellHeight * insetRatio;
      for (let pixelY = 0; pixelY < tileSize; pixelY += 1) {
        for (let pixelX = 0; pixelX < tileSize; pixelX += 1) {
          const sourceMinX = Math.floor(minX + (maxX - minX) * pixelX / tileSize);
          const sourceMaxX = Math.max(sourceMinX + 1, Math.ceil(minX + (maxX - minX) * (pixelX + 1) / tileSize));
          const sourceMinY = Math.floor(minY + (maxY - minY) * pixelY / tileSize);
          const sourceMaxY = Math.max(sourceMinY + 1, Math.ceil(minY + (maxY - minY) * (pixelY + 1) / tileSize));
          const totals = [0, 0, 0, 0];
          let samples = 0;
          for (let y = sourceMinY; y < Math.min(image.height, sourceMaxY); y += 1) {
            for (let x = sourceMinX; x < Math.min(image.width, sourceMaxX); x += 1) {
              const source = (y * image.width + x) * 4;
              totals[0] += image.rgba[source];
              totals[1] += image.rgba[source + 1];
              totals[2] += image.rgba[source + 2];
              totals[3] += image.rgba[source + 3];
              samples += 1;
            }
          }
          const atlasX = tileX * tileSize + pixelX;
          const atlasY = tileY * tileSize + pixelY;
          const target = (atlasY * atlasWidth + atlasX) * 4;
          atlas[target] = quantizeChannel(totals[0] / samples);
          atlas[target + 1] = quantizeChannel(totals[1] / samples);
          atlas[target + 2] = quantizeChannel(totals[2] / samples);
          atlas[target + 3] = Math.round(totals[3] / samples);
        }
      }
    }
  }
  return { width: atlasWidth, height: atlasHeight, rgba: atlas };
}

function applyNamedMaterialRules(image, names, columns, tileSize) {
  const glassIndex = names.indexOf("glass");
  if (glassIndex < 0) return;
  const tileX = glassIndex % columns;
  const tileY = Math.floor(glassIndex / columns);
  // Glass is a binary cutout material in the WebGL 1 terrain pass. Preserve
  // the brightest frame/highlight pixels and clear the pale generated fill so
  // caves and players remain visible without requiring sorted alpha blending.
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const offset = (
        (tileY * tileSize + y) * image.width
        + tileX * tileSize
        + x
      ) * 4;
      const brightness = (image.rgba[offset] + image.rgba[offset + 1] + image.rgba[offset + 2]) / 3;
      image.rgba[offset + 3] = brightness >= 210 ? 255 : 0;
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function encodePng(image) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    rows[rowStart] = 0;
    Buffer.from(image.rgba.buffer, image.rgba.byteOffset + y * image.width * 4, image.width * 4).copy(rows, rowStart + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function textureSource(image, names, columns, rows, tileSize, inputName) {
  const canonicalNames = names.length ? names : Array.from({ length: columns * rows }, (_, index) => `texture_${index}`);
  const base64 = Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength).toString("base64");
  return `// Generated by scripts/pixelate-texture-sheet.mjs from ${JSON.stringify(inputName)}.\n`
    + `// Do not hand-edit; regenerate from an original concept sheet.\n`
    + `export const TEXTURE_TILE_SIZE = ${tileSize};\n`
    + `export const TEXTURE_ATLAS_COLUMNS = ${columns};\n`
    + `export const TEXTURE_ATLAS_ROWS = ${rows};\n`
    + `export const TEXTURE_ATLAS_NAMES = ${JSON.stringify(canonicalNames)} as const;\n`
    + `export type TextureAtlasName = typeof TEXTURE_ATLAS_NAMES[number];\n`
    + `const TEXTURE_ATLAS_BINARY = atob(${JSON.stringify(base64)});\n`
    + `export const TEXTURE_ATLAS_RGBA = Uint8Array.from(TEXTURE_ATLAS_BINARY, (character) => character.charCodeAt(0));\n`;
}

const options = parseArguments(process.argv.slice(2));
const decoded = decodePng(await readFile(options.input));
const pixelated = pixelateSheet(decoded, options.columns, options.rows, options.tileSize, options.inset);
applyNamedMaterialRules(pixelated, options.names, options.columns, options.tileSize);
await writeFile(options.output, encodePng(pixelated));
if (options.ts) {
  await writeFile(resolve(options.ts), textureSource(
    pixelated,
    options.names,
    options.columns,
    options.rows,
    options.tileSize,
    basename(options.input),
  ));
}
console.log(JSON.stringify({
  input: { path: options.input, width: decoded.width, height: decoded.height },
  output: { path: options.output, width: pixelated.width, height: pixelated.height },
  tileSize: options.tileSize,
  tiles: options.columns * options.rows,
  source: options.ts ? resolve(options.ts) : null,
}, null, 2));
