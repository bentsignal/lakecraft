import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  auditCompactClientIdentifierCorpus,
  bundleCompressCss,
  bundleDecompressCss,
  COMPACT_CLIENT_IDENTIFIER_FAMILIES,
  COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES,
  COMPACT_CLIENT_PRIVATE_IDENTIFIERS,
  compactClientIdentifiers,
  CSS_BUNDLE_MAX_DISTANCE,
  CSS_BUNDLE_SEPARATOR,
  CSS_DICTIONARY_ALPHABET,
  cssBundleRuntimeExpression,
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

async function clientSourcePaths(directory = new URL("../client/", import.meta.url)) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) paths.push(...await clientSourcePaths(url));
    else if (/\.[tj]sx?$/.test(entry.name)) paths.push(url);
  }
  return paths.sort((left, right) => left.href.localeCompare(right.href));
}

const files = [
  "client/index.tsx",
  "client/components/HudStyles.tsx",
  "client/lobby/LobbyStyles.tsx",
  "client/chat/ChatStyles.tsx",
  "client/components/ChestDrawer.tsx",
  "client/components/OptionsDialog.tsx",
];
let totalUnpackedBytes = 0;
let totalPackedBytes = 0;
let totalDictionaryBytes = 0;
let totalLzBytes = 0;
let lzWinnerCount = 0;
const compactedTemplates = [];
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
  const compactedSource = compactClientIdentifiers(source);
  for (const match of compactedSource.matchAll(/const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g)) {
    compactedTemplates.push(minifyCssText(match[2]));
  }
}
const elapsedMs = performance.now() - startedAt;
assert.ok(totalUnpackedBytes - totalPackedBytes > 14_000, "embedded CSS should reclaim at least 14 KB before capsule encoding");
assert.ok(elapsedMs < 20_000, `CSS packing took ${elapsedMs.toFixed(1)}ms`);
assert.equal(dictionaryCompressCss(".a~.b{color:red}"), null, "CSS containing the reserved token delimiter must fail safe");
assert.equal(lzCompressCss(".a~.b{color:red}"), null, "LZ packing must reject the reserved token delimiter");

const cssBundleSource = compactedTemplates.join(CSS_BUNDLE_SEPARATOR);
const cssBundle = bundleCompressCss(cssBundleSource);
assert.ok(cssBundle, "the shared stylesheet payload should contain profitable long-window references");
assert.equal(bundleDecompressCss(cssBundle), cssBundleSource, "shared stylesheet payload must round-trip byte-for-byte");
assert.deepEqual(bundleCompressCss(cssBundleSource), cssBundle, "shared stylesheet packing must be deterministic");
const cssBundleExpression = cssBundleRuntimeExpression(cssBundle);
assert.equal(Function(`return ${cssBundleExpression}`)(), cssBundleSource, "the staged runtime decoder must match the build-time decoder");
const cssBundleBytes = Buffer.byteLength(cssBundleExpression)
  + Buffer.byteLength(`.split(${JSON.stringify(CSS_BUNDLE_SEPARATOR)})`);
