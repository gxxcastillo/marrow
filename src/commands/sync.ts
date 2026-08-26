import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dirtyCount, git, hasOrigin, listProjectWorktrees } from "../git";

export interface SyncOptions {
  message?: string;
  auto?: boolean;
}

function isoLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function logLine(marrowHome: string, line: string): Promise<void> {
  const logsDir = path.join(marrowHome, "logs");
  await mkdir(logsDir, { recursive: true });
  await appendFile(path.join(logsDir, "sync.log"), `${isoLocal()} ${line}\n`);
}

async function report(marrowHome: string, auto: boolean | undefined, line: string, isError = false): Promise<void> {
  if (auto) {
    await logLine(marrowHome, line);
    return;
  }
  if (isError) console.error(line);
  else console.log(line);
}

export async function syncCommand(targets: string[], opts: SyncOptions, marrowHome: string): Promise<number> {
  const all = await listProjectWorktrees(marrowHome);
  const worktrees = targets.length > 0 ? all.filter((w) => targets.includes(w.branch)) : all;

  let hadError = false;

  if (targets.length > 0) {
    const found = new Set(worktrees.map((w) => w.branch));
    const missing = targets.filter((t) => !found.has(t));
    if (missing.length > 0) {
      hadError = true;
      await report(marrowHome, opts.auto, `unknown project(s): ${missing.join(", ")}`, true);
    }
  }

  for (const wt of worktrees) {
    try {
      const dirty = await dirtyCount(wt.path);
      if (dirty === 0) continue;

      const addRes = await git(["add", "-A"], wt.path);
      if (addRes.code !== 0) throw new Error(addRes.stderr);

      const message = opts.message ? `${wt.branch}: ${opts.message}` : `${wt.branch}: sync ${isoLocal()}`;
      const commitRes = await git(["commit", "-m", message], wt.path);
      if (commitRes.code !== 0) throw new Error(commitRes.stderr);

      await report(marrowHome, opts.auto, `${wt.branch}: committed (${dirty} change(s))`);
    } catch (err) {
      hadError = true;
      await report(marrowHome, opts.auto, `${wt.branch}: ERROR ${(err as Error).message}`, true);
    }
  }

  if (await hasOrigin(marrowHome)) {
    const pushRes = await git(["push", "origin", "--all"], marrowHome);
    if (pushRes.code !== 0) {
      // Offline / unreachable push is tolerated in --auto mode; still surfaced as an error otherwise.
      if (!opts.auto) hadError = true;
      await report(marrowHome, opts.auto, `push: ERROR ${pushRes.stderr}`, true);
    } else {
      await report(marrowHome, opts.auto, "push: ok");
    }
  } else {
    await report(marrowHome, opts.auto, "push: skipped (no origin)", true);
  }

  if (opts.auto) return 0;
  return hadError ? 1 : 0;
}
