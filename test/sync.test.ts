import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { syncCommand } from "../src/commands/sync";
import { dirtyCount, git, lastCommit, vaultDir } from "../src/git";
import { addProjectWorktree, deleteWorktreeDir, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

// Advances origin/<branch> without touching the local worktree, simulating a
// push from another machine (or an earlier sync of this same one).
async function advanceOrigin(fx: Fixture, branch: string): Promise<void> {
  const tmp = path.join(fx.root, `advance-${branch}`);
  await git(["clone", "-q", "-b", branch, fx.bareOrigin, tmp], fx.root);
  await git(["config", "user.email", "test@example.com"], tmp);
  await git(["config", "user.name", "marrow test"], tmp);
  await Bun.write(path.join(tmp, "remote-change.md"), "remote change\n");
  await git(["add", "-A"], tmp);
  await git(["commit", "-q", "-m", "remote change"], tmp);
  const pushed = await git(["push", "-q", "origin", branch], tmp);
  if (pushed.code !== 0) throw new Error(`advanceOrigin push failed: ${pushed.stderr}`);
}

describe("sync", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("commits dirty projects with a default timestamped message and pushes", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(await dirtyCount(agentsPath)).toBe(0);

    const commit = await lastCommit(agentsPath);
    expect(commit?.subject).toMatch(/^alpha: sync \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    const rev = await git(["rev-parse", "HEAD"], agentsPath);
    const remoteRev = await git(["rev-parse", "origin/alpha"], agentsPath);
    expect(remoteRev.stdout).toBe(rev.stdout);
  });

  test("uses a custom message prefixed with the project name", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    await captureLogs(() => syncCommand([], { message: "did a thing" }, fx.marrowHome));
    const commit = await lastCommit(agentsPath);
    expect(commit?.subject).toBe("alpha: did a thing");
  });

  test("skips clean projects", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const before = await lastCommit(agentsPath);

    await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    const after = await lastCommit(agentsPath);
    expect(after?.subject).toBe(before?.subject);
  });

  test("only syncs the named project when targets are given", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    const betaPath = await addProjectWorktree(fx, "beta");
    await Bun.write(path.join(alphaPath, "note.md"), "note\n");
    await Bun.write(path.join(betaPath, "note.md"), "note\n");

    const { code } = await captureLogs(() => syncCommand(["alpha"], {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(await dirtyCount(alphaPath)).toBe(0);
    expect(await dirtyCount(betaPath)).toBe(1);
  });

  test("returns exit 1 and names an unknown project target", async () => {
    const { code, errLines } = await captureLogs(() => syncCommand(["nonexistent"], {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines).toContain("unknown project: nonexistent");
  });

  test("an ambiguous target name syncs neither match and names both paths", async () => {
    const vault = vaultDir(fx.marrowHome);
    const agentsA = path.join(fx.projectsRoot, "team-a", "shared", ".agents");
    const agentsB = path.join(fx.projectsRoot, "team-b", "shared", ".agents");
    for (const [agentsPath, branch] of [[agentsA, "shared-a"], [agentsB, "shared-b"]] as const) {
      const wt = await git(["worktree", "add", "--orphan", "-b", branch, agentsPath], vault);
      expect(wt.code).toBe(0);
      await git(["config", "user.email", "test@example.com"], agentsPath);
      await git(["config", "user.name", "marrow test"], agentsPath);
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);
      await Bun.write(path.join(agentsPath, "note.md"), "note\n");
    }

    const { code, errLines } = await captureLogs(() => syncCommand(["shared"], {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines[0]).toContain("ambiguous name shared matches:");
    expect(errLines[0]).toContain(agentsA);
    expect(errLines[0]).toContain(agentsB);
    expect(await dirtyCount(agentsA)).toBe(1);
    expect(await dirtyCount(agentsB)).toBe(1);
  });

  test("surfaces a push failure as a non-zero exit", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");
    await git(["remote", "set-url", "origin", path.join(fx.root, "does-not-exist.git")], vaultDir(fx.marrowHome));

    const { code } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(1);
  });

  test("skips push with a warning (not an error) when there is no origin", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(await dirtyCount(agentsPath)).toBe(0);
  });

  test("warns and skips a deleted project directory when no targets are named", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");
    await deleteWorktreeDir(alphaPath);

    const { code, errLines } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(errLines.join("\n")).toContain("alpha: WARN worktree directory missing");
    expect(errLines.join("\n")).toContain("marrow detach alpha");
  });

  test("errors on a deleted project directory named explicitly", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(alphaPath);

    const { code, errLines } = await captureLogs(() => syncCommand(["alpha"], {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("alpha: ERROR worktree directory missing");
  });

  test("still pushes a missing worktree's branch, since only the directory is gone", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only"], alphaPath);
    await deleteWorktreeDir(alphaPath);

    const { code } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(0);
    const remoteRev = await git(["rev-parse", "origin/alpha"], vaultDir(fx.marrowHome));
    const localRev = await git(["rev-parse", "refs/heads/alpha"], vaultDir(fx.marrowHome));
    expect(remoteRev.stdout).toBe(localRev.stdout);
  });

  test("names the stash/merge/stash-pop steps for a dirty worktree behind its upstream", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await advanceOrigin(fx, "alpha");
    await Bun.write(path.join(agentsPath, "local-change.md"), "local\n");

    const { code, errLines } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(1);
    const message = errLines.find((l) => l.includes("reconcile manually"));
    expect(message).toBeDefined();
    expect(message).toContain("git stash");
    expect(message).toContain(`git merge --ff-only origin/alpha`);
    expect(message).toContain("git stash pop");
    expect(message).not.toContain("git pull");
    expect(await dirtyCount(agentsPath)).toBe(1); // untouched: nothing was stashed or merged
  });

  test("names the pull-with-merge step for a diverged worktree", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await advanceOrigin(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only"], agentsPath);

    const { code, errLines } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(1);
    const message = errLines.find((l) => l.includes("has diverged from origin/alpha"));
    expect(message).toBeDefined();
    expect(message).toContain("git pull --no-rebase origin alpha");
    expect(message).not.toContain("git stash");
  });

  test("names both the stash and the pull steps for a worktree that is dirty and diverged at once", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await advanceOrigin(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only"], agentsPath);
    await Bun.write(path.join(agentsPath, "local-change.md"), "local\n");

    const { code, errLines } = await captureLogs(() => syncCommand([], {}, fx.marrowHome));
    expect(code).toBe(1);
    const message = errLines.find((l) => l.includes("has diverged from origin/alpha"));
    expect(message).toBeDefined();
    // Order matters: stash before the pull, pop after, so the uncommitted
    // changes aren't dropped by the reconciliation itself.
    const stashIndex = message!.indexOf("git stash\n");
    const pullIndex = message!.indexOf("git pull --no-rebase origin alpha");
    const popIndex = message!.indexOf("git stash pop");
    expect(stashIndex).toBeGreaterThan(-1);
    expect(pullIndex).toBeGreaterThan(stashIndex);
    expect(popIndex).toBeGreaterThan(pullIndex);
    expect(await dirtyCount(agentsPath)).toBe(1); // untouched: nothing was stashed or merged
  });

  test("notes when -m fans out to more than one dirty project", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    const betaPath = await addProjectWorktree(fx, "beta");
    await Bun.write(path.join(alphaPath, "note.md"), "note\n");
    await Bun.write(path.join(betaPath, "note.md"), "note\n");

    const { errLines } = await captureLogs(() => syncCommand([], { message: "weekly review" }, fx.marrowHome));
    expect(errLines.join("\n")).toContain("note: -m applies the same message to all 2 dirty projects");
    expect((await lastCommit(alphaPath))?.subject).toBe("alpha: weekly review");
    expect((await lastCommit(betaPath))?.subject).toBe("beta: weekly review");
  });

  test("stays silent about fan-out with only one dirty project", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { errLines } = await captureLogs(() => syncCommand([], { message: "just alpha" }, fx.marrowHome));
    expect(errLines.join("\n")).not.toContain("fans out");
    expect(errLines.join("\n")).not.toContain("dirty projects");
  });
});
