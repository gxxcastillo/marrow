import path from "node:path";
import { aheadBehind, dirtyCount, git, hasOrigin, listProjectWorktrees, vaultDir } from "../git";
import { report, reportMissingWorktree, resolveTargets } from "../target-resolution";

export interface SyncOptions {
  message?: string;
}

function isoLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Printed for a manual-reconciliation refusal, in the same style as
// `project.ts`'s `trackedMessage`: marrow itself never merges, rebases, or
// stashes (`architecture.md` → Non-goals) — this is guidance for the human,
// not a command marrow runs. `dirty` and `diverged` are independent: a
// worktree can hold uncommitted changes *and* have local commits diverged
// from origin at the same time, and the steps must cover both or the human
// following them loses the uncommitted changes.
function reconciliationMessage(name: string, agentsPath: string, branch: string, dirty: boolean, diverged: boolean): string {
  const reason = diverged
    ? `has diverged from origin/${branch} — both sides have commits the other lacks`
    : `has local changes and origin/${branch} has moved`;
  const steps = [
    `  cd ${agentsPath}`,
    ...(dirty ? ["  git stash"] : []),
    diverged ? `  git pull --no-rebase origin ${branch}` : `  git merge --ff-only origin/${branch}`,
    ...(dirty ? ["  git stash pop"] : []),
  ];
  return `${name} ${reason}; reconcile manually:\n${steps.join("\n")}\nThen re-run: marrow sync ${name}`;
}

export async function syncCommand(targets: string[], opts: SyncOptions, marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const all = await listProjectWorktrees(vault);

  let hadError = false;
  let worktrees = all;

  if (targets.length > 0) {
    const resolution = resolveTargets(all, targets);
    hadError = resolution.hadError;
    worktrees = resolution.worktrees;
  } else if (opts.message) {
    const dirtyFlags = await Promise.all(all.filter((wt) => !wt.missing).map((wt) => dirtyCount(wt.path)));
    const dirtyProjects = dirtyFlags.filter((count) => count > 0).length;
    if (dirtyProjects > 1) {
      report(`note: -m applies the same message to all ${dirtyProjects} dirty projects`, true);
    }
  }

  if (await hasOrigin(vault)) {
    const fetchRes = await git(["fetch", "--prune", "origin"], vault);
    if (fetchRes.code !== 0) {
      hadError = true;
      report(`fetch: WARN ${fetchRes.stderr}`, true);
    }
  }

  for (const wt of worktrees) {
    const name = path.basename(path.dirname(wt.path));
    if (wt.missing) {
      // The branch and its ref are still fine — only the worktree directory is
      // gone — so this never blocks the push below. Unnamed (all-projects) sync
      // treats it as a warning; naming this project explicitly is an error, the
      // same as naming an unknown one.
      const explicit = targets.length > 0;
      reportMissingWorktree(name, wt, explicit);
      if (explicit) hadError = true;
      continue;
    }
    try {
      const syncState = await aheadBehind(wt.path, wt.branch);
      if (syncState?.behind) {
        const dirtyBeforePull = await dirtyCount(wt.path);
        if (dirtyBeforePull > 0 || syncState.ahead > 0) {
          throw new Error(reconciliationMessage(name, wt.path, wt.branch, dirtyBeforePull > 0, syncState.ahead > 0));
        }
        const fastForward = await git(["merge", "--ff-only", `origin/${wt.branch}`], wt.path);
        if (fastForward.code !== 0) throw new Error(`fast-forward failed: ${fastForward.stderr}`);
        report(`${name}: fast-forwarded`);
      }
      const dirty = await dirtyCount(wt.path);
      if (dirty === 0) continue;

      const addRes = await git(["add", "-A"], wt.path);
      if (addRes.code !== 0) throw new Error(addRes.stderr);

      const message = opts.message ? `${name}: ${opts.message}` : `${name}: sync ${isoLocal()}`;
      const commitRes = await git(["commit", "-m", message], wt.path);
      if (commitRes.code !== 0) throw new Error(commitRes.stderr);

      report(`${name}: committed (${dirty} change(s))`);
    } catch (err) {
      hadError = true;
      report(`${wt.branch}: ERROR ${(err as Error).message}`, true);
    }
  }

  if (await hasOrigin(vault)) {
    // Scoped to this machine's attached worktree branches, not `--all`: a
    // bare-cloned vault (`init --from`) mirrors every branch as a local head,
    // including ones never attached here. Pushing those stale heads fails
    // non-fast-forward the moment another machine advances them.
    const pushBranches = all.map((wt) => wt.branch);
    if (pushBranches.length === 0) {
      report("push: skipped (no project worktrees)");
    } else {
      const pushRes = await git(["push", "origin", ...pushBranches], vault);
      if (pushRes.code !== 0) {
        hadError = true;
        report(`push: ERROR ${pushRes.stderr}`, true);
      } else {
        report("push: ok");
      }
    }
  } else {
    report("push: skipped (no origin)", true);
  }

  return hadError ? 1 : 0;
}
