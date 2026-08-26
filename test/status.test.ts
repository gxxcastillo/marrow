import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { statusCommand } from "../src/commands/status";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";

async function captureLogs(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    const code = await fn();
    return { code, lines };
  } finally {
    console.log = original;
  }
}

describe("status", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("reports no project worktrees for a fresh vault", async () => {
    const { code, lines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(lines).toEqual(["No project worktrees."]);
  });

  test("lists clean pushed projects and summarizes", async () => {
    await addProjectWorktree(fx, "ossa");
    const { code, lines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(code).toBe(0);
    expect(lines[0]).toContain("ossa");
    expect(lines[0]).toContain("clean");
    expect(lines[0]).toContain("+0/-0");
    expect(lines.at(-1)).toBe("1 project(s), 0 dirty");
  });

  test("flags dirty projects and counts them in the summary", async () => {
    const agentsPath = await addProjectWorktree(fx, "ossa");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const { lines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(lines[0]).toContain("dirty (1)");
    expect(lines.at(-1)).toBe("1 project(s), 1 dirty");
  });

  test("lists multiple projects, one per line", async () => {
    await addProjectWorktree(fx, "ossa");
    await addProjectWorktree(fx, "sobremesa");

    const { lines } = await captureLogs(() => statusCommand(fx.marrowHome));
    expect(lines).toHaveLength(3); // 2 projects + summary
    expect(lines.at(-1)).toBe("2 project(s), 0 dirty");
  });
});
