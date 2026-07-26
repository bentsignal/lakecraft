import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  bundleCompressCss,
  bundleDecompressCss,
  compactClientIdentifiers,
  CSS_BUNDLE_SEPARATOR,
  minifyCssText,
} from "../scripts/css-template-compression.mjs";

// Ten isolated trials put the production-corpus median at 3.6–4.2 ms; ten more
// with eight CPU burners stayed at or below 11.5 ms. A 40 ms ceiling rejects a
// sustained order-of-magnitude regression while retaining shared-runner margin.
// Median-of-five requires three samples to regress instead of one lucky pass.
const MAXIMUM_MEDIAN_PACK_MS = 40;
const SAMPLE_COUNT = 5;

async function clientSourceUrls(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const urls = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      urls.push(...await clientSourceUrls(new URL(`${entry.name}/`, directory)));
    } else if (/\.[tj]sx?$/.test(entry.name)) {
      urls.push(url);
    }
  }
  return urls;
}

const templates = [];
for (const url of await clientSourceUrls(new URL("../client/", import.meta.url))) {
  const source = compactClientIdentifiers(await readFile(url, "utf8"));
  for (const match of source.matchAll(/const\s+[A-Z][A-Z0-9_]*_CSS\s*=\s*`([\s\S]*?)`;/g)) {
    templates.push(minifyCssText(match[1]));
  }
}

const css = templates.join(CSS_BUNDLE_SEPARATOR);
assert.ok(templates.length >= 8, "the guard must exercise the complete production stylesheet set");
assert.ok(Buffer.byteLength(css) >= 40_000, "the guard must retain a production-scale CSS payload");

const warmup = bundleCompressCss(css);
assert.ok(warmup, "the production stylesheet payload must remain packable");
assert.equal(bundleDecompressCss(warmup), css, "the timed packer input must round-trip");

const samples = [];
for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
  const startedAt = performance.now();
  const packed = bundleCompressCss(css);
  samples.push(performance.now() - startedAt);
  assert.deepEqual(packed, warmup, "timed packing must remain deterministic");
}

const medianMs = [...samples].sort((left, right) => left - right)[Math.floor(SAMPLE_COUNT / 2)];
assert.ok(
  medianMs < MAXIMUM_MEDIAN_PACK_MS,
  `shared CSS packing median-of-${SAMPLE_COUNT} took ${medianMs.toFixed(1)}ms`,
);

console.log(JSON.stringify({
  benchmark: "shared production CSS packing wall clock",
  sourceBytes: Buffer.byteLength(css),
  templateCount: templates.length,
  samplesMs: samples.map((sample) => Number(sample.toFixed(2))),
  medianMs: Number(medianMs.toFixed(2)),
  maximumMedianMs: MAXIMUM_MEDIAN_PACK_MS,
}));
