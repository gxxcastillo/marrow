import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { initCommand } from "../src/commands/init";
import { publishCommand } from "../src/commands/publish";
import { git, vaultDir } from "../src/git";
import { fetchedOriginBranches, originUrl } from "../src/remote";
import { addProjectWorktree, makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

async function removeVaultOrigin(fx: Fixture): Promise<void> {
  await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));
}

async function seedRemoteBranch(fx: Fixture, branch = "projects/github.com/test/remote"): Promise<void> {
  const repo = path.join(fx.root, `seed-${branch.replaceAll("/", "-")}`);
  await mkdir(repo, { recursive: true });
  await git(["init", "-q", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "marrow test"], repo);
  await Bun.write(path.join(repo, "README.md"), "seed\n");
  await git(["add", "README.md"], repo);
  await git(["commit", "-q", "-m", "seed"], repo);
  await git(["remote", "add", "origin", fx.bareOrigin], repo);
  await git(["push", "-q", "origin", `HEAD:refs/heads/${branch}`], repo);
}

async function installGhStub(fx: Fixture, opts: { url?: string; visibility?: string; createExit?: string } = {}): Promise<() => void> {
  const dir = path.join(fx.root, `gh-stub-${Math.random().toString(16).slice(2)}`);
  const log = path.join(dir, "gh.log");
  await mkdir(dir, { recursive: true });
  await Bun.write(path.join(dir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GH_STUB_LOG"
if [ "$1 $2" = "repo create" ]; then
  exit "$GH_STUB_CREATE_EXIT"
fi
if [ "$1 $2" = "repo view" ]; then
  case "$*" in
    *sshUrl*) printf '%s\\n' "$GH_STUB_URL" ;;
    *visibility*) printf '%s\\n' "$GH_STUB_VISIBILITY" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
`);
  await chmod(path.join(dir, "gh"), 0o755);
  const oldPath = process.env.PATH;
  const oldLog = process.env.GH_STUB_LOG;
  const oldUrl = process.env.GH_STUB_URL;
  const oldVisibility = process.env.GH_STUB_VISIBILITY;
  const oldCreateExit = process.env.GH_STUB_CREATE_EXIT;
  process.env.PATH = `${dir}:${oldPath ?? ""}`;
  process.env.GH_STUB_LOG = log;
  process.env.GH_STUB_URL = opts.url ?? fx.bareOrigin;
  process.env.GH_STUB_VISIBILITY = opts.visibility ?? "PRIVATE";
  process.env.GH_STUB_CREATE_EXIT = opts.createExit ?? "0";
  return () => {
    process.env.PATH = oldPath;
    process.env.GH_STUB_LOG = oldLog;
    process.env.GH_STUB_URL = oldUrl;
    process.env.GH_STUB_VISIBILITY = oldVisibility;
    process.env.GH_STUB_CREATE_EXIT = oldCreateExit;
  };
}

async function hideGhButKeepGit(fx: Fixture): Promise<() => void> {
  const gitPath = Bun.which("git");
  if (!gitPath) throw new Error("git missing from PATH");
  const dir = path.join(fx.root, `path-without-gh-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await symlink(gitPath, path.join(dir, "git"));
  const oldPath = process.env.PATH;
  process.env.PATH = dir;
  return () => { process.env.PATH = oldPath; };
}

