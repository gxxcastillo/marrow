import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveIdentity } from "../identity";
import { git, hasOrigin, listProjectWorktrees, run, vaultDir } from "../git";
import { ensureIgnored, gitignoreState, trackedMessage, writeReadme, type IgnoreState } from "../project";

export interface AddOptions { dryRun?: boolean; id?: string }
class AddAbort extends Error {}
interface Target { id: string; branch: string; name: string; projectDir: string; agentsPath: string; vault: string; marrowHome: string; toolRoot: string }

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
function isoDate(): string { return new Date().toISOString().slice(0, 10); }

async function fetchVault(t: Target): Promise<void> {
  if (!(await hasOrigin(t.vault))) return;
  const res = await git(["fetch", "--prune", "origin"], t.vault);
  if (res.code !== 0) throw new AddAbort(`could not fetch vault origin: ${res.stderr}`);
}
async function branchState(t: Target): Promise<"missing" | "local" | "remote"> {
  if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${t.branch}`], t.vault)).code === 0) return "local";
  if ((await git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${t.branch}`], t.vault)).code === 0) return "remote";
  return "missing";
}
async function parentState(t: Target): Promise<IgnoreState> {
  const state = await gitignoreState(t.projectDir);
  if (state === "tracked") throw new AddAbort(trackedMessage(t.projectDir));
  return state;
}
async function commitAndPush(t: Target, subject: string, localNote = ""): Promise<"pushed" | "not-pushed"> {
  await writeReadme(t.toolRoot, t.agentsPath, t.name, t.branch);
  await git(["add", "-A"], t.agentsPath);
  const commit = await git(["commit", "-m", `${t.name}: ${subject}`], t.agentsPath);
  if (commit.code !== 0) throw new AddAbort(`commit failed: ${commit.stderr}`);
  if (!(await hasOrigin(t.agentsPath))) return "not-pushed";
  const push = await git(["push", "-u", "origin", t.branch], t.agentsPath);
  if (push.code !== 0) throw new AddAbort(`push failed (commit is local${localNote}): ${push.stderr}`);
  return "pushed";
}
async function backup(t: Target): Promise<string> {
  const backups = path.join(t.marrowHome, "backups");
  await mkdir(backups, { recursive: true });
  const tarball = path.join(backups, `${t.name}-${isoDate()}.tar.gz`);
  const made = await run("tar", ["-czf", tarball, "-C", t.projectDir, ".agents"], t.marrowHome);
  if (made.code !== 0 || (await stat(tarball)).size === 0) throw new AddAbort(`backup failed, aborting: ${made.stderr}`);
  const listed = await run("tar", ["-tzf", tarball], t.marrowHome);
  if (listed.code !== 0 || listed.stdout === "") throw new AddAbort("backup tarball failed to list, aborting");
  return tarball;
}

