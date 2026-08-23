import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkMarkdownLinks,
  markdownAnchors,
  markdownLinks,
} from "../scripts/check-markdown-links.mjs";

test("markdown parsing ignores code fences and tracks duplicate headings", () => {
  const source = "# Hello, World!\n## Repeat\n## Repeat\n```md\n[bad](missing.md)\n```\n[good](guide.md#setup)\n";
  assert.deepEqual([...markdownAnchors(source)], ["hello-world", "repeat", "repeat-1"]);
  assert.deepEqual(markdownLinks(source), ["guide.md#setup"]);
});

test("link check validates files and local anchors", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakecraft-markdown-links-"));
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "README.md"), "[valid](docs/guide.md#setup)\n[bad](docs/missing.md)\n");
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n## Setup\n");
    const result = await checkMarkdownLinks(root);
    assert.deepEqual(result.violations, [
      { file: "README.md", link: "docs/missing.md", reason: "missing target" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository Markdown links resolve", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await checkMarkdownLinks(root);
  assert.deepEqual(result.violations, []);
});
