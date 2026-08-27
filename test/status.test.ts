import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { statusCommand } from "../src/commands/status";
import { git } from "../src/git";
import { addProjectWorktree, addUnattachedBranch, deleteWorktreeDir, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("status", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("reports no project worktrees for a fresh vault", async () => {
    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines).toEqual(["No projects attached on this machine. Run `marrow add <project-path>` to get started."]);
  });

  test("lists clean pushed projects and summarizes", async () => {
    await addProjectWorktree(fx, "alpha");
    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toBe("1 project: all clean, all synced");
    expect(outLines[1]).toBe("");
    expect(outLines[2]).toContain("PROJECT");
    expect(outLines[2]).toContain("STATUS");
    expect(outLines[4]).toContain("alpha");
    expect(outLines[4]).toContain("clean, synced");
  });

  test("shows the branch key without rewriting it", async () => {
    await addProjectWorktree(fx, "alpha", "alpha");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("KEY");
    expect(outLines[4]).toContain(path.join("dev", "alpha"));
    expect(outLines[4]).toContain("alpha");
    expect(outLines[4]).not.toContain("projects/");
  });

  test("flags dirty projects and counts them in the summary", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toBe("1 project: 1 with uncommitted changes, all synced");
    expect(outLines[4]).toContain("1 uncommitted change");
  });

  test("makes a project without an upstream explicit", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["branch", "-D", "-r", "origin/alpha"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toBe("1 project: all clean, 1 not pushed");
    expect(outLines[4]).toContain("not pushed");
  });

  test("summarizes commits waiting to push", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-m", "alpha: pending"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toBe("1 project: all clean, 1 commit to push");
    expect(outLines[4]).toContain("1 commit to push");
    expect(outLines[4]).toContain("pending");
    expect(outLines[4]).not.toContain("alpha: pending");
  });

  test("keeps last commit subjects that do not start with the exact project key", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-m", "beta: pending"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[4]).toContain("beta: pending");
  });

  test("lists multiple projects, one per line", async () => {
    await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines).toHaveLength(6); // summary + blank + header + divider + 2 projects
    expect(outLines[0]).toBe("2 projects: all clean, all synced");
  });

  test("names vault branches with no worktree here after the summary", async () => {
    await addProjectWorktree(fx, "alpha");
    await addUnattachedBranch(fx, "beta");

    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toBe("1 project: all clean, all synced");
    expect(outLines.at(-3)).toBe("");
    expect(outLines.at(-2)).toBe("1 project branch not attached here:");
    expect(outLines.at(-1)).toBe("  beta");
  });

  test("distinguishes an empty vault from one with nothing attached here", async () => {
    await addUnattachedBranch(fx, "beta");
    await addUnattachedBranch(fx, "gamma");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toContain("No projects attached on this machine");
    expect(outLines[1]).toBe("The vault has 2 project branches not attached here:");
    expect(outLines[2]).toBe("  beta");
    expect(outLines[3]).toBe("  gamma");
  });

  test("reports a deleted project directory as a missing row instead of crashing", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");
    await deleteWorktreeDir(alphaPath);

    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    const row = outLines.find((l) => l.includes("alpha"));
    expect(row).toContain("missing");
    expect(outLines.some((l) => l.includes("beta") && l.includes("clean"))).toBe(true);
    expect(outLines[0]).toBe("2 projects: 1 missing, all synced");
    expect(outLines.at(-2)).toBe("");
    expect(outLines.at(-1)).toBe(
      "1 project missing its worktree directory; run `marrow detach <project>` to clear the registration: alpha",
    );
  });
});
