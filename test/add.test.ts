import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { addCommand } from "../src/commands/add";
import { git, listProjectWorktrees, vaultDir } from "../src/git";
import { makeFixture, makeProjectRepo, type Fixture } from "./fixtures";
import { captureLogs, listFilesRecursive } from "./helpers";

const branch = (name: string) => `projects/github.com/test/${name}`;

describe("add", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  describe("adopting an existing .agents/", () => {
    test("happy path: adopts an ignored .agents dir, preserving content including dotfiles", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      const before = await listFilesRecursive(agentsPath);
      expect(before).toContain(".hidden");

      const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(outLines.at(-1)).toBe(`pushed: origin/${branch("ossa")}`);

      expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);
      const after = await listFilesRecursive(agentsPath);
      for (const f of before) expect(after).toContain(f);

      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain(branch("ossa"));

      const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
      expect(readme).toContain("## Persistence");
      expect(readme).toContain(`branch: \`${branch("ossa")}\``);

      const rev = await git(["rev-parse", "HEAD"], agentsPath);
      const remoteRev = await git(["rev-parse", `origin/${branch("ossa")}`], agentsPath);
      expect(remoteRev.stdout).toBe(rev.stdout);
    });

    test("backup tarball is created and non-empty", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));

      const backupsDir = path.join(fx.marrowHome, "backups");
      const entries = await readdir(backupsDir);
      expect(entries.length).toBe(1);
      expect((await stat(path.join(backupsDir, entries[0]))).size).toBeGreaterThan(0);
    });

    test("reports a local-only add after the result when the vault has no origin", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));

      const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(outLines[0]).toContain("added 'ossa': adopted existing .agents");
      expect(outLines[1]).toContain("backup:");
      expect(outLines[2]).toBe("not pushed: vault has no origin");
    });

    test("appends .agents/ to parent .gitignore when untracked-not-ignored", async () => {
      const projectDir = await makeProjectRepo(fx, "sobremesa", "untracked");
      const { code } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      const gitignore = await readFile(path.join(projectDir, ".gitignore"), "utf8");
      expect(gitignore).toContain(".agents/");
    });

    test("aborts when .agents is tracked by the parent repo, without touching it", async () => {
      const projectDir = await makeProjectRepo(fx, "eos", "tracked");
      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("tracked");
      expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(false);
    });

    test("aborts when a branch of the same name already exists in marrow", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      const otherAgents = path.join(fx.projectsRoot, "ossa2", ".agents");
      await git(["worktree", "add", "--orphan", "-b", branch("ossa"), otherAgents], vaultDir(fx.marrowHome));
      // An orphan branch has no ref until its first commit ("unborn branch").
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already attached");
    });

    test("aborts when .agents is already a worktree", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      await rm(agentsPath, { recursive: true, force: true });
      await mkdir(agentsPath, { recursive: true });
      await Bun.write(path.join(agentsPath, ".git"), "gitdir: /somewhere\n");

      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already a git worktree");
    });

    test("--dry-run makes no changes to the project or the vault", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      const before = await listFilesRecursive(agentsPath);

      const { code } = await captureLogs(() => addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);

      expect(existsSync(path.join(agentsPath, ".git"))).toBe(false);
      expect(await listFilesRecursive(agentsPath)).toEqual(before);
      expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    });

    test("--dry-run against an untracked project reports the .gitignore step without writing it", async () => {
      const projectDir = await makeProjectRepo(fx, "sobremesa", "untracked");
      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("would append");
      expect(existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
    });

    test("adopts a project at an explicit path", async () => {
      const projectDir = await makeProjectRepo(fx, "ossa", "ignored", path.join(fx.root, "elsewhere"));
      const { code } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain(branch("ossa"));
    });
  });

  describe("creating a fresh .agents/", () => {
    test("creates a fresh .agents worktree seeded from the README template", async () => {
      const projectDir = path.join(fx.root, "elsewhere", "freshproj");
      const { code } = await captureLogs(() => addCommand(projectDir, { id: "personal/freshproj" }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);

      const agentsPath = path.join(projectDir, ".agents");
      expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);

      const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
      expect(readme).toContain("freshproj");
      expect(readme).toContain("## Persistence");

      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain("projects/personal/freshproj");

      const rev = await git(["rev-parse", "HEAD"], agentsPath);
      const remoteRev = await git(["rev-parse", "origin/projects/personal/freshproj"], agentsPath);
      expect(remoteRev.stdout).toBe(rev.stdout);
    });

    test("--dry-run makes no changes when there is nothing to adopt", async () => {
      const projectDir = path.join(fx.root, "elsewhere", "freshproj");
      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true, id: "personal/freshproj" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("fresh .agents/");
      expect(existsSync(path.join(projectDir, ".agents"))).toBe(false);
      expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    });

    test("appends .agents/ to the parent repo's .gitignore when it is not already ignored", async () => {
      const projectDir = path.join(fx.projectsRoot, "freshrepo");
      await mkdir(projectDir, { recursive: true });
      await git(["init", "-q", "-b", "main"], projectDir);

      await git(["remote", "add", "origin", "https://github.com/test/freshrepo.git"], projectDir);
      const { code } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(await readFile(path.join(projectDir, ".gitignore"), "utf8")).toContain(".agents/");
      expect((await git(["check-ignore", "-q", "--", ".agents"], projectDir)).code).toBe(0);
    });

    test("ignores .agents up front even when the project is not a git repo yet", async () => {
      // Nothing to ignore into today, but a later `git init` here must not pick
      // .agents/ up.
      const projectDir = path.join(fx.root, "elsewhere", "notarepo");
      const { code } = await captureLogs(() => addCommand(projectDir, { id: "personal/notarepo" }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(await readFile(path.join(projectDir, ".gitignore"), "utf8")).toContain(".agents/");
    });

    test("--dry-run reports the .gitignore step without writing it", async () => {
      const projectDir = path.join(fx.projectsRoot, "freshdry");
      await mkdir(projectDir, { recursive: true });
      await git(["init", "-q", "-b", "main"], projectDir);

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true, id: "personal/freshdry" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("would append");
      expect(existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
    });

    test("fails if a branch of that name already exists in marrow", async () => {
      const otherAgents = path.join(fx.projectsRoot, "other", ".agents");
      await git(["worktree", "add", "--orphan", "-b", "projects/personal/dupbranch", otherAgents], vaultDir(fx.marrowHome));
      // An orphan branch has no ref until its first commit ("unborn branch").
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

      const { code, errLines } = await captureLogs(() =>
        addCommand(path.join(fx.projectsRoot, "dupbranch"), { id: "personal/dupbranch" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already attached");
    });
  });

  test("dispatches to adopt when .agents already exists, and to fresh-create otherwise", async () => {
    const existing = await makeProjectRepo(fx, "ossa", "ignored");
    const { code: adoptCode, outLines: adoptOut } = await captureLogs(() =>
      addCommand(existing, {}, fx.marrowHome, fx.toolRoot),
    );
    expect(adoptCode).toBe(0);
    expect(adoptOut.join("\n")).toContain("added 'ossa': adopted existing .agents");

    const fresh = path.join(fx.projectsRoot, "brandnew");
    const { code: freshCode, outLines: freshOut } = await captureLogs(() =>
      addCommand(fresh, { id: "personal/brandnew" }, fx.marrowHome, fx.toolRoot),
    );
    expect(freshCode).toBe(0);
    expect(freshOut.join("\n")).toContain("added 'brandnew': created .agents");
  });
});
