import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { statusCommand } from "../src/commands/status";
import { git } from "../src/git";
import { addProjectWorktree, addUnattachedBranch, makeFixture, type Fixture } from "./fixtures";
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
    expect(outLines[0]).toContain("PROJECT");
    expect(outLines[0]).toContain("CHANGES");
    expect(outLines[0]).toContain("SYNC");
    expect(outLines[2]).toContain("alpha");
    expect(outLines[2]).toContain("clean");
    expect(outLines[2]).toContain("synced");
    expect(outLines.at(-1)).toBe("1 project: all clean, all synced");
  });

  test("shows the branch key without rewriting it", async () => {
    await addProjectWorktree(fx, "alpha", "alpha");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toContain("KEY");
    expect(outLines[2]).toStartWith(path.join(await realpath(fx.projectsRoot), "alpha"));
    expect(outLines[2]).toContain("alpha");
    expect(outLines[2]).not.toContain("projects/");
  });

  test("flags dirty projects and counts them in the summary", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("1 uncommitted change");
    expect(outLines.at(-1)).toBe("1 project: 1 with uncommitted changes, all synced");
  });

  test("makes a project without an upstream explicit", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["branch", "-D", "-r", "origin/alpha"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("not pushed");
    expect(outLines.at(-1)).toBe("1 project: all clean, 1 not pushed");
  });

  test("summarizes commits waiting to push", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-m", "alpha: pending"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("1 commit to push");
    expect(outLines.at(-1)).toBe("1 project: all clean, 1 commit to push");
  });

  test("lists multiple projects, one per line", async () => {
    await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines).toHaveLength(5); // header + divider + 2 projects + summary
    expect(outLines.at(-1)).toBe("2 projects: all clean, all synced");
  });

  test("names vault branches with no worktree here after the summary", async () => {
    await addProjectWorktree(fx, "alpha");
    await addUnattachedBranch(fx, "beta");

    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.at(-2)).toBe("1 project: all clean, all synced");
    expect(outLines.at(-1)).toBe("1 project branch not attached here: beta");
  });

  test("distinguishes an empty vault from one with nothing attached here", async () => {
    await addUnattachedBranch(fx, "beta");
    await addUnattachedBranch(fx, "gamma");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toContain("No projects attached on this machine");
    expect(outLines[1]).toBe("The vault has 2 project branches not attached here: beta, gamma.");
  });
});
