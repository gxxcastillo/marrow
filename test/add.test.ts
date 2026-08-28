import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
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
      const resolvedProjectDir = await realpath(projectDir);
      const resolvedAgentsPath = path.join(resolvedProjectDir, ".agents");
      const before = await listFilesRecursive(agentsPath);
      expect(before).toContain(".hidden");

      const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
      expect(code).toBe(0);
      expect(outLines).toContain("added alpha to marrow");
      expect(outLines).toContain(`  project:  ${resolvedProjectDir}`);
      expect(outLines).toContain(`  location: ${resolvedAgentsPath}`);
      expect(outLines).toContain(`  key:      ${branch("alpha")}`);
      expect(outLines).toContain(`vault: pushed origin/${branch("alpha")}`);

      expect(existsSync(path.join(agentsPath, ".git"))).toBe(true);
      const after = await listFilesRecursive(agentsPath);
      for (const f of before) expect(after).toContain(f);

      const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
      expect(worktrees.map((w) => w.branch)).toContain(branch("alpha"));

      const readme = await readFile(path.join(agentsPath, "README.md"), "utf8");
      expect(readme).toContain("<!-- marrow:persistence-block v1 -->");
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
      expect(outLines).toContain("added alpha to marrow");
      expect(outLines.join("\n")).toContain("Adopted existing .agents\n  backup:");
      expect(outLines.join("\n")).toContain("  files:  4 before, 4 after");
      expect(outLines.join("\n")).toContain("  size:   34B before,");
      expect(outLines).toContain("vault: not pushed (no origin configured)");
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

    test("--dry-run previews prepending the parent instruction block without writing it", async () => {
      const projectDir = await makeProjectRepo(fx, "needs-block", "ignored");
      await Bun.write(path.join(projectDir, "AGENTS.md"), "Read .agents/README.md first.\n");

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );

      const output = outLines.join("\n");
      expect(code).toBe(0);
      expect(output).toContain("Project instructions:");
      expect(output).toContain("AGENTS.md                 would add marrow .agents note");
      expect(output).toContain("AGENTS.md                 1 existing .agents reference found; review for inconsistent guidance");
      expect(await readFile(path.join(projectDir, "AGENTS.md"), "utf8")).toBe("Read .agents/README.md first.\n");
      expect(existsSync(path.join(projectDir, ".agents", ".git"))).toBe(false);
    });

    test("live add prepends the parent instruction block to AGENTS.md when it is missing", async () => {
      const projectDir = await makeProjectRepo(fx, "prepend-block", "ignored");
      await Bun.write(path.join(projectDir, "AGENTS.md"), "Read .agents/README.md first.\n");

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );

      const output = outLines.join("\n");
      const agents = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");
      expect(code).toBe(0);
      expect(output).toContain("Project instructions:");
      expect(output).toContain("AGENTS.md                 marrow .agents note added");
      expect(output).toContain("AGENTS.md                 1 existing .agents reference found; review for inconsistent guidance");
      expect(outLines.filter((line) => line === "marrow did not commit these project files.")).toHaveLength(1);
      expect(agents).toStartWith("> [!NOTE]");
      expect(agents).toContain('> <p align="right">v1</p>');
      expect(agents).toContain("Read .agents/README.md first.");
    });

    test("live add disables Codex and Claude Code built-in memory for the parent project", async () => {
      const projectDir = await makeProjectRepo(fx, "disable-memory", "ignored");

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );

      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("Updated project settings:\n  .codex/config.toml");
      expect(outLines.join("\n")).toContain("Codex memory disabled");
      expect(outLines.join("\n")).toContain("Claude Code auto memory disabled");
      expect(outLines).toContain("marrow did not commit these project files.");
      expect(await readFile(path.join(projectDir, ".codex", "config.toml"), "utf8")).toBe([
        "[features]",
        "memories = false",
        "",
        "[memories]",
        "use_memories = false",
        "generate_memories = false",
        "",
      ].join("\n"));
      expect(JSON.parse(await readFile(path.join(projectDir, ".claude", "settings.json"), "utf8"))).toEqual({
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        autoMemoryEnabled: false,
      });
    });

    test("live add updates existing agent memory configs without replacing unrelated settings", async () => {
      const projectDir = await makeProjectRepo(fx, "update-memory-config", "ignored");
      await mkdir(path.join(projectDir, ".codex"), { recursive: true });
      await mkdir(path.join(projectDir, ".claude"), { recursive: true });
      await Bun.write(path.join(projectDir, ".codex", "config.toml"), [
        'model = "gpt-5.6"',
        "",
        "[features]",
        "memories = true",
        "",
        "[sandbox]",
        'mode = "workspace-write"',
        "",
      ].join("\n"));
      await Bun.write(path.join(projectDir, ".claude", "settings.json"), JSON.stringify({ model: "claude-sonnet-5" }));

      const { code } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );

      const codex = await readFile(path.join(projectDir, ".codex", "config.toml"), "utf8");
      const claude = JSON.parse(await readFile(path.join(projectDir, ".claude", "settings.json"), "utf8"));
      expect(code).toBe(0);
      expect(codex).toContain('model = "gpt-5.6"');
      expect(codex).toContain("[features]\nmemories = false");
      expect(codex).toContain("[sandbox]");
      expect(codex).toContain("[memories]\nuse_memories = false\ngenerate_memories = false");
      expect(claude.model).toBe("claude-sonnet-5");
      expect(claude.autoMemoryEnabled).toBe(false);
    });

    test("keeps Codex memory settings inside the intended TOML tables", async () => {
      const projectDir = await makeProjectRepo(fx, "complex-toml-config", "ignored");
      await mkdir(path.join(projectDir, ".codex"), { recursive: true });
      await Bun.write(path.join(projectDir, ".codex", "config.toml"), [
        "[features]",
        "enabled = true",
        "",
        "[[profile]]",
        'name = "work"',
        "",
        '[mcp_servers."foo/bar"]',
        'command = "server"',
        "",
      ].join("\n"));

      const { code } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );

      const codex = await readFile(path.join(projectDir, ".codex", "config.toml"), "utf8");
      expect(code).toBe(0);
      expect(codex).toContain("[features]\nenabled = true\nmemories = false\n\n[[profile]]");
      expect(codex).toContain('[[profile]]\nname = "work"\n\n[mcp_servers."foo/bar"]');
      expect(codex).toContain('[mcp_servers."foo/bar"]\ncommand = "server"');
      expect(codex).toContain("[memories]\nuse_memories = false\ngenerate_memories = false");
    });

    test("does not update parent instruction files when either one has the canonical block", async () => {
      const projectDir = await makeProjectRepo(fx, "has-block", "ignored");
      const block = await readFile(path.join(fx.toolRoot, "templates", "agents-block.md"), "utf8");
      await Bun.write(path.join(projectDir, "CLAUDE.md"), `Project notes.\n\n${block}`);

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );

      expect(code).toBe(0);
      expect(outLines.join("\n")).not.toContain("project instructions");
    });

    test("updates a stale parent instruction block even when another file is current", async () => {
      const projectDir = await makeProjectRepo(fx, "mixed-note-blocks", "ignored");
      const block = await readFile(path.join(fx.toolRoot, "templates", "agents-block.md"), "utf8");
      const agentsContent = `${block.trim()}\n\n# Existing Guidance\n`;
      await Bun.write(path.join(projectDir, "AGENTS.md"), agentsContent);
      await Bun.write(path.join(projectDir, "CLAUDE.md"), [
        "> [!Note]",
        "> **Agent memory:** Read `.agents/README.md` before work.",
        "> Keep `.agents/` current.",
        "> <p align=\"right\">v10.20.30.40</p>",
        "",
        "# Claude Guidance",
        "",
      ].join("\n"));

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );

      const output = outLines.join("\n");
      const agents = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");
      const claude = await readFile(path.join(projectDir, "CLAUDE.md"), "utf8");
      expect(code).toBe(0);
      expect(output).toContain("Project instructions:");
      expect(outLines.some((line) => line.includes("CLAUDE.md") && line.includes("marrow .agents note updated"))).toBe(
        true,
      );
      expect(agents).toBe(agentsContent);
      expect(claude).toContain('> <p align="right">v1</p>');
      expect(claude).not.toContain("v10.20.30.40");
      expect(claude).toContain("# Claude Guidance");
    });

    test("dry-run treats non-canonical .agents prose as missing", async () => {
      const projectDir = await makeProjectRepo(fx, "noncanonical-block", "ignored");
      await Bun.write(path.join(projectDir, "AGENTS.md"), "Read .agents/README.md, then continue.\n");

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );

      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("Project instructions:");
      expect(outLines.join("\n")).toContain("AGENTS.md                 1 existing .agents reference found; review for inconsistent guidance");
    });

    test("previews updating a versioned old note block", async () => {
      const projectDir = await makeProjectRepo(fx, "old-note-block", "ignored");
      await Bun.write(path.join(projectDir, "AGENTS.md"), [
        "> [!Note]",
        "> **Agent memory:** Read `.agents/README.md` before work.",
        "> Keep `.agents/` current.",
        "> <p align=\"right\">v10.20.30.40</p>",
        "",
        "# Existing Guidance",
        "",
      ].join("\n"));
      const before = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, { dryRun: true }, fx.marrowHome, fx.toolRoot),
      );
      const agents = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");

      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("Project instructions:");
      expect(outLines.join("\n")).toContain("would update marrow .agents note (v10.20.30.40 -> v1)");
      expect(outLines.join("\n")).toContain("AGENTS.md                 2 existing .agents references found; review for inconsistent guidance");
      expect(agents).toBe(before);
    });

    test("live add replaces a stale versioned note in place, keeping the rest of the file", async () => {
      const projectDir = await makeProjectRepo(fx, "old-note-block", "ignored");
      await Bun.write(path.join(projectDir, "AGENTS.md"), [
        "> [!Note]",
        "> **Agent memory:** Read `.agents/README.md` before work.",
        "> Keep `.agents/` current.",
        "> <p align=\"right\">v10.20.30.40</p>",
        "",
        "# Existing Guidance",
        "",
      ].join("\n"));

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );
      const agents = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");

      expect(code).toBe(0);
      expect(outLines.join("\n")).toContain("Project instructions:");
      expect(outLines.join("\n")).toContain("marrow .agents note updated (v10.20.30.40 -> v1)");
      expect(outLines.join("\n")).toContain("AGENTS.md                 2 existing .agents references found; review for inconsistent guidance");
      expect(outLines).toContain("marrow did not commit these project files.");
      expect(agents).toContain('> <p align="right">v1</p>');
      expect(agents).not.toContain("v10.20.30.40");
      expect(agents).toContain("# Existing Guidance");
    });

    test("does nothing when the note already carries the current version", async () => {
      const projectDir = await makeProjectRepo(fx, "current-note-block", "ignored");
      const block = await readFile(path.join(fx.toolRoot, "templates", "agents-block.md"), "utf8");
      const agentsContent = `${block.trim()}\n\n# Existing Guidance\n`;
      await Bun.write(path.join(projectDir, "AGENTS.md"), agentsContent);

      const { code, outLines } = await captureLogs(() =>
        addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );
      const agents = await readFile(path.join(projectDir, "AGENTS.md"), "utf8");

      expect(code).toBe(0);
      expect(outLines.join("\n")).not.toContain("project instructions");
      expect(agents).toBe(agentsContent);
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
      expect(readme).toContain("<!-- marrow:persistence-block v1 -->");
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
      expect(outLines).toContain("would add freshproj to marrow");
      expect(outLines).toContain(`  project:  ${projectDir}`);
      expect(outLines).toContain(`  location: ${path.join(projectDir, ".agents")}`);
      expect(outLines).toContain("  key:      local/freshproj");
      expect(outLines).toContain("plan: create new .agents");
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
      expect(existsSync(path.join(projectDir, ".codex"))).toBe(false);
      expect(existsSync(path.join(projectDir, ".claude"))).toBe(false);
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
    const resolvedProjectDir = await realpath(projectDir);
    const first = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(first.code).toBe(0);

    const { code, outLines } = await captureLogs(() => addCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines).toContain("steady is already managed by marrow");
    expect(outLines).toContain(`  project:  ${resolvedProjectDir}`);
    expect(outLines).toContain(`  location: ${path.join(resolvedProjectDir, ".agents")}`);
    expect(outLines).toContain("  key:      steady");
    expect(outLines).toContain("Project settings already up to date.");
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
    expect(outLines).toContain("attached attach to marrow");
    expect(outLines).toContain(`  project:  ${projectDir}`);
    expect(outLines).toContain(`  location: ${path.join(projectDir, ".agents")}`);
    expect(outLines).toContain("  key:      local/attach");
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
