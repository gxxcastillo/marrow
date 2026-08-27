import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MIN_GIT_MAJOR, MIN_GIT_MINOR, aheadBehind, git, gitTooOld, gitVersion, listProjectWorktrees, vaultDir } from "../git";
import { githubId, githubProjectId } from "../identity";
import { originUrl, verifyOriginReachable, verifyPrivateVisibility } from "../remote";
import { unattachedBranches } from "../vault";

const UNPUSHED_WARN_THRESHOLD = 20;
const STALE_BACKUP_DAYS = 30;
const PROGRESS_LINE = "checking vault and project worktree health...";

function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function branchList(branches: string[]): string {
  return branches.sort().join(", ");
}

function showProgress(): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(PROGRESS_LINE);
  return true;
}

function clearProgress(shown: boolean): void {
  if (!shown) return;
  process.stdout.write(`\r${" ".repeat(PROGRESS_LINE.length)}\r`);
}

export async function doctorCommand(marrowHome: string): Promise<number> {
  const lines: string[] = [];
  let failed = false;
  let warnings = 0;
  let failures = 0;
  const ok = (msg: string) => lines.push(`OK    ${msg}`);
  const warn = (msg: string) => {
    lines.push(`WARN  ${msg}`);
    warnings++;
  };
  const fail = (msg: string) => {
    lines.push(`FAIL  ${msg}`);
    failed = true;
    failures++;
  };

  const progressShown = showProgress();

  // Checked before anything else: without `worktree add --orphan` neither
  // `add` nor `publish` can run at all, so it outranks every vault finding.
  const version = await gitVersion();
  const minGit = `${MIN_GIT_MAJOR}.${MIN_GIT_MINOR}`;
  if (!version) {
    warn(`could not determine the git version; marrow needs git ${minGit}+ for \`git worktree add --orphan\``);
  } else if (gitTooOld(version)) {
    fail(`git ${minGit}+ is required by \`marrow add\` and \`marrow publish\` (found ${version.major}.${version.minor})`);
  } else {
    ok(`git ${version.major}.${version.minor} supports \`worktree add --orphan\``);
  }

  const vault = vaultDir(marrowHome);
  const worktrees = await listProjectWorktrees(vault);
  // A registered worktree whose directory is gone can't be filesystem-checked
  // (ignore state, identity, ahead/behind all shell out with its path as cwd,
  // which throws against a missing directory) — those checks run against this
  // subset instead. The registration itself is still reported, via the WARN below.
  const presentWorktrees = worktrees.filter((wt) => !wt.missing);
  // A vault clone contains every branch, but a machine may intentionally
  // attach only some of them. Worktrees are this machine's registry.
  const misplaced = worktrees.filter((wt) => path.basename(wt.path) !== ".agents");
  if (misplaced.length === 0) {
    ok(worktrees.length === 0 ? "no project worktrees attached" : `${countLabel(worktrees.length, "project worktree")} named .agents`);
  }
  for (const wt of worktrees) {
    if (path.basename(wt.path) !== ".agents") fail(`branch '${wt.branch}' worktree at ${wt.path} is not named .agents`);
  }

  for (const wt of worktrees) {
    if (wt.missing) warn(`registered worktree missing at ${wt.path}; run \`marrow detach ${wt.branch}\` to clear the registration`);
  }

  // Reported, never a WARN: attaching a subset is a deliberate choice, not
  // drift. It is surfaced because it silently bounds `grep` and `status`.
  const unattached = await unattachedBranches(vault, worktrees);
  if (unattached.length > 0) {
    ok(
      `${countLabel(unattached.length, "project branch", "project branches")} not attached on this machine (normal; ` +
        `\`marrow grep\` and \`marrow status\` skip them): ${branchList(unattached)}`,
    );
  }

  let ignoredParents = 0;
  for (const wt of presentWorktrees) {
    const projectDir = path.dirname(wt.path);
    // `add` supports creating a fresh worktree in a plain directory; a parent
    // that is not a git repo has nothing to ignore .agents into.
    const inRepo = await git(["rev-parse", "--is-inside-work-tree"], projectDir);
    if (inRepo.code !== 0) {
      ignoredParents++;
      continue;
    }
    const ignored = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
    if (ignored.code === 0) ignoredParents++;
    else fail(`${wt.branch}: parent repo (${projectDir}) does not ignore .agents`);
  }
  if (ignoredParents === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`.agents ignored for ${countLabel(presentWorktrees.length, "project parent")}`);
  }

  let checkedIdentities = 0;
  for (const wt of presentWorktrees) {
    const projectDir = path.dirname(wt.path);
    const origin = await git(["remote", "get-url", "origin"], projectDir);
    const originId = origin.code === 0 ? githubId(origin.stdout) : null;
    const defaultId = origin.code === 0 ? githubProjectId(origin.stdout) : null;
    if (!originId || !defaultId) continue;
    checkedIdentities++;
    const branchId = wt.branch;
    if (branchId !== defaultId) {
      warn(`${projectDir} has GitHub origin ${originId}, but marrow identity is ${branchId}; default is ${defaultId}`);
    }
  }
  if (checkedIdentities > 0 && warnings === 0) ok(`GitHub project identities match defaults for ${countLabel(checkedIdentities, "project")}`);

  const url = await originUrl(vault);
  let originRefsCurrent = false;
  if (!url) {
    warn("no 'origin' remote configured");
  } else {
    try {
      await verifyOriginReachable(vault);
      ok("origin is reachable");
      const fetch = await git(["fetch", "--prune", "origin"], vault);
      if (fetch.code === 0) {
        originRefsCurrent = true;
        ok("origin refs are current");
      } else {
        fail(`origin fetch failed: ${fetch.stderr || fetch.stdout}`);
      }
    } catch {
      fail(`origin (${url}) is not reachable`);
    }

    const visibility = await verifyPrivateVisibility(vault, false);
    if (visibility.status === "ok") ok(visibility.message);
    else if (visibility.status === "warn") warn(visibility.message);
    else fail(visibility.message);
  }

  const missingOriginRefs: string[] = [];
  let tooFarAhead = 0;
  for (const wt of presentWorktrees) {
    if (!originRefsCurrent) continue;
    const ab = await aheadBehind(wt.path, wt.branch);
    if (ab === null) {
      missingOriginRefs.push(wt.branch);
    } else if (ab.ahead > UNPUSHED_WARN_THRESHOLD) {
      warn(`${wt.branch}: ${ab.ahead} unpushed commit(s)`);
      tooFarAhead++;
    }
  }
  if (missingOriginRefs.length > 0) {
    warn(`${countLabel(missingOriginRefs.length, "branch", "branches")} missing origin refs; run \`marrow sync\`: ${branchList(missingOriginRefs)}`);
  } else if (originRefsCurrent && tooFarAhead === 0 && presentWorktrees.length > 0) {
    ok(`push state within threshold for ${countLabel(presentWorktrees.length, "project branch", "project branches")}`);
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

  clearProgress(progressShown);
  for (const line of lines) console.log(line);
  const warningLabel = warnings > 0 ? `, ${countLabel(warnings, "warning")}` : "";
  console.log(failed ? `doctor: FAIL (${countLabel(failures, "failure")}${warningLabel})` : warnings > 0 ? `doctor: OK (${countLabel(warnings, "warning")})` : "doctor: OK");
  return failed ? 1 : 0;
}
