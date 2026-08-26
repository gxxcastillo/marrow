import { aheadBehind, dirtyCount, lastCommit, listProjectWorktrees } from "../git";

export async function statusCommand(marrowHome: string): Promise<number> {
  const worktrees = await listProjectWorktrees(marrowHome);
  if (worktrees.length === 0) {
    console.log("No project worktrees.");
    return 0;
  }

  let dirtyTotal = 0;
  for (const wt of worktrees) {
    const dirty = await dirtyCount(wt.path);
    const ab = await aheadBehind(wt.path, wt.branch);
    const commit = await lastCommit(wt.path);
    if (dirty > 0) dirtyTotal++;

    const dirtyLabel = dirty > 0 ? `dirty (${dirty})` : "clean";
    const abLabel = ab ? `+${ab.ahead}/-${ab.behind}` : "no upstream";
    const commitLabel = commit ? `${commit.date} ${commit.subject}` : "no commits";
    console.log(`${wt.branch}\t${dirtyLabel}\t${abLabel}\t${commitLabel}`);
  }
  console.log(`${worktrees.length} project(s), ${dirtyTotal} dirty`);
  return 0;
}
