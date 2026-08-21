import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkMarkdownFiles,
  countMarkdownLines,
  DEFAULT_MAX_MARKDOWN_LINES,
  findMarkdownFiles,
} from "../scripts/check-markdown-lines.mjs";

async function withFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), "lakecraft-markdown-lines-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("countMarkdownLines counts logical lines and ignores a final newline", () => {
  assert.equal(countMarkdownLines(""), 0);
  assert.equal(countMarkdownLines("one"), 1);
  assert.equal(countMarkdownLines("one\ntwo\n"), 2);
  assert.equal(countMarkdownLines("one\r\ntwo\r\nthree"), 3);
});

test("findMarkdownFiles scans tracked and untracked-looking files while excluding vendor state", async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, "docs", "nested"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".lakebed"), { recursive: true });
    await mkdir(join(root, "node_modules", "package"), { recursive: true });
    await writeFile(join(root, "README.md"), "# readme\n");
    await writeFile(join(root, "docs", "nested", "untracked.markdown"), "# note\n");
    await writeFile(join(root, ".git", "ignored.md"), "ignored\n");
    await writeFile(join(root, ".lakebed", "ignored.md"), "ignored\n");
    await writeFile(join(root, "node_modules", "package", "ignored.md"), "ignored\n");

    const files = await findMarkdownFiles(root);
    assert.deepEqual(files.map((file) => file.slice(root.length + 1)), ["docs/nested/untracked.markdown", "README.md"]);
  });
});

test("checkMarkdownFiles reports actionable oversized documents", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "short.md"), "short\n");
    await writeFile(join(root, "large.md"), `${"line\n".repeat(4)}`);

    const result = await checkMarkdownFiles(root, 3);
    assert.equal(result.files.length, 2);
    assert.deepEqual(result.violations.map(({ path, lineCount, maxLines }) => ({ path, lineCount, maxLines })), [
      { path: "large.md", lineCount: 4, maxLines: 3 },
    ]);
    assert.equal(DEFAULT_MAX_MARKDOWN_LINES, 300);
    assert.match(await readFile(join(root, "large.md"), "utf8"), /^line/);
  });
});

test("checkMarkdownFiles rejects invalid limits", async () => {
  await withFixture(async (root) => {
    await assert.rejects(() => checkMarkdownFiles(root, 0), /positive integer/);
    await assert.rejects(() => checkMarkdownFiles(root, 1.5), /positive integer/);
  });
});

test("repository Markdown stays within the line limit", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const result = await checkMarkdownFiles(repositoryRoot);
  assert.deepEqual(
    result.violations.map(({ path, lineCount }) => ({ path, lineCount })),
    [],
    "split or condense oversized Markdown before merging",
  );
});
