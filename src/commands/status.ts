import os from "node:os";
import path from "node:path";
import { aheadBehind, dirtyCount, lastCommit, listProjectWorktrees, vaultDir } from "../git";

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function syncLabel(aheadBehind: { ahead: number; behind: number } | null): string {
  if (!aheadBehind) return "not pushed";
  if (aheadBehind.ahead === 0 && aheadBehind.behind === 0) return "synced";

  const pending: string[] = [];
  if (aheadBehind.ahead > 0) pending.push(`${countLabel(aheadBehind.ahead, "commit")} to push`);
  if (aheadBehind.behind > 0) pending.push(`${countLabel(aheadBehind.behind, "commit")} to pull`);
  return pending.join(", ");
}

function displayProject(branch: string): string {
  return branch.startsWith("projects/") ? branch.slice("projects/".length) : branch;
}

function displayPath(worktreePath: string): string {
  const projectPath = path.dirname(worktreePath);
  const relative = path.relative(os.homedir(), projectPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative) ? `~/${relative}` : projectPath;
}

export async function statusCommand(marrowHome: string): Promise<number> {
  const worktrees = await listProjectWorktrees(vaultDir(marrowHome));
  if (worktrees.length === 0) {
    console.log("No projects attached on this machine. Run `marrow add <project-path>` to get started.");
    return 0;
  }

  let dirtyTotal = 0;
  let unpushedTotal = 0;
  let aheadTotal = 0;
  let behindTotal = 0;
  const rows: string[][] = [];
  for (const wt of worktrees) {
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
      displayProject(wt.branch),
      dirty > 0 ? countLabel(dirty, "uncommitted change") : "clean",
      syncLabel(ab),
      commit ? `${commit.date} ${commit.subject}` : "no commits",
    ]);
  }

  const headers = ["PROJECT", "KEY", "CHANGES", "SYNC", "LAST COMMIT"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const format = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));

  const changes = dirtyTotal === 0 ? "all clean" : `${dirtyTotal} with uncommitted changes`;
  const sync = [
    unpushedTotal > 0 ? `${unpushedTotal} not pushed` : "",
    aheadTotal > 0 ? `${countLabel(aheadTotal, "commit")} to push` : "",
    behindTotal > 0 ? `${countLabel(behindTotal, "commit")} to pull` : "",
  ].filter(Boolean);
  console.log(`${countLabel(worktrees.length, "project")}: ${changes}, ${sync.join(", ") || "all synced"}`);
  return 0;
}
