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
    const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
    const { code: adoptCode } = await captureLogs(() =>
      addCommand(projectDir, { id: "personal/plaindir" }, fx.marrowHome, fx.toolRoot),
    );
    expect(adoptCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(code).toBe(0);
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
      addCommand(projectDir, { id: "personal/plaindir" }, fx.marrowHome, fx.toolRoot),
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
    await addProjectWorktree(fx, "ossa");
    await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.some((l) => l.startsWith("WARN") && l.includes("no 'origin' remote"))).toBe(true);
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
