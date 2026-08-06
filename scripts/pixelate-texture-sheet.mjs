import { deflateSync, inflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { encodeStaticBytes } from "./static-byte-encoding.mjs";
import { decodePng as decodeImportedPng } from "./png-rgba.mjs";

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
  const options = {
    columns: 4,
    rows: 4,
    sourceColumns: null,
    sourceRows: null,
    tileSize: 16,
    inset: 0.04,
    names: [],
    ts: "",
  };
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
    else if (argument === "--source-columns") options.sourceColumns = parsePositiveInteger(value, "source columns");
    else if (argument === "--source-rows") options.sourceRows = parsePositiveInteger(value, "source rows");
    else if (argument === "--tile-size") options.tileSize = parsePositiveInteger(value, "tile size");
    else if (argument === "--inset") {
      options.inset = Number(value);
      if (!Number.isFinite(options.inset) || options.inset < 0 || options.inset >= 0.25) fail("inset must be from 0 through 0.249.");
    } else if (argument === "--names") options.names = value.split(",").map((name) => name.trim()).filter(Boolean);
    else if (argument === "--ts") options.ts = value;
    else fail(`unknown option ${argument}.`);
  }
  if (positional.length !== 2) {
    fail("usage: node scripts/pixelate-texture-sheet.mjs input.png output.png [--columns 4 --rows 4 --source-columns 4 --source-rows 4 --tile-size 16 --inset 0.04 --names a,b,... --ts output.ts]");
  }
  if (options.names.length > options.columns * options.rows) {
    fail(`--names cannot contain more than ${options.columns * options.rows} comma-separated names.`);
  }
  const sourceColumns = options.sourceColumns ?? options.columns;
  const sourceRows = options.sourceRows ?? options.rows;
  if (sourceColumns * sourceRows > options.columns * options.rows) {
    fail("source grid cannot contain more cells than the output atlas.");
  }
  if (options.names.length && options.names.length < sourceColumns * sourceRows) {
    fail(`--names must cover all ${sourceColumns * sourceRows} source cells.`);
  }
  return {
    input: resolve(positional[0]),
    output: resolve(positional[1]),
    ...options,
    sourceColumns,
    sourceRows,
  };
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

function pixelOffset(image, x, y) {
  return (y * image.width + x) * 4;
}

function setPixel(image, x, y, color) {
  const offset = pixelOffset(image, x, y);
  image.rgba[offset] = color[0];
  image.rgba[offset + 1] = color[1];
  image.rgba[offset + 2] = color[2];
  image.rgba[offset + 3] = color[3] ?? 255;
}

function copyTile(source, sourceIndex, output, outputIndex, sourceColumns, outputColumns, tileSize) {
  const sourceX = (sourceIndex % sourceColumns) * tileSize;
  const sourceY = Math.floor(sourceIndex / sourceColumns) * tileSize;
  const outputX = (outputIndex % outputColumns) * tileSize;
  const outputY = Math.floor(outputIndex / outputColumns) * tileSize;
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const sourceOffset = pixelOffset(source, sourceX + x, sourceY + y);
      setPixel(output, outputX + x, outputY + y, source.rgba.subarray(sourceOffset, sourceOffset + 4));
    }
  }
}

// Small connected silhouettes keep ore embedded in the host stone instead of
// reading as evenly spaced dots. Each tuple is x, y, and palette-tone index.
const ORE_CLUSTER_SHAPES = [
  [[0,0,0],[1,0,1],[0,1,1],[1,1,2],[2,1,1],[1,2,0]],
  [[0,0,0],[1,0,1],[1,1,2],[2,1,1],[2,2,2],[3,2,1],[2,3,0]],
  [[1,0,0],[0,1,1],[1,1,2],[2,1,1],[1,2,0]],
];

const ORE_RECIPES = Object.freeze({
  coal_ore: {
    tones: [[34,34,34,255],[51,51,51,255],[85,85,85,255]],
    clusters: [[1,1,0],[9,2,1],[4,7,2],[10,10,0],[1,11,1]],
  },
  iron_ore: {
    tones: [[119,68,51,255],[187,119,85,255],[221,170,119,255]],
    clusters: [[3,1,1],[10,4,0],[1,8,2],[8,11,1]],
  },
  gold_ore: {
    tones: [[170,102,17,255],[238,187,34,255],[255,221,85,255]],
    clusters: [[1,2,2],[9,1,0],[5,8,1],[11,11,2]],
  },
  diamond_ore: {
    tones: [[17,119,136,255],[34,187,204,255],[119,238,238,255]],
    clusters: [[3,1,2],[10,5,0],[2,10,0],[9,12,2]],
  },
});

