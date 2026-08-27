import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, utimes } from "node:fs/promises";
import path from "node:path";
import { addCommand } from "../src/commands/add";
import { doctorCommand } from "../src/commands/doctor";
import { git, vaultDir } from "../src/git";
import { addProjectWorktree, makeFixture, makeProjectRepo, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("doctor", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("passes for a properly adopted project (ignored parent, pushed)", async () => {
    const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
    const { code: adoptCode } = await captureLogs(() =>
      addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
    );
    expect(adoptCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(outLines.some((l) => l.includes("marrow identity"))).toBe(false);
    expect(code).toBe(0);
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
      const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));

      expect(code).toBe(0);
      expect(writes[0]).toBe("checking vault and project worktree health...");
      expect(writes).toContain(`\r${" ".repeat("checking vault and project worktree health...".length)}\r`);
      expect(outLines[0]).toStartWith("OK    ");
      expect(outLines).not.toContain("checking vault and project worktree health...");
      expect(outLines.at(-1)).toStartWith("doctor:");
    } finally {
      process.stdout.write = originalWrite;
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
    }
  });

  test("summarizes healthy per-project checks", async () => {
    await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));

    expect(code).toBe(0);
    expect(outLines).toContain("OK    2 project worktrees named .agents");
    expect(outLines).toContain("OK    .agents ignored for 2 project parents");
    expect(outLines).toContain("OK    push state within threshold for 2 project branches");
    expect(outLines.some((l) => l.includes("branch 'alpha' worktree at"))).toBe(false);
  });

  test("fails when a worktree is not named .agents", async () => {
    const wrongPath = path.join(fx.projectsRoot, "wrongdir", "memory");
    await git(["worktree", "add", "--orphan", "-b", "misplaced", wrongPath], vaultDir(fx.marrowHome));
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], wrongPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("not named .agents"))).toBe(true);
  });

  test("does not fail a project whose parent directory is not a git repo", async () => {
    const projectDir = path.join(fx.root, "elsewhere", "plaindir");
    const { code: addCode } = await captureLogs(() =>
      addCommand(projectDir, { id: "local/plaindir" }, fx.marrowHome, fx.toolRoot),
    );
    expect(addCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(code).toBe(0);
  });

  test("fails when a project's parent repo does not ignore .agents", async () => {
    const projectDir = path.join(fx.projectsRoot, "leaky");
    await mkdir(projectDir, { recursive: true });
    await git(["init", "-q", "-b", "main"], projectDir);
    await git(["config", "user.email", "test@example.com"], projectDir);
    await git(["config", "user.name", "marrow test"], projectDir);
    await Bun.write(path.join(projectDir, "package.json"), "{}\n");
    await git(["add", "package.json"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);

    const agentsPath = path.join(projectDir, ".agents");
    await git(["worktree", "add", "--orphan", "-b", "leaky", agentsPath], vaultDir(fx.marrowHome));
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("does not ignore"))).toBe(true);
  });

  test("warns when there is no origin remote", async () => {
    await addProjectWorktree(fx, "alpha");
    await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.some((l) => l.startsWith("WARN") && l.includes("no 'origin' remote"))).toBe(true);
  });

  test("aggregates missing origin refs with a remediation", async () => {
    const alphaAgents = await addProjectWorktree(fx, "alpha");
    const betaAgents = await addProjectWorktree(fx, "beta");
    await git(["push", "-q", "origin", "HEAD:refs/heads/landing"], alphaAgents);
    await git(["push", "-q", "origin", ":alpha"], alphaAgents);
    await git(["push", "-q", "origin", ":beta"], betaAgents);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    const warnings = outLines.filter((l) => l.startsWith("WARN") && l.includes("missing origin refs"));

    expect(code).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 branches missing origin refs");
    expect(warnings[0]).toContain("run `marrow sync`");
    expect(warnings[0]).toContain("alpha");
    expect(warnings[0]).toContain("beta");
    expect(outLines.some((l) => l.includes("no upstream"))).toBe(false);
  });

  test("warns when a local-id project now has a GitHub origin", async () => {
    const projectDir = await makeProjectRepo(fx, "future", "ignored");
    const { code: addCode } = await captureLogs(() =>
      addCommand(projectDir, { id: "local/future" }, fx.marrowHome, fx.toolRoot),
    );
    expect(addCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.some((l) =>
      l.startsWith("WARN") &&
      l.includes("future has GitHub origin github.com/test/future") &&
      l.includes("marrow identity is local/future"),
    )).toBe(true);
  });

  test("warns when a GitHub-id project origin differs from its marrow identity", async () => {
    const projectDir = await makeProjectRepo(fx, "renamed", "ignored");
    const { code: addCode } = await captureLogs(() =>
      addCommand(projectDir, { id: "github.com/test/old-name" }, fx.marrowHome, fx.toolRoot),
    );
    expect(addCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.some((l) =>
      l.startsWith("WARN") &&
      l.includes("renamed has GitHub origin github.com/test/renamed") &&
      l.includes("marrow identity is github.com/test/old-name"),
    )).toBe(true);
  });

  test("warns about backup tarballs older than 30 days", async () => {
    const backupsDir = path.join(fx.marrowHome, "backups");
    await mkdir(backupsDir, { recursive: true });
    const tarballPath = path.join(backupsDir, "old-project-2020-01-01.tar.gz");
    await Bun.write(tarballPath, "fake");
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000;
    await utimes(tarballPath, old, old);

    const { outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(outLines.some((l) => l.startsWith("WARN") && l.includes("old-project") && l.includes("day"))).toBe(true);
  });
});
