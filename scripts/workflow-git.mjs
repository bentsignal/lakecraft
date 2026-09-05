import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

export function cleanCommit(cwd = process.cwd()) {
  if (git(["status", "--porcelain", "--untracked-files=all"], cwd)) {
    throw new Error("Commit the intended changes and resolve unrelated work before validation or publishing.");
  }
  return git(["rev-parse", "HEAD"], cwd);
}

export function requirePushedCommit(channel, cwd = process.cwd()) {
  const commit = cleanCommit(cwd);
  const branch = git(["branch", "--show-current"], cwd);
  if (!branch || (channel === "development" ? branch === "main" : branch !== "main")) {
    throw new Error(`${channel} requires ${channel === "development" ? "a work branch" : "main"}.`);
  }
  const remote = git(["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`], cwd).split(/\s/)[0];
  if (remote !== commit) throw new Error("HEAD must match the pushed origin branch. Sync before publishing.");
  return { branch, commit };
}

export async function withCommitArchive(commit, cwd, consume) {
  const directory = await mkdtemp(join(tmpdir(), "lakecraft-workflow-"));
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", commit], {
      cwd, maxBuffer: 128 * 1024 * 1024,
    });
    execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
    return await consume(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function withCommitWorktree(commit, cwd, consume) {
  const directory = await mkdtemp(join(tmpdir(), "lakecraft-validation-"));
  const checkout = join(directory, "source");
  let added = false;
  try {
    git(["worktree", "add", "--quiet", "--detach", checkout, commit], cwd);
    added = true;
    return await consume(checkout);
  } finally {
    if (added) git(["worktree", "remove", "--force", checkout], cwd);
    await rm(directory, { recursive: true, force: true });
  }
}