function paintOreTile(output, outputIndex, columns, tileSize, stoneIndex, name) {
  const recipe = ORE_RECIPES[name];
  if (!recipe || stoneIndex < 0) fail(`cannot derive ${name} without the canonical stone tile.`);
  copyTile(output, stoneIndex, output, outputIndex, columns, columns, tileSize);
  const originX = (outputIndex % columns) * tileSize;
  const originY = Math.floor(outputIndex / columns) * tileSize;
  for (const [clusterX, clusterY, shapeIndex] of recipe.clusters) {
    const shape = ORE_CLUSTER_SHAPES[shapeIndex];
    for (const [x, y, tone] of shape) {
      setPixel(output, originX + clusterX + x, originY + clusterY + y, recipe.tones[tone]);
    }
  }
}

function paintDerivedTile(output, outputIndex, columns, tileSize, name) {
  const originX = (outputIndex % columns) * tileSize;
  const originY = Math.floor(outputIndex / columns) * tileSize;
  const paint = (x, y, color) => setPixel(output, originX + x, originY + y, color);
  const fill = (color) => {
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) paint(x, y, color);
    }
  };

  if (name === "oak_log_end") {
    const bark = [102, 68, 34, 255];
    const heartwood = [187, 136, 68, 255];
    const light = [221, 170, 85, 255];
    const ring = [153, 102, 51, 255];
    fill(heartwood);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const radius = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const edge = x < 2 || x > 13 || y < 2 || y > 13;
        if (edge) paint(x, y, bark);
        else if ((radius >= 2 && radius < 3) || (radius >= 5 && radius < 6)) paint(x, y, ring);
        else if (((x * 7 + y * 11) & 15) === 0) paint(x, y, light);
      }
    }
    for (const [x, y] of [[7, 6], [7, 7], [8, 7], [8, 8], [9, 8], [6, 9], [5, 10]]) paint(x, y, bark);
    return;
  }

  if (name === "crafting_table_top") {
    const dark = [85, 51, 17, 255];
    const wood = [153, 102, 51, 255];
    const light = [204, 153, 85, 255];
    fill(wood);
    for (let edge = 0; edge < tileSize; edge += 1) {
      paint(edge, 0, dark); paint(edge, 15, dark); paint(0, edge, dark); paint(15, edge, dark);
    }
    for (let edge = 2; edge < 14; edge += 1) {
      paint(edge, 2, light); paint(edge, 13, light); paint(2, edge, light); paint(13, edge, light);
    }
    for (let index = 3; index < 13; index += 1) {
      paint(index, index, dark);
      if (index < 12) paint(index + 1, index, light);
    }
    for (const [x, y] of [[5, 10], [6, 9], [9, 6], [10, 5], [11, 4]]) paint(x, y, [68, 68, 51, 255]);
    return;
  }

  if (name === "crafting_table_front") {
    const dark = [68, 34, 17, 255];
    const wood = [153, 102, 51, 255];
    const light = [221, 170, 85, 255];
    fill(wood);
    for (let x = 0; x < tileSize; x += 1) {
      paint(x, 0, dark); paint(x, 1, light); paint(x, 7, dark); paint(x, 15, dark);
    }
    for (let y = 0; y < tileSize; y += 1) {
      paint(0, y, dark); paint(7, y, dark); paint(15, y, dark);
    }
    for (let index = 3; index < 7; index += 1) paint(index, index, [68, 68, 51, 255]);
    for (let y = 9; y < 14; y += 1) {
      paint(10, y, [102, 102, 85, 255]);
      paint(11, y, [102, 102, 85, 255]);
    }
    return;
  }

  if (name === "furnace_side") {
    // Neutral original masonry used on every non-front vertical face. It is
    // intentionally free of an opening so a furnace keeps one readable
    // orientation instead of appearing to have a mouth on every side.
    const mortar = [68, 68, 68, 255];
    const shadow = [102, 102, 102, 255];
    const stone = [136, 136, 136, 255];
    const highlight = [170, 170, 153, 255];
    fill(stone);
    for (const y of [0, 4, 8, 12, 15]) {
      for (let x = 0; x < tileSize; x += 1) paint(x, y, mortar);
    }
    for (let course = 0; course < 4; course += 1) {
      const seamA = course % 2 === 0 ? 6 : 2;
      const seamB = course % 2 === 0 ? 14 : 10;
      for (let y = course * 4 + 1; y < Math.min(course * 4 + 4, tileSize); y += 1) {
        paint(seamA, y, mortar); paint(seamB, y, mortar);
      }
    }
    for (const [x, y] of [[1,1],[2,1],[7,1],[8,1],[3,5],[4,5],[11,5],[12,5],[1,9],[6,9],[7,9],[13,9],[3,13],[9,13]]) paint(x, y, highlight);
    for (const [x, y] of [[4,2],[11,3],[1,6],[8,6],[14,7],[4,10],[10,11],[1,14],[12,14]]) paint(x, y, shadow);
    return;
  }

  if (name === "furnace_front") {
    const mortar = [68, 68, 68, 255];
    const stone = [136, 136, 136, 255];
    const highlight = [170, 170, 153, 255];
    fill(stone);
    for (let y = 0; y < tileSize; y += 4) {
      for (let x = (y / 4) % 2 ? 0 : 3; x < tileSize; x += 8) {
        paint(x, y, mortar); paint(Math.min(15, x + 1), y, mortar);
      }
    }
    for (let x = 2; x < 14; x += 1) {
      paint(x, 2, highlight); paint(x, 7, mortar); paint(x, 14, mortar);
    }
    for (let y = 8; y < 14; y += 1) {
      for (let x = 3; x < 13; x += 1) paint(x, y, x === 3 || x === 12 || y === 8 ? [51, 51, 51, 255] : [17, 17, 17, 255]);
    }
    return;
  }

  if (name === "furnace_top") {
    const dark = [68, 68, 68, 255];
    const stone = [136, 136, 136, 255];
    const light = [170, 170, 170, 255];
    fill(stone);
    for (let edge = 0; edge < tileSize; edge += 1) {
      paint(edge, 0, dark); paint(edge, 15, dark); paint(0, edge, dark); paint(15, edge, dark);
      paint(edge, 2, light); paint(edge, 13, light); paint(2, edge, light); paint(13, edge, light);
    }
    for (let x = 4; x < 12; x += 1) {
      paint(x, 4, dark); paint(x, 11, dark);
    }
    for (let y = 4; y < 12; y += 1) {
      paint(4, y, dark); paint(11, y, dark);
    }
    return;
  }

  if (name === "tnt_side") {
    const dark = [85, 17, 17, 255];
    const shadow = [136, 34, 34, 255];
    const red = [187, 51, 34, 255];
    const lightRed = [221, 68, 51, 255];
    const paperShadow = [204, 187, 153, 255];
    const paper = [238, 221, 187, 255];
    const paperLight = [255, 238, 204, 255];
    const ink = [34, 34, 34, 255];
    fill(red);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        if ((y < 5 || y > 10) && ((x * 5 + y * 3) & 15) === 0) paint(x, y, lightRed);
        if (x === 0 || x === 15) paint(x, y, dark);
      }
    }
    for (let x = 1; x < 15; x += 1) {
      paint(x, 4, shadow);
      paint(x, 5, paperShadow);
      for (let y = 6; y <= 9; y += 1) paint(x, y, paper);
      paint(x, 10, paperLight);
      paint(x, 11, shadow);
    }
    // A hand-authored 3×4 T-N-T wordmark. The open center N and generous
    // paper negative space keep it readable on placed, held, and inventory cubes.
    for (const [x, y] of [
      [1,6],[2,6],[3,6],[2,7],[2,8],[2,9],
      [6,6],[9,6],[6,7],[7,7],[9,7],[6,8],[8,8],[9,8],[6,9],[9,9],
      [12,6],[13,6],[14,6],[13,7],[13,8],[13,9],
    ]) paint(x, y, ink);
    return;
  }

  if (name === "tnt_top") {
    const dark = [85, 17, 17, 255];
    const shadow = [136, 34, 34, 255];
    const red = [187, 51, 34, 255];
    const light = [238, 85, 51, 255];
    const cord = [204, 170, 102, 255];
    const fuse = [34, 34, 34, 255];
    const ember = [255, 170, 34, 255];
    fill(red);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        if (x === 0 || x === 15 || y === 0 || y === 15) paint(x, y, dark);
        else if (x === 5 || x === 10 || y === 5 || y === 10) paint(x, y, shadow);
        else if (((x + 2 * y) % 7) === 0) paint(x, y, light);
      }
    }
    for (const [x, y] of [[6,7],[6,8],[7,6],[7,9],[8,6],[8,9],[9,7],[9,8]]) paint(x, y, cord);
    for (const [x, y] of [[7,7],[8,7],[7,8],[8,8],[8,6],[9,6],[9,5],[10,5],[10,4]]) paint(x, y, fuse);
    paint(11, 3, ember); paint(10, 3, [238, 85, 34, 255]);
    return;
  }

  if (name === "tnt_bottom") {
    const dark = [68, 17, 17, 255];
    const strap = [102, 51, 34, 255];
    const red = [170, 34, 34, 255];
    const light = [204, 68, 51, 255];
    const fastener = [170, 136, 85, 255];
    fill(red);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        if (x < 2 || x > 13 || y < 2 || y > 13) paint(x, y, dark);
        else if ((x === 6 || x === 9 || y === 6 || y === 9)) paint(x, y, strap);
        else if (((x * 3 + y * 5) & 15) === 0) paint(x, y, light);
      }
    }
    for (const [x, y] of [[3,3],[12,3],[3,12],[12,12]]) paint(x, y, fastener);
    return;
  }

  if (name === "gravel") {
    // A compact, high-contrast pebble field inspired by classic voxel gravel.
    // The warm-gray flecks keep it distinct from both smooth stone and the
    // larger mortar-separated shapes in cobblestone when viewed at distance.
    const darkest = [68, 68, 68, 255];
    const dark = [85, 85, 85, 255];
    const base = [119, 119, 119, 255];
    const warm = [136, 119, 102, 255];
    const light = [170, 170, 153, 255];
    fill(base);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const grain = (Math.imul(x + 3, 29) ^ Math.imul(y + 5, 47) ^ Math.imul(x * y + 7, 13)) & 31;
        if (grain < 4) paint(x, y, dark);
        else if (grain < 7) paint(x, y, warm);
        else if (grain === 7 || grain === 19) paint(x, y, light);
      }
    }
    for (const [x, y] of [
      [1,1],[2,1],[1,2],[5,0],[6,0],[6,1],[10,2],[11,2],[10,3],[14,4],[15,4],
      [3,5],[4,5],[3,6],[7,7],[8,7],[8,8],[12,6],[13,6],[13,7],[1,10],[2,10],
      [5,12],[6,12],[5,13],[10,11],[11,11],[10,12],[14,14],[15,14],[14,15],
    ]) paint(x, y, darkest);
    for (const [x, y] of [
      [2,2],[6,2],[9,1],[11,3],[15,5],[4,7],[6,6],[9,8],[12,8],[2,11],
      [4,10],[7,13],[9,12],[12,14],[13,13],[0,15],
    ]) paint(x, y, light);
    return;
  }

  if (name === "wool") {
    // Original 16px woven-fleece tile. Warm off-whites create a soft cloth
    // field while short deterministic horizontal and vertical threads keep
    // the cube readable at Minecraft-scale nearest-neighbor sampling.
    const shadow = [187, 187, 170, 255];
    const low = [204, 204, 187, 255];
    const base = [221, 221, 204, 255];
    const light = [238, 238, 221, 255];
    const highlight = [255, 255, 238, 255];
    fill(base);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const weave = (Math.imul(x + 5, 19) ^ Math.imul(y + 11, 31) ^ Math.imul(x * y + 3, 7)) & 31;
        if (weave < 3) paint(x, y, low);
        else if (weave === 3 || weave === 17) paint(x, y, light);
      }
    }
    for (const [x, y] of [
      [1,2],[2,2],[5,0],[5,1],[9,3],[10,3],[13,1],[14,1],
      [3,6],[4,6],[7,5],[7,6],[11,7],[12,7],[15,5],[15,6],
      [0,10],[1,10],[5,9],[6,9],[9,11],[10,11],[13,9],[14,9],
      [2,14],[3,14],[7,13],[8,13],[11,15],[12,15],[15,13],[15,14],
    ]) paint(x, y, shadow);
    for (const [x, y] of [
      [2,1],[6,2],[10,2],[14,3],[1,5],[5,7],[8,4],[13,6],
      [2,9],[6,8],[10,10],[14,8],[0,13],[4,12],[9,14],[13,12],
    ]) paint(x, y, highlight);
    return;
  }

  if (name === "sapling") {
    // Original oak sapling sprite: transparent negative space around a warm
    // forked stem and a sparse three-tone leaf crown for alpha-tested quads.
    fill([0, 0, 0, 0]);
    const outline = [34, 68, 29, 255];
    const stem = [119, 85, 51, 255];
    const stemLight = [170, 119, 68, 255];
    const dark = [51, 102, 34, 255];
    const green = [85, 153, 51, 255];
    const light = [119, 187, 68, 255];
    for (const [x, y] of [[7,6],[8,6],[7,7],[8,7],[7,8],[8,8],[7,9],[8,9],[7,10],[8,10],[7,11],[8,11],[7,12],[8,12],[7,13],[8,13],[7,14],[8,14]]) paint(x, y, stem);
    for (const [x, y] of [[8,7],[8,9],[8,11],[8,13]]) paint(x, y, stemLight);
    for (const [x, y] of [[6,8],[5,7],[4,6],[9,8],[10,7],[11,6],[6,5],[5,4],[9,5],[10,4]]) paint(x, y, stem);
    for (const [x, y] of [
      [3,3],[4,2],[5,2],[6,3],[2,4],[3,4],[4,4],[5,4],[6,4],[3,5],[4,5],[5,5],
      [9,2],[10,1],[11,2],[12,2],[13,3],[9,3],[10,3],[11,3],[12,3],[13,4],[10,4],[11,4],[12,4],
      [1,6],[2,5],[3,6],[4,6],[2,7],[3,7],[4,7],[5,7],
      [10,6],[11,5],[12,5],[13,6],[14,6],[10,7],[11,7],[12,7],[13,7],
      [6,1],[7,0],[8,1],[7,2],[8,2],[9,3],
    ]) paint(x, y, outline);
    for (const [x, y] of [[4,3],[5,3],[3,4],[4,4],[5,5],[10,2],[11,2],[12,3],[10,3],[11,4],[2,6],[3,6],[3,7],[11,6],[12,6],[13,6],[11,7],[7,1],[8,2]]) paint(x, y, green);
    for (const [x, y] of [[5,2],[3,3],[4,5],[11,1],[12,2],[13,3],[2,5],[4,6],[12,5],[14,6],[7,0],[9,2]]) paint(x, y, light);
    for (const [x, y] of [[6,4],[9,3],[5,7],[10,7],[7,5],[8,5]]) paint(x, y, dark);
    return;
  }

  if (name === "stone_bricks") {
    // Original cool-gray masonry with staggered courses, one-pixel dark
    // mortar, and sparse worn highlights that stay legible at 16px.
    const mortar = [68, 68, 68, 255];
    const dark = [85, 85, 85, 255];
    const base = [119, 119, 119, 255];
    const light = [153, 153, 136, 255];
    const worn = [136, 136, 119, 255];
    fill(base);
    for (const y of [0, 4, 8, 12, 15]) {
      for (let x = 0; x < tileSize; x += 1) paint(x, y, mortar);
    }
    for (let course = 0; course < 4; course += 1) {
      const top = course * 4 + 1;
      const seamA = course % 2 === 0 ? 7 : 3;
      const seamB = course % 2 === 0 ? 15 : 11;
      for (let y = top; y < Math.min(top + 3, tileSize); y += 1) {
        paint(seamA, y, mortar);
        paint(seamB, y, mortar);
      }
    }
    for (const [x, y] of [[1,1],[2,1],[8,1],[9,1],[4,5],[5,5],[12,5],[13,5],[1,9],[2,9],[8,9],[9,9],[4,13],[5,13],[12,13]]) paint(x, y, light);
    for (const [x, y] of [[5,2],[11,3],[2,6],[8,7],[14,6],[5,10],[10,11],[1,14],[8,14],[13,13]]) paint(x, y, dark);
    for (const [x, y] of [[3,2],[9,3],[6,6],[13,7],[3,10],[12,10],[6,14]]) paint(x, y, worn);
    return;
  }

  if (name === "clay") {
    // Original blue-gray clay: a quiet compacted surface with irregular
    // compressed bands. It stays deliberately smoother than stone while the
    // sparse cool highlights keep large deposits from reading as flat color.
    const deep = [85, 102, 119, 255];
    const shadow = [119, 136, 136, 255];
    const base = [153, 170, 187, 255];
    const light = [187, 204, 204, 255];
    fill(base);
    for (const [x, y] of [
      [1,2],[2,2],[8,1],[9,1],[13,3],[14,3],
      [4,6],[5,6],[10,5],[11,5],[1,9],[2,9],
      [7,10],[8,10],[13,8],[14,8],[3,13],[4,13],[10,14],[11,14],
    ]) paint(x, y, shadow);
    for (const [x, y] of [[2,3],[6,2],[10,3],[14,2],[3,7],[8,6],[12,7],[1,12],[6,11],[9,12],[13,11],[7,15]]) paint(x, y, light);
    for (const [x, y] of [[5,1],[11,2],[1,6],[6,7],[14,6],[4,10],[11,9],[2,14],[8,13],[13,14]]) paint(x, y, deep);
    return;
  }

  if (name === "bricks") {
    // Original fired-clay masonry with staggered courses, deep mortar and
    // warm chipped highlights. The rhythm mirrors classic Minecraft brick
    // scale without copying any source texture.
    const mortar = [68, 51, 51, 255];
    const dark = [119, 68, 51, 255];
    const base = [204, 68, 51, 255];
    const warm = [187, 102, 34, 255];
    const light = [221, 136, 34, 255];
    fill(base);
    for (const y of [0, 4, 8, 12, 15]) for (let x = 0; x < tileSize; x += 1) paint(x, y, mortar);
    for (let course = 0; course < 4; course += 1) {
      const top = course * 4 + 1;
      const seams = course % 2 === 0 ? [7, 15] : [3, 11];
      for (let y = top; y < Math.min(top + 3, tileSize); y += 1) for (const x of seams) paint(x, y, mortar);
    }
    for (const [x, y] of [[1,1],[2,1],[8,1],[9,1],[4,5],[5,5],[12,5],[13,5],[1,9],[2,9],[8,9],[9,9],[4,13],[5,13],[12,13]]) paint(x, y, light);
    for (const [x, y] of [[5,2],[11,3],[2,6],[8,7],[14,6],[5,10],[10,11],[1,14],[8,14],[13,13]]) paint(x, y, dark);
    for (const [x, y] of [[3,2],[9,3],[6,6],[13,7],[3,10],[12,10],[6,14]]) paint(x, y, warm);
    return;
  }

  fail(`no deterministic material recipe exists for derived tile ${name}.`);
}

