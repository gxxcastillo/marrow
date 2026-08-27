import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { grepCommand } from "../src/commands/grep";
import { addProjectWorktree, addUnattachedBranch, deleteWorktreeDir, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("grep", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("reports no project worktrees for a fresh vault", async () => {
    const { code, outLines } = await captureLogs(() => grepCommand("needle", [], fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines).toEqual(["No project worktrees."]);
  });

  test("finds a pattern across project worktrees and exits 0", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "findme-marker\n");

    const code = await grepCommand("findme-marker", [], fx.marrowHome);
    expect(code).toBe(0);
  });

  test("exits non-zero when nothing matches", async () => {
    await addProjectWorktree(fx, "alpha");
    const code = await grepCommand("no-such-pattern-anywhere", [], fx.marrowHome);
    expect(code).not.toBe(0);
  });

  test("stays silent when every vault branch is attached here", async () => {
    await addProjectWorktree(fx, "alpha");
    const { errLines } = await captureLogs(() => grepCommand("findme-marker", [], fx.marrowHome));
    expect(errLines).toEqual([]);
  });

  test("warns on stderr when the vault has branches with no worktree here", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "findme-marker\n");
    await addUnattachedBranch(fx, "beta");
    await addUnattachedBranch(fx, "gamma");

    const { errLines } = await captureLogs(() => grepCommand("findme-marker", [], fx.marrowHome));
    expect(errLines).toHaveLength(1);
    expect(errLines[0]).toContain("searched 1 of 3 project branches");
    expect(errLines[0]).toContain("beta, gamma");
    // stdout is rg's match stream; the caveat must never contaminate it.
    expect(errLines[0]).toStartWith("marrow grep:");
  });

  test("names unattached branches when nothing is attached at all", async () => {
    await addUnattachedBranch(fx, "beta");

    const { code, outLines, errLines } = await captureLogs(() => grepCommand("needle", [], fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines).toEqual(["No project worktrees."]);
    expect(errLines[0]).toContain("no project branches are attached here");
    expect(errLines[0]).toContain("beta");
  });

  test("skips a deleted project directory with a stderr notice, still searching the rest", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(alphaPath);
    const betaPath = await addProjectWorktree(fx, "beta");
    await Bun.write(path.join(betaPath, "note.md"), "findme-marker\n");

    const { code, errLines } = await captureLogs(() => grepCommand("findme-marker", [], fx.marrowHome));
    expect(code).toBe(0);
    expect(errLines.join("\n")).toContain("skipping 1 branch with a missing worktree directory");
    expect(errLines.join("\n")).toContain("marrow detach <project>");
    expect(errLines.join("\n")).toContain("alpha");
  });

  test("prints No project worktrees. when every attached worktree's directory is missing", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(alphaPath);

    const { code, outLines, errLines } = await captureLogs(() => grepCommand("needle", [], fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines).toEqual(["No project worktrees."]);
    expect(errLines.join("\n")).toContain("missing worktree directory");
  });
});
