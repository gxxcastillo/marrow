import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { aheadBehind, dirtyCount, git, hasOrigin, lastCommit, listProjectWorktrees, vaultDir } from "../src/git";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";

describe("git.ts", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("listProjectWorktrees lists every orphan project branch (bare vault has no main checkout)", async () => {
    await addProjectWorktree(fx, "ossa");
    await addProjectWorktree(fx, "sobremesa");

    const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
    const branches = worktrees.map((w) => w.branch).sort();
    expect(branches).toEqual(["ossa", "sobremesa"]);
    expect(worktrees.every((w) => w.branch !== "main")).toBe(true);
  });

  test("listProjectWorktrees returns empty array for a fresh vault", async () => {
    const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
    expect(worktrees).toEqual([]);
  });

  test("dirtyCount is 0 right after a clean seed commit", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    expect(await dirtyCount(agentsPath)).toBe(0);
  });

  test("dirtyCount counts modified and untracked files", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await Bun.write(path.join(agentsPath, "README.md"), "# ossa\nchanged\n");
    await Bun.write(path.join(agentsPath, "new-file.md"), "new\n");
    expect(await dirtyCount(agentsPath)).toBe(2);
  });

  test("aheadBehind is null when origin/<branch> does not exist", async () => {
    const projectDir = path.join(fx.projectsRoot, "no-push");
    const agentsPath = path.join(projectDir, ".agents");
    await git(["worktree", "add", "--orphan", "-b", "no-push", agentsPath], vaultDir(fx.marrowHome));
    await git(["config", "user.email", "test@example.com"], agentsPath);
    await git(["config", "user.name", "marrow test"], agentsPath);
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);

    expect(await aheadBehind(agentsPath, "no-push")).toBeNull();
  });

  test("aheadBehind reports ahead after a local commit not yet pushed", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await Bun.write(path.join(agentsPath, "extra.md"), "extra\n");
    await git(["add", "-A"], agentsPath);
    await git(["commit", "-q", "-m", "local only"], agentsPath);

    const ab = await aheadBehind(agentsPath, "ossa");
    expect(ab).toEqual({ ahead: 1, behind: 0 });
  });

  test("lastCommit returns the most recent commit's date and subject", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    const commit = await lastCommit(agentsPath);
    expect(commit?.subject).toBe("ossa: seed");
    expect(commit?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("lastCommit is null with no commits", async () => {
    const projectDir = path.join(fx.projectsRoot, "empty");
    const agentsPath = path.join(projectDir, ".agents");
    await git(["worktree", "add", "--orphan", "-b", "empty", agentsPath], vaultDir(fx.marrowHome));
    expect(await lastCommit(agentsPath)).toBeNull();
  });

  test("hasOrigin reflects whether an origin remote is configured", async () => {
    expect(await hasOrigin(vaultDir(fx.marrowHome))).toBe(true);

    // Worktrees share their parent repo's remotes, so use an unrelated repo
    // to exercise the false case.
    const bareRepo = path.join(fx.root, "no-origin-repo");
    await git(["init", "-q", "-b", "main", bareRepo], fx.root);
    expect(await hasOrigin(bareRepo)).toBe(false);
  });
});
