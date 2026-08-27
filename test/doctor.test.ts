import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, utimes } from "node:fs/promises";
import path from "node:path";
import { adoptCommand } from "../src/commands/adopt";
import { doctorCommand } from "../src/commands/doctor";
import { git } from "../src/git";
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

  test("passes for a properly adopted project (ignored parent, conventional path, pushed)", async () => {
    await makeProjectRepo(fx, "ossa", "ignored");
    const { code: adoptCode } = await captureLogs(() => adoptCommand("ossa", {}, fx.marrowHome, fx.devRoot));
    expect(adoptCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.devRoot));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(code).toBe(0);
  });

  test("fails when a worktree isn't at the conventional path", async () => {
    const wrongPath = path.join(fx.devRoot, "wrongdir", ".agents");
    await git(["worktree", "add", "--orphan", "-b", "misplaced", wrongPath], fx.marrowHome);
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], wrongPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("expected"))).toBe(true);
  });

  test("fails when a project's parent repo does not ignore .agents", async () => {
    const projectDir = path.join(fx.devRoot, "leaky");
    await mkdir(projectDir, { recursive: true });
    await git(["init", "-q", "-b", "main"], projectDir);
    await git(["config", "user.email", "test@example.com"], projectDir);
    await git(["config", "user.name", "marrow test"], projectDir);
    await Bun.write(path.join(projectDir, "package.json"), "{}\n");
    await git(["add", "package.json"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);

    const agentsPath = path.join(projectDir, ".agents");
    await git(["worktree", "add", "--orphan", "-b", "leaky", agentsPath], fx.marrowHome);
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("does not ignore"))).toBe(true);
  });

  test("fails when there is no origin remote", async () => {
    await addProjectWorktree(fx, "ossa");
    await git(["remote", "remove", "origin"], fx.marrowHome);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("no 'origin' remote"))).toBe(true);
  });

  test("warns about backup tarballs older than 30 days", async () => {
    const backupsDir = path.join(fx.marrowHome, "backups");
    await mkdir(backupsDir, { recursive: true });
    const tarballPath = path.join(backupsDir, "old-project-2020-01-01.tar.gz");
    await Bun.write(tarballPath, "fake");
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000;
    await utimes(tarballPath, old, old);

    const { outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.devRoot));
    expect(outLines.some((l) => l.startsWith("WARN") && l.includes("old-project") && l.includes("day"))).toBe(true);
  });
});
