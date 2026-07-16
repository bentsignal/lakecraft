import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COMPACT_CLIENT_IDENTIFIER_FAMILIES,
  compactClientIdentifiers,
  CSS_DICTIONARY_ALPHABET,
  dictionaryCompressCss,
  dictionaryDecompressCss,
  minifyCssText,
} from "../scripts/css-template-compression.mjs";
import {
  CSS_LZ_ALPHABET,
  CSS_LZ_MAX_DISTANCE,
  CSS_LZ_MAX_LENGTH,
  CSS_LZ_MIN_LENGTH,
  cssLzRuntimeExpression,
  lzCompressCss,
  lzDecompressCss,
} from "../scripts/css-lz-compression.mjs";

const files = [
  "client/index.tsx",
  "client/components/HudStyles.tsx",
  "client/lobby/LobbyStyles.tsx",
  "client/chat/ChatStyles.tsx",
  "client/components/ChestDrawer.tsx",
  "client/components/FirstPersonBow.tsx",
  "client/components/OptionsDialog.tsx",
];
let totalUnpackedBytes = 0;
let totalPackedBytes = 0;
let totalDictionaryBytes = 0;
let totalLzBytes = 0;
let lzWinnerCount = 0;
const startedAt = performance.now();
for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g)) {
    const minified = minifyCssText(match[2]);
    const packed = dictionaryCompressCss(minified);
    assert.ok(packed, `${match[1]} should have at least one profitable dictionary entry`);
    assert.equal(dictionaryDecompressCss(packed), minified, `${match[1]} must round-trip byte-for-byte`);
    assert.deepEqual(dictionaryCompressCss(minified), packed, `${match[1]} packing must be deterministic`);
    const expression = `(()=>{const d=${JSON.stringify(packed.dictionary)},a=${JSON.stringify(CSS_DICTIONARY_ALPHABET)};return ${JSON.stringify(packed.compressed)}.replace(/~([0-9A-Za-z_$])/g,(t,s)=>d[a.indexOf(s)]??t)})()`;
    const lz = lzCompressCss(minified);
    assert.ok(lz, `${match[1]} should contain a profitable LZ back-reference`);
    assert.equal(lzDecompressCss(lz), minified, `${match[1]} LZ payload must round-trip byte-for-byte`);
    assert.deepEqual(lzCompressCss(minified), lz, `${match[1]} LZ packing must be deterministic`);
    const lzExpression = cssLzRuntimeExpression(lz);
    const chosenBytes = Math.min(Buffer.byteLength(expression), Buffer.byteLength(lzExpression));
    totalUnpackedBytes += Buffer.byteLength(JSON.stringify(minified));
    totalPackedBytes += chosenBytes;
    totalDictionaryBytes += Buffer.byteLength(expression);
    totalLzBytes += Buffer.byteLength(lzExpression);
    if (Buffer.byteLength(lzExpression) < Buffer.byteLength(expression)) lzWinnerCount += 1;
  }
}
const elapsedMs = performance.now() - startedAt;
assert.ok(totalUnpackedBytes - totalPackedBytes > 14_000, "embedded CSS should reclaim at least 14 KB before capsule encoding");
assert.ok(elapsedMs < 20_000, `CSS packing took ${elapsedMs.toFixed(1)}ms`);
assert.equal(dictionaryCompressCss(".a~.b{color:red}"), null, "CSS containing the reserved token delimiter must fail safe");
assert.equal(lzCompressCss(".a~.b{color:red}"), null, "LZ packing must reject the reserved token delimiter");

const overlapping = "a".repeat(CSS_LZ_MAX_LENGTH + 20);
const overlappingPacked = lzCompressCss(overlapping);
assert.ok(overlappingPacked, "overlapping repeated output should compress");
assert.equal(lzDecompressCss(overlappingPacked), overlapping, "overlapping back-references must round-trip");
assert.ok(
  [...overlappingPacked.compressed.matchAll(/~(...)/g)].every(([, token]) => (
    CSS_LZ_ALPHABET.indexOf(token[2]) + CSS_LZ_MIN_LENGTH <= CSS_LZ_MAX_LENGTH
  )),
  "encoded match lengths must stay in the 5..67 range",
);
const maximumDistanceFixture = `ABCDE${"x".repeat(CSS_LZ_MAX_DISTANCE - 5)}ABCDE`;
const maximumDistancePacked = lzCompressCss(maximumDistanceFixture);
assert.ok(maximumDistancePacked.compressed.endsWith("~$$0"), "a 4096-character back-reference must use the maximum distance digits");
assert.equal(lzDecompressCss(maximumDistancePacked), maximumDistanceFixture, "the maximum search distance must round-trip");
const outsideWindowFixture = `ABCDE${"x".repeat(CSS_LZ_MAX_DISTANCE - 4)}ABCDE`;
assert.ok(lzCompressCss(outsideWindowFixture).compressed.endsWith("ABCDE"), "a 4097-character back-reference must stay literal");
assert.throws(() => lzDecompressCss({ compressed: "~" }), /Truncated/, "truncated tokens must be rejected");
assert.throws(() => lzDecompressCss({ compressed: "~00!" }), /Malformed/, "non-alphabet digits must be rejected");
assert.throws(() => lzDecompressCss({ compressed: "~00$" }), /Malformed/, "the reserved length digit must be rejected");
assert.throws(() => lzDecompressCss({ compressed: "~000" }), /unavailable/, "forward references must be rejected");

const identifierFixture = '.lc-panel{color:var(--lc-color)}<section className="lc-panel" aria-labelledby="lakecraft-title" id="lakecraft-title">';
assert.equal(
  compactClientIdentifiers(identifierFixture),
  '.xpanel{color:var(--xcolor)}<section className="xpanel" aria-labelledby="ytitle" id="ytitle">',
  "compact client identifiers must rewrite selectors, variables, class names, and DOM references consistently",
);
assert.equal(
  compactClientIdentifiers('.lc-inventory-window .lc-meter--health .lc-player-preview__head .lc-unmapped'),
  '.xe-window .xl--health .xd__head .xunmapped',
  "frequent client-only identifier families must compact before the generic namespace",
);
assert.equal(
  new Set(COMPACT_CLIENT_IDENTIFIER_FAMILIES.map(([, compact]) => compact)).size,
  COMPACT_CLIENT_IDENTIFIER_FAMILIES.length,
  "compact family names must remain collision-free",
);
assert.ok(
  COMPACT_CLIENT_IDENTIFIER_FAMILIES.every(([readable, compact]) => readable.startsWith("lc-") && /^x[a-z]$/.test(compact)),
  "family rewrites must stay inside the private client namespace",
);

console.log(JSON.stringify({
  benchmark: "deterministic embedded CSS dictionary compression",
  unpackedBytes: totalUnpackedBytes,
  packedBytes: totalPackedBytes,
  savedBytes: totalUnpackedBytes - totalPackedBytes,
  dictionaryExpressionBytes: totalDictionaryBytes,
  lzExpressionBytes: totalLzBytes,
  hybridSavingsOverDictionaryBytes: totalDictionaryBytes - totalPackedBytes,
  lzWinnerCount,
  elapsedMs: Number(elapsedMs.toFixed(2)),
}));
console.log("lakecraft compact CSS roundtrip tests: ok");
