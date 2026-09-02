import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachCommand } from "../src/commands/attach";
import { refreshCommand } from "../src/commands/refresh";
import { git, vaultDir } from "../src/git";
import { agentsBlockStatus } from "../src/project";
import { deleteWorktreeDir, makeFixture, makeProjectRepo, setTestIdentity, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

async function noteStatus(toolRoot: string, projectDir: string, project: string) {
  return (await agentsBlockStatus(toolRoot, projectDir, path.join(projectDir, ".agents"), project)).kind;
}

// Drifts a freshly-attached project's note wording, the same content-based staleness
// shape `test/doctor.test.ts`'s staleness tests use now that there's no version tag to
// corrupt, so `refresh` has something to repair. The note stays structurally
// recognizable (still opens with `> [!NOTE]` and links `.agents/README.md`) but no
// longer matches the template exactly.
async function staleNote(projectDir: string): Promise<string> {
  const agentsMdPath = path.join(projectDir, "AGENTS.md");
  const original = await readFile(agentsMdPath, "utf8");
  const drifted = original.replace("and keep it current as you go.", "and keep it up to date.");
  if (drifted === original) throw new Error("staleNote: drift target text not found in the current template");
  await writeFile(agentsMdPath, drifted);
  return agentsMdPath;
}

describe("refresh", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("refreshes every attached project when no targets are named", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    const beta = await makeProjectRepo(fx, "beta", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await captureLogs(() => attachCommand(beta, {}, fx.marrowHome, fx.toolRoot));
    await staleNote(alpha);
    await staleNote(beta);

    const { code, outLines } = await captureLogs(() => refreshCommand([], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines).toContain("alpha:");
    expect(outLines).toContain("beta:");
    expect(outLines).toContain("refresh: 2 project(s) updated, 0 unchanged");

    expect(await noteStatus(fx.toolRoot, alpha, "alpha")).toBe("current");
    expect(await noteStatus(fx.toolRoot, beta, "beta")).toBe("current");
  });

  test("only refreshes the named subset", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    const beta = await makeProjectRepo(fx, "beta", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await captureLogs(() => attachCommand(beta, {}, fx.marrowHome, fx.toolRoot));
    await staleNote(alpha);
    await staleNote(beta);

    const { code, outLines } = await captureLogs(() => refreshCommand(["alpha"], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines).toContain("alpha:");
    expect(outLines).not.toContain("beta:");
    expect(outLines).toContain("refresh: 1 project(s) updated, 0 unchanged");

    expect(await noteStatus(fx.toolRoot, alpha, "alpha")).toBe("current");
    expect(await noteStatus(fx.toolRoot, beta, "beta")).toBe("stale");
  });

  test("an unknown target is reported and skipped while a valid target in the same call still refreshes", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await staleNote(alpha);

    const { code, outLines, errLines } = await captureLogs(() =>
      refreshCommand(["nonexistent", "alpha"], {}, fx.marrowHome, fx.toolRoot),
    );
    expect(code).toBe(1);
    expect(errLines).toContain("unknown project: nonexistent");
    expect(outLines).toContain("alpha:");

    expect(await noteStatus(fx.toolRoot, alpha, "alpha")).toBe("current");
  });

  test("an ambiguous target name refreshes neither match and names both paths", async () => {
    const vault = vaultDir(fx.marrowHome);
    const agentsA = path.join(fx.projectsRoot, "team-a", "shared", ".agents");
    const agentsB = path.join(fx.projectsRoot, "team-b", "shared", ".agents");
    for (const [agentsPath, branch] of [[agentsA, "shared-a"], [agentsB, "shared-b"]] as const) {
      const wt = await git(["worktree", "add", "--orphan", "-b", branch, agentsPath], vault);
      expect(wt.code).toBe(0);
      await setTestIdentity(agentsPath);
      await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);
    }

    const { code, errLines } = await captureLogs(() => refreshCommand(["shared"], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(errLines[0]).toContain("ambiguous name shared matches:");
    expect(errLines[0]).toContain(agentsA);
    expect(errLines[0]).toContain(agentsB);
  });

  test("a fully current project is counted unchanged and prints nothing for it", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));

    const { code, outLines } = await captureLogs(() => refreshCommand([], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines).toEqual(["refresh: 0 project(s) updated, 1 unchanged"]);
  });

  test("surfaces a broken .claude/settings.json even when it's the only thing wrong", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await writeFile(path.join(alpha, ".claude", "settings.json"), "{ not valid json");

    const { code, outLines } = await captureLogs(() => refreshCommand([], {}, fx.marrowHome, fx.toolRoot));
    const output = outLines.join("\n");

    expect(code).toBe(0);
    expect(outLines).toContain("alpha:");
    expect(output).toContain(".claude/settings.json     could not update:");
    expect(outLines).toContain("refresh: 1 project(s) updated, 0 unchanged");
  });

  test("fixes a stale note, a missing CLAUDE.md redirect, and re-enabled memory settings together", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await staleNote(alpha);
    await rm(path.join(alpha, "CLAUDE.md"));
    await writeFile(path.join(alpha, ".claude", "settings.json"), JSON.stringify({ autoMemoryEnabled: true }));

    const { code, outLines } = await captureLogs(() => refreshCommand([], {}, fx.marrowHome, fx.toolRoot));
    const output = outLines.join("\n");

    expect(code).toBe(0);
    expect(output).toContain("alpha:");
    expect(output).toContain("Project instructions:");
    expect(output).toContain("marrow .agents note updated");
    expect(output).toContain("Claude Code compatibility:");
    expect(output).toContain("CLAUDE.md                 redirect to AGENTS.md added");
    expect(output).toContain("Updated project settings:");
    expect(output).toContain("Claude Code auto memory disabled");
    expect(outLines).toContain("refresh: 1 project(s) updated, 0 unchanged");

    expect(existsSync(path.join(alpha, "CLAUDE.md"))).toBe(true);
    const settings = JSON.parse(await readFile(path.join(alpha, ".claude", "settings.json"), "utf8"));
    expect(settings.autoMemoryEnabled).toBe(false);
  });

  test("--dry-run previews a single named target without writing", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    const agentsMdPath = await staleNote(alpha);
    const before = await readFile(agentsMdPath, "utf8");

    const { code, outLines } = await captureLogs(() => refreshCommand(["alpha"], { dryRun: true }, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("would update marrow .agents note");
    expect(outLines).toContain("refresh: 1 project(s) updated, 0 unchanged");
    expect(await readFile(agentsMdPath, "utf8")).toBe(before);
  });

  test("--dry-run previews across every attached project without writing", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    const beta = await makeProjectRepo(fx, "beta", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await captureLogs(() => attachCommand(beta, {}, fx.marrowHome, fx.toolRoot));
    const alphaMd = await staleNote(alpha);
    const betaMd = await staleNote(beta);
    const beforeAlpha = await readFile(alphaMd, "utf8");
    const beforeBeta = await readFile(betaMd, "utf8");

    const { code, outLines } = await captureLogs(() => refreshCommand([], { dryRun: true }, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines).toContain("refresh: 2 project(s) updated, 0 unchanged");
    expect(await readFile(alphaMd, "utf8")).toBe(beforeAlpha);
    expect(await readFile(betaMd, "utf8")).toBe(beforeBeta);
  });

  test("warns and continues past a missing worktree directory when no targets are named", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    const beta = await makeProjectRepo(fx, "beta", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await captureLogs(() => attachCommand(beta, {}, fx.marrowHome, fx.toolRoot));
    await deleteWorktreeDir(path.join(alpha, ".agents"));

    const { code, errLines } = await captureLogs(() => refreshCommand([], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(errLines.join("\n")).toContain("alpha: WARN worktree directory missing");
    expect(errLines.join("\n")).toContain("marrow detach alpha");
  });

  test("errors on a deleted project directory named explicitly", async () => {
    const alpha = await makeProjectRepo(fx, "alpha", "ignored");
    await captureLogs(() => attachCommand(alpha, {}, fx.marrowHome, fx.toolRoot));
    await deleteWorktreeDir(path.join(alpha, ".agents"));

    const { code, errLines } = await captureLogs(() => refreshCommand(["alpha"], {}, fx.marrowHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("alpha: ERROR worktree directory missing");
  });
});
