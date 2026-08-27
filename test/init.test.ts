import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { initCommand } from "../src/commands/init";
import { listProjectWorktrees, vaultDir } from "../src/git";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("init", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("creates the vault's bare repo when absent", async () => {
    // makeFixture() pre-creates the vault; remove it to exercise the "absent" path.
    await rm(vaultDir(fx.marrowHome), { recursive: true, force: true });

    const { code, outLines } = await captureLogs(() => initCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("initialized vault");

    // A freshly initialized bare vault must actually work: worktrees can be added to it.
    expect(await listProjectWorktrees(vaultDir(fx.marrowHome))).toEqual([]);
  });

  test("is idempotent: reports already-existing and does not touch it", async () => {
    await addProjectWorktree(fx, "ossa");

    const { code, outLines } = await captureLogs(() => initCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("already exists");

    const worktrees = await listProjectWorktrees(vaultDir(fx.marrowHome));
    expect(worktrees.map((w) => w.branch)).toEqual(["ossa"]);
  });
});
