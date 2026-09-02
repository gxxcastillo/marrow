import { matchWorktrees, type ProjectWorktree } from "./git";

export function report(line: string, isError = false): void {
  if (isError) console.error(line);
  else console.log(line);
}

// Resolves each CLI-supplied project name to exactly one worktree, or reports it
// excluded with an accurate reason instead of silently acting on every match — a prior
// version of `sync` reported an ambiguous target as "unknown" yet still synced every one
// of its matches. Shared by `sync` and `refresh`, the two commands that take positional
// project-name targets against the worktree registry.
export function resolveTargets(all: ProjectWorktree[], targets: string[]): { worktrees: ProjectWorktree[]; hadError: boolean } {
  let hadError = false;
  const resolved = new Map<string, ProjectWorktree>(); // keyed by path: dedupes when two targets name the same worktree
  for (const target of targets) {
    const found = matchWorktrees(all, target);
    if (found.length === 0) {
      hadError = true;
      report(`unknown project: ${target}`, true);
    } else if (found.length > 1) {
      hadError = true;
      report(`ambiguous name ${target} matches: ${found.map((w) => w.path).join(", ")}`, true);
    } else {
      resolved.set(found[0].path, found[0]);
    }
  }
  return { worktrees: [...resolved.values()], hadError };
}

// Reports a registered-but-missing worktree directory. Naming it explicitly is an error;
// encountering it during an unnamed all-projects pass is a warning — the branch and its
// ref are unaffected either way, only the worktree directory is gone.
export function reportMissingWorktree(name: string, wt: ProjectWorktree, explicit: boolean): void {
  const remediation = `worktree directory missing at ${wt.path}; run \`marrow detach ${wt.branch}\` to clear the registration`;
  report(`${name}: ${explicit ? "ERROR" : "WARN"} ${remediation}`, true);
}
