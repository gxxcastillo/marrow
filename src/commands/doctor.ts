import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MIN_GIT_MAJOR, MIN_GIT_MINOR, aheadBehind, git, gitTooOld, gitVersion, listProjectWorktrees, splitByMissing, vaultDir } from "../git";
import { clearProgress, countLabel, showProgress } from "../format";
import { originUrl, verifyOriginReachable, verifyPrivateVisibility } from "../remote";
import { unattachedBranches } from "../vault";

const UNPUSHED_WARN_THRESHOLD = 20;
const STALE_BACKUP_DAYS = 30;
const PROGRESS_LINE = "checking vault and project worktree health...";

function branchList(branches: string[]): string {
  return branches.sort().join(", ");
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

  const progressShown = showProgress(PROGRESS_LINE);

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
  const { present: presentWorktrees, missing: missingWorktrees } = splitByMissing(worktrees);
  // A vault clone contains every branch, but a machine may intentionally
  // attach only some of them. Worktrees are this machine's registry.
  const misplaced = worktrees.filter((wt) => path.basename(wt.path) !== ".agents");
  if (misplaced.length === 0) {
    ok(worktrees.length === 0 ? "no project worktrees attached" : `${countLabel(worktrees.length, "project worktree")} named .agents`);
  }
  for (const wt of worktrees) {
    if (path.basename(wt.path) !== ".agents") fail(`branch '${wt.branch}' worktree at ${wt.path} is not named .agents`);
  }

  for (const wt of missingWorktrees) {
    warn(`registered worktree missing at ${wt.path}; run \`marrow detach ${wt.branch}\` to clear the registration`);
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
      warn(`${wt.branch}: ${countLabel(ab.ahead, "unpushed commit")}`);
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
    let stale = 0;
    for (const entry of await readdir(backupsDir)) {
      const ageDays = (now - (await stat(path.join(backupsDir, entry))).mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > STALE_BACKUP_DAYS) stale++;
    }
    // One aggregate line, not one per tarball: backups are never auto-deleted,
    // so a per-tarball warning would be a permanent, ever-growing noise source.
    if (stale > 0) warn(`${countLabel(stale, "backup")} older than ${STALE_BACKUP_DAYS} days under ${backupsDir}`);
  }

  const marrowOnPath = Bun.which("marrow");
  if (marrowOnPath) ok(`marrow on PATH at ${marrowOnPath}`);
  else warn("bin/marrow is not on PATH");

  clearProgress(progressShown, PROGRESS_LINE);
  for (const line of lines) console.log(line);
  const warningLabel = warnings > 0 ? `, ${countLabel(warnings, "warning")}` : "";
  console.log(failed ? `doctor: FAIL (${countLabel(failures, "failure")}${warningLabel})` : warnings > 0 ? `doctor: OK (${countLabel(warnings, "warning")})` : "doctor: OK");
  return failed ? 1 : 0;
}