assert.ok(
  totalPackedBytes - cssBundleBytes > 8_000,
  "one cross-template payload should reclaim at least 8 KB before capsule encoding",
);
assert.equal(bundleCompressCss(".a~.b{color:red}"), null, "shared packing rejects its short token prefix");
assert.equal(bundleCompressCss(".a^.b{color:red}"), null, "shared packing rejects its medium token prefix");
assert.equal(bundleCompressCss(".a`.b{color:red}"), null, "shared packing rejects its long token prefix");
const separatorFixture = `.a{color:red}${CSS_BUNDLE_SEPARATOR}.b{color:red}`;
assert.equal(bundleDecompressCss(bundleCompressCss(separatorFixture)), separatorFixture, "the joined payload preserves stylesheet separators");
const optimalParseFixture = "abcdeXUVWXYZUVWXYZcdefgcdefgUVWXYZbcdefcdefgabcdeabcdeYUVWXYZbcdefabcdefmnopqrabcdecdefgcdefgabcde";
const optimalParsePacked = bundleCompressCss(optimalParseFixture);
assert.equal(optimalParsePacked.compressed.length, 63, "global CSS parsing avoids the 64-byte greedy encoding");
assert.equal(bundleDecompressCss(optimalParsePacked), optimalParseFixture, "the non-greedy CSS fixture round-trips exactly");
const maximumLengthPacked = bundleCompressCss("a".repeat(69));
assert.equal(maximumLengthPacked.compressed, "a~0$", "the full 64-symbol length alphabet encodes a 68-byte match");
assert.equal(bundleDecompressCss(maximumLengthPacked), "a".repeat(69), "the maximum shared match length round-trips");
assert.throws(() => bundleDecompressCss({ compressed: "`" }), /Truncated/, "truncated shared tokens must be rejected");
assert.throws(() => bundleDecompressCss({ compressed: "`000!" }), /Malformed/, "malformed shared tokens must be rejected");
assert.throws(() => bundleDecompressCss({ compressed: "~00" }), /unavailable/, "forward shared references must be rejected");
const longDistanceFixture = `ABCDEFGH${"x".repeat(4_096)}ABCDEFGH`;
const longDistancePacked = bundleCompressCss(longDistanceFixture);
assert.ok(longDistancePacked.compressed.includes("`"), "a distance beyond 4096 characters must use a long-window token");
assert.equal(bundleDecompressCss(longDistancePacked), longDistanceFixture, "long-window shared tokens must round-trip");
const maximumBundleDistanceDecoded = bundleDecompressCss({
  compressed: `${"x".repeat(CSS_BUNDLE_MAX_DISTANCE)}\`$$$0`,
});
assert.equal(maximumBundleDistanceDecoded.length, CSS_BUNDLE_MAX_DISTANCE + 5, "maximum shared distance must decode");
assert.ok(maximumBundleDistanceDecoded.endsWith("xxxxx"), "maximum shared distance must reference available output");

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
  '.Z0 .Yq2health .ZX0 .xunmapped',
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
const allClientSources = await Promise.all((await clientSourcePaths()).map((path) => readFile(path, "utf8")));
assert.equal(auditCompactClientIdentifierCorpus(allClientSources), true, "the reviewed private identifier corpus must stay exact");
for (const [, compact] of COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES) {
  assert.throws(
    () => auditCompactClientIdentifierCorpus([...allClientSources, `const exactCollision = "${compact}";`]),
    new RegExp(`prefix target already exists.*${compact}`),
    `${compact} exact target collisions must fail closed`,
  );
  assert.throws(
    () => auditCompactClientIdentifierCorpus([...allClientSources, `const concreteCollision = "${compact}health";`]),
    new RegExp(`prefix target already exists.*${compact}`),
    `${compact} concrete modifier collisions must fail closed`,
  );
}
assert.equal(
  new Set(COMPACT_CLIENT_PRIVATE_IDENTIFIERS.map(([, compact]) => compact)).size,
  COMPACT_CLIENT_PRIVATE_IDENTIFIERS.length,
  "private identifier targets must remain unique",
);
assert.ok(
  COMPACT_CLIENT_PRIVATE_IDENTIFIERS.every(([readable, compact, expectedCount]) => (
    /^(?:--)?[xy]/.test(readable)
    && /^(?:--)?Z[0-9A-Za-z_]+$/.test(compact)
    && Number.isInteger(expectedCount)
    && expectedCount > 0
  )),
  "private identifiers must stay in reviewed namespaces with fixed positive occurrence counts",
);
assert.deepEqual(
  COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES.map(([readable, compact, count]) => [readable, compact, count]),
  [["xc-slot--", "Yq0", 1], ["xj-glyph--", "Yq1", 3], ["xl--", "Yq2", 7], ["xt--", "Yq3", 3]],
  "only the four reviewed runtime-composed modifier families may use prefix compaction",
);
assert.equal(
  compactClientIdentifiers('className={`lc-furnace-slot--${kind} lc-item-glyph--${category} lc-meter--${meter} lc-toast--${tone}`}'),
  'className={`Yq0${kind} Yq1${category} Yq2${meter} Yq3${tone}`}',
  "runtime-composed private modifiers must retain matching stable prefixes",
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
  sharedExpressionBytes: cssBundleBytes,
  sharedSavingsOverSeparateBytes: totalPackedBytes - cssBundleBytes,
  elapsedMs: Number(elapsedMs.toFixed(2)),
}));
console.log("lakecraft compact CSS roundtrip tests: ok");
