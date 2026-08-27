import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { statusCommand } from "../src/commands/status";
import { git } from "../src/git";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";
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
    await addProjectWorktree(fx, "ossa");
    const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("PROJECT");
    expect(outLines[0]).toContain("CHANGES");
    expect(outLines[0]).toContain("SYNC");
    expect(outLines[2]).toContain("ossa");
    expect(outLines[2]).toContain("clean");
    expect(outLines[2]).toContain("synced");
    expect(outLines.at(-1)).toBe("1 project: all clean, all synced");
  });

  test("omits the internal branch namespace from project names", async () => {
    await addProjectWorktree(fx, "ossa", "projects/github.com/test/ossa");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toContain("KEY");
    expect(outLines[2]).toStartWith(path.join(await realpath(fx.projectsRoot), "ossa"));
    expect(outLines[2]).toContain("github.com/test/ossa");
    expect(outLines[2]).not.toContain("projects/");
  });

  test("flags dirty projects and counts them in the summary", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("1 uncommitted change");
    expect(outLines.at(-1)).toBe("1 project: 1 with uncommitted changes, all synced");
  });

  test("makes a project without an upstream explicit", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await git(["branch", "-D", "-r", "origin/ossa"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("not pushed");
    expect(outLines.at(-1)).toBe("1 project: all clean, 1 not pushed");
  });

  test("summarizes commits waiting to push", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await git(["commit", "--allow-empty", "-m", "ossa: pending"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[2]).toContain("1 commit to push");
    expect(outLines.at(-1)).toBe("1 project: all clean, 1 commit to push");
  });

  test("lists multiple projects, one per line", async () => {
    await addProjectWorktree(fx, "ossa");
    await addProjectWorktree(fx, "sobremesa");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines).toHaveLength(5); // header + divider + 2 projects + summary
    expect(outLines.at(-1)).toBe("2 projects: all clean, all synced");
  });
});
