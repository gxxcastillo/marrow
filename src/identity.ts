import path from "node:path";
import { git } from "./git";

export interface ProjectIdentity {
  id: string;
  branch: string;
  dir: string;
  name: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export function branchFor(id: string): string {
  return id;
}

function validId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.includes("..") && !id.includes("//") && !id.endsWith(".") && !id.endsWith("/");
}

export function githubId(url: string): string | null {
  const value = url.trim();
  const scp = value.match(/^[^@\s]+@github\.com:(.+)$/i);
  const standard = value.match(/^(?:https?|ssh):\/\/(?:[^@/\s]+@)?github\.com\/(.+)$/i);
  const tail = scp?.[1] ?? standard?.[1];
  if (!tail) return null;

  const parts = tail.replace(/\.git\/?$/i, "").split("/");
  if (parts.length !== 2 || !parts.every((part) => /^[a-z0-9_.-]+$/i.test(part))) return null;
  return `github.com/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

export function githubProjectId(url: string): string | null {
  return githubId(url)?.split("/").at(-1) ?? null;
}

export async function resolveIdentity(projectArg: string, explicitId?: string): Promise<ProjectIdentity> {
  // `undefined` means no --id was given; an empty --id is a bad value, not an
  // absent one, and must fail validation rather than silently deriving an id.
  let dir = path.resolve(projectArg);
  if (explicitId === undefined) {
    const root = await git(["rev-parse", "--show-toplevel"], dir);
    if (root.code !== 0) {
      throw new Error(`${dir} is not a git repository; pass --id <stable-id> for a project without origin`);
    }
    dir = root.stdout;
  }

  let id = explicitId;
  if (id === undefined) {
    const origin = await git(["remote", "get-url", "origin"], dir);
    const resolved = origin.code === 0 ? githubProjectId(origin.stdout) : null;
    if (!resolved) {
      throw new Error(`${dir} has no supported GitHub origin; pass --id <stable-id>`);
    }
    id = resolved;
  }

  if (!validId(id)) {
    throw new Error(`invalid project id '${id}'; use lowercase letters, numbers, '.', '_', '-', and '/'`);
  }
  return { id, branch: branchFor(id), dir, name: path.basename(dir) };
}
