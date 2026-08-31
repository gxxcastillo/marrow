import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { statusCommand } from "../src/commands/status";
import { git } from "../src/git";
import {
  addProjectWorktree,
  addUnattachedBranch,
  deleteWorktreeDir,
  makeFixture,
  setTestIdentity,
  type Fixture,
} from "./fixtures";
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
    expect(outLines).toEqual(["No projects attached on this machine. Run `marrow attach <project-path>` to get started."]);
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

  test("surfaces stale, oversized, and blocked-on-you memory", async () => {
    const projectDir = path.join(fx.projectsRoot, "alpha");
    await mkdir(projectDir, { recursive: true });
    await git(["init", "-q", "-b", "main"], projectDir);
    await setTestIdentity(projectDir);
    await Bun.write(path.join(projectDir, ".gitignore"), ".agents/\n");
    await git(["add", ".gitignore"], projectDir);
    await git(["commit", "-q", "-m", "initial parent"], projectDir);
    const stampedHead = (await git(["rev-parse", "--short", "HEAD"], projectDir)).stdout;

    const agentsPath = await addProjectWorktree(fx, "alpha");
    await mkdir(path.join(agentsPath, "plans"));
    const state = [
      `As of 2026-08-31 (alpha @${stampedHead})`,
      ...Array.from({ length: 300 }, (_, index) => `line ${index + 1}`),
    ].join("\n");
    await Bun.write(path.join(agentsPath, "current-state.md"), `${state}\n`);
    await Bun.write(
      path.join(agentsPath, "plans", "approval-plan.md"),
      "# Approval\n\nBlocked on you: approve the fixture (2026-08-31)\ncontinuation is not printed\n",
    );
    await git(["add", "current-state.md", "plans/approval-plan.md"], agentsPath);
    await git(["commit", "-q", "-m", "alpha: add memory signals"], agentsPath);
    await git(["push", "-q", "origin", "alpha"], agentsPath);

    await Bun.write(path.join(projectDir, "advance.txt"), "advance\n");
    await git(["add", "advance.txt"], projectDir);
    await git(["commit", "-q", "-m", "advance parent"], projectDir);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toBe(
      "1 project: all clean, all synced, 1 stale project, 1 oversized current-state.md, 1 blocked on you",
    );
    expect(outLines[4]).toContain("stale (parent 1 commit past stamp)");
    expect(outLines[4]).toContain("large current-state.md (301 lines)");
    expect(outLines).toContain("Blocked on you:");
    expect(outLines).toContain("  alpha: Blocked on you: approve the fixture (2026-08-31)");
    expect(outLines.join("\n")).not.toContain("continuation is not printed");
  });

  test("keeps clean output unchanged for a fresh stamp with no blocked lines", async () => {
    const projectDir = path.join(fx.projectsRoot, "alpha");
    await mkdir(projectDir, { recursive: true });
    await git(["init", "-q", "-b", "main"], projectDir);
    await setTestIdentity(projectDir);
    await Bun.write(path.join(projectDir, ".gitignore"), ".agents/\n");
    await git(["add", ".gitignore"], projectDir);
    await git(["commit", "-q", "-m", "initial parent"], projectDir);
    const parentHead = (await git(["rev-parse", "--short", "HEAD"], projectDir)).stdout;

    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "current-state.md"), `As of 2026-08-31 (alpha @${parentHead})\n`);
    await git(["add", "current-state.md"], agentsPath);
    await git(["commit", "-q", "-m", "alpha: add current state"], agentsPath);
    await git(["push", "-q", "origin", "alpha"], agentsPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toBe("1 project: all clean, all synced");
    expect(outLines).toHaveLength(5);
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

  test("shows transient progress without keeping it in final output", async () => {
    await addProjectWorktree(fx, "alpha");

    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const { code, outLines } = await captureLogs(() => statusCommand(fx.marrowHome));

      expect(code).toBe(0);
      expect(writes[0]).toBe("checking project status...");
      expect(writes).toContain(`\r${" ".repeat("checking project status...".length)}\r`);
      expect(outLines[0]).toBe("1 project: all clean, all synced");
      expect(outLines).not.toContain("checking project status...");
    } finally {
      process.stdout.write = originalWrite;
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
    }
  });

  test("keeps part of the commit subject visible even when other columns are wide", async () => {
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 100 });

    try {
      // A long key alone pushes the fixed columns (PROJECT + KEY + STATUS) past the
      // 100-column target, which used to starve LAST COMMIT down to its own header
      // length (11 chars) — not even room for a bare date.
      const longKey = "some-very-long-project-key-used-only-for-width-testing";
      const agentsPath = await addProjectWorktree(fx, longKey, longKey);
      const subject = "a distinctive long commit subject that must not be fully swallowed";
      await git(["commit", "--allow-empty", "-q", "-m", `${longKey}: ${subject}`], agentsPath);

      const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
      const row = outLines.find((l) => l.includes(longKey) && l.includes("commit to push"));
      expect(row).toBeDefined();
      expect(row).toContain(subject.slice(0, 10));
    } finally {
      Object.defineProperty(process.stdout, "columns", { configurable: true, value: originalColumns });
    }
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
    expect(outLines.at(-2)).toBe(
      "1 project branch not attached on this machine (normal — each machine can attach a different subset):",
    );
    expect(outLines.at(-1)).toBe("  beta");
  });

  test("distinguishes an empty vault from one with nothing attached here", async () => {
    await addUnattachedBranch(fx, "beta");
    await addUnattachedBranch(fx, "gamma");

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines[0]).toContain("No projects attached on this machine");
    expect(outLines[1]).toBe(
      "The vault has 2 project branches not attached on this machine (normal — each machine can attach a different subset):",
    );
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
      "1 project missing its worktree directory; run `marrow detach alpha` to clear the registration",
    );
  });

  test("uses a generic detach command plus a name list when multiple worktree directories are missing", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    const betaPath = await addProjectWorktree(fx, "beta");
    await deleteWorktreeDir(alphaPath);
    await deleteWorktreeDir(betaPath);

    const { outLines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(outLines.at(-1)).toBe(
      "2 projects missing their worktree directories; run `marrow detach <project>` to clear the registration: alpha, beta",
    );
  });
});
