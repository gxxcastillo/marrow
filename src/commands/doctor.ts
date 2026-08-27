import { existsSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { aheadBehind, git, listProjectWorktrees, run } from "../git";

const UNPUSHED_WARN_THRESHOLD = 20;
const STALE_BACKUP_DAYS = 30;

export async function doctorCommand(marrowHome: string, devRoot: string): Promise<number> {
  const lines: string[] = [];
  let failed = false;
  const ok = (msg: string) => lines.push(`OK    ${msg}`);
  const warn = (msg: string) => lines.push(`WARN  ${msg}`);
  const fail = (msg: string) => {
    lines.push(`FAIL  ${msg}`);
    failed = true;
  };

  const worktrees = await listProjectWorktrees(marrowHome);
  const worktreeByBranch = new Map(worktrees.map((w) => [w.branch, w.path]));

  // Worktrees are derived from local branches (git worktree list), so every
  // worktree already has a branch by construction: checking each branch's
  // worktree covers both directions of "branch <-> worktree" in one pass.
  const branchesRes = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], marrowHome);
  const branches = branchesRes.stdout.split("\n").filter((b) => b && b !== "main");

  for (const branch of branches) {
    const expected = path.join(devRoot, branch, ".agents");
    const actual = worktreeByBranch.get(branch);
    if (!actual) {
      fail(`branch '${branch}' has no worktree`);
      continue;
    }
    // Compare real paths: git resolves symlinks (e.g. macOS /var -> /private/var)
    // when reporting worktree paths, so a naive string compare can false-fail.
    let matches: boolean;
    try {
      matches = (await realpath(actual)) === (await realpath(expected));
    } catch {
      matches = false;
    }
    if (!matches) {
      fail(`branch '${branch}' worktree at ${actual}, expected ${expected}`);
    } else {
      ok(`branch '${branch}' worktree at conventional path`);
    }
  }

  for (const wt of worktrees) {
    const projectDir = path.dirname(wt.path);
    const check = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
    if (check.code === 0) {
      ok(`${wt.branch}: parent repo ignores .agents`);
    } else {
      fail(`${wt.branch}: parent repo (${projectDir}) does not ignore .agents`);
    }
  }

  const remotes = await git(["remote"], marrowHome);
  if (!remotes.stdout.split("\n").includes("origin")) {
    fail("no 'origin' remote configured");
  } else {
    const originUrl = await git(["remote", "get-url", "origin"], marrowHome);
    const reachable = await run("git", ["ls-remote", "--exit-code", "origin"], marrowHome);
    if (reachable.code !== 0) {
      fail(`origin (${originUrl.stdout}) is not reachable`);
    } else {
      ok("origin is reachable");
    }

    const ghPath = Bun.which("gh");
    if (!ghPath) {
      warn("gh not available; skipped origin visibility check");
    } else {
      const vis = await run("gh", ["repo", "view", "--json", "visibility", "-q", ".visibility"], marrowHome);
      if (vis.code !== 0) {
        warn(`could not determine origin visibility via gh: ${vis.stderr || vis.stdout}`);
      } else if (vis.stdout.trim() !== "PRIVATE") {
        fail(`origin visibility is ${vis.stdout.trim()}, expected PRIVATE`);
      } else {
        ok("origin is PRIVATE");
      }
    }
  }

  for (const wt of worktrees) {
    const ab = await aheadBehind(wt.path, wt.branch);
    if (ab === null) {
      warn(`${wt.branch}: no upstream (origin/${wt.branch})`);
    } else if (ab.ahead > UNPUSHED_WARN_THRESHOLD) {
      warn(`${wt.branch}: ${ab.ahead} unpushed commit(s)`);
    }
  }

  const backupsDir = path.join(marrowHome, "backups");
  if (existsSync(backupsDir)) {
    const now = Date.now();
    for (const entry of await readdir(backupsDir)) {
      const ageDays = (now - (await stat(path.join(backupsDir, entry))).mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > STALE_BACKUP_DAYS) {
        warn(`backup ${entry} is ${Math.floor(ageDays)} day(s) old`);
      }
    }
  }

  const marrowOnPath = Bun.which("marrow");
  if (!marrowOnPath) {
    warn("bin/marrow is not on PATH");
  } else {
    ok(`marrow on PATH at ${marrowOnPath}`);
  }

  for (const line of lines) console.log(line);
  console.log(failed ? "doctor: FAIL" : "doctor: OK");
  return failed ? 1 : 0;
}
