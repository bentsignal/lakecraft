import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./workflow-git.mjs";

export function releaseChanges(cwd = process.cwd()) {
  const commit = git(["rev-parse", "HEAD"], cwd);
  // UTC-prefixed tags follow deployment order, including a rollback to older source.
  const tag = git(["for-each-ref", "--sort=-refname", "--format=%(refname:short)", "refs/tags/production/"], cwd)
    .split("\n").filter(Boolean)[0] ?? "workflow/production-baseline";
  try { git(["merge-base", "--is-ancestor", tag, commit], cwd); }
  catch { throw new Error("Fetch tags and establish a production or workflow baseline that is an ancestor of HEAD."); }
  const baseline = git(["rev-parse", `${tag}^{commit}`], cwd);
  return {
    baseline, baselineTag: tag, baselineKind: tag.startsWith("production/") ? "production" : "workflow-start", commit,
    commits: git(["log", "--reverse", "--format=%H %s", `${baseline}..${commit}`], cwd).split("\n").filter(Boolean),
    files: git(["diff", "--name-status", baseline, commit], cwd).split("\n").filter(Boolean),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(releaseChanges(), null, 2));
}
