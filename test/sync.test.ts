import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { syncCommand } from "../src/commands/sync";
import { dirtyCount, git, lastCommit, vaultDir } from "../src/git";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";

describe("sync", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("commits dirty projects with a default timestamped message and pushes", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const code = await syncCommand([], {}, fx.marrowHome);
    expect(code).toBe(0);
    expect(await dirtyCount(agentsPath)).toBe(0);

    const commit = await lastCommit(agentsPath);
    expect(commit?.subject).toMatch(/^alpha: sync \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    const rev = await git(["rev-parse", "HEAD"], agentsPath);
    const remoteRev = await git(["rev-parse", "origin/alpha"], agentsPath);
    expect(remoteRev.stdout).toBe(rev.stdout);
  });

  test("uses a custom message prefixed with the project name", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    await syncCommand([], { message: "did a thing" }, fx.marrowHome);
    const commit = await lastCommit(agentsPath);
    expect(commit?.subject).toBe("alpha: did a thing");
  });

  test("skips clean projects", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    const before = await lastCommit(agentsPath);

    await syncCommand([], {}, fx.marrowHome);
    const after = await lastCommit(agentsPath);
    expect(after?.subject).toBe(before?.subject);
  });

  test("only syncs the named project when targets are given", async () => {
    const alphaPath = await addProjectWorktree(fx, "alpha");
    const betaPath = await addProjectWorktree(fx, "beta");
    await Bun.write(path.join(alphaPath, "note.md"), "note\n");
    await Bun.write(path.join(betaPath, "note.md"), "note\n");

    const code = await syncCommand(["alpha"], {}, fx.marrowHome);
    expect(code).toBe(0);
    expect(await dirtyCount(alphaPath)).toBe(0);
    expect(await dirtyCount(betaPath)).toBe(1);
  });

  test("returns exit 1 for an unknown project target", async () => {
    const code = await syncCommand(["nonexistent"], {}, fx.marrowHome);
    expect(code).toBe(1);
  });

  test("tolerates an unreachable origin in --auto mode and still exits 0", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");
    await git(["remote", "set-url", "origin", path.join(fx.root, "does-not-exist.git")], vaultDir(fx.marrowHome));

    const code = await syncCommand([], { auto: true }, fx.marrowHome);
    expect(code).toBe(0);
    expect(await dirtyCount(agentsPath)).toBe(0); // commit happened locally despite push failure

    const log = await readFile(path.join(fx.marrowHome, "logs", "sync.log"), "utf8");
    expect(log).toContain("push: ERROR");
  });

  test("surfaces a push failure as a non-zero exit outside --auto", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");
    await git(["remote", "set-url", "origin", path.join(fx.root, "does-not-exist.git")], vaultDir(fx.marrowHome));

    const code = await syncCommand([], {}, fx.marrowHome);
    expect(code).toBe(1);
  });

  test("skips push with a warning (not an error) when there is no origin", async () => {
    const agentsPath = await addProjectWorktree(fx, "alpha");
    await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));
    await Bun.write(path.join(agentsPath, "note.md"), "note\n");

    const code = await syncCommand([], {}, fx.marrowHome);
    expect(code).toBe(0);
    expect(await dirtyCount(agentsPath)).toBe(0);
  });
});
