import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { countLabel } from "../format";
import { aheadBehind, dirtyCount, git, gitRaw, listProjectWorktrees, matchWorktrees, vaultDir } from "../git";
import { withoutPersistenceSection } from "../memory-files";
import { stripLedger } from "../version-ledger";

export interface DetachOptions {
  dryRun?: boolean;
  vaultOnly?: boolean;
}

async function vaultOnlyDetach(
  name: string,
  branch: string,
  worktreePath: string,
  dryRun: boolean,
  vault: string,
): Promise<number> {
  const dirty = await dirtyCount(worktreePath);
  if (dirty > 0) {
    console.error(
      `marrow detach: ${worktreePath} has ${dirty} uncommitted change(s); refusing --vault-only for a dirty worktree.\n` +
        `  Sync it first: marrow sync ${name}\n` +
        `  Or discard the changes: git -C ${worktreePath} checkout -- . && git -C ${worktreePath} clean -fd`,
    );
    return 1;
  }
  if (dryRun) {
    console.log(`dry run: would remove the worktree for '${name}' at ${worktreePath}; branch ${branch} would be retained in the vault`);
    return 0;
  }
  const ab = await aheadBehind(worktreePath, branch);
  const removed = await git(["worktree", "remove", worktreePath], vault);
  if (removed.code !== 0) {
    console.error(`marrow detach: could not remove worktree: ${removed.stderr}`);
    return 1;
  }
  const note = ab && ab.ahead > 0 ? `, ${countLabel(ab.ahead, "unpushed commit")} retained on the branch` : "";
  console.log(`detached '${name}': removed the worktree at ${worktreePath}; branch '${branch}' is retained in the vault${note}`);
  return 0;
}

// Composes the two disjoint marrow-authored regions of a retained README — the fenced
// persistence block (or its identifiable historical unfenced form) and the frontmatter
// version ledger — into one removal, returning `null` only when neither was present.
function withoutMarrowMetadata(content: string): string | null {
  const withoutPersistence = withoutPersistenceSection(content);
  const base = withoutPersistence ?? content;
  const stripped = stripLedger(base);
  return withoutPersistence !== null || stripped !== base ? stripped : null;
}

function printParentReminder(projectPath: string): void {
  console.log("Parent project files were left unchanged:");
  console.log(`  ${path.join(projectPath, ".gitignore")} — remove .agents/ only if it should be tracked`);
  console.log(`  AGENTS.md/CLAUDE.md — remove the .agents note only if the convention is no longer used`);
  console.log(`  .codex/config.toml and .claude/settings.json — re-enable built-in memory only if wanted`);
}

async function keepFilesDetach(
  name: string,
  branch: string,
  worktreePath: string,
  dryRun: boolean,
  vault: string,
): Promise<number> {
  const dirty = await dirtyCount(worktreePath);
  const readmePath = path.join(worktreePath, "README.md");
  const originalReadme = existsSync(readmePath) ? await readFile(readmePath, "utf8") : null;
  const diskRemoval = originalReadme === null ? null : withoutMarrowMetadata(originalReadme);
  const retainedReadme = diskRemoval ?? originalReadme;
  const trackedReadme = await git(["ls-tree", "--name-only", "HEAD", "--", "README.md"], worktreePath);
  if (trackedReadme.code !== 0) {
    console.error(`marrow detach: could not inspect the committed README: ${trackedReadme.stderr}`);
    return 1;
  }
  const committedReadme = trackedReadme.stdout === "" ? null : await gitRaw(["show", "HEAD:README.md"], worktreePath);
  if (committedReadme && committedReadme.code !== 0) {
    console.error(`marrow detach: could not read the committed README: ${committedReadme.stderr}`);
    return 1;
  }
  const branchRemoval = committedReadme ? withoutMarrowMetadata(committedReadme.stdout) : null;
  if (dryRun) {
    console.log(`dry run: would keep ${worktreePath} as ordinary files and retain branch '${branch}' in the vault`);
    if (diskRemoval !== null) console.log("dry run: would remove marrow's persistence block and version ledger from .agents/README.md");
    if (dirty > 0) console.log(`warning: ${dirty} uncommitted change(s) would remain in the retained files`);
    printParentReminder(path.dirname(worktreePath));
    return 0;
  }

  const moved = `${worktreePath}.detaching`;
  try {
    if (branchRemoval !== null) {
      // Build the branch commit from HEAD's README, not the dirty working copy. `--only`
      // also excludes unrelated staged paths. The retained file is restored immediately
      // afterward with its user edits intact and only the persistence block removed.
      await writeFile(readmePath, branchRemoval);
      const committed = await git(["commit", "--only", "-m", `${name}: detach from marrow`, "--", "README.md"], worktreePath);
      if (committed.code !== 0) throw new Error(`could not commit the persistence-block removal: ${committed.stderr}`);
    }
    if (retainedReadme === null) await rm(readmePath, { force: true });
    else await writeFile(readmePath, retainedReadme);
    await rename(worktreePath, moved);
    const removed = await git(["worktree", "remove", "--force", worktreePath], vault);
    if (removed.code !== 0) throw new Error(`could not clear the worktree registration: ${removed.stderr}`);
    await rename(moved, worktreePath);
    await rm(path.join(worktreePath, ".git"), { recursive: true, force: true });
    await git(["worktree", "prune"], vault);
  } catch (err) {
    if (!existsSync(worktreePath) && existsSync(moved)) await rename(moved, worktreePath);
    if (existsSync(worktreePath)) {
      if (originalReadme === null) await rm(readmePath, { force: true });
      else await writeFile(readmePath, originalReadme);
    }
    console.error(`marrow detach: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  console.log(`detached '${name}': kept ordinary files at ${worktreePath}; branch '${branch}' is retained in the vault`);
  if (dirty > 0) console.log(`warning: retained files started with ${dirty} uncommitted change(s); inspect them before deleting the vault branch`);
  printParentReminder(path.dirname(worktreePath));
  return 0;
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

  return opts.vaultOnly
    ? vaultOnlyDetach(name, wt.branch, wt.path, opts.dryRun === true, vault)
    : keepFilesDetach(name, wt.branch, wt.path, opts.dryRun === true, vault);
}