function expandNamedAtlas(source, names, columns, rows, sourceColumns, sourceRows, tileSize) {
  const output = {
    width: columns * tileSize,
    height: rows * tileSize,
    rgba: new Uint8Array(columns * rows * tileSize * tileSize * 4),
  };
  const sourceTileCount = sourceColumns * sourceRows;
  for (let index = 0; index < sourceTileCount; index += 1) {
    copyTile(source, index, output, index, sourceColumns, columns, tileSize);
    if (names[index] === "furnace_side") paintDerivedTile(output, index, columns, tileSize, names[index]);
  }
  const stoneIndex = names.indexOf("stone");
  for (let index = 0; index < sourceTileCount; index += 1) {
    if (ORE_RECIPES[names[index]]) paintOreTile(output, index, columns, tileSize, stoneIndex, names[index]);
  }
  for (let index = sourceTileCount; index < names.length; index += 1) {
    paintDerivedTile(output, index, columns, tileSize, names[index]);
  }
  return output;
}

function applyNamedMaterialRules(image, names, columns, tileSize) {
  const glassIndex = names.indexOf("glass");
  if (glassIndex < 0) return;
  const tileX = glassIndex % columns;
  const tileY = Math.floor(glassIndex / columns);
  // Glass keeps a low-alpha cyan center, brighter diagonal glints, and a
  // readable frame. It is isolated into the renderer's sorted transparent
  // pass; opaque terrain never receives these alpha values.
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const offset = (
        (tileY * tileSize + y) * image.width
        + tileX * tileSize
        + x
      ) * 4;
      const frame = x === 0 || y === 0 || x === tileSize - 1 || y === tileSize - 1;
      const glint = (x === y && x >= 3 && x <= 6)
        || (x + y === tileSize - 1 && x >= 9 && x <= 12);
      const color = frame ? [119, 187, 187] : glint ? [170, 238, 238] : [102, 187, 204];
      image.rgba[offset] = color[0];
      image.rgba[offset + 1] = color[1];
      image.rgba[offset + 2] = color[2];
      image.rgba[offset + 3] = frame ? 187 : glint ? 102 : 24;
    }
  }
}

