import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publishLakebedPreview } from "./publish-lakebed-preview.mjs";
import { releaseChanges } from "./release-changes.mjs";
import { validateWorkflow } from "./validate-workflow.mjs";
import { requirePushedCommit, withCommitArchive } from "./workflow-git.mjs";

const channel = process.argv[2];
if (process.argv.length !== 3 || !["development", "preview"].includes(channel)) {
  throw new Error("Usage: node scripts/publish-review.mjs <development|preview>");
}
const cwd = process.cwd();
const source = requirePushedCommit(channel, cwd);
const changes = channel === "preview" ? releaseChanges(cwd) : undefined;
const checks = await validateWorkflow(cwd);
if (requirePushedCommit(channel, cwd).commit !== source.commit) throw new Error("Source changed during validation.");
const deployment = await withCommitArchive(source.commit, cwd, (sourceRoot) => publishLakebedPreview({
  sourceRoot, metadataRoot: cwd, channel, expectedArtifact: checks.artifact,
}));
const receipt = { channel, ...source, ...deployment, checks, changes };
await mkdir(join(cwd, ".lakebed", "reviews"), { recursive: true });
const receiptPath = join(cwd, ".lakebed", "reviews", `${channel}.json`);
// Keep the deployment identity even if a subsequent HTTP check fails.
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
for (const route of ["/", "/?multiplayer=1", "/api/status"]) {
  const response = await fetch(new URL(route, deployment.url), { signal: AbortSignal.timeout(20_000) });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Published ${deployment.url}, but ${route} returned HTTP ${response.status}.`);
}
receipt.verifiedAt = new Date().toISOString();
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