async function adopt(t: Target, state: IgnoreState, dryRun: boolean): Promise<number> {
  if (state === "no-repo") throw new AddAbort(`${t.projectDir} is not a git repository`);
  await ensureIgnored(t.projectDir, state, dryRun);
  if (dryRun) { console.log(`dry run for '${t.name}' (adopting existing .agents/ into ${t.branch}):`); return 0; }
  const before = await walk(t.agentsPath), tarball = await backup(t), moved = `${t.agentsPath}.pre-marrow`;
  await rename(t.agentsPath, moved);
  const worktree = await git(["worktree", "add", "--orphan", "-b", t.branch, t.agentsPath], t.vault);
  if (worktree.code !== 0) { await rename(moved, t.agentsPath); throw new AddAbort(`git worktree add failed, rolled back: ${worktree.stderr}`); }
  for (const entry of await readdir(moved, { withFileTypes: true })) await rename(path.join(moved, entry.name), path.join(t.agentsPath, entry.name));
  await rmdir(moved);
  const pushed = await commitAndPush(t, "adopt into marrow", `, backup at ${tarball}`), after = await walk(t.agentsPath, true);
  console.log(`added '${t.name}': adopted existing .agents (${before.count} file(s)/${before.size}B → ${after.count} file(s)/${after.size}B)`);
  console.log(`backup: ${tarball}`);
  console.log(pushed === "pushed" ? `pushed: origin/${t.branch}` : "not pushed: vault has no origin");
  if (after.count < before.count || after.size < before.size) { console.error(`marrow add: WARNING possible content loss — verify against ${tarball}`); return 1; }
  return 0;
}
async function create(t: Target, state: IgnoreState, dryRun: boolean): Promise<number> {
  if (!dryRun) await mkdir(t.projectDir, { recursive: true });
  await ensureIgnored(t.projectDir, state, dryRun);
  if (dryRun) { console.log(`dry run for '${t.name}' (fresh .agents/ on ${t.branch}):`); return 0; }
  const worktree = await git(["worktree", "add", "--orphan", "-b", t.branch, t.agentsPath], t.vault);
  if (worktree.code !== 0) throw new AddAbort(`git worktree add failed: ${worktree.stderr}`);
  const pushed = await commitAndPush(t, "init via marrow add");
  console.log(`added '${t.name}': created .agents at ${t.agentsPath}`);
  console.log(pushed === "pushed" ? `pushed: origin/${t.branch}` : "not pushed: vault has no origin");
  return 0;
}
async function attach(t: Target, state: IgnoreState, local: boolean, dryRun: boolean): Promise<number> {
  await ensureIgnored(t.projectDir, state, dryRun);
  if (dryRun) { console.log(`dry run for '${t.name}' (attaching ${t.branch} at ${t.agentsPath})`); return 0; }
  if (!local) {
    const made = await git(["branch", "--track", t.branch, `origin/${t.branch}`], t.vault);
    if (made.code !== 0) throw new AddAbort(`could not create local branch for ${t.branch}: ${made.stderr}`);
  }
  const worktree = await git(["worktree", "add", t.agentsPath, t.branch], t.vault);
  if (worktree.code !== 0) throw new AddAbort(`could not attach ${t.branch}: ${worktree.stderr}`);
  console.log(`added '${t.name}': attached ${t.branch} at ${t.agentsPath}`);
  return 0;
}

export async function addCommand(projectArg: string, opts: AddOptions, marrowHome: string, toolRoot: string): Promise<number> {
  try {
    const identity = await resolveIdentity(projectArg, opts.id);
    const t: Target = { ...identity, projectDir: identity.dir, agentsPath: path.join(identity.dir, ".agents"), vault: vaultDir(marrowHome), marrowHome, toolRoot };
    await fetchVault(t);
    const worktrees = await listProjectWorktrees(t.vault), atTarget = worktrees.find((wt) => wt.path === t.agentsPath);
    if (atTarget) {
      if (atTarget.branch === t.branch) { console.log(`added '${t.name}': already attached ${t.branch}`); return 0; }
      throw new AddAbort(`${t.agentsPath} is a worktree for '${atTarget.branch}', not '${t.branch}'`);
    }
    const state = await branchState(t), other = worktrees.find((wt) => wt.branch === t.branch);
    if (other) throw new AddAbort(`${t.branch} is already attached at ${other.path}`);
    const hasAgents = existsSync(t.agentsPath);
    if (hasAgents && !(await stat(t.agentsPath)).isDirectory()) throw new AddAbort(`${t.agentsPath} exists but is not a directory`);
    if (hasAgents && existsSync(path.join(t.agentsPath, ".git"))) throw new AddAbort(`${t.agentsPath} is already a git worktree`);
    const ignored = existsSync(t.projectDir) ? await parentState(t) : "no-repo";
    if (hasAgents && state !== "missing") throw new AddAbort(`${t.agentsPath} has local content but ${t.branch} already exists; inspect both sources before continuing`);
    if (hasAgents) return adopt(t, ignored, opts.dryRun === true);
    if (state === "missing") return create(t, ignored, opts.dryRun === true);
    return attach(t, ignored, state === "local", opts.dryRun === true);
  } catch (err) {
    console.error(`marrow add: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
