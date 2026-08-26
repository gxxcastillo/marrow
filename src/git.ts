// Thin Bun.spawn git wrapper and worktree discovery. No git library.

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function git(args: string[], cwd: string): Promise<SpawnResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export interface Worktree {
  path: string;
  branch: string;
}

// Discovers project worktrees registered against MARROW_HOME, excluding the
// main checkout (branch "main"). Zero config: worktrees are the registry.
export async function listProjectWorktrees(marrowHome: string): Promise<Worktree[]> {
  const res = await git(["worktree", "list", "--porcelain"], marrowHome);
  if (res.code !== 0) throw new Error(`git worktree list failed: ${res.stderr}`);

  const entries: Worktree[] = [];
  let path = "";
  let branch = "";
  for (const line of [...res.stdout.split("\n"), ""]) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "") {
      if (path && branch && branch !== "main") entries.push({ path, branch });
      path = "";
      branch = "";
    }
  }
  return entries;
}

export async function dirtyCount(cwd: string): Promise<number> {
  const res = await git(["status", "--porcelain"], cwd);
  if (res.code !== 0) throw new Error(`git status failed: ${res.stderr}`);
  return res.stdout.length === 0 ? 0 : res.stdout.split("\n").length;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

// null when there is no origin/<branch> to compare against (never pushed / no origin).
export async function aheadBehind(cwd: string, branch: string): Promise<AheadBehind | null> {
  const check = await git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], cwd);
  if (check.code !== 0) return null;
  const res = await git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], cwd);
  if (res.code !== 0) return null;
  const [ahead, behind] = res.stdout.split(/\s+/).map(Number);
  return { ahead, behind };
}

export interface LastCommit {
  date: string;
  subject: string;
}

export async function lastCommit(cwd: string): Promise<LastCommit | null> {
  const res = await git(["log", "-1", "--format=%ad|%s", "--date=short"], cwd);
  if (res.code !== 0 || res.stdout === "") return null;
  const [date, ...rest] = res.stdout.split("|");
  return { date, subject: rest.join("|") };
}

export async function hasOrigin(cwd: string): Promise<boolean> {
  const res = await git(["remote"], cwd);
  return res.stdout.split("\n").includes("origin");
}
