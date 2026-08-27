import { existsSync } from "node:fs";
import path from "node:path";
import { git, listProjectWorktrees, run } from "./git";

export type VisibilityResult =
  | { status: "ok"; message: string }
  | { status: "warn"; message: string }
  | { status: "fail"; message: string };

export async function isBareVault(vault: string): Promise<boolean> {
  if (!existsSync(vault)) return false;
  const res = await git(["rev-parse", "--is-bare-repository"], vault);
  return res.code === 0 && res.stdout === "true";
}

export async function localBranches(vault: string): Promise<string[]> {
  const res = await git(["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/"], vault);
  if (res.code !== 0) throw new Error(`could not list local branches: ${res.stderr}`);
  return res.stdout === "" ? [] : res.stdout.split("\n");
}

export async function fetchedOriginBranches(vault: string): Promise<string[]> {
  const res = await git(["for-each-ref", "--format=%(refname:strip=3)", "refs/remotes/origin/"], vault);
  if (res.code !== 0) throw new Error(`could not list fetched branches: ${res.stderr}`);
  return res.stdout === "" ? [] : res.stdout.split("\n").filter((branch) => branch !== "HEAD");
}

export async function originUrl(vault: string): Promise<string | null> {
  const res = await git(["remote", "get-url", "origin"], vault);
  return res.code === 0 ? res.stdout : null;
}

export async function emptyLocalVault(vault: string): Promise<boolean> {
  return (await localBranches(vault)).length === 0 && (await listProjectWorktrees(vault)).length === 0;
}

export async function configureOriginFetch(vault: string): Promise<void> {
  const res = await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], vault);
  if (res.code !== 0) throw new Error(`could not configure origin fetch: ${res.stderr}`);
}

export async function verifyOriginReachable(vault: string): Promise<void> {
  const res = await run("git", ["ls-remote", "--exit-code", "origin"], vault);
  if (res.code !== 0) throw new Error(`origin is not reachable: ${res.stderr || res.stdout}`);
}

export async function validateRemoteUrl(url: string, cwd: string): Promise<void> {
  const res = await run("git", ["ls-remote", url], cwd);
  if (res.code !== 0) throw new Error(`remote is not reachable: ${res.stderr || res.stdout}`);
}

export function commandOnPath(name: string): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(path.join(dir, name)));
}

export async function verifyPrivateVisibility(vault: string, strict: boolean): Promise<VisibilityResult> {
  if (!commandOnPath("gh")) {
    const message = "gh not available; skipped origin visibility check";
    return strict ? { status: "fail", message } : { status: "warn", message };
  }
  const vis = await run("gh", ["repo", "view", "--json", "visibility", "-q", ".visibility"], vault);
  if (vis.code !== 0) {
    const message = `could not determine origin visibility via gh: ${vis.stderr || vis.stdout}`;
    return strict ? { status: "fail", message } : { status: "warn", message };
  }
  const visibility = vis.stdout.trim();
  if (visibility !== "PRIVATE") return { status: "fail", message: `origin visibility is ${visibility}, expected PRIVATE` };
  return { status: "ok", message: "origin is PRIVATE" };
}
