import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachCommand } from "../src/commands/attach";
import { doctorCommand } from "../src/commands/doctor";
import { git, vaultDir } from "../src/git";
import {
  addProjectWorktree,
  addUnattachedBranch,
  deleteWorktreeDir,
  installGhStub,
  makeFixture,
  makeProjectRepo,
  setTestIdentity,
  type Fixture,
} from "./fixtures";
import { captureLogs, currentAgentsBlockVersion } from "./helpers";

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
      attachCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
    );
    expect(adoptCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(outLines).toContain("OK    marrow .agents note current for 1 project parent");
    expect(outLines).toContain("OK    current-state.md stamps well formed for 1 project worktree");
    expect(code).toBe(0);
  });

  test("prints only the summary line by default for a clean vault", async () => {
    const restoreGh = await installGhStub(fx);
    try {
      const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
      const { code: adoptCode } = await captureLogs(() =>
        attachCommand(projectDir, {}, fx.marrowHome, fx.toolRoot),
      );
      expect(adoptCode).toBe(0);

      const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
      expect(outLines).toEqual(["doctor: OK"]);
      expect(code).toBe(0);
    } finally {
      restoreGh();
    }
  });

  test("warns when required current-state.md is missing", async () => {
    await addProjectWorktree(fx, "alpha");

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));

    expect(code).toBe(0);
    const line = outLines.find((item) => item.includes("missing required .agents/current-state.md"));
    expect(line).toStartWith("WARN");
    expect(line).toContain("alpha: missing required .agents/current-state.md");
    expect(line).not.toContain(" at ");
    expect(line).toContain("marrow sync alpha");
  });

  test("warns when the current-state.md stamp is malformed", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await writeFile(path.join(agentsPath, "current-state.md"), "# Current state\n");

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));

    expect(code).toBe(0);
    const line = outLines.find((item) => item.includes("malformed As of stamp"));
    expect(line).toStartWith("WARN");
    expect(line).toContain("alpha: malformed As of stamp in .agents/current-state.md");
    expect(line).toContain("marrow sync alpha");
  });

  test("warns when a project's AGENTS.md has no marrow .agents note", async () => {
    const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
    const { code: adoptCode } = await captureLogs(() => attachCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(adoptCode).toBe(0);
    await writeFile(path.join(projectDir, "AGENTS.md"), "# alpha\n");

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    const line = outLines.find((l) => l.includes("no marrow .agents note"));
    expect(line).toBeDefined();
    expect(line).toStartWith("WARN");
    expect(line).toContain("alpha");
    expect(line).not.toContain(" at ");
    expect(line).toContain("marrow attach ");
  });

  test("warns when a project's marrow .agents note is stale", async () => {
    const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
    const { code: adoptCode } = await captureLogs(() => attachCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(adoptCode).toBe(0);
    const agentsMdPath = path.join(projectDir, "AGENTS.md");
    const stale = (await readFile(agentsMdPath, "utf8")).replace(/<p align="right">v\d+<\/p>/, '<p align="right">v0</p>');
    await writeFile(agentsMdPath, stale);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    const line = outLines.find((l) => l.includes("stale marrow .agents note"));
    expect(line).toBeDefined();
    expect(line).toStartWith("WARN");
    expect(line).toContain(`v0 -> v${await currentAgentsBlockVersion(fx.toolRoot)}`);
    expect(line).not.toContain(" at ");
    expect(line).toContain("marrow attach ");
  });

  test("warns with 'not verbatim' when a project's note wording drifted at the current version", async () => {
    const projectDir = await makeProjectRepo(fx, "alpha", "ignored");
    const { code: adoptCode } = await captureLogs(() => attachCommand(projectDir, {}, fx.marrowHome, fx.toolRoot));
    expect(adoptCode).toBe(0);
    const agentsMdPath = path.join(projectDir, "AGENTS.md");
    const original = await readFile(agentsMdPath, "utf8");
    const drifted = original
      .split("\n")
      .filter((line) => line.trim() !== ">")
      .join("\n");
    expect(drifted).not.toBe(original);
    await writeFile(agentsMdPath, drifted);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    const line = outLines.find((l) => l.includes("stale marrow .agents note"));
    expect(line).toBeDefined();
    const currentVersion = await currentAgentsBlockVersion(fx.toolRoot);
    expect(line).toContain(`v${currentVersion}, not verbatim`);
    expect(line).not.toContain(`v${currentVersion} -> v${currentVersion}`);
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
      const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));

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

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));

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

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("not named .agents"))).toBe(true);
  });

  test("does not fail a project whose parent directory is not a git repo", async () => {
    const projectDir = path.join(fx.root, "elsewhere", "plaindir");
    const { code: addCode } = await captureLogs(() =>
      attachCommand(projectDir, { id: "local/plaindir" }, fx.marrowHome, fx.toolRoot),
    );
    expect(addCode).toBe(0);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(code).toBe(0);
  });

  test("fails when a project's parent repo does not ignore .agents", async () => {
    const projectDir = path.join(fx.projectsRoot, "leaky");
    await mkdir(projectDir, { recursive: true });
    await git(["init", "-q", "-b", "main"], projectDir);
    await setTestIdentity(projectDir);
    await Bun.write(path.join(projectDir, "package.json"), "{}\n");
    await git(["add", "package.json"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);

    const agentsPath = path.join(projectDir, ".agents");
    await git(["worktree", "add", "--orphan", "-b", "leaky", agentsPath], vaultDir(fx.marrowHome));
    await git(["commit", "--allow-empty", "-q", "-m", "seed"], agentsPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(outLines.some((l) => l.startsWith("FAIL") && l.includes("does not ignore"))).toBe(true);
  });

  test("passes origin reachability for a configured origin nothing has been pushed to yet", async () => {
    // fx's vault.git origin (fx.bareOrigin) is a real, reachable bare repo that
    // makeFixture never pushes to — exactly a freshly created GitHub repo before
    // the first `marrow publish`. `git ls-remote --exit-code` used to treat its
    // zero refs as "unreachable"; plain `ls-remote` correctly reports it as fine.
    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));
    expect(code).toBe(0);
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(outLines).toContain("OK    origin is reachable");
  });

  test("warns when there is no origin remote", async () => {
    await addProjectWorktree(fx, "alpha");
    await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.some((l) => l.startsWith("WARN") && l.includes("no 'origin' remote"))).toBe(true);
  });

  test("aggregates missing origin refs with a remediation", async () => {
    const alphaAgents = await addProjectWorktree(fx, "alpha");
    const betaAgents = await addProjectWorktree(fx, "beta");
    await git(["push", "-q", "origin", "HEAD:refs/heads/landing"], alphaAgents);
    await git(["push", "-q", "origin", ":alpha"], alphaAgents);
    await git(["push", "-q", "origin", ":beta"], betaAgents);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    const warnings = outLines.filter((l) => l.startsWith("WARN") && l.includes("missing origin refs"));

    expect(code).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 branches missing origin refs");
    expect(warnings[0]).toContain("run `marrow sync`");
    expect(warnings[0]).toContain("alpha");
    expect(warnings[0]).toContain("beta");
    expect(outLines.some((l) => l.includes("no upstream"))).toBe(false);
  });

  test("aggregates stale backup tarballs into one warning line", async () => {
    const backupsDir = path.join(fx.marrowHome, "backups");
    await mkdir(backupsDir, { recursive: true });
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000;
    for (const name of ["old-project-2020-01-01.tar.gz", "another-project-2020-01-02.tar.gz"]) {
      const tarballPath = path.join(backupsDir, name);
      await Bun.write(tarballPath, "fake");
      await utimes(tarballPath, old, old);
    }
    // A recent one must not count toward the aggregate.
    await Bun.write(path.join(backupsDir, "fresh-project-today.tar.gz"), "fake");

    const { outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot));
    const warnings = outLines.filter((l) => l.startsWith("WARN") && l.includes("older than 30 days"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 backups older than 30 days");
    expect(warnings[0]).toContain(backupsDir);
  });

  test("reports unattached vault branches as OK, not as a warning", async () => {
    await addProjectWorktree(fx, "alpha");
    await addUnattachedBranch(fx, "beta");

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));
    const line = outLines.find((l) => l.includes("not attached on this machine"));
    expect(line).toBeDefined();
    // Attaching a subset is a deliberate choice, not drift: it is reported,
    // but must never produce a WARN/FAIL line or affect the exit code.
    expect(line).toStartWith("OK");
    expect(line).toContain("1 project branch");
    expect(line).toContain("beta");
    expect(outLines.some((l) => /^(WARN|FAIL)/.test(l) && l.includes("not attached"))).toBe(false);
    expect(code).toBe(0);
  });

  test("warns about a registered worktree whose directory is missing, without crashing on the rest", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    await addProjectWorktree(fx, "beta");
    await deleteWorktreeDir(alphaPath);

    const { code, outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));
    expect(code).toBe(0);
    expect(outLines.some((l) => l.startsWith("FAIL"))).toBe(false);
    const line = outLines.find((l) => l.includes("registered worktree missing"));
    expect(line).toBeDefined();
    expect(line).toStartWith("WARN");
    expect(line).toContain("marrow detach alpha");
    expect(outLines).toContain("OK    .agents ignored for 1 project parent");
  });

  test("reports git worktree --orphan support before vault findings", async () => {
    await addProjectWorktree(fx, "alpha");

    const { outLines } = await captureLogs(() => doctorCommand(fx.marrowHome, fx.toolRoot, { verbose: true }));
    const line = outLines.find((l) => l.includes("worktree add --orphan"));
    expect(line).toBeDefined();
    expect(line).toStartWith("OK");
    // It gates `attach` and `publish` entirely, so it must precede vault checks.
    expect(outLines.indexOf(line!)).toBe(0);
  });
});
