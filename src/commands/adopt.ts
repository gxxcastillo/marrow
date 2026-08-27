import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { git, run } from "../git";
import { resolveProject, writeReadme } from "../project";

export interface AdoptOptions {
  dryRun?: boolean;
}

class AdoptAbort extends Error {}

interface Snapshot {
  count: number;
  size: number;
}

async function walk(dir: string, excludeGit = false): Promise<Snapshot> {
  let count = 0;
  let size = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excludeGit && entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(full, excludeGit);
      count += sub.count;
      size += sub.size;
    } else {
      count += 1;
      size += (await stat(full)).size;
    }
  }
  return { count, size };
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type IgnoreState = "ignored" | "untracked" | "tracked" | "no-repo";

async function gitignoreState(projectDir: string): Promise<IgnoreState> {
  const tracked = await git(["ls-files", "--", ".agents"], projectDir);
  if (tracked.code !== 0) return "no-repo";
  if (tracked.stdout.length > 0) return "tracked";
  const ignoreCheck = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
  if (ignoreCheck.code === 0) return "ignored";
  if (ignoreCheck.code === 1) return "untracked";
  return "no-repo";
}

async function appendGitignore(projectDir: string): Promise<void> {
  const gitignorePath = path.join(projectDir, ".gitignore");
  const existing = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  await appendFile(gitignorePath, `${needsNewline ? "\n" : ""}.agents/\n`);
}

async function checkPreconditions(name: string, projectDir: string, marrowHome: string): Promise<IgnoreState> {
  const agentsPath = path.join(projectDir, ".agents");
  if (!existsSync(agentsPath) || !(await stat(agentsPath)).isDirectory()) {
    throw new AdoptAbort(`${agentsPath} does not exist or is not a directory`);
  }
  if (existsSync(path.join(agentsPath, ".git"))) {
    throw new AdoptAbort(`${agentsPath} is already a git worktree`);
  }
  const branchCheck = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], marrowHome);
  if (branchCheck.code === 0) {
    throw new AdoptAbort(`branch '${name}' already exists in marrow`);
  }
  const state = await gitignoreState(projectDir);
  if (state === "no-repo") {
    throw new AdoptAbort(`${projectDir} is not a git repository`);
  }
  if (state === "tracked") {
    throw new AdoptAbort(
      `${projectDir}/.agents is tracked by its parent repo. Untrack it first (attended step):\n` +
        `  cd ${projectDir}\n` +
        `  git rm -r --cached .agents\n` +
        `  echo '.agents/' >> .gitignore\n` +
        `  git add .gitignore\n` +
        `  git commit -m "untrack .agents"\n` +
        `Then re-run: marrow adopt ${name}`,
    );
  }
  return state;
}

export async function adoptCommand(
  projectArg: string,
  opts: AdoptOptions,
  marrowHome: string,
  devRoot: string,
): Promise<number> {
  const { name, dir: projectDir } = resolveProject(projectArg, devRoot);
  const agentsPath = path.join(projectDir, ".agents");

  let state: IgnoreState;
  try {
    state = await checkPreconditions(name, projectDir, marrowHome);
  } catch (err) {
    console.error(`marrow adopt: ${(err as Error).message}`);
    return 1;
  }

  if (state === "untracked") {
    if (opts.dryRun) {
      console.log(`${projectDir}/.agents is untracked but not ignored — would append '.agents/' to .gitignore.`);
    } else {
      await appendGitignore(projectDir);
      console.log(`appended '.agents/' to ${projectDir}/.gitignore — commit that change in the parent repo yourself.`);
    }
  }

  if (opts.dryRun) {
    console.log(`dry run for '${name}':`);
    console.log(`  1. back up ${agentsPath} to ${path.join(marrowHome, "backups", `${name}-${isoDate()}.tar.gz`)}`);
    console.log(`  2. move ${agentsPath} -> ${agentsPath}.pre-marrow`);
    console.log(`  3. git worktree add --orphan -b ${name} ${agentsPath}`);
    console.log(`  4. move contents (including dotfiles) back into the new worktree`);
    console.log(`  5. write/append README.md persistence block`);
    console.log(`  6. commit '${name}: adopt into marrow' and push`);
    return 0;
  }

  const before = await walk(agentsPath);

  const backupsDir = path.join(marrowHome, "backups");
  await mkdir(backupsDir, { recursive: true });
  const tarballPath = path.join(backupsDir, `${name}-${isoDate()}.tar.gz`);
  const tarRes = await run("tar", ["-czf", tarballPath, "-C", projectDir, ".agents"], marrowHome);
  if (tarRes.code !== 0) {
    console.error(`marrow adopt: backup failed, aborting: ${tarRes.stderr}`);
    return 1;
  }
  if ((await stat(tarballPath)).size === 0) {
    console.error("marrow adopt: backup tarball is empty, aborting");
    return 1;
  }
  const listRes = await run("tar", ["-tzf", tarballPath], marrowHome);
  if (listRes.code !== 0 || listRes.stdout.trim() === "") {
    console.error("marrow adopt: backup tarball failed to list, aborting");
    return 1;
  }

  const preMarrowPath = `${agentsPath}.pre-marrow`;
  await rename(agentsPath, preMarrowPath);

  const wtRes = await git(["worktree", "add", "--orphan", "-b", name, agentsPath], marrowHome);
  if (wtRes.code !== 0) {
    await rename(preMarrowPath, agentsPath);
    console.error(`marrow adopt: git worktree add failed, rolled back: ${wtRes.stderr}`);
    return 1;
  }

  for (const entry of await readdir(preMarrowPath, { withFileTypes: true })) {
    await rename(path.join(preMarrowPath, entry.name), path.join(agentsPath, entry.name));
  }
  await rmdir(preMarrowPath);

  await writeReadme(marrowHome, agentsPath, name);

  await git(["add", "-A"], agentsPath);
  const commitRes = await git(["commit", "-m", `${name}: adopt into marrow`], agentsPath);
  if (commitRes.code !== 0) {
    console.error(`marrow adopt: commit failed: ${commitRes.stderr}`);
    return 1;
  }
  const pushRes = await git(["push", "-u", "origin", name], agentsPath);
  if (pushRes.code !== 0) {
    console.error(`marrow adopt: push failed (commit is local, backup at ${tarballPath}): ${pushRes.stderr}`);
    return 1;
  }

  const after = await walk(agentsPath, true);
  console.log(
    `adopted '${name}': ${before.count} file(s)/${before.size}B before, ${after.count} file(s)/${after.size}B after (backup: ${tarballPath})`,
  );
  if (after.count < before.count || after.size < before.size) {
    console.error(`marrow adopt: WARNING possible content loss — verify against ${tarballPath}`);
    return 1;
  }
  return 0;
}
