import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { adoptCommand } from "../src/commands/adopt";
import { git, listProjectWorktrees } from "../src/git";
import { makeFixture, makeProjectRepo, type Fixture } from "./fixtures";
import { captureLogs, listFilesRecursive } from "./helpers";

describe("adopt", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("happy path: adopts an ignored .agents dir, preserving content including dotfiles", async () => {
    const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
    const agentsPath = path.join(projectDir, ".agents");
    const before = await listFilesRecursive(agentsPath);
    expect(before).toContain(".hidden");

    const { code } = await captureLogs(() => adoptCommand("ossa", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(0);

    expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);
    const after = await listFilesRecursive(agentsPath);
    for (const f of before) expect(after).toContain(f);

    const worktrees = await listProjectWorktrees(fx.marrowHome);
    expect(worktrees.map((w) => w.branch)).toContain("ossa");

    const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
    expect(readme).toContain("## Persistence");
    expect(readme).toContain("branch: `ossa`");

    const rev = await git(["rev-parse", "HEAD"], agentsPath);
    const remoteRev = await git(["rev-parse", "origin/ossa"], agentsPath);
    expect(remoteRev.stdout).toBe(rev.stdout);
  });

  test("backup tarball is created and non-empty", async () => {
    await makeProjectRepo(fx, "ossa", "ignored");
    await captureLogs(() => adoptCommand("ossa", {}, fx.marrowHome, fx.devRoot));

    const backupsDir = path.join(fx.marrowHome, "backups");
    const entries = await readdir(backupsDir);
    expect(entries.length).toBe(1);
    expect((await stat(path.join(backupsDir, entries[0]))).size).toBeGreaterThan(0);
  });

  test("appends .agents/ to parent .gitignore when untracked-not-ignored", async () => {
    const projectDir = await makeProjectRepo(fx, "sobremesa", "untracked");
    const { code } = await captureLogs(() => adoptCommand("sobremesa", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(0);
    const gitignore = await readFile(path.join(projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".agents/");
  });

  test("aborts when .agents is tracked by the parent repo, without touching it", async () => {
    const projectDir = await makeProjectRepo(fx, "eos", "tracked");
    const { code, errLines } = await captureLogs(() => adoptCommand("eos", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("tracked");
    expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(false);
  });

  test("aborts when .agents does not exist", async () => {
    const projectDir = path.join(fx.devRoot, "nogit");
    await Bun.write(path.join(projectDir, "package.json"), "{}\n");
    await git(["init", "-q", "-b", "main"], projectDir);

    const { code, errLines } = await captureLogs(() => adoptCommand("nogit", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("does not exist");
  });

  test("aborts when a branch of the same name already exists in marrow", async () => {
    await makeProjectRepo(fx, "ossa", "ignored");
    const otherAgents = path.join(fx.devRoot, "ossa2", ".agents");
    await git(["worktree", "add", "--orphan", "-b", "ossa", otherAgents], fx.marrowHome);
    // An orphan branch has no ref until its first commit ("unborn branch").
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

    const { code, errLines } = await captureLogs(() => adoptCommand("ossa", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("already exists");
  });

  test("aborts when .agents is already a worktree", async () => {
    const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
    const agentsPath = path.join(projectDir, ".agents");
    await rm(agentsPath, { recursive: true, force: true });
    await mkdir(agentsPath, { recursive: true });
    await Bun.write(path.join(agentsPath, ".git"), "gitdir: /somewhere\n");

    const { code, errLines } = await captureLogs(() => adoptCommand("ossa", {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("already a git worktree");
  });

  test("--dry-run makes no changes to the project or the vault", async () => {
    const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
    const agentsPath = path.join(projectDir, ".agents");
    const before = await listFilesRecursive(agentsPath);

    const { code } = await captureLogs(() => adoptCommand("ossa", { dryRun: true }, fx.marrowHome, fx.devRoot));
    expect(code).toBe(0);

    expect(existsSync(path.join(agentsPath, ".git"))).toBe(false);
    expect(await listFilesRecursive(agentsPath)).toEqual(before);
    expect(await listProjectWorktrees(fx.marrowHome)).toEqual([]);
  });

  test("--dry-run against an untracked project reports the .gitignore step without writing it", async () => {
    const projectDir = await makeProjectRepo(fx, "sobremesa", "untracked");
    const { code, outLines } = await captureLogs(() =>
      adoptCommand("sobremesa", { dryRun: true }, fx.marrowHome, fx.devRoot),
    );
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("would append");
    expect(existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
  });

  test("resolves a path argument in addition to a bare project name", async () => {
    const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
    const { code } = await captureLogs(() => adoptCommand(projectDir, {}, fx.marrowHome, fx.devRoot));
    expect(code).toBe(0);
    const worktrees = await listProjectWorktrees(fx.marrowHome);
    expect(worktrees.map((w) => w.branch)).toContain("ossa");
  });
});
