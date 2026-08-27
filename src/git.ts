// Thin Bun.spawn git wrapper and worktree discovery. No git library.

import path from "node:path";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(cmd: string, args: string[], cwd: string): Promise<SpawnResult> {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
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

// Discovers project worktrees registered against the vault. Zero config:
// worktrees are the registry. The vault is bare, so it has no main-checkout
// entry of its own — every entry `git worktree list` reports is a real
// project by construction.
export async function listProjectWorktrees(vaultPath: string): Promise<{ path: string; branch: string }[]> {
  const res = await git(["worktree", "list", "--porcelain"], vaultPath);
  if (res.code !== 0) throw new Error(`git worktree list failed: ${res.stderr}`);

  // --porcelain emits one blank-line-separated block per worktree. A block
  // without a branch line (detached HEAD) is not a project worktree.
  return res.stdout.split("\n\n").flatMap((block) => {
    const wtPath = block.match(/^worktree (.+)$/m)?.[1];
    const branch = block.match(/^branch (?:refs\/heads\/)?(.+)$/m)?.[1];
    return wtPath && branch ? [{ path: wtPath, branch }] : [];
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
