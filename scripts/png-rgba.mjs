import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  throw new Error(`PNG decode: ${message}`);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

function unpackIndexedRow(row, bitDepth, width) {
  const indexes = [];
  if (bitDepth === 8) return [...row.subarray(0, width)];
  const mask = 2 ** bitDepth - 1;
  const perByte = 8 / bitDepth;
  for (const byte of row) {
    for (let index = 0; index < perByte && indexes.length < width; index += 1) {
      indexes.push(byte >> (8 - bitDepth * (index + 1)) & mask);
    }
  }
  return indexes;
}

/** Decode the standard PNG formats used by Minecraft's packaged textures. */
export function decodePng(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail("input is not a PNG file.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette = null;
  let transparency = Buffer.alloc(0);
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail("truncated PNG chunk.");
    const chunk = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") imageData.push(chunk);
    else if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  if (!width || !height || width > 8_192 || height > 8_192) fail("invalid dimensions.");
  if (interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType)
    || ![1, 2, 4, 8].includes(bitDepth) || colorType !== 3 && bitDepth !== 8) {
    fail("unsupported PNG format.");
  }
  if (colorType === 3 && (!palette || palette.length % 3)) fail("indexed image has no valid palette.");
  const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(channels * bitDepth / 8));
  const inflated = inflateSync(Buffer.concat(imageData));
  if (inflated.length !== (rowBytes + 1) * height) fail("unexpected image-data length.");
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (rowBytes + 1)];
    const sourceStart = y * (rowBytes + 1) + 1;
    const targetStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[sourceStart + x];
      const left = x >= bytesPerPixel ? raw[targetStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[targetStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? raw[targetStart - rowBytes + x - bytesPerPixel] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft)
          : fail(`unsupported row filter ${filter}.`);
      raw[targetStart + x] = (encoded + predictor) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * rowBytes, (y + 1) * rowBytes);
    if (colorType === 3) {
      for (const [x, paletteIndex] of unpackIndexedRow(row, bitDepth, width).entries()) {
        const source = paletteIndex * 3;
        if (source + 2 >= palette.length) fail("palette index is out of range.");
        const target = (y * width + x) * 4;
        rgba[target] = palette[source];
        rgba[target + 1] = palette[source + 1];
        rgba[target + 2] = palette[source + 2];
        rgba[target + 3] = paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
      }
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 0 || colorType === 4) {
        rgba[target] = rgba[target + 1] = rgba[target + 2] = row[source];
      } else {
        rgba[target] = row[source];
        rgba[target + 1] = row[source + 1];
        rgba[target + 2] = row[source + 2];
      }
      const transparentGray = colorType === 0 && transparency.length >= 2
        && row[source] === transparency.readUInt16BE(0);
      const transparentRgb = colorType === 2 && transparency.length >= 6
        && row[source] === transparency.readUInt16BE(0)
        && row[source + 1] === transparency.readUInt16BE(2)
        && row[source + 2] === transparency.readUInt16BE(4);
      rgba[target + 3] = colorType === 4 ? row[source + 1] : colorType === 6 ? row[source + 3]
        : transparentGray || transparentRgb ? 0 : 255;
    }
  }
  return Object.freeze({ width, height, rgba });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBytes, data])) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

/** Deterministic RGBA encoder used when an installed animated strip contributes its first authored frame. */
export function encodePngRgba(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    fail("invalid RGBA image");
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rows, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
