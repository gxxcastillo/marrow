import { listProjectWorktrees, vaultDir } from "../git";

export async function grepCommand(pattern: string, extraArgs: string[], marrowHome: string): Promise<number> {
  const worktrees = await listProjectWorktrees(vaultDir(marrowHome));
  if (worktrees.length === 0) {
    console.log("No project worktrees.");
    return 0;
  }
  const paths = worktrees.map((w) => w.path);

  const cmd = Bun.which("rg")
    ? ["rg", "--hidden", "--no-ignore", "-g", "!.git", pattern, ...extraArgs, ...paths]
    : ["grep", "-rn", "--exclude-dir=.git", pattern, ...paths, ...extraArgs];

  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}
