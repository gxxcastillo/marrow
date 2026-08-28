import os from "node:os";
import path from "node:path";
import { aheadBehind, dirtyCount, lastCommit, listProjectWorktrees, vaultDir } from "../git";
import { clearProgress, countLabel, showProgress } from "../format";
import { unattachedBranches } from "../vault";

const PROGRESS_LINE = "checking project status...";
// A floor, not a target: below this, LAST COMMIT (the most diagnostic column —
// what actually happened) degenerates into a bare truncated date with zero of the
// actual subject, in exactly the cases (long paths/keys, many pending commits)
// where a reader most needs to skim it. Taking the row past the target width is
// an acceptable trade for that.
const MIN_LAST_COMMIT_WIDTH = 24;

function syncLabel(aheadBehind: { ahead: number; behind: number } | null): string {
  if (!aheadBehind) return "not pushed";
  if (aheadBehind.ahead === 0 && aheadBehind.behind === 0) return "synced";

  const pending: string[] = [];
  if (aheadBehind.ahead > 0) pending.push(`${countLabel(aheadBehind.ahead, "commit")} to push`);
  if (aheadBehind.behind > 0) pending.push(`${countLabel(aheadBehind.behind, "commit")} to pull`);
  return pending.join(", ");
}

function displayPath(worktreePath: string): string {
  const projectPath = path.dirname(worktreePath);
  const relative = path.relative(os.homedir(), projectPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative) ? `~/${relative}` : projectPath;
}

function shorten(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return ".".repeat(width);
  return `${value.slice(0, width - 3)}...`;
}

function shortenProject(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return ".".repeat(width);
  return `...${value.slice(value.length - width + 3)}`;
}

// No upper cap on terminal width: PROJECT and LAST COMMIT are still clamped to
// their own natural content width below, so a wide terminal doesn't pad columns
// wider than needed — it just stops truncating them prematurely.
function tableTargetWidth(): number {
  return Math.max(50, process.stdout.columns ?? 100);
}

function printBranchList(header: string, branches: string[]): void {
  console.log(`${header}:`);
  for (const branch of branches) console.log(`  ${branch}`);
}

function printRows(rows: string[][]): void {
  const headers = ["PROJECT", "KEY", "STATUS", "LAST COMMIT"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const target = tableTargetWidth();
  const projectMax = Math.max(headers[0].length, Math.min(widths[0], Math.floor(target * 0.32)));
  const fixedWidth = projectMax + widths[1] + widths[2] + 2 * (headers.length - 1);
  widths[0] = projectMax;
  widths[3] = Math.min(widths[3], Math.max(MIN_LAST_COMMIT_WIDTH, target - fixedWidth));
  const format = (row: string[]) =>
    row.map((cell, index) => (index === 0 ? shortenProject(cell, widths[index]) : shorten(cell, widths[index])).padEnd(widths[index])).join("  ").trimEnd();

  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));
}

function displayCommit(commit: { date: string; subject: string } | null, projectKey: string): string {
  if (!commit) return "no commits";
  const prefix = `${projectKey}: `;
  const subject = commit.subject.startsWith(prefix) ? commit.subject.slice(prefix.length) : commit.subject;
  return `${commit.date} ${subject}`;
}

export async function statusCommand(marrowHome: string): Promise<number> {
  const progressShown = showProgress(PROGRESS_LINE);
  const vault = vaultDir(marrowHome);
  const worktrees = await listProjectWorktrees(vault);
  // The table covers attached worktrees only. Naming what it leaves out keeps
  // a partially attached machine from reading as an empty or complete vault.
  const unattached = await unattachedBranches(vault, worktrees);
  const unattachedNote = unattached.length === 0
    ? ""
    : `${countLabel(unattached.length, "project branch", "project branches")} not attached here`;

  if (worktrees.length === 0) {
    clearProgress(progressShown, PROGRESS_LINE);
    console.log("No projects attached on this machine. Run `marrow add <project-path>` to get started.");
    if (unattachedNote) printBranchList(`The vault has ${unattachedNote}`, unattached);
    return 0;
  }

  let dirtyTotal = 0;
  let unpushedTotal = 0;
  let aheadTotal = 0;
  let behindTotal = 0;
  const rows: string[][] = [];
  const missingBranches: string[] = [];
  for (const wt of worktrees) {
    if (wt.missing) {
      missingBranches.push(wt.branch);
      rows.push([displayPath(wt.path), wt.branch, "missing", "-"]);
      continue;
    }
    const dirty = await dirtyCount(wt.path);
    const ab = await aheadBehind(wt.path, wt.branch);
    const commit = await lastCommit(wt.path);
    if (dirty > 0) dirtyTotal++;
    if (!ab) unpushedTotal++;
    if (ab) {
      aheadTotal += ab.ahead;
      behindTotal += ab.behind;
    }

    rows.push([
      displayPath(wt.path),
      wt.branch,
      `${dirty > 0 ? countLabel(dirty, "uncommitted change") : "clean"}, ${syncLabel(ab)}`,
      displayCommit(commit, wt.branch),
    ]);
  }

  clearProgress(progressShown, PROGRESS_LINE);
  const changeSummary = [
    missingBranches.length > 0 ? `${missingBranches.length} missing` : "",
    dirtyTotal > 0 ? `${dirtyTotal} with uncommitted changes` : "",
  ].filter(Boolean);
  const changes = changeSummary.join(", ") || "all clean";
  const sync = [
    unpushedTotal > 0 ? `${unpushedTotal} not pushed` : "",
    aheadTotal > 0 ? `${countLabel(aheadTotal, "commit")} to push` : "",
    behindTotal > 0 ? `${countLabel(behindTotal, "commit")} to pull` : "",
  ].filter(Boolean);
  console.log(`${countLabel(worktrees.length, "project")}: ${changes}, ${sync.join(", ") || "all synced"}`);
  console.log("");
  printRows(rows);
  let printedPostTableNote = false;
  if (unattachedNote) {
    console.log("");
    printBranchList(unattachedNote, unattached);
    printedPostTableNote = true;
  }
  if (missingBranches.length > 0) {
    if (!printedPostTableNote) console.log("");
    const subject = missingBranches.length === 1 ? "its worktree directory" : "their worktree directories";
    console.log(
      `${countLabel(missingBranches.length, "project")} missing ${subject}; run \`marrow detach <project>\` to clear ` +
        `the registration: ${missingBranches.join(", ")}`,
    );
  }
  return 0;
}
