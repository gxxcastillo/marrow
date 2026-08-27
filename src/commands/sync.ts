import path from "node:path";
import { aheadBehind, dirtyCount, git, hasOrigin, listProjectWorktrees, vaultDir, type ProjectWorktree } from "../git";

export interface SyncOptions {
  message?: string;
}

function isoLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function report(line: string, isError = false): void {
  if (isError) console.error(line);
  else console.log(line);
}

// Printed for a manual-reconciliation refusal, in the same style as
// `project.ts`'s `trackedMessage`: marrow itself never merges, rebases, or
// stashes (`architecture.md` → Non-goals) — this is guidance for the human,
// not a command marrow runs.
function reconciliationMessage(name: string, agentsPath: string, branch: string, diverged: boolean): string {
  if (diverged) {
    return (
      `${name} has diverged from origin/${branch} — both sides have commits the other lacks; reconcile manually:\n` +
      `  cd ${agentsPath}\n` +
      `  git pull --no-rebase origin ${branch}\n` +
      `Then re-run: marrow sync ${name}`
    );
  }
  return (
    `${name} has local changes and origin/${branch} has moved; reconcile manually:\n` +
    `  cd ${agentsPath}\n` +
    `  git stash\n` +
    `  git merge --ff-only origin/${branch}\n` +
    `  git stash pop\n` +
    `Then re-run: marrow sync ${name}`
  );
}

export async function syncCommand(targets: string[], opts: SyncOptions, marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const all = await listProjectWorktrees(vault);
  const matches = (target: string) => all.filter((w) => w.branch === target || path.basename(path.dirname(w.path)) === target);

  let hadError = false;
  let worktrees = all;

  if (targets.length > 0) {
    // Each target resolves to exactly one worktree or is excluded with an
    // accurate reason — a prior version reported an ambiguous target as
    // "unknown" yet still synced every one of its matches.
    const resolved = new Map<string, ProjectWorktree>();
    for (const target of targets) {
      const found = matches(target);
      if (found.length === 0) {
        hadError = true;
        report(`unknown project: ${target}`, true);
      } else if (found.length > 1) {
        hadError = true;
        report(`ambiguous name ${target} matches: ${found.map((w) => w.path).join(", ")}`, true);
      } else {
        resolved.set(found[0].path, found[0]); // keyed by path: dedupes when two targets name the same worktree
      }
    }
    worktrees = [...resolved.values()];
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
      const remediation = `worktree directory missing at ${wt.path}; run \`marrow detach ${wt.branch}\` to clear the registration`;
      if (targets.length > 0) {
        hadError = true;
        report(`${name}: ERROR ${remediation}`, true);
      } else {
        report(`${name}: WARN ${remediation}`, true);
      }
      continue;
    }
    try {
      const syncState = await aheadBehind(wt.path, wt.branch);
      if (syncState?.behind) {
        const dirtyBeforePull = await dirtyCount(wt.path);
        if (dirtyBeforePull > 0 || syncState.ahead > 0) {
          throw new Error(reconciliationMessage(name, wt.path, wt.branch, syncState.ahead > 0));
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
