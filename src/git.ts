// Thin Bun.spawn git wrapper and worktree discovery. No git library.

import path from "node:path";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(cmd: string, args: string[], cwd: string): Promise<SpawnResult> {
  const proc = Bun.spawn([cmd, ...args], { cwd, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function git(args: string[], cwd: string): Promise<SpawnResult> {
  return run("git", args, cwd);
}

// <MARROW_HOME>/vault.git is the bare repo every git-invoking command
// actually targets; MARROW_HOME itself is just its parent (also holding
// backups/ and logs/ as plain sibling directories).
export function vaultDir(marrowHome: string): string {
  return path.join(marrowHome, "vault.git");
}

export interface ProjectWorktree {
  path: string;
  branch: string;
  // Set when git reports this worktree `prunable` — its directory no longer
  // exists on disk (deleted out from under the registration) while the vault
  // still carries the branch and the worktree administrative data. Every git
  // command that would use `path` as `cwd` (status, ahead/behind, ignore
  // checks) throws ENOENT against a missing directory, so callers must skip
  // those for a missing worktree rather than crash.
  missing: boolean;
}

// Discovers project worktrees registered against the vault. Zero config:
// worktrees are the registry. The vault is bare, so it has no main-checkout
// entry of its own — every entry `git worktree list` reports is a real
// project by construction.
export async function listProjectWorktrees(vaultPath: string): Promise<ProjectWorktree[]> {
  const res = await git(["worktree", "list", "--porcelain"], vaultPath);
  if (res.code !== 0) throw new Error(`git worktree list failed: ${res.stderr}`);

  // --porcelain emits one blank-line-separated block per worktree. A block
  // without a branch line (detached HEAD) is not a project worktree.
  return res.stdout.split("\n\n").flatMap((block) => {
    const wtPath = block.match(/^worktree (.+)$/m)?.[1];
    const branch = block.match(/^branch (?:refs\/heads\/)?(.+)$/m)?.[1];
    const missing = /^prunable /m.test(block);
    return wtPath && branch ? [{ path: wtPath, branch, missing }] : [];
  });
}

export async function dirtyCount(cwd: string): Promise<number> {
  const res = await git(["status", "--porcelain"], cwd);
  if (res.code !== 0) throw new Error(`git status failed: ${res.stderr}`);
  return res.stdout.length === 0 ? 0 : res.stdout.split("\n").length;
}

// null when there is no origin/<branch> to compare against (never pushed / no origin).
export async function aheadBehind(cwd: string, branch: string): Promise<{ ahead: number; behind: number } | null> {
  const check = await git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], cwd);
  if (check.code !== 0) return null;
  const res = await git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], cwd);
  if (res.code !== 0) return null;
  const [ahead, behind] = res.stdout.split(/\s+/).map(Number);
  return { ahead, behind };
}

export async function lastCommit(cwd: string): Promise<{ date: string; subject: string } | null> {
  const res = await git(["log", "-1", "--format=%ad|%s", "--date=short"], cwd);
  if (res.code !== 0 || res.stdout === "") return null;
  const [date, ...rest] = res.stdout.split("|");
  return { date, subject: rest.join("|") };
}

export async function hasOrigin(cwd: string): Promise<boolean> {
  const res = await git(["remote"], cwd);
  return res.stdout.split("\n").includes("origin");
}

// `git worktree add --orphan` — the mechanism behind every adopted project
// (`commands/add.ts`, `vault.ts`) — landed in git 2.42. Older git runs `init`
// fine and then fails on the first `add`, so this is checked up front by
// `bin/install` and re-checked by `doctor`.
export const MIN_GIT_MAJOR = 2;
export const MIN_GIT_MINOR = 42;

export interface GitVersion {
  major: number;
  minor: number;
}

// null when `git --version` fails or prints something unparseable — an exotic
// build is warned about, never blocked.
export async function gitVersion(): Promise<GitVersion | null> {
  const res = await run("git", ["--version"], process.cwd());
  const parsed = res.code === 0 ? res.stdout.match(/^git version (\d+)\.(\d+)/) : null;
  return parsed ? { major: Number(parsed[1]), minor: Number(parsed[2]) } : null;
}

export function gitTooOld({ major, minor }: GitVersion): boolean {
  return major < MIN_GIT_MAJOR || (major === MIN_GIT_MAJOR && minor < MIN_GIT_MINOR);
}
