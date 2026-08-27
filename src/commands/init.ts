import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { git, listProjectWorktrees, vaultDir } from "../git";

async function emptyVault(vault: string): Promise<boolean> {
  const branches = await git(["for-each-ref", "--format=%(refname)", "refs/heads/"], vault);
  return branches.code === 0 && branches.stdout === "" && (await listProjectWorktrees(vault)).length === 0;
}

async function hydrate(vault: string, source: string): Promise<void> {
  const remote = await git(["remote", "get-url", "origin"], vault);
  if (remote.code === 0 && remote.stdout !== source) throw new Error(`vault already uses origin ${remote.stdout}`);
  if (remote.code !== 0) {
    if (!(await emptyVault(vault))) throw new Error("vault is not empty; refusing to replace it with --from");
    const added = await git(["remote", "add", "origin", source], vault);
    if (added.code !== 0) throw new Error(`could not configure origin: ${added.stderr}`);
  }
  await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], vault);
  const fetched = await git(["fetch", "--prune", "origin"], vault);
  if (fetched.code !== 0) throw new Error(`could not fetch origin: ${fetched.stderr}`);
}

async function verifyPrivate(vault: string): Promise<void> {
  if (!Bun.which("gh")) return;
  const visibility = await Bun.spawn(["gh", "repo", "view", "--json", "visibility", "-q", ".visibility"], {
    cwd: vault,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(visibility.stdout).text(), visibility.exited]);
  if (code === 0 && stdout.trim() !== "PRIVATE") throw new Error(`origin visibility is ${stdout.trim()}, expected PRIVATE`);
}

// `--from` connects this machine to an already-created vault. It never creates
// a remote: the caller supplies one, and normal doctor checks still verify it.
export async function initCommand(marrowHome: string, from?: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  try {
    if (!existsSync(vault)) {
      await mkdir(marrowHome, { recursive: true });
      if (from) {
        const clone = await git(["clone", "--bare", from, vault], marrowHome);
        if (clone.code !== 0) throw new Error(`git clone failed: ${clone.stderr}`);
        await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], vault);
        const fetched = await git(["fetch", "--prune", "origin"], vault);
        if (fetched.code !== 0) throw new Error(`could not fetch origin: ${fetched.stderr}`);
        await verifyPrivate(vault);
        console.log(`initialized vault from ${from}: ${vault}`);
        return 0;
      }
      const made = await git(["init", "-q", "--bare", "-b", "main", vault], marrowHome);
      if (made.code !== 0) throw new Error(`git init failed: ${made.stderr}`);
      console.log(`initialized vault: ${vault}`);
      return 0;
    }
    if (!from) {
      console.log(`vault already exists: ${vault}`);
      return 0;
    }
    await hydrate(vault, from);
    await verifyPrivate(vault);
    console.log(`hydrated vault from ${from}: ${vault}`);
    return 0;
  } catch (err) {
    console.error(`marrow init: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
