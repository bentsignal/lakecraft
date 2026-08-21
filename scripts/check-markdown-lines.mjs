import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_MAX_MARKDOWN_LINES = 300;
export const MARKDOWN_EXTENSIONS = Object.freeze([".md", ".markdown"]);
export const EXCLUDED_DIRECTORY_NAMES = Object.freeze([".git", ".lakebed", "node_modules"]);

function isMarkdownFile(name) {
  const lowerName = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

/**
 * Count logical lines without treating a final newline as an additional blank line.
 * This matches how people generally count lines in a text document and avoids
 * penalising normal POSIX-style files that end with a newline.
 */
export function countMarkdownLines(source) {
  if (source.length === 0) return 0;
  return source.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).length;
}

/**
 * Find Markdown files below root. The walk is intentionally filesystem-based,
 * so both tracked and untracked project files are checked.
 */
export async function findMarkdownFiles(rootDirectory) {
  const root = resolve(rootDirectory);
  const files = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.includes(entry.name)) continue;
        await walk(join(directory, entry.name));
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(join(directory, entry.name));
      }
    }
  }

  await walk(root);
  return files;
}

/**
 * Return every Markdown file over the configured limit, with paths relative to
 * root for stable, actionable CLI output.
 */
export async function checkMarkdownFiles(rootDirectory, maxLines = DEFAULT_MAX_MARKDOWN_LINES) {
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new RangeError("maxLines must be a positive integer");
  }

  const root = resolve(rootDirectory);
  const files = await findMarkdownFiles(root);
  const violations = [];
  for (const file of files) {
    const lineCount = countMarkdownLines(await readFile(file, "utf8"));
    if (lineCount > maxLines) {
      violations.push({
        path: relative(root, file) || file,
        absolutePath: file,
        lineCount,
        maxLines,
      });
    }
  }
  return { files, violations, maxLines, root };
}

async function main() {
  const [rootArgument = "."] = process.argv.slice(2);
  const root = isAbsolute(rootArgument) ? rootArgument : resolve(process.cwd(), rootArgument);
  const result = await checkMarkdownFiles(root);
  if (result.violations.length === 0) {
    console.log(`Markdown line check passed: ${result.files.length} file(s) at or below ${result.maxLines} lines.`);
    return;
  }

  console.error(`Markdown line check failed: ${result.violations.length} file(s) exceed ${result.maxLines} lines.`);
  for (const violation of result.violations) {
    console.error(`- ${violation.path}: ${violation.lineCount} lines (maximum ${violation.maxLines}); split or condense this document.`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Markdown line check could not run: ${error.message}`);
    process.exitCode = 1;
  });
}
