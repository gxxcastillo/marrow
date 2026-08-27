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
  const paths = worktrees.map((w) => w.path);
  reportPartial(worktrees.length, unattached);

  const cmd = Bun.which("rg")
    ? ["rg", "--hidden", "--no-ignore", "-g", "!.git", pattern, ...extraArgs, ...paths]
    : ["grep", "-rn", "--exclude-dir=.git", pattern, ...paths, ...extraArgs];

  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}
