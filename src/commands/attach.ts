import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { ensureAgentMemoryDisabled } from "../agent-config";
import { resolveIdentity } from "../identity";
import { backupAgents } from "../backup";
import { git, hasOrigin, listProjectWorktrees, vaultDir } from "../git";
import { ensureCurrentState, hasCurrentState, writeMemoryFiles } from "../memory-files";
import { ensureAgentsBlock, ensureIgnored, gitignoreState, trackedMessage, type IgnoreState } from "../project";

export interface AttachOptions { dryRun?: boolean; id?: string }
class AttachAbort extends Error {}
interface Target { branch: string; name: string; projectDir: string; agentsPath: string; vault: string; marrowHome: string; toolRoot: string }
interface Worktree { path: string; branch: string; missing: boolean }
type BranchState = "missing" | "local" | "remote";
type AgentsState = "missing" | "directory" | "worktree" | "not-directory";
interface AttachInspection {
  target: Target;
  branchState: BranchState;
  agentsState: AgentsState;
  ignoreState: IgnoreState;
  worktreeAtTarget?: Worktree;
  worktreeForBranch?: Worktree;
}
type AttachPlan =
  | { kind: "already-attached"; target: Target }
  | { kind: "adopt"; target: Target; ignoreState: IgnoreState }
  | { kind: "create"; target: Target; ignoreState: IgnoreState }
  | { kind: "reattach"; target: Target; ignoreState: IgnoreState; localBranch: boolean }
  | { kind: "error"; message: string };

function printTarget(heading: string, t: Target): void {
  console.log(heading);
  console.log(`  project:  ${t.projectDir}`);
  console.log(`  location: ${t.agentsPath}`);
  console.log(`  key:      ${t.branch}`);
}

function printVaultSync(pushed: "pushed" | "not-pushed", branch: string): void {
  console.log(pushed === "pushed" ? `vault: pushed origin/${branch}` : "vault: not pushed (no origin configured)");
}

async function walk(dir: string, excludeGit = false): Promise<{ count: number; size: number }> {
  let count = 0, size = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excludeGit && entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const sub = await walk(full, excludeGit); count += sub.count; size += sub.size; }
    else { count += 1; size += (await stat(full)).size; }
  }
  return { count, size };
}
async function fetchVault(t: Target): Promise<void> {
  if (!(await hasOrigin(t.vault))) return;
  const res = await git(["fetch", "--prune", "origin"], t.vault);
  if (res.code !== 0) throw new AttachAbort(`could not fetch vault origin: ${res.stderr}`);
}
async function branchState(t: Target): Promise<BranchState> {
  if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${t.branch}`], t.vault)).code === 0) return "local";
  if ((await git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${t.branch}`], t.vault)).code === 0) return "remote";
  return "missing";
}
async function agentsState(agentsPath: string): Promise<AgentsState> {
  if (!existsSync(agentsPath)) return "missing";
  if (!(await stat(agentsPath)).isDirectory()) return "not-directory";
  return existsSync(path.join(agentsPath, ".git")) ? "worktree" : "directory";
}
async function commitAndPush(t: Target, subject: string, localNote = ""): Promise<"pushed" | "not-pushed"> {
  await writeMemoryFiles(t.toolRoot, t.agentsPath, t.name, t.branch);
  await git(["add", "-A"], t.agentsPath);
  const commit = await git(["commit", "-m", `${t.name}: ${subject}`], t.agentsPath);
  if (commit.code !== 0) throw new AttachAbort(`commit failed: ${commit.stderr}`);
  return pushBranch(t, localNote);
}

