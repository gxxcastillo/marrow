import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { addCommand } from "../src/commands/add";
import { doctorCommand } from "../src/commands/doctor";
import { initCommand } from "../src/commands/init";
import { git, listProjectWorktrees, vaultDir } from "../src/git";
import { makeFixture, makeProjectRepo, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

const BRANCH = "projects/github.com/test/ossa";

async function secondProject(fx: Fixture, name: string): Promise<string> {
  const dir = path.join(fx.root, "machine-b", "elsewhere", name);
  await mkdir(dir, { recursive: true });
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "marrow test"], dir);
  await git(["remote", "add", "origin", `https://github.com/test/${name}.git`], dir);
  await Bun.write(path.join(dir, ".gitignore"), ".agents/\n");
  await git(["add", ".gitignore"], dir);
  await git(["commit", "-q", "-m", "init"], dir);
  return dir;
}

describe("multi-machine lifecycle", () => {
  let fx: Fixture;
  beforeEach(async () => { fx = await makeFixture(); });
  afterEach(async () => { await fx.cleanup(); });

  test("init --from and add attach an existing branch at a different checkout path", async () => {
    const machineA = await makeProjectRepo(fx, "ossa", "ignored");
    expect(await addCommand(machineA, {}, fx.marrowHome, fx.toolRoot)).toBe(0);

    const machineBHome = path.join(fx.root, "machine-b", "marrow-home");
    expect(await initCommand(machineBHome, fx.bareOrigin)).toBe(0);
    const machineB = await secondProject(fx, "ossa");
    const { code, outLines } = await captureLogs(() => addCommand(machineB, {}, machineBHome, fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain(`attached ${BRANCH}`);
    expect(await Bun.file(path.join(machineB, ".agents", "current-state.md")).text()).toBe("state\n");
    expect((await listProjectWorktrees(vaultDir(machineBHome))).map((wt) => wt.branch)).toEqual([BRANCH]);
  });

  test("doctor permits remote branches that this machine has not attached", async () => {
    const machineA = await makeProjectRepo(fx, "ossa", "ignored");
    expect(await addCommand(machineA, {}, fx.marrowHome, fx.toolRoot)).toBe(0);
    const machineBHome = path.join(fx.root, "machine-b", "marrow-home");
    await initCommand(machineBHome, fx.bareOrigin);
    const { code, outLines } = await captureLogs(() => doctorCommand(machineBHome));
    expect(code).toBe(0);
    expect(outLines.some((line) => line.includes("has no worktree"))).toBe(false);
  });

});
