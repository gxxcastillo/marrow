import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "../src/git";

const REAL_TEMPLATES_DIR = path.join(import.meta.dir, "..", "templates");

export interface Fixture {
  root: string;
  marrowHome: string;
  devRoot: string;
  bareOrigin: string;
  cleanup: () => Promise<void>;
}

function guardNotRealHome(marrowHome: string): void {
  const real = path.resolve(process.env.HOME ?? "", "dev", "marrow");
  if (path.resolve(marrowHome) === real) {
    throw new Error("refusing to run tests against the real ~/dev/marrow");
  }
}

// Builds a fake MARROW_HOME (vault, with a file:// bare repo as origin) and a
// fake MARROW_DEV_ROOT. Tests never touch real repos under ~/dev.
export async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "marrow-test-"));
  const marrowHome = path.join(root, "marrow");
  const devRoot = path.join(root, "dev");
  const bareOrigin = path.join(root, "origin.git");

  guardNotRealHome(marrowHome);

  await mkdir(marrowHome, { recursive: true });
  await mkdir(devRoot, { recursive: true });
  await cp(REAL_TEMPLATES_DIR, path.join(marrowHome, "templates"), { recursive: true });

  await git(["init", "-q", "-b", "main"], marrowHome);
  await git(["config", "user.email", "test@example.com"], marrowHome);
  await git(["config", "user.name", "marrow test"], marrowHome);
  await git(["add", "-A"], marrowHome);
  await git(["commit", "-q", "-m", "init"], marrowHome);

  await git(["init", "-q", "--bare", "-b", "main", bareOrigin], root);
  await git(["remote", "add", "origin", bareOrigin], marrowHome);
  await git(["push", "-q", "origin", "main"], marrowHome);

  return {
    root,
    marrowHome,
    devRoot,
    bareOrigin,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

// Adds an orphan project worktree (mirrors `marrow adopt` step 4 onward) and
// gives it one seed commit, pushed to origin.
export async function addProjectWorktree(fx: Fixture, project: string): Promise<string> {
  const projectDir = path.join(fx.devRoot, project);
  const agentsPath = path.join(projectDir, ".agents");
  await mkdir(projectDir, { recursive: true });

  const wt = await git(["worktree", "add", "--orphan", "-b", project, agentsPath], fx.marrowHome);
  if (wt.code !== 0) throw new Error(`worktree add failed: ${wt.stderr}`);

  await git(["config", "user.email", "test@example.com"], agentsPath);
  await git(["config", "user.name", "marrow test"], agentsPath);
  await Bun.write(path.join(agentsPath, "README.md"), `# ${project}\n`);
  await git(["add", "-A"], agentsPath);
  await git(["commit", "-q", "-m", `${project}: seed`], agentsPath);
  await git(["push", "-q", "origin", project], agentsPath);

  return agentsPath;
}

export type IgnoreState = "ignored" | "untracked" | "tracked";

// Builds a standalone parent project repo (distinct from the marrow vault)
// with a populated .agents/ dir, in one of the three gitignore states adopt
// must handle.
export async function makeProjectRepo(fx: Fixture, name: string, ignoreState: IgnoreState): Promise<string> {
  const projectDir = path.join(fx.devRoot, name);
  const agentsPath = path.join(projectDir, ".agents");
  await mkdir(path.join(agentsPath, "sub"), { recursive: true });
  await Bun.write(path.join(agentsPath, "README.md"), `# ${name} agents\n`);
  await Bun.write(path.join(agentsPath, "current-state.md"), "state\n");
  await Bun.write(path.join(agentsPath, "sub", "note.md"), "note\n");
  await Bun.write(path.join(agentsPath, ".hidden"), "dotfile\n");

  await git(["init", "-q", "-b", "main"], projectDir);
  await git(["config", "user.email", "test@example.com"], projectDir);
  await git(["config", "user.name", "marrow test"], projectDir);
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
