import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { main } from "../src/cli";
import { FIXTURE_VERSION, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("cli dispatch", () => {
  let fx: Fixture;

  const call = (argv: string[]) => captureLogs(() => main(argv, fx.marrowHome, fx.toolRoot));

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test.each([["-h"], ["--help"]])("%s prints usage to stdout and exits 0", async (flag) => {
    const { code, outLines, errLines } = await call([flag]);
    expect(code).toBe(0);
    expect(errLines).toEqual([]);
    const usage = outLines.join("\n");
    for (const name of ["init", "publish", "status", "sync", "add", "doctor", "grep", "convention"]) {
      expect(usage).toContain(name);
    }
  });

  test("usage lines come from the command table", async () => {
    const { outLines } = await call(["--help"]);
    expect(outLines.join("\n")).toContain("init");
    expect(outLines.join("\n")).toContain("sync [project...] [-m <msg>] [--auto]");
  });

  test.each(["create", "connect"])("%s is not a remote lifecycle command", async (command) => {
    const { code, errLines } = await call([command, "file:///tmp/vault.git"]);
    expect(code).toBe(2);
    expect(errLines.join("\n")).toContain("usage: marrow <command> [args]");
  });

  test.each([["-v"], ["--version"]])("%s prints the tool version and exits 0", async (flag) => {
    const { code, outLines, errLines } = await call([flag]);
    expect(code).toBe(0);
    expect(errLines).toEqual([]);
    expect(outLines).toEqual([`marrow ${FIXTURE_VERSION}`]);
  });

  test("no command prints usage to stderr and exits 2", async () => {
    const { code, outLines, errLines } = await call([]);
    expect(code).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines.join("\n")).toContain("usage: marrow <command> [args]");
  });

  test("unknown command prints usage to stderr and exits 2", async () => {
    const { code, outLines, errLines } = await call(["bogus"]);
    expect(code).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines.join("\n")).toContain("usage: marrow <command> [args]");
  });

  test("unknown option exits 2 instead of throwing", async () => {
    const { code, errLines } = await call(["sync", "--bogus"]);
    expect(code).toBe(2);
    expect(errLines.join("\n")).toContain("--bogus");
    expect(errLines.join("\n")).toContain("usage: marrow sync");
  });

  test("an option missing its value exits 2 instead of throwing", async () => {
    const { code, errLines } = await call(["sync", "-m"]);
    expect(code).toBe(2);
    expect(errLines.join("\n")).toContain("usage: marrow sync");
  });

  test.each([
    ["publish", "usage: marrow publish <owner>/<repo> [--dry-run]"],
    ["add", "usage: marrow add <project-path> [--id <stable-id>] [--dry-run]"],
    ["grep", "usage: marrow grep <pattern> [rg-args...]"],
  ])("%s without its required argument exits 2", async (command, expected) => {
    const { code, outLines, errLines } = await call([command]);
    expect(code).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines).toEqual([expected]);
  });

  test("per-command --help prints to stdout and exits 0", async () => {
    const { code, outLines, errLines } = await call(["add", "--help"]);
    expect(code).toBe(0);
    expect(errLines).toEqual([]);
    expect(outLines.join("\n")).toContain("usage: marrow add <project-path> [--id <stable-id>] [--dry-run]");
  });

  test("grep does not intercept flags meant for rg", async () => {
    // Raw command: --help reaches grepCommand as an rg arg, not marrow's help.
    // The empty vault short-circuits before rg is spawned.
    const { code, outLines } = await call(["grep", "TODO", "--help"]);
    expect(code).toBe(0);
    expect(outLines).toEqual(["No project worktrees."]);
  });

  test("dispatch reaches the command implementation", async () => {
    const { code, outLines } = await call(["status"]);
    expect(code).toBe(0);
    expect(outLines).toEqual(["No projects attached on this machine. Run `marrow add <project-path>` to get started."]);
  });
});
