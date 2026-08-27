import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { grepCommand } from "../src/commands/grep";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("grep", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("reports no project worktrees for a fresh vault", async () => {
    const { code, outLines } = await captureLogs(() => grepCommand("needle", [], fx.marrowHome));
    expect(code).toBe(0);
    expect(outLines).toEqual(["No project worktrees."]);
  });

  test("finds a pattern across project worktrees and exits 0", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await Bun.write(path.join(agentsPath, "note.md"), "findme-marker\n");

    const code = await grepCommand("findme-marker", [], fx.marrowHome);
    expect(code).toBe(0);
  });

  test("exits non-zero when nothing matches", async () => {
    await addProjectWorktree(fx, "ossa");
    const code = await grepCommand("no-such-pattern-anywhere", [], fx.marrowHome);
    expect(code).not.toBe(0);
  });
});
