import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { attachCommand } from "../src/commands/attach";
import { detachCommand } from "../src/commands/detach";
import { git, gitRaw, listProjectWorktrees, vaultDir } from "../src/git";
import { addProjectWorktree, deleteWorktreeDir, makeFixture, setTestIdentity, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("detach", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("keeps ordinary files, removes the persistence block, and leaves parent files unchanged", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const projectDir = path.dirname(agentsPath);
    const persistence = await Bun.file(path.join(fx.toolRoot, "templates", "persistence-block.md")).text();
    await Bun.write(path.join(agentsPath, "README.md"), `# Alpha notes\n\n${persistence}`);
    await git(["add", "README.md"], agentsPath);
    await git(["commit", "-q", "-m", "alpha: add persistence block"], agentsPath);
    await mkdir(path.join(projectDir, ".codex"), { recursive: true });
    await mkdir(path.join(projectDir, ".claude"), { recursive: true });
    const parentFiles = new Map([
      [path.join(projectDir, ".gitignore"), ".agents/\n"],
      [path.join(projectDir, "AGENTS.md"), "read .agents/README.md\n"],
      [path.join(projectDir, ".codex", "config.toml"), "[features]\nmemories = false\n"],
      [path.join(projectDir, ".claude", "settings.json"), '{"autoMemoryEnabled":false}\n'],
    ]);
    for (const [file, content] of parentFiles) await Bun.write(file, content);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("detached 'alpha'");
    expect(outLines[0]).toContain(agentsPath);
    expect(outLines.join("\n")).toContain("Parent project files were left unchanged");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    expect(existsSync(agentsPath)).toBe(true);
    expect(existsSync(path.join(agentsPath, ".git"))).toBe(false);
    expect(await Bun.file(path.join(agentsPath, "README.md")).text()).toBe("# Alpha notes\n");
    for (const [file, content] of parentFiles) expect(await Bun.file(file).text()).toBe(content);
    const branch = await git(["branch", "--list", "alpha"], vaultDir(fx.marrowHome));
    expect(branch.stdout).toContain("alpha");
  });

  test("allows a dirty default detach and keeps the uncommitted files", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "uncommitted\n");

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("started with 1 uncommitted change");
    expect(await Bun.file(path.join(agentsPath, "note.md")).text()).toBe("uncommitted\n");
    expect(existsSync(path.join(agentsPath, ".git"))).toBe(false);
  });

  test("commits only the block removal while retaining dirty README edits", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const persistence = await Bun.file(path.join(fx.toolRoot, "templates", "persistence-block.md")).text();
    await Bun.write(path.join(agentsPath, "README.md"), `# Alpha notes\n\n${persistence}`);
    await git(["add", "README.md"], agentsPath);
    await git(["commit", "-q", "-m", "alpha: add persistence block"], agentsPath);

    await Bun.write(path.join(agentsPath, "README.md"), `# Staged edit\n\n${persistence}`);
    await git(["add", "README.md"], agentsPath);
    await Bun.write(path.join(agentsPath, "README.md"), `# Staged edit\n\nUnstaged edit\n\n${persistence}`);
    await Bun.write(path.join(agentsPath, "unrelated.md"), "staged but unrelated\n");
    await git(["add", "unrelated.md"], agentsPath);

    const { code } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(await Bun.file(path.join(agentsPath, "README.md")).text()).toBe("# Staged edit\n\nUnstaged edit\n");
    expect(await Bun.file(path.join(agentsPath, "unrelated.md")).text()).toBe("staged but unrelated\n");

    const vault = vaultDir(fx.marrowHome);
    expect((await gitRaw(["show", "alpha:README.md"], vault)).stdout).toBe("# Alpha notes\n");
    expect((await git(["cat-file", "-e", "alpha:unrelated.md"], vault)).code).not.toBe(0);
    expect((await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "alpha"], vault)).stdout).toBe("README.md");
  });

  test("preserves an unrelated user-authored Persistence section on disk and branch", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const readme = "# Alpha notes\n\n## Persistence\n\nKeep this project policy.\n";
    await Bun.write(path.join(agentsPath, "README.md"), readme);
    await git(["add", "README.md"], agentsPath);
    await git(["commit", "-q", "-m", "alpha: add project policy"], agentsPath);
    const before = (await git(["rev-parse", "alpha"], vaultDir(fx.marrowHome))).stdout;

    expect((await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome))).code).toBe(0);
    expect(await Bun.file(path.join(agentsPath, "README.md")).text()).toBe(readme);
    expect((await gitRaw(["show", "alpha:README.md"], vaultDir(fx.marrowHome))).stdout).toBe(readme);
    expect((await git(["rev-parse", "alpha"], vaultDir(fx.marrowHome))).stdout).toBe(before);
  });

  test("default detach leaves two sources that attach refuses to merge", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const projectDir = path.dirname(agentsPath);
    expect((await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome))).code).toBe(0);

    const { code, errLines } = await captureLogs(() =>
      attachCommand(projectDir, { id: "alpha" }, fx.marrowHome, fx.toolRoot),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("has local content but alpha already exists");
    expect(await Bun.file(path.join(agentsPath, "README.md")).text()).toBe("# alpha\n");
  });

  test("names retained unpushed commits", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only"], agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { vaultOnly: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("1 unpushed commit retained on the branch");
  });

  test("pluralizes multiple retained unpushed commits", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["commit", "--allow-empty", "-q", "-m", "local only 1"], agentsPath);
    await git(["commit", "--allow-empty", "-q", "-m", "local only 2"], agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { vaultOnly: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toContain("2 unpushed commits retained on the branch");
  });

  test("--vault-only refuses a dirty worktree with remediation, leaving it attached", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code, errLines } = await captureLogs(() => detachCommand("alpha", { vaultOnly: true }, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("refusing --vault-only");
    expect(errLines.join("\n")).toContain("marrow sync alpha");
    expect(errLines.join("\n")).toContain("clean -fd");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toHaveLength(1);
  });

  test("--vault-only preserves the reattach round trip", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const projectDir = path.dirname(agentsPath);
    const detached = await captureLogs(() => detachCommand("alpha", { vaultOnly: true }, fx.marrowHome));
    expect(detached.code).toBe(0);

    const attached = await captureLogs(() =>
      attachCommand(projectDir, { id: "alpha" }, fx.marrowHome, fx.toolRoot),
    );
    expect(attached.code).toBe(0);
    expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);
    expect(await Bun.file(path.join(agentsPath, "README.md")).text()).toBe("# alpha\n");
  });

  test("clears the registration for a worktree whose directory is already missing", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", {}, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("worktree directory was already missing");
    expect(outLines.join("\n")).toContain("nothing was pushed or deleted");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
    const branch = await git(["branch", "--list", "alpha"], vaultDir(fx.marrowHome));
    expect(branch.stdout).toContain("alpha");
  });

  test("reports an unknown project name", async () => {
    const { code, errLines } = await captureLogs(() => detachCommand("nonexistent", {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines).toEqual(["marrow detach: unknown project: nonexistent"]);
  });

  test("reports an ambiguous project name and detaches nothing", async () => {
    const vault = vaultDir(fx.marrowHome);
    const agentsA = path.join(fx.projectsRoot, "team-a", "shared", ".agents");
    const agentsB = path.join(fx.projectsRoot, "team-b", "shared", ".agents");
    for (const [agentsPath, branch] of [[agentsA, "shared-a"], [agentsB, "shared-b"]] as const) {
      const wt = await git(["worktree", "add", "--orphan", "-b", branch, agentsPath], vault);
      expect(wt.code).toBe(0);
      await setTestIdentity(agentsPath);
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);
    }

    const { code, errLines } = await captureLogs(() => detachCommand("shared", {}, fx.marrowHome));
    expect(code).toBe(1);
    expect(errLines[0]).toContain("ambiguous name shared matches:");
    expect(errLines[0]).toContain(agentsA);
    expect(errLines[0]).toContain(agentsB);

    expect(await listProjectWorktrees(vault)).toHaveLength(2);
  });

  test("dry-run previews a clean detach without touching the worktree", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { dryRun: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toStartWith("dry run:");

    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toHaveLength(1);
  });

  test("--vault-only dry-run still refuses a dirty worktree", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { code, errLines } = await captureLogs(() =>
      detachCommand("alpha", { dryRun: true, vaultOnly: true }, fx.marrowHome),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("uncommitted change");
  });

  test("dry-run previews clearing an already-missing registration without doing it", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await deleteWorktreeDir(agentsPath);

    const { code, outLines } = await captureLogs(() => detachCommand("alpha", { dryRun: true }, fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines[0]).toStartWith("dry run:");

    const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.missing).toBe(true);
  });
});
