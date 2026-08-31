import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { main } from "../src/cli";
import { vaultDir } from "../src/git";
import { FIXTURE_VERSION, installGhStub, makeFixture, type Fixture } from "./fixtures";
import { captureLogs, withEnv } from "./helpers";

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
    for (const name of ["init", "publish", "status", "sync", "add", "detach", "doctor", "grep", "convention", "update"]) {
      expect(usage).toContain(name);
    }
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

  test("update rejects an extra argument (it takes none)", async () => {
    const { code, outLines, errLines } = await call(["update", "extra"]);
    expect(code).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines).toEqual(["usage: marrow update"]);
  });

  test.each([
    { command: "init", args: ["extra"], expected: "usage: marrow init [--from <vault-url>] [--dry-run]" },
    { command: "publish", args: ["owner/repo", "extra"], expected: "usage: marrow publish <owner>/<repo> [--dry-run]" },
    { command: "status", args: ["extra"], expected: "usage: marrow status" },
    { command: "add", args: ["/tmp/project", "extra"], expected: "usage: marrow add <project-path> [--id <stable-id>] [--dry-run]" },
    { command: "detach", args: ["project", "extra"], expected: "usage: marrow detach <project> [--dry-run]" },
    { command: "doctor", args: ["extra"], expected: "usage: marrow doctor [--verbose]" },
    { command: "convention", args: ["extra"], expected: "usage: marrow convention" },
  ])("$command rejects extra positional arguments", async ({ command, args, expected }) => {
    const { code, outLines, errLines } = await call([command, ...args]);
    expect(code).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines).toEqual([expected]);
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

  test("per-command --help documents every option and prints the command's help paragraph", async () => {
    const { code, outLines, errLines } = await call(["add", "--help"]);
    expect(code).toBe(0);
    expect(errLines).toEqual([]);
    const help = outLines.join("\n");
    expect(help).toContain("usage: marrow add <project-path> [--id <stable-id>] [--dry-run]");
    expect(help).toContain("Options:");
    expect(help).toContain("--dry-run");
    expect(help).toContain("preview without writing anything");
    expect(help).toContain("--id");
    expect(help).toContain("stable identity for a project with no supported GitHub origin");
    expect(help).toContain("attended-only operation");
  });

  test("per-command --help documents a short option alongside its long form", async () => {
    const { outLines } = await call(["sync", "--help"]);
    const help = outLines.join("\n");
    expect(help).toContain("--message, -m");
    expect(help).toContain("commit message text");
  });

  test("a command with no documented options prints no Options section", async () => {
    const { outLines } = await call(["status", "--help"]);
    const help = outLines.join("\n");
    expect(help).toContain("show attached memory that needs attention");
    expect(help).not.toContain("Options:");
  });

  test("status and doctor help state their distinct roles", async () => {
    const statusHelp = (await call(["status", "--help"])).outLines.join("\n");
    const doctorHelp = (await call(["doctor", "--help"])).outLines.join("\n");
    expect(statusHelp).toContain("show attached memory that needs attention");
    expect(doctorHelp).toContain("verify marrow setup and safety");
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

  test("doctor prints only the summary by default; --verbose and -v both print every passing check", async () => {
    const restoreGh = await installGhStub(fx);
    try {
      const { code, outLines } = await call(["doctor"]);
      expect(code).toBe(0);
      expect(outLines).toEqual(["doctor: OK"]);

      const long = await call(["doctor", "--verbose"]);
      expect(long.code).toBe(0);
      expect(long.outLines).toContain("OK    no project worktrees attached");
      expect(long.outLines).toContain("OK    origin is PRIVATE");

      const short = await call(["doctor", "-v"]);
      expect(short.outLines).toEqual(long.outLines);
    } finally {
      restoreGh();
    }
  });
});

describe("first-run guard (no vault yet)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test.each([
    ["status", []],
    ["sync", []],
    ["add", ["/tmp/whatever"]],
    ["doctor", []],
    ["grep", ["pattern"]],
    ["detach", ["whatever"]],
    ["publish", ["owner/repo"]],
  ])("%s fails with one actionable line and exit 1 when there's no vault yet", async (command, args) => {
    const noVaultHome = path.join(fx.root, "no-vault-home");
    const { code, outLines, errLines } = await captureLogs(() => main([command, ...args], noVaultHome, fx.toolRoot));
    expect(code).toBe(1);
    expect(outLines).toEqual([]);
    expect(errLines).toEqual([`no vault at ${vaultDir(noVaultHome)} — run \`marrow init\``]);
  });

  test.each(["init", "convention"])("%s does not require a vault to already exist", async (command) => {
    const noVaultHome = path.join(fx.root, "no-vault-home");
    const { code } = await captureLogs(() => main([command, ...(command === "init" ? ["--dry-run"] : [])], noVaultHome, fx.toolRoot));
    expect(code).toBe(0);
  });

  test("update does not require a vault either — it reaches its own checkout check, not the vault gate", async () => {
    const noVaultHome = path.join(fx.root, "no-vault-home");
    const fakeHome = path.join(fx.root, "fake-home-for-update");
    const { code, errLines } = await withEnv({ HOME: fakeHome }, () =>
      captureLogs(() => main(["update"], noVaultHome, fx.toolRoot)),
    );
    // fx.toolRoot is never the managed checkout under fakeHome, so this fails
    // for update's own reason — proof the vault gate never ran.
    expect(code).toBe(1);
    expect(errLines.join("\n")).not.toContain("no vault at");
    expect(errLines.join("\n")).toContain("local checkout");
  });
});
