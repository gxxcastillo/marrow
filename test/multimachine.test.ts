import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { addCommand } from "../src/commands/add";
import { doctorCommand } from "../src/commands/doctor";
import { syncCommand } from "../src/commands/sync";
import { git, listProjectWorktrees, vaultDir } from "../src/git";
import { makeFixture, makeProjectRepo, setTestIdentity, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

const BRANCH = "alpha";

async function secondProject(fx: Fixture, name: string): Promise<string> {
  const dir = path.join(fx.root, "machine-b", "elsewhere", name);
  await mkdir(dir, { recursive: true });
  await git(["init", "-q", "-b", "main"], dir);
  await setTestIdentity(dir);
  await git(["remote", "add", "origin", `https://github.com/test/${name}.git`], dir);
  await Bun.write(path.join(dir, ".gitignore"), ".agents/\n");
  await git(["add", ".gitignore"], dir);
  await git(["commit", "-q", "-m", "init"], dir);
  return dir;
}

async function cloneVaultForSecondMachine(fx: Fixture): Promise<string> {
  const machineBHome = path.join(fx.root, "machine-b", "marrow-home");
  await mkdir(machineBHome, { recursive: true });
  const clone = await git(["clone", "--bare", fx.bareOrigin, vaultDir(machineBHome)], machineBHome);
  expect(clone.code).toBe(0);
  // A clone doesn't inherit the source repo's local user.name/user.email —
  // set them here too, for the same reason makeFixture sets them on the
  // first machine's vault (worktrees created off this bare repo need an
  // identity that doesn't depend on the running machine's global git config).
  await setTestIdentity(vaultDir(machineBHome));
  await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], vaultDir(machineBHome));
  const fetch = await git(["fetch", "--prune", "origin"], vaultDir(machineBHome));
  expect(fetch.code).toBe(0);
  return machineBHome;
}

async function expectCommandSuccess(fn: () => Promise<number>): Promise<void> {
  expect((await captureLogs(fn)).code).toBe(0);
}

describe("multi-machine attachment", () => {
  let fx: Fixture;
  beforeEach(async () => { fx = await makeFixture(); });
  afterEach(async () => { await fx.cleanup(); });

  test("add attaches an existing branch at a different checkout path", async () => {
    const machineA = await makeProjectRepo(fx, "alpha", "ignored");
    await expectCommandSuccess(() => addCommand(machineA, {}, fx.marrowHome, fx.toolRoot));

    const machineBHome = await cloneVaultForSecondMachine(fx);
    const machineB = await secondProject(fx, "alpha");
    const { code, outLines } = await captureLogs(() => addCommand(machineB, {}, machineBHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain(`attached ${BRANCH}`);
    expect(await Bun.file(path.join(machineB, ".agents", "current-state.md")).text()).toBe(
      "As of 2026-01-01 (alpha @deadbee)\n\n# Current state — alpha\n",
    );
    expect((await listProjectWorktrees(vaultDir(machineBHome))).map((wt) => wt.branch)).toEqual([BRANCH]);
  });

  test("doctor permits remote branches that this machine has not attached", async () => {
    const machineA = await makeProjectRepo(fx, "alpha", "ignored");
    await expectCommandSuccess(() => addCommand(machineA, {}, fx.marrowHome, fx.toolRoot));
    const machineBHome = await cloneVaultForSecondMachine(fx);
    const { code, outLines } = await captureLogs(() => doctorCommand(machineBHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.some((line) => line.includes("has no worktree"))).toBe(false);
  });

  test("sync pushes cleanly from a second machine after another machine advances a branch it hasn't attached", async () => {
    const machineA = await makeProjectRepo(fx, "alpha", "ignored");
    await expectCommandSuccess(() => addCommand(machineA, {}, fx.marrowHome, fx.toolRoot));
    const betaOnA = await makeProjectRepo(fx, "beta", "ignored");
    await expectCommandSuccess(() => addCommand(betaOnA, {}, fx.marrowHome, fx.toolRoot));

    const machineBHome = await cloneVaultForSecondMachine(fx);
    const machineBBeta = await secondProject(fx, "beta");
    await expectCommandSuccess(() => addCommand(machineBBeta, {}, machineBHome, fx.toolRoot));

    // Machine A advances alpha, a branch machine B carries a stale local head
    // for (the full-mirror `clone --bare`) but has never attached a worktree to.
    await Bun.write(path.join(machineA, ".agents", "advance.md"), "advanced\n");
    await expectCommandSuccess(() => syncCommand([], {}, fx.marrowHome));

    // Machine B commits its own beta change and syncs.
    await Bun.write(path.join(machineBBeta, ".agents", "note.md"), "note\n");
    const { code, errLines } = await captureLogs(() => syncCommand([], {}, machineBHome));

    expect(code).toBe(0);
    expect(errLines).toEqual([]);
    const remoteBeta = await git(["rev-parse", "origin/beta"], vaultDir(machineBHome));
    const localBeta = await git(["rev-parse", "refs/heads/beta"], vaultDir(machineBHome));
    expect(remoteBeta.stdout).toBe(localBeta.stdout);
  });
});
