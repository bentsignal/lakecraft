import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseChanges } from "../scripts/release-changes.mjs";
import { cleanCommit, git, requirePushedCommit, withCommitArchive, withCommitWorktree } from "../scripts/workflow-git.mjs";
import { requireMatchingArtifact, reviewMetadataPath } from "../scripts/publish-lakebed-preview.mjs";

test("delivery uses clean pushed commits and excludes ignored local state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakecraft-workflow-test-"));
  const remote = join(directory, "remote.git");
  const cwd = join(directory, "checkout");
  try {
    execFileSync("git", ["init", "--bare", "--quiet", remote]);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", cwd]);
    git(["config", "user.name", "Workflow test"], cwd);
    git(["config", "user.email", "workflow@example.invalid"], cwd);
    git(["config", "commit.gpgsign", "false"], cwd);
    await writeFile(join(cwd, ".gitignore"), "secret\n");
    await writeFile(join(cwd, "app"), "baseline");
    git(["add", "."], cwd);
    git(["commit", "--quiet", "-m", "Baseline"], cwd);
    const baseline = cleanCommit(cwd);
    git(["tag", "workflow/production-baseline"], cwd);
    git(["remote", "add", "origin", remote], cwd);
    git(["push", "--quiet", "origin", "main"], cwd);
    assert.equal(requirePushedCommit("preview", cwd).commit, baseline);
    assert.throws(() => requirePushedCommit("development", cwd), /work branch/);
    git(["switch", "--quiet", "-c", "feature"], cwd);
    await writeFile(join(cwd, "app"), "changed");
    assert.throws(() => cleanCommit(cwd), /Commit/);
    git(["commit", "--quiet", "-am", "Change app"], cwd);
    const commit = cleanCommit(cwd);
    const changes = releaseChanges(cwd);
    assert.equal(changes.baselineKind, "workflow-start");
    assert.equal(changes.baseline, baseline);
    assert.deepEqual(changes.commits, [`${commit} Change app`]);
    git(["push", "--quiet", "origin", "feature"], cwd);
    assert.equal(requirePushedCommit("development", cwd).commit, commit);
    await writeFile(join(cwd, "secret"), "must stay local");
    await withCommitArchive(commit, cwd, async (archive) => {
      assert.equal(await readFile(join(archive, "app"), "utf8"), "changed");
      await assert.rejects(readFile(join(archive, "secret")), { code: "ENOENT" });
    });
    await withCommitWorktree(commit, cwd, async (checkout) => {
      assert.equal(cleanCommit(checkout), commit);
      await assert.rejects(readFile(join(checkout, "secret")), { code: "ENOENT" });
    });
    git(["tag", "production/20260905T100000Z-test", commit], cwd);
    assert.equal(releaseChanges(cwd).baseline, commit);
    git(["tag", "production/20260905T110000Z-rollback", baseline], cwd);
    assert.equal(releaseChanges(cwd).baseline, baseline, "rollback becomes the comparison baseline");
    await writeFile(join(cwd, "app"), "not pushed");
    git(["commit", "--quiet", "-am", "Unpushed"], cwd);
    assert.throws(() => requirePushedCommit("development", cwd), /pushed origin branch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review channels cannot share bindings and changed builds cannot publish", () => {
  assert.notEqual(reviewMetadataPath("development"), reviewMetadataPath("preview"));
  assert.throws(() => reviewMetadataPath("production"), /Unknown review channel/);
  const expected = { artifactHash: "artifact", clientBundleHash: "client" };
  requireMatchingArtifact(expected, expected);
  assert.throws(() => requireMatchingArtifact({ ...expected, artifactHash: "changed" }, expected), /differs/);
  assert.throws(() => requireMatchingArtifact({ ...expected, clientBundleHash: "changed" }, expected), /differs/);
});
