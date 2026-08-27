import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./git";
import { localBranches } from "./remote";

export const VAULT_LANDING_BRANCH = "main";
export const VAULT_README = `# marrow-vault

Private data vault for [marrow](https://github.com/gxxcastillo/marrow).

Project memory lives on independent project branches and is checked out as
\`.agents/\` worktrees inside each project. This branch is only the GitHub
default branch. Do not put project memory, registry data, or tool configuration
here.
`;

export async function branchesForPublish(vault: string): Promise<string[]> {
  const branches = await localBranches(vault);
  return branches.includes(VAULT_LANDING_BRANCH) ? branches : [VAULT_LANDING_BRANCH, ...branches];
}

export async function ensureVaultLandingBranch(vault: string): Promise<void> {
  if ((await localBranches(vault)).includes(VAULT_LANDING_BRANCH)) return;

  const tmp = await mkdtemp(path.join(os.tmpdir(), "marrow-vault-main-"));
  try {
    const wt = await git(["worktree", "add", "--orphan", "-b", VAULT_LANDING_BRANCH, tmp], vault);
    if (wt.code !== 0) throw new Error(`could not create vault landing worktree: ${wt.stderr}`);
    await git(["config", "user.email", "marrow@example.invalid"], tmp);
    await git(["config", "user.name", "marrow"], tmp);
    await Bun.write(path.join(tmp, "README.md"), VAULT_README);
    const added = await git(["add", "README.md"], tmp);
    if (added.code !== 0) throw new Error(`could not stage vault README: ${added.stderr}`);
    const committed = await git(["commit", "-q", "-m", "seed vault landing branch"], tmp);
    if (committed.code !== 0) throw new Error(`could not commit vault README: ${committed.stderr}`);
  } finally {
    await git(["worktree", "remove", "--force", tmp], vault);
    await rm(tmp, { recursive: true, force: true });
  }
}
