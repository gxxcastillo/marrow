import path from "node:path";
import { needsClaudeRedirect } from "./claude-redirect";
import { git, type ProjectWorktree } from "./git";
import { countLabel, displayPath } from "./format";
import { misplacedPlanFiles } from "./layout";
import { persistenceBlockStatus, readCurrentState } from "./memory-files";
import { PARENT_INSTRUCTION_FILENAMES, agentsBlockStatus, updateLabel } from "./project";

type Reporter = (msg: string) => void;

// Six independent per-project health checks in one pass over presentWorktrees:
// gitignore state, the marrow .agents note, the working-memory persistence block,
// the Claude Code redirect, plan-file placement, and current-state.md. None depends
// on another, so they share a single traversal instead of six. Extracted out of
// `doctor.ts` to keep that file under the ~250-line budget (`AGENTS.md` → Build
// discipline).
export async function checkProjectWorktrees(
  toolRoot: string,
  presentWorktrees: ProjectWorktree[],
  ok: Reporter,
  warn: Reporter,
  fail: Reporter,
): Promise<void> {
  let ignoredParents = 0;
  let currentAgentsBlocks = 0;
  let currentPersistenceBlocks = 0;
  let claudeRedirectsPresent = 0;
  let wellPlacedPlans = 0;
  let wellformedCurrentStates = 0;
  for (const wt of presentWorktrees) {
    const projectDir = path.dirname(wt.path);

    // `attach` supports creating a fresh worktree in a plain directory; a parent
    // that is not a git repo has nothing to ignore .agents into.
    const inRepo = await git(["rev-parse", "--is-inside-work-tree"], projectDir);
    if (inRepo.code !== 0) {
      ignoredParents++;
    } else {
      const ignored = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
      if (ignored.code === 0) ignoredParents++;
      else fail(`${wt.branch}: parent repo (${projectDir}) does not ignore .agents`);
    }

    // `attach` plants this note on every attach and re-verifies it on every re-run, but
    // nothing catches drift (a manual edit, a merge) between runs short of re-running
    // `attach`. WARN, not FAIL — a missing or stale note doesn't break marrow, it just
    // leaves agents in that project without the pointer.
    const status = await agentsBlockStatus(toolRoot, projectDir, wt.path, path.basename(projectDir));
    if (status.kind === "current") {
      currentAgentsBlocks++;
    } else if (status.kind === "missing") {
      warn(`${wt.branch}: no marrow .agents note in ${PARENT_INSTRUCTION_FILENAMES.join(" or ")}; run \`marrow refresh ${displayPath(projectDir)}\` to add it`);
    } else {
      const versions = status.files.map((f) => `${path.basename(f.path)} ${updateLabel(f.fromVersion, status.currentVersion)}`).join(", ");
      warn(`${wt.branch}: stale marrow .agents note (${versions}); run \`marrow refresh ${displayPath(projectDir)}\` to update it`);
    }

    // The working-memory persistence block gets the same staleness detection and
    // `refresh` remediation as the note above — tracking a version in the ledger only
    // means something once something reads and acts on it.
    const blockStatus = await persistenceBlockStatus(toolRoot, wt.path, path.basename(projectDir), wt.branch);
    if (blockStatus.kind === "current") {
      currentPersistenceBlocks++;
    } else if (blockStatus.kind === "missing") {
      warn(`${wt.branch}: no marrow working-memory block in .agents/README.md; run \`marrow refresh ${displayPath(projectDir)}\` to add it`);
    } else {
      warn(`${wt.branch}: stale marrow working-memory block; run \`marrow refresh ${displayPath(projectDir)}\` to update it`);
    }

    // Claude Code only auto-loads CLAUDE.md, never AGENTS.md directly — a project
    // carrying the note in AGENTS.md alone silently strands Claude Code agents.
    if (needsClaudeRedirect(projectDir)) {
      warn(`${wt.branch}: AGENTS.md has no CLAUDE.md redirect; Claude Code will not auto-load it; run \`marrow refresh ${displayPath(projectDir)}\` to add one`);
    } else {
      claudeRedirectsPresent++;
    }

    // `status`'s blocked-on-you scan reads only a direct `plans/*.md` child; a
    // root-level `*-plan.md` file is structurally invisible to it regardless of
    // content. WARN, not FAIL — it degrades one status signal, nothing more.
    const misplaced = await misplacedPlanFiles(wt.path);
    if (misplaced.length > 0) {
      warn(`${wt.branch}: ${countLabel(misplaced.length, "plan file")} at .agents root, not plans/; move them into plans/`);
    } else {
      wellPlacedPlans++;
    }

    const currentState = await readCurrentState(wt.path);
    if (!currentState) {
      warn(
        `${wt.branch}: missing required .agents/current-state.md; create it with an honest As of stamp, then run \`marrow sync ${wt.branch}\``,
      );
    } else if (!currentState.stamp) {
      warn(
        `${wt.branch}: malformed As of stamp in .agents/current-state.md; use ` +
          `As of YYYY-MM-DD (@<short-sha> + <parent commit subject>) or @no-HEAD, then run \`marrow sync ${wt.branch}\``,
      );
    } else {
      wellformedCurrentStates++;
    }
  }
  if (ignoredParents === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`.agents ignored for ${countLabel(presentWorktrees.length, "project parent")}`);
  }
  if (currentAgentsBlocks === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`marrow .agents note current for ${countLabel(presentWorktrees.length, "project parent")}`);
  }
  if (currentPersistenceBlocks === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`working-memory block current for ${countLabel(presentWorktrees.length, "project worktree")}`);
  }
  if (claudeRedirectsPresent === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`CLAUDE.md redirect present for ${countLabel(presentWorktrees.length, "project parent")}`);
  }
  if (wellPlacedPlans === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`no misplaced plan files for ${countLabel(presentWorktrees.length, "project worktree")}`);
  }
  if (wellformedCurrentStates === presentWorktrees.length && presentWorktrees.length > 0) {
    ok(`current-state.md stamps well formed for ${countLabel(presentWorktrees.length, "project worktree")}`);
  }
}
