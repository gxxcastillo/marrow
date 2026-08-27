import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { addCommand } from "../src/commands/add";
import { git, listProjectWorktrees, vaultDir } from "../src/git";
import { addProjectWorktree, makeFixture, makeProjectRepo, type Fixture } from "./fixtures";
import { captureLogs, listFilesRecursive } from "./helpers";

const branch = (name: string) => name;

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
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      const before = await listFilesRecursive(agentsPath);
      expect(before).toContain(".hidden");

      const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(outLines.at(-1)).toBe(`pushed: origin/${branch("alpha")}`);

      expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);
      const after = await listFilesRecursive(agentsPath);
      for (const f of before) expect(after).toContain(f);

      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain(branch("alpha"));

      const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
      expect(readme).toContain("## Persistence");
      expect(readme).toContain(`branch: \`${branch("alpha")}\``);

      const rev = await git(["rev-parse", "HEAD"], agentsPath);
      const remoteRev = await git(["rev-parse", `origin/${branch("alpha")}`], agentsPath);
      expect(remoteRev.stdout).toBe(rev.stdout);
    });

    test("backup tarball is created and non-empty", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));

      const backupsDir = path.join(fx.marrowHome, "backups");
      const entries = await readdir(backupsDir);
      expect(entries.length).toBe(1);
      expect((await stat(path.join(backupsDir, entries[0]))).size).toBeGreaterThan(0);
    });

    test("reports a local-only add after the result when the vault has no origin", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));

      const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(outLines[0]).toContain("added 'alpha': adopted existing .agents");
      expect(outLines[1]).toContain("backup:");
      expect(outLines[2]).toBe("not pushed: vault has no origin");
    });

    test("appends .agents/ to parent .gitignore when untracked-not-ignored", async () => {
      const projectDir = await makeProjectRepo(fx, "beta", "untracked");
      const { code } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      const gitignore = await readFile(path.join(projectDir, ".gitignore"), "utf8");
      expect(gitignore).toContain(".agents/");
    });

    test("aborts when .agents is tracked by the parent repo, without touching it", async () => {
      const projectDir = await makeProjectRepo(fx, "tracked-project", "tracked");
      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("tracked");
      expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(false);
    });

    test("aborts when a branch of the same name already exists in marrow", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      const otherAgents = path.join(fx.projectsRoot, "alpha-other", ".agents");
      await git(["worktree", "add", "--orphan", "-b", branch("alpha"), otherAgents], vaultDir(fx.marrowHome));
      // An orphan branch has no ref until its first commit ("unborn branch").
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already attached");
    });

    test("aborts when .agents is already a worktree", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      await rm(agentsPath, { recursive: true, force: true });
      await mkdir(agentsPath, { recursive: true });
      await Bun.write(path.join(agentsPath, ".git"), "gitdir: /somewhere\n");

      const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already a git worktree");
    });

    test("--dry-run makes no changes to the project or the vault", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      const agentsPath = path.join(projectDir, ".agents");
      const before = await listFilesRecursive(agentsPath);

      const { code } = await captureLogs(() => addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);

      expect(existsSync(path.join(agentsPath, ".git"))).toBe(false);
      expect(await listFilesRecursive(agentsPath)).toEqual(before);
      expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    });

    test("--dry-run against an untracked project reports the .gitignore step without writing it", async () => {
      const projectDir = await makeProjectRepo(fx, "beta", "untracked");
      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("would append");
      expect(existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
    });

    test("adopts a project at an explicit path", async () => {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored", path.join(fx.root, "elsewhere"));
      const { code } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain(branch("alpha"));
    });

    test("--id from a subdirectory still lands .agents/ at the repo root, not the subdirectory", async () => {
      const projectDir = await makeProjectRepo(fx, "nested-repo", "ignored", path.join(fx.root, "elsewhere"));
      const nested = path.join(projectDir, "packages", "sub");
      await mkdir(nested, { recursive: true });

      const { code } = await captureLogs(() => addCommand(nested, { id: "custom/nested-repo" }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(true);
      expect(existsSync(path.join(nested, ".agents"))).toBe(false);
    });
  });

  describe("creating a fresh .agents/", () => {
    test("creates a fresh .agents worktree seeded from the README template", async () => {
      const projectDir = path.join(fx.root, "elsewhere", "freshproj");
      const { code } = await captureLogs(() => addCommand(projectDir, { id: "local/freshproj" }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);

      const agentsPath = path.join(projectDir, ".agents");
      expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);

      const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
      expect(readme).toContain("freshproj");
      expect(readme).toContain("## Persistence");

      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain("local/freshproj");

      const rev = await git(["rev-parse", "HEAD"], agentsPath);
      const remoteRev = await git(["rev-parse", "origin/local/freshproj"], agentsPath);
      expect(remoteRev.stdout).toBe(rev.stdout);
    });

    test("--dry-run makes no changes when there is nothing to adopt", async () => {
      const projectDir = path.join(fx.root, "elsewhere", "freshproj");
      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true, id: "local/freshproj" }, fx.marrowHome, fx.toolRoot),
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
      const { code } = await captureLogs(() => addCommand(projectDir, { id: "local/notarepo" }, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(await readFile(path.join(projectDir, ".gitignore"), "utf8")).toContain(".agents/");
    });

    test("--dry-run reports the .gitignore step without writing it", async () => {
      const projectDir = path.join(fx.projectsRoot, "freshdry");
      await mkdir(projectDir, { recursive: true });
      await git(["init", "-q", "-b", "main"], projectDir);

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true, id: "local/freshdry" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("would append");
      expect(existsSync(path.join(projectDir, ".gitignore"))).toBe(false);
    });

    test("fails if a branch of that name already exists in marrow", async () => {
      const otherAgents = path.join(fx.projectsRoot, "other", ".agents");
      await git(["worktree", "add", "--orphan", "-b", "local/dupbranch", otherAgents], vaultDir(fx.marrowHome));
      // An orphan branch has no ref until its first commit ("unborn branch").
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);

      const { code, errLines } = await captureLogs(() =>
        addCommand(path.join(fx.projectsRoot, "dupbranch"), { id: "local/dupbranch" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already attached");
    });

    test("names the missing worktree's directory and points at detach, rather than reporting a false success", async () => {
      const otherAgents = path.join(fx.projectsRoot, "other-missing", ".agents");
      await git(["worktree", "add", "--orphan", "-b", "local/dupbranch-missing", otherAgents], vaultDir(fx.marrowHome));
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);
      await rm(otherAgents, { recursive: true, force: true });

      const { code, errLines } = await captureLogs(() =>
        addCommand(path.join(fx.projectsRoot, "dupbranch-missing"), { id: "local/dupbranch-missing" }, fx.marrowHome, fx.toolRoot),
      );
      expect(code).toBe(1);
      expect(errLines.join("\n")).toContain("already attached");
      expect(errLines.join("\n")).toContain("marrow detach local/dupbranch-missing");
    });
  });

  test("re-running add on an unchanged, present worktree succeeds without changing it", async () => {
    const projectDir = await makeProjectRepo(fx, "steady", "ignored");
    const first = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(first.code).toBe(0);

    const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("already attached steady");
  });

  test("refuses to report false success when the worktree at the target path is missing", async () => {
    const projectDir = await makeProjectRepo(fx, "vanished", "ignored");
    const first = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(first.code).toBe(0);
    await rm(path.join(projectDir, ".agents"), { recursive: true, force: true });

    const { code, errLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("worktree directory is missing");
    expect(errLines.join("\n")).toContain("marrow detach vanished");
    expect(existsSync(path.join(projectDir, ".agents"))).toBe(false);
  });

  test("attaches an existing branch when there is no local .agents directory", async () => {
    const seededAgents = await addProjectWorktree(fx, "seeded", "local/attach");
    await git(["worktree", "remove", seededAgents], vaultDir(fx.marrowHome));
    const projectDir = path.join(fx.projectsRoot, "attach");
    await mkdir(projectDir, { recursive: true });

    const { code, outLines } = await captureLogs(() =>
      addCommand(projectDir, { id: "local/attach" }, fx.marrowHome, fx.toolRoot),
    );

    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("attached local/attach");
    expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(true);
  });

  test("plans conflict precedence without mutating rejected targets", async () => {
    const cases: {
      name: string;
      setup: () => Promise<{ projectDir: string; opts?: Parameters<typeof addCommand>[1]; unchangedPath: string }>;
      expected: string;
    }[] = [
      {
        name: "wrong worktree at target",
        setup: async () => {
          const projectDir = await makeProjectRepo(fx, "wrong-target", "ignored");
          const agentsPath = path.join(projectDir, ".agents");
          await rm(agentsPath, { recursive: true, force: true });
          await git(["worktree", "add", "--orphan", "-b", "local/other", agentsPath], vaultDir(fx.marrowHome));
          return { projectDir, unchangedPath: agentsPath };
        },
        expected: "is a worktree for 'local/other'",
      },
      {
        name: "same branch attached elsewhere",
        setup: async () => {
          const projectDir = await makeProjectRepo(fx, "attached-elsewhere", "ignored");
          const agentsPath = path.join(projectDir, ".agents");
          const otherAgents = path.join(fx.projectsRoot, "attached-elsewhere-other", ".agents");
          await git(["worktree", "add", "--orphan", "-b", branch("attached-elsewhere"), otherAgents], vaultDir(fx.marrowHome));
          await git(["commit", "--allow-empty", "-q", "-m", "seed"], otherAgents);
          return { projectDir, unchangedPath: agentsPath };
        },
        expected: "already attached",
      },
      {
        name: "local content and existing branch",
        setup: async () => {
          const projectDir = await makeProjectRepo(fx, "branch-and-content", "ignored");
          const agentsPath = path.join(projectDir, ".agents");
          const seededAgents = await addProjectWorktree(fx, "branch-and-content-seed", branch("branch-and-content"));
          await git(["worktree", "remove", seededAgents], vaultDir(fx.marrowHome));
          return { projectDir, unchangedPath: agentsPath };
        },
        expected: "has local content",
      },
    ];

    for (const c of cases) {
      const { projectDir, opts = {}, unchangedPath } = await c.setup();
      const before = await listFilesRecursive(unchangedPath);
      const { code, errLines } = await captureLogs(() => addCommand(projectDir, opts, fx.marrowHome, fx.toolRoot));

      expect(code, c.name).toBe(1);
      expect(errLines.join("\n"), c.name).toContain(c.expected);
      expect(await listFilesRecursive(unchangedPath), c.name).toEqual(before);
    }
  });
});
