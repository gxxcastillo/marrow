import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, vaultDir } from "../src/git";

const REAL_TOOL_ROOT = path.join(import.meta.dir, "..");
const REAL_TEMPLATES_DIR = path.join(REAL_TOOL_ROOT, "templates");
const REAL_CONVENTION = path.join(REAL_TOOL_ROOT, "CONVENTION.md");

export const FIXTURE_VERSION = "9.9.9-test";

export interface Fixture {
  root: string;
  toolRoot: string;
  marrowHome: string;
  projectsRoot: string;
  bareOrigin: string;
  cleanup: () => Promise<void>;
}

function guardNotReal(candidate: string, real: string, label: string): void {
  if (path.resolve(candidate) === path.resolve(real)) {
    throw new Error(`refusing to run tests against the real ${label}`);
  }
}

// Builds throwaway stand-ins for both repos in the two-repo design: a fake
// tool root (for templates/CONVENTION.md resolution) and a fake bare vault
// (MARROW_HOME) with its own file://-backed bare origin, plus explicit project
// paths. Tests never touch real project repos or the configured default vault.
export async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "marrow-test-"));
  const toolRoot = path.join(root, "tool");
  const marrowHome = path.join(root, "marrow-home");
  const projectsRoot = path.join(root, "dev");
  const bareOrigin = path.join(root, "origin.git");

  guardNotReal(marrowHome, path.join(process.env.HOME ?? "", ".marrow"), "~/.marrow vault");
  guardNotReal(toolRoot, REAL_TOOL_ROOT, "marrow tool checkout");

  await mkdir(toolRoot, { recursive: true });
  await cp(REAL_TEMPLATES_DIR, path.join(toolRoot, "templates"), { recursive: true });
  await cp(REAL_CONVENTION, path.join(toolRoot, "CONVENTION.md"));
  // `marrow --version` reads the tool root's package.json. Synthetic, not a copy
  // of the real one, so the version assertion doesn't move with each release.
  await Bun.write(path.join(toolRoot, "package.json"), `{ "name": "marrow", "version": "${FIXTURE_VERSION}" }\n`);

  await mkdir(projectsRoot, { recursive: true });

  const vault = vaultDir(marrowHome);
  await mkdir(vault, { recursive: true });
  await git(["init", "-q", "--bare", "-b", "main"], vault);

  await git(["init", "-q", "--bare", "-b", "main", bareOrigin], root);
  await git(["remote", "add", "origin", bareOrigin], vault);

  return {
    root,
    toolRoot,
    marrowHome,
    projectsRoot,
    bareOrigin,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

// Adds an orphan project worktree (mirrors `marrow add`'s adopt-mode step 4 onward) and
// gives it one seed commit, pushed to origin.
export async function addProjectWorktree(fx: Fixture, project: string, branch = project): Promise<string> {
  const projectDir = path.join(fx.projectsRoot, project);
  const agentsPath = path.join(projectDir, ".agents");
  await mkdir(projectDir, { recursive: true });

  const wt = await git(["worktree", "add", "--orphan", "-b", branch, agentsPath], vaultDir(fx.marrowHome));
  if (wt.code !== 0) throw new Error(`worktree add failed: ${wt.stderr}`);

  await git(["config", "user.email", "test@example.com"], agentsPath);
  await git(["config", "user.name", "marrow test"], agentsPath);
  await Bun.write(path.join(agentsPath, "README.md"), `# ${project}\n`);
  await git(["add", "-A"], agentsPath);
  await git(["commit", "-q", "-m", `${project}: seed`], agentsPath);
  await git(["push", "-q", "origin", branch], agentsPath);

  return agentsPath;
}

export type IgnoreState = "ignored" | "untracked" | "tracked";

// Builds a standalone parent project repo (distinct from the marrow vault)
// with a populated .agents/ dir, in one of the three gitignore states `add`'s
// adopt mode must handle.
export async function makeProjectRepo(
  fx: Fixture,
  name: string,
  ignoreState: IgnoreState,
  parentDir = fx.projectsRoot,
): Promise<string> {
  const projectDir = path.join(parentDir, name);
  const agentsPath = path.join(projectDir, ".agents");
  await mkdir(path.join(agentsPath, "sub"), { recursive: true });
  await Bun.write(path.join(agentsPath, "README.md"), `# ${name} agents\n`);
  await Bun.write(path.join(agentsPath, "current-state.md"), "state\n");
  await Bun.write(path.join(agentsPath, "sub", "note.md"), "note\n");
  await Bun.write(path.join(agentsPath, ".hidden"), "dotfile\n");

  await git(["init", "-q", "-b", "main"], projectDir);
  await git(["config", "user.email", "test@example.com"], projectDir);
  await git(["config", "user.name", "marrow test"], projectDir);
  await git(["remote", "add", "origin", `https://github.com/test/${name}.git`], projectDir);
  await Bun.write(path.join(projectDir, "package.json"), "{}\n");

  if (ignoreState === "ignored") {
    await Bun.write(path.join(projectDir, ".gitignore"), ".agents/\n");
    await git(["add", "-A"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);
  } else if (ignoreState === "tracked") {
    await git(["add", "-A"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);
  } else {
    await git(["add", "package.json"], projectDir);
    await git(["commit", "-q", "-m", "init"], projectDir);
  }

  return projectDir;
}

// Creates a project branch that exists in the vault but has no worktree on
// this machine — the multi-machine normal case, where a clone carries every
// branch and a machine attaches only the projects it works on.
export async function addUnattachedBranch(fx: Fixture, branch: string): Promise<void> {
  const agentsPath = await addProjectWorktree(fx, branch);
  const vault = vaultDir(fx.marrowHome);
  const removed = await git(["worktree", "remove", "--force", agentsPath], vault);
  if (removed.code !== 0) throw new Error(`worktree remove failed: ${removed.stderr}`);
}

// Simulates a worktree directory deleted out from under its registration (by
// hand, by a wider cleanup) rather than detached through marrow: the vault
// keeps the branch and the worktree administrative data, but `git worktree
// list --porcelain` reports the entry `prunable`. Distinct from
// `addUnattachedBranch`, which properly removes the registration itself.
export async function deleteWorktreeDir(agentsPath: string): Promise<void> {
  await rm(agentsPath, { recursive: true, force: true });
}