async function pushBranch(t: Target, localNote = ""): Promise<"pushed" | "not-pushed"> {
  if (!(await hasOrigin(t.agentsPath))) return "not-pushed";
  const push = await git(["push", "-u", "origin", t.branch], t.agentsPath);
  if (push.code !== 0) throw new AttachAbort(`push failed (commit is local${localNote}): ${push.stderr}`);
  return "pushed";
}
async function inspectAttach(projectArg: string, opts: AttachOptions, marrowHome: string, toolRoot: string): Promise<AttachInspection> {
  const identity = await resolveIdentity(projectArg, opts.id);
  const target: Target = {
    branch: identity.id,
    name: identity.name,
    projectDir: identity.dir,
    agentsPath: path.join(identity.dir, ".agents"),
    vault: vaultDir(marrowHome),
    marrowHome,
    toolRoot,
  };
  await fetchVault(target);

  const worktrees = await listProjectWorktrees(target.vault);
  return {
    target,
    branchState: await branchState(target),
    agentsState: await agentsState(target.agentsPath),
    ignoreState: existsSync(target.projectDir) ? await gitignoreState(target.projectDir) : "no-repo",
    worktreeAtTarget: worktrees.find((wt) => wt.path === target.agentsPath),
    worktreeForBranch: worktrees.find((wt) => wt.branch === target.branch),
  };
}

function planAttach(i: AttachInspection): AttachPlan {
  const t = i.target;
  if (i.worktreeAtTarget) {
    if (i.worktreeAtTarget.branch !== t.branch) {
      return { kind: "error", message: `${t.agentsPath} is a worktree for '${i.worktreeAtTarget.branch}', not '${t.branch}'` };
    }
    if (i.worktreeAtTarget.missing) {
      return {
        kind: "error",
        message: `${t.agentsPath} is registered for '${t.branch}' but its worktree directory is missing; run \`marrow detach ${t.branch}\` first, then re-run attach`,
      };
    }
    return { kind: "already-attached", target: t };
  }
  if (i.worktreeForBranch) {
    const remediation = i.worktreeForBranch.missing
      ? ` but its worktree directory is missing; run \`marrow detach ${t.branch}\` first, then re-run attach`
      : "";
    return { kind: "error", message: `${t.branch} is already attached at ${i.worktreeForBranch.path}${remediation}` };
  }
  if (i.agentsState === "not-directory") return { kind: "error", message: `${t.agentsPath} exists but is not a directory` };
  if (i.agentsState === "worktree") return { kind: "error", message: `${t.agentsPath} is already a git worktree` };
  if (i.ignoreState === "tracked") return { kind: "error", message: trackedMessage(t.projectDir) };
  if (i.agentsState === "directory") {
    if (i.branchState !== "missing") {
      return { kind: "error", message: `${t.agentsPath} has local content but ${t.branch} already exists; inspect both sources before continuing` };
    }
    if (i.ignoreState === "no-repo") return { kind: "error", message: `${t.projectDir} is not a git repository` };
    return { kind: "adopt", target: t, ignoreState: i.ignoreState };
  }
  return i.branchState === "missing"
    ? { kind: "create", target: t, ignoreState: i.ignoreState }
    : { kind: "reattach", target: t, ignoreState: i.ignoreState, localBranch: i.branchState === "local" };
}

