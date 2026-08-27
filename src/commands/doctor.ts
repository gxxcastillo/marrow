import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { aheadBehind, git, listProjectWorktrees, vaultDir } from "../git";
import { originUrl, verifyOriginReachable, verifyPrivateVisibility } from "../remote";

const UNPUSHED_WARN_THRESHOLD = 20;
const STALE_BACKUP_DAYS = 30;

export async function doctorCommand(marrowHome: string): Promise<number> {
  const lines: string[] = [];
  let failed = false;
  const ok = (msg: string) => lines.push(`OK    ${msg}`);
  const warn = (msg: string) => lines.push(`WARN  ${msg}`);
  const fail = (msg: string) => {
    lines.push(`FAIL  ${msg}`);
    failed = true;
  };
  const check = (pass: boolean, okMsg: string, failMsg: string) => (pass ? ok(okMsg) : fail(failMsg));

  const vault = vaultDir(marrowHome);
  const worktrees = await listProjectWorktrees(vault);
  // A vault clone contains every branch, but a machine may intentionally
  // attach only some of them. Worktrees are this machine's registry.
  for (const wt of worktrees) {
    const actual = wt.path;
    check(
      path.basename(actual) === ".agents",
      `branch '${wt.branch}' worktree at ${actual}`,
      `branch '${wt.branch}' worktree at ${actual} is not named .agents`,
    );
  }

  for (const wt of worktrees) {
    const projectDir = path.dirname(wt.path);
    // `add` supports creating a fresh worktree in a plain directory; a parent
    // that is not a git repo has nothing to ignore .agents into.
    const inRepo = await git(["rev-parse", "--is-inside-work-tree"], projectDir);
    if (inRepo.code !== 0) {
      ok(`${wt.branch}: parent is not a git repo (nothing to ignore)`);
      continue;
    }
    const ignored = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
    check(
      ignored.code === 0,
      `${wt.branch}: parent repo ignores .agents`,
      `${wt.branch}: parent repo (${projectDir}) does not ignore .agents`,
    );
  }

  const url = await originUrl(vault);
  if (!url) {
    warn("no 'origin' remote configured");
  } else {
    try {
      await verifyOriginReachable(vault);
      ok("origin is reachable");
    } catch {
      fail(`origin (${url}) is not reachable`);
    }

    const visibility = await verifyPrivateVisibility(vault, false);
    if (visibility.status === "ok") ok(visibility.message);
    else if (visibility.status === "warn") warn(visibility.message);
    else fail(visibility.message);
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
  if (marrowOnPath) ok(`marrow on PATH at ${marrowOnPath}`);
  else warn("bin/marrow is not on PATH");

  for (const line of lines) console.log(line);
  console.log(failed ? "doctor: FAIL" : "doctor: OK");
  return failed ? 1 : 0;
}
