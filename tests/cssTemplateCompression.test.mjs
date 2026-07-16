import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compactClientIdentifiers,
  CSS_DICTIONARY_ALPHABET,
  dictionaryCompressCss,
  dictionaryDecompressCss,
  minifyCssText,
} from "../scripts/css-template-compression.mjs";

const files = [
  "client/index.tsx",
  "client/components/HudStyles.tsx",
  "client/lobby/LobbyStyles.tsx",
  "client/chat/ChatStyles.tsx",
  "client/components/ChestDrawer.tsx",
  "client/components/FirstPersonBow.tsx",
];
let totalUnpackedBytes = 0;
let totalPackedBytes = 0;
const startedAt = performance.now();
for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g)) {
    const minified = minifyCssText(match[2]);
    const packed = dictionaryCompressCss(minified);
    assert.ok(packed, `${match[1]} should have at least one profitable dictionary entry`);
    assert.equal(dictionaryDecompressCss(packed), minified, `${match[1]} must round-trip byte-for-byte`);
    assert.deepEqual(dictionaryCompressCss(minified), packed, `${match[1]} packing must be deterministic`);
    const expression = `(()=>{const d=${JSON.stringify(packed.dictionary)},a=${JSON.stringify(CSS_DICTIONARY_ALPHABET)};return ${JSON.stringify(packed.compressed)}.replace(/~([0-9A-Za-z_$])~/g,(t,s)=>d[a.indexOf(s)]??t)})()`;
    totalUnpackedBytes += Buffer.byteLength(JSON.stringify(minified));
    totalPackedBytes += Buffer.byteLength(expression);
  }
}
const elapsedMs = performance.now() - startedAt;
assert.ok(totalUnpackedBytes - totalPackedBytes > 14_000, "embedded CSS should reclaim at least 14 KB before capsule encoding");
assert.ok(elapsedMs < 20_000, `CSS packing took ${elapsedMs.toFixed(1)}ms`);
assert.equal(dictionaryCompressCss(".a~.b{color:red}"), null, "CSS containing the reserved token delimiter must fail safe");

const identifierFixture = '.lc-panel{color:var(--lc-color)}<section className="lc-panel" aria-labelledby="lakecraft-title" id="lakecraft-title">';
assert.equal(
  compactClientIdentifiers(identifierFixture),
  '.xpanel{color:var(--xcolor)}<section className="xpanel" aria-labelledby="ytitle" id="ytitle">',
  "compact client identifiers must rewrite selectors, variables, class names, and DOM references consistently",
);

console.log(JSON.stringify({
  benchmark: "deterministic embedded CSS dictionary compression",
  unpackedBytes: totalUnpackedBytes,
  packedBytes: totalPackedBytes,
  savedBytes: totalUnpackedBytes - totalPackedBytes,
  elapsedMs: Number(elapsedMs.toFixed(2)),
}));
console.log("lakecraft compact CSS roundtrip tests: ok");