async function adopt(t: Target, state: IgnoreState, dryRun: boolean): Promise<number> {
  if (dryRun) {
    await ensureIgnored(t.projectDir, state, true);
    printTarget(`would attach ${t.name} to marrow`, t);
    console.log("plan: adopt existing .agents");
    return 0;
  }
  const before = await walk(t.agentsPath), tarball = await backupAgents(t.projectDir, t.name, t.marrowHome), moved = `${t.agentsPath}.pre-marrow`;
  await ensureIgnored(t.projectDir, state, false);
  await rename(t.agentsPath, moved);
  const worktree = await git(["worktree", "add", "--orphan", "-b", t.branch, t.agentsPath], t.vault);
  if (worktree.code !== 0) { await rename(moved, t.agentsPath); throw new AttachAbort(`git worktree add failed, rolled back: ${worktree.stderr}`); }
  for (const entry of await readdir(moved, { withFileTypes: true })) await rename(path.join(moved, entry.name), path.join(t.agentsPath, entry.name));
  await rmdir(moved);
  const pushed = await commitAndPush(t, "adopt into marrow", `, backup at ${tarball}`), after = await walk(t.agentsPath, true);
  printTarget(`attached ${t.name} to marrow`, t);
  console.log("");
  console.log("Adopted existing .agents");
  console.log(`  backup: ${tarball}`);
  console.log(`  files:  ${before.count} before, ${after.count} after`);
  console.log(`  size:   ${before.size}B before, ${after.size}B after`);
  console.log("");
  printVaultSync(pushed, t.branch);
  if (after.count < before.count || after.size < before.size) { console.error(`marrow attach: WARNING possible content loss — verify against ${tarball}`); return 1; }
  return 0;
}
async function create(t: Target, state: IgnoreState, dryRun: boolean): Promise<number> {
  if (!dryRun) await mkdir(t.projectDir, { recursive: true });
  await ensureIgnored(t.projectDir, state, dryRun);
  if (dryRun) { printTarget(`would attach ${t.name} to marrow`, t); console.log("plan: create new .agents"); return 0; }
  const worktree = await git(["worktree", "add", "--orphan", "-b", t.branch, t.agentsPath], t.vault);
  if (worktree.code !== 0) throw new AttachAbort(`git worktree add failed: ${worktree.stderr}`);
  const pushed = await commitAndPush(t, "init via marrow attach");
  printTarget(`attached ${t.name} to marrow`, t);
  console.log("");
  console.log("created new .agents");
  console.log("");
  printVaultSync(pushed, t.branch);
  return 0;
}
async function reattach(t: Target, state: IgnoreState, local: boolean, dryRun: boolean): Promise<number> {
  await ensureIgnored(t.projectDir, state, dryRun);
  if (dryRun) { printTarget(`would attach ${t.name} to marrow`, t); return 0; }
  if (!local) {
    const made = await git(["branch", "--track", t.branch, `origin/${t.branch}`], t.vault);
    if (made.code !== 0) throw new AttachAbort(`could not create local branch for ${t.branch}: ${made.stderr}`);
  }
  const worktree = await git(["worktree", "add", t.agentsPath, t.branch], t.vault);
  if (worktree.code !== 0) throw new AttachAbort(`could not attach ${t.branch}: ${worktree.stderr}`);
  printTarget(`attached ${t.name} to marrow`, t);
  return 0;
}

async function alreadyAttached(t: Target, dryRun: boolean): Promise<number> {
  printTarget(`${t.name} is already managed by marrow`, t);
  if (hasCurrentState(t.agentsPath)) return 0;
  console.log("");
  console.log("Working memory:");
  if (dryRun) { console.log("  .agents/current-state.md would be created"); return 0; }
  await ensureCurrentState(t.toolRoot, t.agentsPath, t.name);
  await git(["add", "--", "current-state.md"], t.agentsPath);
  const commit = await git(["commit", "-m", `${t.name}: add current-state`], t.agentsPath);
  if (commit.code !== 0) throw new AttachAbort(`commit failed: ${commit.stderr}`);
  console.log("  .agents/current-state.md created");
  console.log("");
  printVaultSync(await pushBranch(t), t.branch);
  return 0;
}

async function executePlan(plan: AttachPlan, dryRun: boolean): Promise<number> {
  switch (plan.kind) {
    case "already-attached":
      return alreadyAttached(plan.target, dryRun);
    case "adopt":
      return adopt(plan.target, plan.ignoreState, dryRun);
    case "create":
      return create(plan.target, plan.ignoreState, dryRun);
    case "reattach":
      return reattach(plan.target, plan.ignoreState, plan.localBranch, dryRun);
    case "error":
      throw new AttachAbort(plan.message);
  }
}

export async function attachCommand(projectArg: string, opts: AttachOptions, marrowHome: string, toolRoot: string): Promise<number> {
  try {
    const inspection = await inspectAttach(projectArg, opts, marrowHome, toolRoot);
    const dryRun = opts.dryRun === true;
    const code = await executePlan(planAttach(inspection), dryRun);
    if (code === 0) {
      const settingsChanged = await ensureAgentMemoryDisabled(inspection.target.projectDir, dryRun);
      const instructionsChanged = await ensureAgentsBlock(toolRoot, inspection.target.projectDir, inspection.target.name, dryRun);
      if (settingsChanged || instructionsChanged) {
        console.log("");
        console.log("marrow did not commit these project files.");
      }
    }
    return code;
  } catch (err) {
    console.error(`marrow attach: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
