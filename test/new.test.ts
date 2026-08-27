import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { newCommand } from "../src/commands/new";
import { git, listProjectWorktrees } from "../src/git";
import { makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("new", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("creates a fresh .agents worktree seeded from the README template", async () => {
    const { code } = await captureLogs(() => newCommand("freshproj", fx.marrowHome, fx.devRoot));
    expect(code).toBe(0);

    const agentsPath = path.join(fx.devRoot, "freshproj", ".agents");
    expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);

    const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
    expect(readme).toContain("freshproj");
    expect(readme).toContain("## Persistence");

    const worktrees = await listProjectWorktrees(fx.marrowHome);
    expect(worktrees.map((w) => w.branch)).toContain("freshproj");

    const rev = await git(["rev-parse", "HEAD"], agentsPath);
    const remoteRev = await git(["rev-parse", "origin/freshproj"], agentsPath);
    expect(remoteRev.stdout).toBe(rev.stdout);
  });

  test("fails if .agents already exists", async () => {
    const agentsPath = path.join(fx.devRoot, "dup", ".agents");
    await mkdir(agentsPath, { recursive: true });

    const { code, errLines } = await captureLogs(() => newCommand("dup", fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("already exists");
  });

  test("fails if a branch of that name already exists in marrow", async () => {
    const otherAgents = path.join(fx.devRoot, "other", ".agents");
    await git(["worktree", "add", "--orphan", "-b", "dupbranch", otherAgents], fx.marrowHome);
    // An orphan branch has no ref until its first commit ("unborn branch").
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

    const { code, errLines } = await captureLogs(() => newCommand("dupbranch", fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("already exists");
  });
});
