import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { initCommand } from "../src/commands/init";
import { publishCommand } from "../src/commands/publish";
import { git, vaultDir } from "../src/git";
import { fetchedOriginBranches, originUrl } from "../src/remote";
import { VAULT_README } from "../src/vault";
import { addProjectWorktree, installGhStub, makeFixture, setTestIdentity, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

async function removeVaultOrigin(fx: Fixture): Promise<void> {
  await git(["remote", "remove", "origin"], vaultDir(fx.marrowHome));
}

async function seedRemoteBranch(fx: Fixture, branch = "remote"): Promise<void> {
  const repo = path.join(fx.root, `seed-${branch.replaceAll("/", "-")}`);
  await mkdir(repo, { recursive: true });
  await git(["init", "-q", "-b", "main"], repo);
  await setTestIdentity(repo);
  await Bun.write(path.join(repo, "README.md"), "seed\n");
  await git(["add", "README.md"], repo);
  await git(["commit", "-q", "-m", "seed"], repo);
  await git(["remote", "add", "origin", fx.bareOrigin], repo);
  await git(["push", "-q", "origin", `HEAD:refs/heads/${branch}`], repo);
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
    await addProjectWorktree(fx, "alpha");
    await removeVaultOrigin(fx);

    const { code, outLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", { dryRun: true }, fx.marrowHome),
    );

    expect(code).toBe(0);
    expect(outLines).toContain("dry run: would publish vault to private GitHub repository example-owner/marrow-vault");
    expect(outLines).toContain("origin: git@github.com:example-owner/marrow-vault.git");
    expect(outLines).toContain("branches: 2");
    expect(outLines).toContain("  main");
    expect((await git(["rev-parse", "--verify", "--quiet", "main"], vaultDir(fx.marrowHome))).code).toBe(1);
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(null);
  });

  test("publish fails with a clean message, not a raw crash, when called directly against a missing vault", async () => {
    const noVaultHome = path.join(fx.root, "no-vault-home");
    const { code, errLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", {}, noVaultHome),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("vault does not exist");
  });

  test("publish pushes every local branch to a private GitHub remote", async () => {
    restoreEnv = await installGhStub(fx);
    await addProjectWorktree(fx, "alpha");
    await removeVaultOrigin(fx);

    const { code, outLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(0);
    expect(outLines[0]).toBe("publishing vault to private GitHub repository example-owner/marrow-vault...");
    expect(outLines).toContain(`origin: ${fx.bareOrigin}`);
    expect(outLines).toContain("pushed branches: 2");
    expect(outLines).toContain("origin is PRIVATE");
    expect(await originUrl(vaultDir(fx.marrowHome))).toBe(fx.bareOrigin);
    expect((await git(["rev-parse", "origin/alpha"], vaultDir(fx.marrowHome))).code).toBe(0);
    const readme = await git(["show", "origin/main:README.md"], vaultDir(fx.marrowHome));
    expect(readme.stdout).toBe(VAULT_README.trim());
    expect(readme.stdout).toContain("Private data vault for marrow.");
  });

  test("publish refuses an existing origin", async () => {
    const { code, errLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", {}, fx.marrowHome),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("vault already uses origin");
  });

  test("publish requires gh in live mode", async () => {
    restoreEnv = await hideGhButKeepGit(fx);
    await removeVaultOrigin(fx);

    const { code, errLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("gh is required");
  });

  test("publish reports partial state when privacy verification fails", async () => {
    restoreEnv = await installGhStub(fx, { visibility: "PUBLIC" });
    await addProjectWorktree(fx, "alpha");
    await removeVaultOrigin(fx);

    const { code, errLines } = await captureLogs(() =>
      publishCommand("example-owner/marrow-vault", {}, fx.marrowHome),
    );

    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("origin visibility is PUBLIC, expected PRIVATE");
    expect(errLines.join("\n")).toContain("created repository: example-owner/marrow-vault");
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
    expect(outLines).toContain("fetched 1 project branch");
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
    expect(await fetchedOriginBranches(vaultDir(fx.marrowHome))).toEqual(["remote"]);
  });

  test("init --from succeeds against a reachable but still-empty remote", async () => {
    restoreEnv = await hideGhButKeepGit(fx);
    const freshHome = path.join(fx.root, "fresh-home");

    // fx.bareOrigin is a real, reachable bare repo that nothing has pushed to yet
    // (e.g. a freshly created GitHub repo before the first `marrow publish`). Plain
    // `ls-remote` still succeeds against it; only `--exit-code` would misreport this
    // as unreachable, since it treats "zero matching refs" as failure.
    const { code, outLines } = await captureLogs(() => initCommand(freshHome, { from: fx.bareOrigin }));

    expect(code).toBe(0);
    expect(outLines).toContain(`cloned vault from ${fx.bareOrigin}`);
    expect(outLines).toContain("fetched 0 project branches");
    expect(await originUrl(vaultDir(freshHome))).toBe(fx.bareOrigin);
  });

  test("init --from refuses existing origin and populated local vaults before mutation", async () => {
    let res = await captureLogs(() => initCommand(fx.marrowHome, { from: fx.bareOrigin }));
    expect(res.code).toBe(1);
    expect(res.errLines.join("\n")).toContain("vault already uses origin");

    await addProjectWorktree(fx, "alpha");
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
