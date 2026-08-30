import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli";
import { updateCommand } from "../src/commands/update";
import { git, run } from "../src/git";
import { setTestIdentity } from "./fixtures";
import { withEnv } from "./helpers";

const REAL_TOOL_ROOT = path.join(import.meta.dir, "..");
const REAL_INSTALL = path.join(REAL_TOOL_ROOT, "bin", "install");
const REPO_URL = "https://github.com/gxxcastillo/marrow.git";

function guardNotReal(candidate: string): void {
  if (path.resolve(candidate) === path.resolve(process.env.HOME ?? "")) {
    throw new Error("refusing to run a test against the real HOME");
  }
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "marrow-update-test-"));
  guardNotReal(root);
  return root;
}

describe("updateCommand (unit)", () => {
  let root: string;
  let fakeHome: string;
  let managedDir: string;

  // A stand-in for the managed checkout's own bin/install: records that it
  // ran, and exits with $FAKE_INSTALL_EXIT (default 0) so tests can drive
  // both success and propagated-failure paths without a real clone/network.
  const FAKE_INSTALL = `#!/usr/bin/env bash
set -euo pipefail
: > "$(dirname "$0")/../ran"
exit "\${FAKE_INSTALL_EXIT:-0}"
`;

  beforeEach(async () => {
    root = await makeRoot();
    fakeHome = path.join(root, "home");
    managedDir = path.join(fakeHome, ".local", "share", "marrow");
    await mkdir(path.join(managedDir, "bin"), { recursive: true });
    await writeFile(path.join(managedDir, "bin", "install"), FAKE_INSTALL);
    await chmod(path.join(managedDir, "bin", "install"), 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("refuses a local development checkout without running the installer", async () => {
    const devCheckout = path.join(root, "dev-checkout");
    await mkdir(devCheckout, { recursive: true });

    const code = await withEnv({ HOME: fakeHome }, () => updateCommand(devCheckout));

    expect(code).toBe(1);
    expect(existsSync(path.join(managedDir, "ran"))).toBe(false);
  });

  test("refusal message names the local checkout and points to git", async () => {
    const devCheckout = path.join(root, "dev-checkout");
    await mkdir(devCheckout, { recursive: true });
    const originalError = console.error;
    const errLines: string[] = [];
    console.error = (...args: unknown[]) => errLines.push(args.join(" "));
    try {
      await withEnv({ HOME: fakeHome }, () => updateCommand(devCheckout));
    } finally {
      console.error = originalError;
    }
    expect(errLines.join("\n")).toContain("local checkout");
    expect(errLines.join("\n")).toContain("update it with git");
  });

  test("invokes the managed checkout's own installer when toolRoot is the managed checkout", async () => {
    const code = await withEnv({ HOME: fakeHome }, () => updateCommand(managedDir));

    expect(code).toBe(0);
    expect(existsSync(path.join(managedDir, "ran"))).toBe(true);
  });

  test("propagates the installer's nonzero exit code", async () => {
    const code = await withEnv({ HOME: fakeHome, FAKE_INSTALL_EXIT: "7" }, () => updateCommand(managedDir));
    expect(code).toBe(7);
  });

  test("recognizes the managed checkout through a symlinked HOME", async () => {
    // toolRoot (as import.meta.dir would resolve it in production) is
    // already the physical path; HOME is a symlink pointing at its parent.
    // Physical resolution on both sides must still recognize a match.
    const realHomeTarget = path.join(root, "real-home");
    const managedViaRealPath = path.join(realHomeTarget, ".local", "share", "marrow");
    await mkdir(path.join(managedViaRealPath, "bin"), { recursive: true });
    await writeFile(path.join(managedViaRealPath, "bin", "install"), FAKE_INSTALL);
    await chmod(path.join(managedViaRealPath, "bin", "install"), 0o755);

    const symlinkedHome = path.join(root, "symlinked-home");
    await run("ln", ["-s", realHomeTarget, symlinkedHome], root);

    const code = await withEnv({ HOME: symlinkedHome }, () => updateCommand(managedViaRealPath));

    expect(code).toBe(0);
    expect(existsSync(path.join(managedViaRealPath, "ran"))).toBe(true);
  });

  test("fails clearly when HOME is unset", async () => {
    const code = await withEnv({ HOME: undefined }, () => updateCommand(managedDir));
    expect(code).toBe(1);
  });

  test("fails clearly when the managed checkout has no installer", async () => {
    await rm(path.join(managedDir, "bin", "install"));
    const code = await withEnv({ HOME: fakeHome }, () => updateCommand(managedDir));
    expect(code).toBe(1);
  });

  test("does not require a vault to exist, end to end through cli dispatch", async () => {
    const noVaultMarrowHome = path.join(root, "no-vault-marrow-home");
    const code = await withEnv({ HOME: fakeHome }, () => main(["update"], noVaultMarrowHome, managedDir));
    expect(code).toBe(0);
    expect(existsSync(path.join(managedDir, "ran"))).toBe(true);
  });
});

describe("bin/install output (real shell updater against a fixture remote)", () => {
  let root: string;
  let fakeHome: string;
  let originDir: string;
  let seedDir: string;
  let gitConfigGlobal: string;
  let shimDir: string;
  let setupSentinel: string;
  let managedClone: string;

  // Redirects the literal, hardcoded official origin URL bin/install uses to
  // a local fixture bare repo, while `git remote get-url origin` on the
  // resulting clone still reports the official URL. Two pieces, matching how
  // bin/install actually uses git: (1) a url.<fixture>.insteadOf config,
  // isolated via GIT_CONFIG_GLOBAL/GIT_CONFIG_NOSYSTEM, transparently
  // redirects clone/fetch transport to the fixture; (2) `git remote get-url`
  // is documented to *expand* insteadOf when displaying a remote's URL, which
  // would leak the fixture path right back into bin/install's own origin
  // check — a thin git shim first on PATH special-cases that one subcommand
  // to read the literal stored config instead, and passes everything else
  // straight through to the real git binary untouched.
  async function withRewrite<T>(fn: () => Promise<T>): Promise<T> {
    return withEnv(
      {
        HOME: fakeHome,
        GIT_CONFIG_GLOBAL: gitConfigGlobal,
        GIT_CONFIG_NOSYSTEM: "1",
        SETUP_SENTINEL: setupSentinel,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      },
      fn,
    );
  }

  // Stub for the *clone's own* bin/setup (bin/install always execs
  // $clone_dir/bin/setup at the end). Writes its sentinel to a fixed path
  // entirely outside the clone's working tree, via env var, so it never
  // leaves an untracked file that would trip bin/install's own dirty check
  // on a later run.
  const STUB_SETUP = `#!/usr/bin/env bash
set -euo pipefail
: > "$SETUP_SENTINEL"
`;

  beforeEach(async () => {
    root = await makeRoot();
    fakeHome = path.join(root, "home");
    await mkdir(fakeHome, { recursive: true });
    setupSentinel = path.join(root, "setup-ran");

    originDir = path.join(root, "origin.git");
    await mkdir(originDir, { recursive: true });
    await run("git", ["init", "-q", "--bare", "-b", "main"], originDir);

    seedDir = path.join(root, "seed");
    await run("git", ["clone", "-q", originDir, seedDir], root);
    await setTestIdentity(seedDir);
    await mkdir(path.join(seedDir, "bin"), { recursive: true });
    await writeFile(path.join(seedDir, "bin", "setup"), STUB_SETUP);
    await chmod(path.join(seedDir, "bin", "setup"), 0o755);
    // A real clone of the tool repo carries bin/install too — needed so
    // `marrow update`, run against the resulting clone, finds an installer.
    await writeFile(path.join(seedDir, "bin", "install"), await readFile(REAL_INSTALL, "utf8"));
    await chmod(path.join(seedDir, "bin", "install"), 0o755);
    await git(["add", "-A"], seedDir);
    await git(["commit", "-q", "-m", "v1"], seedDir);
    await git(["push", "-q", "origin", "main"], seedDir);

    gitConfigGlobal = path.join(root, "gitconfig-rewrite");
    await writeFile(gitConfigGlobal, `[url "${originDir}"]\n\tinsteadOf = ${REPO_URL}\n`);

    const realGit = Bun.which("git");
    if (!realGit) throw new Error("git not found on PATH");
    shimDir = path.join(root, "git-shim");
    await mkdir(shimDir, { recursive: true });
    await writeFile(
      path.join(shimDir, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
dir=""
rest=("$@")
if [ "\${1:-}" = "-C" ]; then
  dir="$2"
  rest=("\${@:3}")
fi
if [ "\${rest[0]:-}" = "remote" ] && [ "\${rest[1]:-}" = "get-url" ]; then
  remote_name="\${rest[2]}"
  if [ -n "$dir" ]; then
    exec "${realGit}" -C "$dir" config --get "remote.$remote_name.url"
  else
    exec "${realGit}" config --get "remote.$remote_name.url"
  fi
fi
if [ -n "$dir" ]; then
  exec "${realGit}" -C "$dir" "\${rest[@]}"
else
  exec "${realGit}" "\${rest[@]}"
fi
`,
    );
    await chmod(path.join(shimDir, "git"), 0o755);

    managedClone = path.join(fakeHome, ".local", "share", "marrow");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("fresh install clones, then a repeat install with no upstream change reports already up to date", async () => {
    const first = await withRewrite(() => run("bash", [REAL_INSTALL], root));
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`cloning ${REPO_URL}`);
    expect(existsSync(setupSentinel)).toBe(true);

    const second = await withRewrite(() => run("bash", [REAL_INSTALL], root));
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already up to date");
    expect(second.stdout).not.toContain(" -> ");
  });

  test("an advancing upstream commit reports the old -> new short-sha update", async () => {
    const first = await withRewrite(() => run("bash", [REAL_INSTALL], root));
    expect(first.code).toBe(0);
    const oldSha = (await git(["rev-parse", "--short", "HEAD"], managedClone)).stdout;

    await writeFile(path.join(seedDir, "marker.txt"), "v2\n");
    await git(["add", "-A"], seedDir);
    await git(["commit", "-q", "-m", "v2"], seedDir);
    await git(["push", "-q", "origin", "main"], seedDir);
    const newSha = (await git(["rev-parse", "--short", "HEAD"], seedDir)).stdout;

    const second = await withRewrite(() => run("bash", [REAL_INSTALL], root));
    expect(second.code).toBe(0);
    expect(second.stdout).toContain(`updated ${managedClone}: ${oldSha} -> ${newSha}`);
    expect(await readFile(path.join(managedClone, "marker.txt"), "utf8")).toBe("v2\n");
  });

  test("marrow update drives the same real bin/install path end to end", async () => {
    const first = await withRewrite(() => run("bash", [REAL_INSTALL], root));
    expect(first.code).toBe(0);

    const resolvedManaged = await realpath(managedClone);
    const code = await withRewrite(() => updateCommand(resolvedManaged));
    expect(code).toBe(0);
  });
});
