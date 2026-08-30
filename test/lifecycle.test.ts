// Full install -> update -> uninstall lifecycle against the real shell scripts
// (bin/install, bin/setup via install, bin/uninstall) and the real `marrow`
// binary, run against a fixture remote and a fixture $HOME/$MARROW_HOME —
// never the real machine's install or vault. See test/update.test.ts for the
// git-shim + insteadOf rewrite technique this reuses.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, run } from "../src/git";
import { setTestIdentity } from "./fixtures";
import { withEnv } from "./helpers";

const REAL_TOOL_ROOT = path.join(import.meta.dir, "..");
const REPO_URL = "https://github.com/gxxcastillo/marrow.git";
const BIN_INSTALL = path.join(REAL_TOOL_ROOT, "bin", "install");
const BIN_UNINSTALL = path.join(REAL_TOOL_ROOT, "bin", "uninstall");

function guardNotReal(candidate: string): void {
  if (path.resolve(candidate) === path.resolve(process.env.HOME ?? "")) {
    throw new Error("refusing to run a test against the real HOME");
  }
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "marrow-lifecycle-test-"));
  guardNotReal(root);
  return root;
}

function gitShimScript(realGit: string): string {
  return `#!/usr/bin/env bash
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
`;
}

describe("install -> update -> uninstall lifecycle", () => {
  let root: string;
  let fakeHome: string;
  let marrowHome: string;
  let originDir: string;
  let seedDir: string;
  let gitConfigGlobal: string;
  let shimDir: string;

  async function withFixtureEnv<T>(home: string, extra: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    return withEnv(
      {
        HOME: home,
        MARROW_HOME: marrowHome,
        GIT_CONFIG_GLOBAL: gitConfigGlobal,
        GIT_CONFIG_NOSYSTEM: "1",
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        ...extra,
      },
      fn,
    );
  }

  // A full, runnable copy of the tool's current source — needed because this
  // suite spawns the real bin/marrow as a subprocess, not through in-process
  // command functions. version distinguishes fixture generations from the
  // real package.json's value and from each other (v1 vs v2).
  async function seedToolContent(dir: string, version: string): Promise<void> {
    await rm(path.join(dir, "src"), { recursive: true, force: true });
    await cp(path.join(REAL_TOOL_ROOT, "src"), path.join(dir, "src"), { recursive: true });
    await mkdir(path.join(dir, "bin"), { recursive: true });
    for (const name of ["marrow", "install", "setup", "uninstall"]) {
      await cp(path.join(REAL_TOOL_ROOT, "bin", name), path.join(dir, "bin", name));
      await chmod(path.join(dir, "bin", name), 0o755);
    }
    await rm(path.join(dir, "templates"), { recursive: true, force: true });
    await cp(path.join(REAL_TOOL_ROOT, "templates"), path.join(dir, "templates"), { recursive: true });
    await cp(path.join(REAL_TOOL_ROOT, "CONVENTION.md"), path.join(dir, "CONVENTION.md"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "marrow", version, private: true, type: "module" }, null, 2));
  }

  beforeEach(async () => {
    root = await makeRoot();
    fakeHome = path.join(root, "home");
    await mkdir(fakeHome, { recursive: true });
    marrowHome = path.join(root, "marrow-home");

    originDir = path.join(root, "origin.git");
    await mkdir(originDir, { recursive: true });
    await run("git", ["init", "-q", "--bare", "-b", "main"], originDir);

    seedDir = path.join(root, "seed");
    await run("git", ["clone", "-q", originDir, seedDir], root);
    await setTestIdentity(seedDir);
    await seedToolContent(seedDir, "9.9.9-fixture-v1");
    await git(["add", "-A"], seedDir);
    await git(["commit", "-q", "-m", "v1"], seedDir);
    await git(["push", "-q", "origin", "main"], seedDir);

    gitConfigGlobal = path.join(root, "gitconfig-rewrite");
    await writeFile(gitConfigGlobal, `[url "${originDir}"]\n\tinsteadOf = ${REPO_URL}\n`);

    const realGit = Bun.which("git");
    if (!realGit) throw new Error("git not found on PATH");
    shimDir = path.join(root, "git-shim");
    await mkdir(shimDir, { recursive: true });
    await writeFile(path.join(shimDir, "git"), gitShimScript(realGit));
    await chmod(path.join(shimDir, "git"), 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("fresh install, no-op reinstall, advance + update, dirty refusal, uninstall preserving the vault", async () => {
    const managedClone = path.join(fakeHome, ".local", "share", "marrow");
    const binMarrow = path.join(fakeHome, ".local", "bin", "marrow");

    // 1. Fresh no-checkout install into a temporary HOME.
    const first = await withFixtureEnv(fakeHome, {}, () => run("bash", [BIN_INSTALL], root));
    expect(first.code).toBe(0);
    expect(existsSync(managedClone)).toBe(true);
    expect(existsSync(binMarrow)).toBe(true);
    expect(existsSync(path.join(marrowHome, "vault.git"))).toBe(true);

    const version1 = await withFixtureEnv(fakeHome, {}, () => run(binMarrow, ["--version"], root));
    expect(version1.stdout).toBe("marrow 9.9.9-fixture-v1");

    // Sentinel proving uninstall preserves real project data under MARROW_HOME.
    const sentinel = path.join(marrowHome, "sentinel.txt");
    await writeFile(sentinel, "keep me\n");

    // 2. A second install with no upstream change.
    const second = await withFixtureEnv(fakeHome, {}, () => run("bash", [BIN_INSTALL], root));
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already up to date");

    // 3. Advance the fixture remote, then `marrow update`.
    await seedToolContent(seedDir, "9.9.9-fixture-v2");
    await git(["add", "-A"], seedDir);
    await git(["commit", "-q", "-m", "v2"], seedDir);
    await git(["push", "-q", "origin", "main"], seedDir);

    const updated = await withFixtureEnv(fakeHome, {}, () => run(binMarrow, ["update"], root));
    expect(updated.code).toBe(0);
    expect(updated.stdout).toContain("updated");

    // 4. The installed command reports the new fixture version.
    const version2 = await withFixtureEnv(fakeHome, {}, () => run(binMarrow, ["--version"], root));
    expect(version2.stdout).toBe("marrow 9.9.9-fixture-v2");

    // 5. update refuses local changes in the managed clone.
    await writeFile(path.join(managedClone, "dirty.txt"), "uncommitted\n");
    const dirtyUpdate = await withFixtureEnv(fakeHome, {}, () => run(binMarrow, ["update"], root));
    expect(dirtyUpdate.code).toBe(1);
    expect(dirtyUpdate.stderr).toContain("local changes");
    await rm(path.join(managedClone, "dirty.txt"));

    // 6. Uninstall.
    const uninstalled = await withFixtureEnv(fakeHome, {}, () => run("bash", [BIN_UNINSTALL], root));
    expect(uninstalled.code).toBe(0);

    // 7. The managed clone and symlink are removed.
    expect(existsSync(managedClone)).toBe(false);
    expect(existsSync(binMarrow)).toBe(false);

    // 8. A sentinel under temporary MARROW_HOME survives uninstall.
    expect(existsSync(sentinel)).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("keep me\n");
    // uninstall never removed anything outside .local/{bin,share}/marrow.
    expect(existsSync(fakeHome)).toBe(true);
  });

  test("validates physical paths when the temporary home is reached through a symlink", async () => {
    const realHomeTarget = path.join(root, "real-home");
    await mkdir(realHomeTarget, { recursive: true });
    const symlinkedHome = path.join(root, "symlinked-home");
    await run("ln", ["-s", realHomeTarget, symlinkedHome], root);

    const managedViaRealPath = path.join(realHomeTarget, ".local", "share", "marrow");
    const binMarrowViaRealPath = path.join(realHomeTarget, ".local", "bin", "marrow");

    const installed = await withFixtureEnv(symlinkedHome, {}, () => run("bash", [BIN_INSTALL], root));
    expect(installed.code).toBe(0);
    // bin/setup resolves its own location with `cd -P` before writing the
    // symlink target, so both the clone and the marrow symlink land at the
    // physically resolved path, not the symlinked-HOME-based one.
    expect(existsSync(managedViaRealPath)).toBe(true);
    expect(existsSync(binMarrowViaRealPath)).toBe(true);

    const version = await withFixtureEnv(symlinkedHome, {}, () => run(binMarrowViaRealPath, ["--version"], root));
    expect(version.stdout).toBe("marrow 9.9.9-fixture-v1");

    const uninstalled = await withFixtureEnv(symlinkedHome, {}, () => run("bash", [BIN_UNINSTALL], root));
    expect(uninstalled.code).toBe(0);
    expect(existsSync(managedViaRealPath)).toBe(false);
    expect(existsSync(binMarrowViaRealPath)).toBe(false);
    // Nothing outside the fixture root was touched — the root itself, and
    // the (now-empty-of-marrow) real home, are both still present.
    expect(existsSync(root)).toBe(true);
    expect(existsSync(realHomeTarget)).toBe(true);
  });
});
