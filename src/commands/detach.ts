import path from "node:path";
import { countLabel } from "../format";
import { aheadBehind, dirtyCount, git, listProjectWorktrees, matchWorktrees, vaultDir } from "../git";

export interface DetachOptions {
  dryRun?: boolean;
}

// Resolved like `sync` targets, but exactly one match is required — detach
// always acts on a single project. Never touches the branch or the remote:
// the branch and its history stay in the vault regardless of which path this
// command takes.
export async function detachCommand(target: string, opts: DetachOptions, marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const worktrees = await listProjectWorktrees(vault);
  const found = matchWorktrees(worktrees, target);

  if (found.length === 0) {
    console.error(`marrow detach: unknown project: ${target}`);
    return 1;
  }
  if (found.length > 1) {
    console.error(`marrow detach: ambiguous name ${target} matches: ${found.map((w) => w.path).join(", ")}`);
    return 1;
  }

  const wt = found[0];
  const name = path.basename(path.dirname(wt.path));

  if (wt.missing) {
    if (opts.dryRun) {
      console.log(`dry run: would clear the registration for '${name}' (${wt.branch}); worktree directory is already missing`);
      return 0;
    }
    const pruned = await git(["worktree", "remove", "--force", wt.path], vault);
    if (pruned.code !== 0) {
      console.error(`marrow detach: could not clear the registration for '${name}': ${pruned.stderr}`);
      return 1;
    }
    console.log(`detached '${name}': cleared the registration for ${wt.branch} (worktree directory was already missing)`);
    console.log(`branch '${wt.branch}' is retained in the vault; nothing was pushed or deleted`);
    return 0;
  }

  const dirty = await dirtyCount(wt.path);
  if (dirty > 0) {
    console.error(
      `marrow detach: ${wt.path} has ${dirty} uncommitted change(s); refusing to detach a dirty worktree.\n` +
        `  Sync it first: marrow sync ${name}\n` +
        `  Or discard the changes: git -C ${wt.path} checkout -- . && git -C ${wt.path} clean -fd`,
    );
    return 1;
  }

  if (opts.dryRun) {
    console.log(`dry run: would remove the worktree for '${name}' at ${wt.path}; branch ${wt.branch} would be retained in the vault`);
    return 0;
  }

  const ab = await aheadBehind(wt.path, wt.branch);
  const removed = await git(["worktree", "remove", wt.path], vault);
  if (removed.code !== 0) {
    console.error(`marrow detach: could not remove worktree: ${removed.stderr}`);
    return 1;
  }
  const unpushedNote = ab && ab.ahead > 0 ? `, ${countLabel(ab.ahead, "unpushed commit")} retained on the branch` : "";
  console.log(`detached '${name}': removed the worktree at ${wt.path}; branch '${wt.branch}' is retained in the vault${unpushedNote}`);
  return 0;
}