function applyImportedMinecraftBlockTextures(image, names, columns, tileSize, blockTextures) {
  for (const [name, payload] of Object.entries(blockTextures ?? {})) {
    const tile = names.indexOf(name);
    if (tile < 0) continue;
    const source = decodeImportedPng(Buffer.from(payload, "base64"));
    if (source.width !== tileSize || source.height !== tileSize) {
      fail(`imported block texture ${name} must be ${tileSize}x${tileSize}.`);
    }
    const tileX = tile % columns;
    const tileY = Math.floor(tile / columns);
    for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < tileSize; x += 1) {
      const input = (y * tileSize + x) * 4;
      const output = ((tileY * tileSize + y) * image.width + tileX * tileSize + x) * 4;
      image.rgba.set(source.rgba.subarray(input, input + 4), output);
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

function packStaticBytes(bytes, extended = false) {
  const packed = [];
  for (let index = 0; index < bytes.length;) {
    const control = packed.length;
    packed.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && index < bytes.length; bit += 1) {
      let length = 0;
      let distance = 0;
      for (let source = Math.max(0, index - 4_095); source < index; source += 1) {
        let candidate = 0;
        while (candidate < (extended ? 273 : 18) && index + candidate < bytes.length
          && bytes[source + candidate] === bytes[index + candidate]) candidate += 1;
        if (candidate > length) {
          length = candidate;
          distance = index - source;
        }
      }
      if (length >= 3) {
        if (extended && length === 18) length = 17;
        flags |= 1 << bit;
        const value = (Math.min(length, 18) - 3) * 4_096 + distance;
        packed.push(value >> 8, value & 255);
        if (extended && length > 17) packed.push(length - 18);
        index += length;
      } else packed.push(bytes[index++]);
    }
    packed[control] = flags;
  }
  return { payload: encodeStaticBytes(packed), size: packed.length };
}

function textureSource(image, names, columns, rows, tileSize, inputName) {
  const canonicalNames = names.length ? names : Array.from({ length: columns * rows }, (_, index) => `texture_${index}`);
  const palette = [];
  const paletteIndexes = new Map();
  const pixelIndexes = new Uint8Array(image.rgba.length / 4);
  for (let pixel = 0; pixel < pixelIndexes.length; pixel += 1) {
    const offset = pixel * 4;
    const key = `${image.rgba[offset]},${image.rgba[offset + 1]},${image.rgba[offset + 2]},${image.rgba[offset + 3]}`;
    let paletteIndex = paletteIndexes.get(key);
    if (paletteIndex === undefined) {
      paletteIndex = palette.length / 4;
      if (paletteIndex >= 256) fail("generated atlas exceeds the compact 256-color runtime palette.");
      paletteIndexes.set(key, paletteIndex);
      palette.push(image.rgba[offset], image.rgba[offset + 1], image.rgba[offset + 2], image.rgba[offset + 3]);
    }
    pixelIndexes[pixel] = paletteIndex;
  }
  const palettePacked = packStaticBytes(palette);
  const frequencies = new Uint32Array(256);
  for (const paletteIndex of pixelIndexes) frequencies[paletteIndex] += 1;
  const tileColorCounts = [];
  const tilePalettes = [];
  const tilePixels = [];
  for (let tile = 0; tile < columns * rows; tile += 1) {
    const tileColumn = tile % columns;
    const tileRow = Math.floor(tile / columns);
    const pixels = [];
    for (let y = 0; y < tileSize; y += 1) for (let x = 0; x < tileSize; x += 1) {
      pixels.push(pixelIndexes[(tileRow * tileSize + y) * columns * tileSize + tileColumn * tileSize + x]);
    }
    const colors = [...new Set(pixels)].sort((left, right) => frequencies[right] - frequencies[left] || left - right);
    if (colors.length > 255) fail(`atlas tile ${tile} exceeds the compact 255-color local palette.`);
    const indexes = new Map(colors.map((color, index) => [color, index]));
    const bits = Math.max(1, Math.ceil(Math.log2(colors.length)));
    tileColorCounts.push(colors.length);
    tilePalettes.push(...colors);
    let buffer = 0;
    let available = 0;
    for (const pixel of pixels) {
      buffer = buffer * 2 ** bits + indexes.get(pixel);
      available += bits;
      if (available >= 8) {
        available -= 8;
        tilePixels.push(buffer >> available & 255);
        buffer &= 2 ** available - 1;
      }
    }
    if (available > 0) tilePixels.push(buffer << (8 - available));
  }
  const compactIndexes = [...tileColorCounts, ...tilePalettes, ...tilePixels];
  const indexPacked = packStaticBytes(compactIndexes, true);
  const paletteOffset = tileColorCounts.length;
  const pixelOffset = paletteOffset + tilePalettes.length;
  return `// Generated by scripts/pixelate-texture-sheet.mjs from ${JSON.stringify(inputName)}.\n`
    + `// Do not hand-edit; regenerate from the original concept sheet and named procedural recipes.\n`
    + `import { decodeStaticBytes } from "../../staticData.ts";\n`
    + `export const TEXTURE_TILE_SIZE = ${tileSize};\n`
    + `export const TEXTURE_ATLAS_COLUMNS = ${columns};\n`
    + `export const TEXTURE_ATLAS_ROWS = ${rows};\n`
    + `export const TEXTURE_ATLAS_NAMES = ${JSON.stringify(canonicalNames)} as const;\n`
    + `export type TextureAtlasName = typeof TEXTURE_ATLAS_NAMES[number];\n`
    + `const TEXTURE_ATLAS_PALETTE = decodeStaticBytes(${JSON.stringify(palettePacked.payload)}, ${palette.length}, ${palettePacked.size});\n`
    + `const invalid = (): never => { throw new Error("Invalid texture atlas data."); }, data = decodeStaticBytes(${JSON.stringify(indexPacked.payload)}, ${compactIndexes.length}, ${indexPacked.size}, true);\n`
    + `export const TEXTURE_ATLAS_RGBA = new Uint8Array(${pixelIndexes.length * 4});\n`
    + `let palette = ${paletteOffset}, source = ${pixelOffset}; for (let tile = 0; tile < ${columns * rows}; tile += 1) {\n`
    + `  const colors = data[tile]; if (!colors || palette + colors > ${pixelOffset}) invalid(); const bits = Math.max(1, Math.ceil(Math.log2(colors))); let buffer = 0, available = 0;\n`
    + `  for (let pixel = 0; pixel < ${tileSize * tileSize}; pixel += 1) { while (available < bits) { if (source >= data.length) invalid(); buffer = buffer * 256 + data[source++]; available += 8; } available -= bits; const color = buffer >> available & 2 ** bits - 1; buffer &= 2 ** available - 1; if (color >= colors) invalid();\n`
    + `    const input = data[palette + color] * 4, output = ((Math.floor(tile / ${columns}) * ${tileSize} + Math.floor(pixel / ${tileSize})) * ${columns * tileSize} + tile % ${columns} * ${tileSize} + pixel % ${tileSize}) * 4; if (input + 3 >= TEXTURE_ATLAS_PALETTE.length) invalid();\n`
    + `    for (let channel = 0; channel < 4; channel += 1) TEXTURE_ATLAS_RGBA[output + channel] = TEXTURE_ATLAS_PALETTE[input + channel]; }\n`
    + `  if (buffer) invalid(); palette += colors;\n`
    + `}\nif (palette !== ${pixelOffset} || source !== data.length) invalid();\n`;
}

const options = parseArguments(process.argv.slice(2));
const decoded = decodePng(await readFile(options.input));
const sampled = pixelateSheet(
  decoded,
  options.sourceColumns,
  options.sourceRows,
  options.tileSize,
  options.inset,
);
const pixelated = expandNamedAtlas(
  sampled,
  options.names,
  options.columns,
  options.rows,
  options.sourceColumns,
  options.sourceRows,
  options.tileSize,
);
applyNamedMaterialRules(pixelated, options.names, options.columns, options.tileSize);
const importedVisualAssets = JSON.parse(await readFile(
  new URL("./generated/minecraft-visual-assets-v26.2.json", import.meta.url),
  "utf8",
));
applyImportedMinecraftBlockTextures(
  pixelated,
  options.names,
  options.columns,
  options.tileSize,
  importedVisualAssets.blocks,
);
const pngBytes = encodePng(pixelated);
await writeFile(options.output, pngBytes);
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
  input: {
    path: options.input,
    width: decoded.width,
    height: decoded.height,
    columns: options.sourceColumns,
    rows: options.sourceRows,
  },
  output: { path: options.output, width: pixelated.width, height: pixelated.height },
  tileSize: options.tileSize,
  tiles: options.columns * options.rows,
  source: options.ts ? resolve(options.ts) : null,
}, null, 2));
