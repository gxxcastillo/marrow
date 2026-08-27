import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { git, vaultDir } from "../git";
import {
  configureOriginFetch,
  emptyLocalVault,
  fetchedOriginBranches,
  isBareVault,
  originUrl,
  validateRemoteUrl,
  verifyOriginReachable,
  verifyPrivateVisibility,
} from "../remote";

export interface InitOptions { from?: string; dryRun?: boolean }
class InitAbort extends Error {}

async function fromMode(vault: string): Promise<"clone" | "hydrate"> {
  if (!existsSync(vault)) return "clone";
  if (!(await isBareVault(vault))) throw new InitAbort(`${vault} is not a bare git repository`);
  const existingOrigin = await originUrl(vault);
  if (existingOrigin) throw new InitAbort(`vault already uses origin ${existingOrigin}`);
  if (!(await emptyLocalVault(vault))) throw new InitAbort("vault is not empty; refusing to initialize from remote");
  return "hydrate";
}

async function initFrom(marrowHome: string, source: string, dryRun: boolean): Promise<number> {
  const vault = vaultDir(marrowHome);
  const mode = await fromMode(vault);
  await validateRemoteUrl(source, process.cwd());

  if (dryRun) {
    console.log(`dry run: would ${mode === "clone" ? "clone" : "hydrate"} vault from ${source}`);
    console.log(`vault: ${vault}`);
    return 0;
  }

  if (mode === "clone") {
    await mkdir(marrowHome, { recursive: true });
    const cloned = await git(["clone", "--bare", source, vault], marrowHome);
    if (cloned.code !== 0) throw new InitAbort(`git clone failed: ${cloned.stderr}`);
  } else {
    const added = await git(["remote", "add", "origin", source], vault);
    if (added.code !== 0) throw new InitAbort(`could not configure origin: ${added.stderr}`);
  }

  await configureOriginFetch(vault);
  const fetched = await git(["fetch", "--prune", "origin"], vault);
  if (fetched.code !== 0) throw new InitAbort(`could not fetch origin: ${fetched.stderr}`);
  await verifyOriginReachable(vault);
  const visibility = await verifyPrivateVisibility(vault, false);
  if (visibility.status === "fail") throw new InitAbort(visibility.message);

  console.log(`${mode === "clone" ? "cloned" : "hydrated"} vault from ${source}`);
  console.log(`origin: ${await originUrl(vault)}`);
  console.log(`fetched branches: ${(await fetchedOriginBranches(vault)).length}`);
  console.log(visibility.message);
  return 0;
}

export async function initCommand(marrowHome: string, opts: InitOptions = {}): Promise<number> {
  const vault = vaultDir(marrowHome);
  try {
    if (opts.from) return await initFrom(marrowHome, opts.from, opts.dryRun === true);
    if (opts.dryRun) {
      console.log(existsSync(vault) ? `vault already exists: ${vault}` : `dry run: would initialize vault: ${vault}`);
      return 0;
    }
    if (!existsSync(vault)) {
      await mkdir(marrowHome, { recursive: true });
      const made = await git(["init", "-q", "--bare", "-b", "main", vault], marrowHome);
      if (made.code !== 0) throw new Error(`git init failed: ${made.stderr}`);
      console.log(`initialized vault: ${vault}`);
      return 0;
    }
    console.log(`vault already exists: ${vault}`);
    return 0;
  } catch (err) {
    console.error(`marrow init: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
