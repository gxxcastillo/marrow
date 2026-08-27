import { listProjectWorktrees, vaultDir } from "../git";
import { unattachedBranches } from "../vault";

function countLabel(count: number, noun: string, plural = `${noun}es`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

// Unattached branches go to stderr, never stdout: stdout belongs to rg's match
// stream, which callers pipe. A partial search reported as a complete one is
// the failure mode grep exists to prevent, one level up.
function reportPartial(searched: number, unattached: string[]): void {
  if (unattached.length === 0) return;
  const scope = searched === 0
    ? "no project branches are attached here"
    : `searched ${searched} of ${searched + unattached.length} project branches`;
  console.error(
    `marrow grep: ${scope}; ${countLabel(unattached.length, "branch", "branches")} in the vault not attached on this machine ` +
      `(attach with \`marrow add <project-path>\`): ${unattached.join(", ")}`,
  );
}

export async function grepCommand(pattern: string, extraArgs: string[], marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const worktrees = await listProjectWorktrees(vault);
  const unattached = await unattachedBranches(vault, worktrees);

  if (worktrees.length === 0) {
    console.log("No project worktrees.");
    reportPartial(0, unattached);
    return 0;
  }

  // A registered worktree whose directory is gone can't be searched; report
  // it rather than pass a nonexistent path to rg/grep.
  const missing = worktrees.filter((w) => w.missing);
  const present = worktrees.filter((w) => !w.missing);
  if (missing.length > 0) {
    console.error(
      `marrow grep: skipping ${countLabel(missing.length, "branch", "branches")} with a missing worktree directory ` +
        `(run \`marrow detach <project>\` to clear the registration): ${missing.map((w) => w.branch).join(", ")}`,
    );
  }
  if (present.length === 0) {
    console.log("No project worktrees.");
    return 0;
  }
  const paths = present.map((w) => w.path);
  reportPartial(present.length, unattached);

  const cmd = Bun.which("rg")
    ? ["rg", "--hidden", "--no-ignore", "-g", "!.git", pattern, ...extraArgs, ...paths]
    : ["grep", "-rn", "--exclude-dir=.git", pattern, ...paths, ...extraArgs];

  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}
