import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { git } from "../git";
import { resolveProject, writeReadme } from "../project";

export async function newCommand(projectArg: string, marrowHome: string, devRoot: string): Promise<number> {
  const { name, dir: projectDir } = resolveProject(projectArg, devRoot);
  const agentsPath = path.join(projectDir, ".agents");

  if (existsSync(agentsPath)) {
    console.error(`marrow new: ${agentsPath} already exists — use 'marrow adopt ${name}'`);
    return 1;
  }
  const branchCheck = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], marrowHome);
  if (branchCheck.code === 0) {
    console.error(`marrow new: branch '${name}' already exists in marrow`);
    return 1;
  }

  await mkdir(projectDir, { recursive: true });
  const wtRes = await git(["worktree", "add", "--orphan", "-b", name, agentsPath], marrowHome);
  if (wtRes.code !== 0) {
    console.error(`marrow new: git worktree add failed: ${wtRes.stderr}`);
    return 1;
  }

  await writeReadme(marrowHome, agentsPath, name);

  await git(["add", "-A"], agentsPath);
  const commitRes = await git(["commit", "-m", `${name}: init via marrow new`], agentsPath);
  if (commitRes.code !== 0) {
    console.error(`marrow new: commit failed: ${commitRes.stderr}`);
    return 1;
  }
  const pushRes = await git(["push", "-u", "origin", name], agentsPath);
  if (pushRes.code !== 0) {
    console.error(`marrow new: push failed (commit is local): ${pushRes.stderr}`);
    return 1;
  }

  console.log(`created .agents worktree for '${name}' at ${agentsPath}`);
  return 0;
}
