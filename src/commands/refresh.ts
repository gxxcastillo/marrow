import path from "node:path";
import { agentMemoryChangesPending, computeAgentMemoryChanges, ensureAgentMemoryDisabled, type AgentMemoryChanges } from "../agent-config";
import { ensureClaudeRedirect, needsClaudeRedirect } from "../claude-redirect";
import { listProjectWorktrees, vaultDir } from "../git";
import { persistenceBlockStatus, writeReadme, type PersistenceBlockStatus } from "../memory-files";
import { agentsBlockStatus, ensureAgentsBlock, updateLabel, type AgentsBlockStatus } from "../project";
import { report, reportMissingWorktree, resolveTargets } from "../target-resolution";

export interface RefreshOptions {
  dryRun?: boolean;
}

interface RefreshStatus {
  needsUpdate: boolean;
  blockStatus: AgentsBlockStatus;
  blockFileStatus: PersistenceBlockStatus;
  needsRedirect: boolean;
  memory: AgentMemoryChanges;
}

// Read-only precheck across all four parent-repo-footprint concerns, using each
// concern's own existing pure predicate (`agentsBlockStatus`, `persistenceBlockStatus`,
// `needsClaudeRedirect`, `computeAgentMemoryChanges`) rather than the return value of
// the print-and-write ensure* functions, which in `--dry-run` mode always report
// `false` regardless of whether a change is pending. This is what lets a fully current
// project stay completely silent instead of still printing its heading. The computed
// pieces are returned (not just a boolean) so a project that does need work can hand
// them straight to the functions below instead of those functions re-reading the same
// files.
async function refreshStatus(toolRoot: string, projectDir: string, agentsPath: string, project: string, branch: string): Promise<RefreshStatus> {
  const blockStatus = await agentsBlockStatus(toolRoot, projectDir, agentsPath, project);
  const blockFileStatus = await persistenceBlockStatus(toolRoot, agentsPath, project, branch);
  const needsRedirect = needsClaudeRedirect(projectDir);
  const memory = await computeAgentMemoryChanges(projectDir);
  const needsUpdate =
    blockStatus.kind !== "current" || blockFileStatus.kind !== "current" || needsRedirect || agentMemoryChangesPending(memory);
  return { needsUpdate, blockStatus, blockFileStatus, needsRedirect, memory };
}

// Mirrors `ensureAgentsBlock`'s reporting shape for the working-memory persistence
// block: silent when current, a labeled add/update line under a `Working memory:`
// heading otherwise, writing only outside `--dry-run`.
async function ensurePersistenceBlock(
  toolRoot: string,
  agentsPath: string,
  project: string,
  branch: string,
  status: PersistenceBlockStatus,
  dryRun: boolean,
): Promise<void> {
  if (status.kind === "current") return;
  console.log("");
  console.log("Working memory:");
  const target = ".agents/README.md".padEnd(25);
  if (status.kind === "missing") {
    if (dryRun) {
      console.log(`  ${target} would add working memory block`);
      return;
    }
    await writeReadme(toolRoot, agentsPath, project, branch);
    console.log(`  ${target} working memory block added`);
    return;
  }
  const label = updateLabel(status.installedVersion ?? "unknown", status.currentVersion);
  if (dryRun) {
    console.log(`  ${target} would update working memory block (${label})`);
    return;
  }
  await writeReadme(toolRoot, agentsPath, project, branch);
  console.log(`  ${target} working memory block updated (${label})`);
}

// Reconciles every already-attached project's marrow-managed footprint — the `.agents`
// note, the working-memory persistence block, the CLAUDE.md redirect, and the
// agent-memory settings — against whatever the current templates say. Target resolution
// is shared with `sync` (`../target-resolution`); per-project work reuses `attach.ts`'s
// already-attached-path call sequence verbatim for the note/redirect/settings concerns.
// Never touches `current-state.md`, and never commits or pushes vault git state — a
// project whose note or persistence block needed a fix is left with that one ledger
// edit uncommitted, for a later `marrow sync` to pick up.
export async function refreshCommand(targets: string[], opts: RefreshOptions, marrowHome: string, toolRoot: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  const all = await listProjectWorktrees(vault);
  const dryRun = opts.dryRun === true;

  let hadError = false;
  let worktrees = all;

  if (targets.length > 0) {
    // Every target this command can name is by definition already attached (it comes
    // from listProjectWorktrees), so there is no create/adopt path to gate here.
    const resolution = resolveTargets(all, targets);
    hadError = resolution.hadError;
    worktrees = resolution.worktrees;
  }

  let updated = 0;
  let unchanged = 0;

  for (const wt of worktrees) {
    const name = path.basename(path.dirname(wt.path));
    if (wt.missing) {
      // Same WARN/ERROR-by-explicitness split as `sync` (`sync.ts:62-73`): the branch
      // and its ref are untouched either way, only the worktree directory is gone.
      const explicit = targets.length > 0;
      reportMissingWorktree(name, wt, explicit);
      if (explicit) hadError = true;
      continue;
    }

    const projectDir = path.dirname(wt.path);
    const status = await refreshStatus(toolRoot, projectDir, wt.path, name, wt.branch);
    if (!status.needsUpdate) {
      unchanged++;
      continue;
    }

    report(`${name}:`);
    await ensureAgentMemoryDisabled(projectDir, dryRun, status.memory);
    await ensureAgentsBlock(toolRoot, projectDir, wt.path, name, dryRun, status.blockStatus);
    await ensureClaudeRedirect(toolRoot, projectDir, dryRun);
    await ensurePersistenceBlock(toolRoot, wt.path, name, wt.branch, status.blockFileStatus, dryRun);
    updated++;
  }

  report(`refresh: ${updated} project(s) updated, ${unchanged} unchanged`);
  return hadError ? 1 : 0;
}
