import { access, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findMarkdownFiles } from "./check-markdown-lines.mjs";

const LINK_PATTERN = /!?\[[^\]]*\]\((<?[^\s)>]+>?)(?:\s+["'][^"']*["'])?\)/g;

function githubSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function markdownAnchors(source) {
  const counts = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = githubSlug(heading[2]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

export function markdownLinks(source) {
  const links = [];
  let fenced = false;
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(LINK_PATTERN)) {
      links.push(match[1].replace(/^<|>$/g, ""));
    }
  }
  return links;
}

export async function checkMarkdownLinks(rootDirectory) {
  const root = resolve(rootDirectory);
  const files = await findMarkdownFiles(root);
  const sourceCache = new Map();
  const violations = [];

  async function sourceFor(file) {
    if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, "utf8"));
    return sourceCache.get(file);
  }

  for (const file of files) {
    const source = await sourceFor(file);
    for (const rawLink of markdownLinks(source)) {
      if (/^(?:https?:|mailto:|data:)/i.test(rawLink)) continue;
      const [rawPath, rawAnchor] = rawLink.split("#", 2);
      const target = rawPath ? resolve(dirname(file), decodeURIComponent(rawPath)) : file;
      try {
        await access(target);
      } catch {
        violations.push({ file: relative(root, file), link: rawLink, reason: "missing target" });
        continue;
      }
      if (!rawAnchor || extname(target).toLowerCase() !== ".md" || (await stat(target)).isDirectory()) continue;
      const anchor = decodeURIComponent(rawAnchor).toLowerCase();
      if (!markdownAnchors(await sourceFor(target)).has(anchor)) {
        violations.push({ file: relative(root, file), link: rawLink, reason: "missing anchor" });
      }
    }
  }
  return { files, root, violations };
}

async function main() {
  const root = resolve(process.cwd(), process.argv[2] ?? ".");
  const result = await checkMarkdownLinks(root);
  if (result.violations.length === 0) {
    console.log(`Markdown link check passed: ${result.files.length} file(s).`);
    return;
  }
  console.error(`Markdown link check failed: ${result.violations.length} invalid link(s).`);
  for (const violation of result.violations) {
    console.error(`- ${violation.file}: ${violation.link} (${violation.reason})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Markdown link check could not run: ${error.message}`);
    process.exitCode = 1;
  });
}