describe("remote lifecycle", () => {
  let fx: Fixture;
  let restoreEnv: () => void;

  beforeEach(async () => {
    fx = await makeFixture();
    restoreEnv = () => {};
  });

  afterEach(async () => {
    restoreEnv();
    await fx.cleanup();
  });

  test("publish dry-run lists the intended private repo and branches without adding origin", async () => {
    await addProjectWorktree(fx, "ossa");
    await removeVaultOrigin(fx);

    const { code, outLines } = await captureLogs(() =>
      publishCommand("gxxcastillo/marrow-vault", { dryRun: true }, fx.marrowHome),
    );

    expect(code).toBe(0);
    expect(outLines).toContain("dry run: would publish vault to private GitHub repository gxxcastillo/marrow-vault");
    expect(outLines).toContain("origin: git@github.com:gxxcastillo/marrow-vault.git");
    expect(outLines).toContain("branches: 1");
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(null);
  });

  test("publish pushes every local branch to a private GitHub remote", async () => {
    restoreEnv = await installGhStub(fx);
    await addProjectWorktree(fx, "ossa");
    await removeVaultOrigin(fx);

    const { code, outLines } = await captureLogs(() =>
      publishCommand("gxxcastillo/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(0);
    expect(outLines[0]).toBe("publishing vault to private GitHub repository gxxcastillo/marrow-vault...");
    expect(outLines).toContain(`origin: ${fx.bareOrigin}`);
    expect(outLines).toContain("pushed branches: 1");
    expect(outLines).toContain("origin is PRIVATE");
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(fx.bareOrigin);
    expect((await git(["rev-parse", "origin/ossa"], vaultDir(fx.marrowHome))).code).toBe(0);
  });

  test("publish refuses an existing origin", async () => {
    const { code, errLines } = await captureLogs(() =>
      publishCommand("gxxcastillo/marrow-vault", {}, fx.marrowHome),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("vault already uses origin");
  });

  test("publish requires gh in live mode", async () => {
    restoreEnv = await hideGhButKeepGit(fx);
    await removeVaultOrigin(fx);

    const { code, errLines } = await captureLogs(() =>
      publishCommand("gxxcastillo/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("gh is required");
  });

  test("publish reports partial state when privacy verification fails", async () => {
    restoreEnv = await installGhStub(fx, { visibility: "PUBLIC" });
    await addProjectWorktree(fx, "ossa");
    await removeVaultOrigin(fx);

    const { code, errLines } = await captureLogs(() =>
      publishCommand("gxxcastillo/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("origin visibility is PUBLIC, expected PRIVATE");
    expect(errLines.join("\n")).toContain("created repository: gxxcastillo/marrow-vault");
    expect(errLines.join("\n")).toContain("safe next command:");
  });

  test("init --from dry-run validates the URL without creating the local vault", async () => {
    await seedRemoteBranch(fx);
    await rm(vaultDir(fx.marrowHome), { recursive: true, force: true });

    const { code, outLines } = await captureLogs(() =>
      initCommand(fx.marrowHome, { from: fx.bareOrigin, dryRun: true }),
    );

    expect(code).toBe(0);
    expect(outLines).toContain(`dry run: would clone vault from ${fx.bareOrigin}`);
    expect(await Bun.file(vaultDir(fx.marrowHome)).exists()).toBe(false);
  });

  test("init --from bare-clones when the local vault is absent", async () => {
    restoreEnv = await hideGhButKeepGit(fx);
    await seedRemoteBranch(fx);
    await rm(vaultDir(fx.marrowHome), { recursive: true, force: true });

    const { code, outLines } = await captureLogs(() =>
      initCommand(fx.marrowHome, { from: fx.bareOrigin }),
    );

    expect(code).toBe(0);
    expect(outLines).toContain(`cloned vault from ${fx.bareOrigin}`);
    expect(outLines).toContain("fetched branches: 1");
    expect(outLines).toContain("gh not available; skipped origin visibility check");
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(fx.bareOrigin);
  });

  test("init --from hydrates an empty local vault with no origin", async () => {
    restoreEnv = await hideGhButKeepGit(fx);
    await seedRemoteBranch(fx);
    await removeVaultOrigin(fx);

    const { code, outLines } = await captureLogs(() =>
      initCommand(fx.marrowHome, { from: fx.bareOrigin }),
    );

    expect(code).toBe(0);
    expect(outLines).toContain(`hydrated vault from ${fx.bareOrigin}`);
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(fx.bareOrigin);
    expect(await fetchedOriginBranches(vaultDir(fx.marrowHome))).toEqual(["projects/github.com/test/remote"]);
  });

  test("init --from refuses existing origin and populated local vaults before mutation", async () => {
    let res = await captureLogs(() => initCommand(fx.marrowHome, { from: fx.bareOrigin }));
    expect(res.code).toBe(1);
    expect(res.errLines.join("\n")).toContain("vault already uses origin");

    await addProjectWorktree(fx, "ossa");
    await removeVaultOrigin(fx);
    res = await captureLogs(() => initCommand(fx.marrowHome, { from: fx.bareOrigin }));
    expect(res.code).toBe(1);
    expect(res.errLines.join("\n")).toContain("vault is not empty");
  });

  test("init --from fails a remote reported as public", async () => {
    restoreEnv = await installGhStub(fx, { visibility: "PUBLIC" });
    await seedRemoteBranch(fx);
    await rm(vaultDir(fx.marrowHome), { recursive: true, force: true });

    const { code, errLines } = await captureLogs(() =>
      initCommand(fx.marrowHome, { from: fx.bareOrigin }),
    );

    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("origin visibility is PUBLIC, expected PRIVATE");
  });
});
