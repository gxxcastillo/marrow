import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { aheadBehind, dirtyCount, git, hasOrigin, listProjectWorktrees, vaultDir } from "../git";

export interface SyncOptions {
  message?: string;
  auto?: boolean;
}

function isoLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --auto redirects every line to <MARROW_HOME>/logs/sync.log instead of the
// terminal, so a hook or scheduled job leaves a record without writing to stdout.
async function report(marrowHome: string, auto: boolean | undefined, line: string, isError = false): Promise<void> {
  if (!auto) {
    if (isError) console.error(line);
    else console.log(line);
    return;
  }
  const logsDir = path.join(marrowHome, "logs");
  await mkdir(logsDir, { recursive: true });
  await appendFile(path.join(logsDir, "sync.log"), `${isoLocal()} ${line}\n`);
}

export async function syncCommand(targets: string[], opts: SyncOptions, marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const all = await listProjectWorktrees(vault);
  const matches = (target: string) => all.filter((w) => w.branch === target || path.basename(path.dirname(w.path)) === target);
  const worktrees = targets.length > 0 ? targets.flatMap(matches) : all;

  let hadError = false;

  if (targets.length > 0) {
    const missing = targets.filter((t) => matches(t).length !== 1);
    if (missing.length > 0) {
      hadError = true;
      await report(marrowHome, opts.auto, `unknown project(s): ${missing.join(", ")}`, true);
    }
  }

  if (await hasOrigin(vault)) {
    const fetchRes = await git(["fetch", "--prune", "origin"], vault);
    if (fetchRes.code !== 0) {
      if (!opts.auto) hadError = true;
      await report(marrowHome, opts.auto, `fetch: WARN ${fetchRes.stderr}`, true);
    }
  }

  for (const wt of worktrees) {
    try {
      const name = path.basename(path.dirname(wt.path));
      const syncState = await aheadBehind(wt.path, wt.branch);
      if (syncState?.behind) {
        const dirtyBeforePull = await dirtyCount(wt.path);
        if (dirtyBeforePull > 0 || syncState.ahead > 0) {
          throw new Error("remote changes require manual reconciliation");
        }
        const fastForward = await git(["merge", "--ff-only", `origin/${wt.branch}`], wt.path);
        if (fastForward.code !== 0) throw new Error(`fast-forward failed: ${fastForward.stderr}`);
        await report(marrowHome, opts.auto, `${name}: fast-forwarded`);
      }
      const dirty = await dirtyCount(wt.path);
      if (dirty === 0) continue;

      const addRes = await git(["add", "-A"], wt.path);
      if (addRes.code !== 0) throw new Error(addRes.stderr);

      const message = opts.message ? `${name}: ${opts.message}` : `${name}: sync ${isoLocal()}`;
      const commitRes = await git(["commit", "-m", message], wt.path);
      if (commitRes.code !== 0) throw new Error(commitRes.stderr);

      await report(marrowHome, opts.auto, `${name}: committed (${dirty} change(s))`);
    } catch (err) {
      hadError = true;
      await report(marrowHome, opts.auto, `${wt.branch}: ERROR ${(err as Error).message}`, true);
    }
  }

  if (await hasOrigin(vault)) {
    // Scoped to this machine's attached worktree branches, not `--all`: a
    // bare-cloned vault (`init --from`) mirrors every branch as a local head,
    // including ones never attached here. Pushing those stale heads fails
    // non-fast-forward the moment another machine advances them.
    const pushBranches = all.map((wt) => wt.branch);
    if (pushBranches.length === 0) {
      await report(marrowHome, opts.auto, "push: skipped (no project worktrees)");
    } else {
      const pushRes = await git(["push", "origin", ...pushBranches], vault);
      if (pushRes.code !== 0) {
        // Offline / unreachable push is tolerated in --auto mode; still surfaced as an error otherwise.
        if (!opts.auto) hadError = true;
        await report(marrowHome, opts.auto, `push: ERROR ${pushRes.stderr}`, true);
      } else {
        await report(marrowHome, opts.auto, "push: ok");
      }
    }
  } else {
    await report(marrowHome, opts.auto, "push: skipped (no origin)", true);
  }

  if (opts.auto) return 0;
  return hadError ? 1 : 0;
}
