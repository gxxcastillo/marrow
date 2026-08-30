import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { detachCommand } from "../src/commands/detach";
import { git, listProjectWorktrees, vaultDir } from "../src/git";
import { addProjectWorktree, deleteWorktreeDir, makeFixture, setTestIdentity, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("detach", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("removes a clean worktree and retains the branch in the vault", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("detached 'alpha'");
    expect(outLines[0]).toContain(agentsPath);
    expect(outLines[0]).not.toContain("unpushed");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    const branch = await git(["branch", "--list", "alpha"], vaultDir(fx.marrowHome));
    expect(branch.stdout).toContain("alpha");
  });

  test("names retained unpushed commits", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only"], agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("1 unpushed commit retained on the branch");
  });

  test("pluralizes multiple retained unpushed commits", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only 1"], agentsPath);
    await git(["commit", "--allow-empty", "-q", "-m", "local only 2"], agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("2 unpushed commits retained on the branch");
  });

  test("refuses a dirty worktree with sync-or-discard remediation, leaving it attached", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code, errLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("1 uncommitted change");
    expect(errLines.join("\n")).toContain("marrow sync alpha");
    expect(errLines.join("\n")).toContain("clean -fd");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toHaveLength(1);
  });

  test("clears the registration for a worktree whose directory is already missing", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("worktree directory was already missing");
    expect(outLines.join("\n")).toContain("nothing was pushed or deleted");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    const branch = await git(["branch", "--list", "alpha"], vaultDir(fx.marrowHome));
    expect(branch.stdout).toContain("alpha");
  });

  test("reports an unknown project name", async () => {
    const { code, errLines } = await captureLogs(() => detachCommand("nonexistent", {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines).toEqual(["marrow detach: unknown project: nonexistent"]);
  });

  test("reports an ambiguous project name and detaches nothing", async () => {
    const vault = vaultDir(fx.marrowHome);
    const agentsA = path.join(fx.projectsRoot, "team-a", "shared", ".agents");
    const agentsB = path.join(fx.projectsRoot, "team-b", "shared", ".agents");
    for (const [agentsPath, branch] of [[agentsA, "shared-a"], [agentsB, "shared-b"]] as const) {
      const wt = await git(["worktree", "add", "--orphan", "-b", branch, agentsPath], vault);
      expect(wt.code).toBe(0);
      await setTestIdentity(agentsPath);
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);
    }

    const { code, errLines } = await captureLogs(() => detachCommand("shared", {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines[0]).toContain("ambiguous name shared matches:");
    expect(errLines[0]).toContain(agentsA);
    expect(errLines[0]).toContain(agentsB);

    expect(await listProjectWorktrees(vault)).toHaveLength(2);
  });

  test("dry-run previews a clean detach without touching the worktree", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { dryRun: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toStartWith("dry run:");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toHaveLength(1);
  });

  test("dry-run still refuses a dirty worktree", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code, errLines } = await captureLogs(() => detachCommand("alpha", { dryRun: true }, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("uncommitted change");
  });

  test("dry-run previews clearing an already-missing registration without doing it", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { dryRun: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toStartWith("dry run:");

    const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.missing).toBe(true);
  });
});
