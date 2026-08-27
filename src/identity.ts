import { existsSync } from "node:fs";
import path from "node:path";
import { git } from "./git";

// The vault branch is exactly the project id — there is no separate mapping,
// so a `ProjectIdentity` carries only `id` (`architecture.md` → Design model:
// "its vault branch is exactly that identity").
export interface ProjectIdentity {
  id: string;
  dir: string;
  name: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

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
  // Toplevel resolution runs whenever the path is inside a git repo, --id or
  // not — `cli.md` says the path always resolves to the parent repo's root.
  // `existsSync` guards the fresh-create case (`marrow add <new-path> --id
  // <id>`): the directory may not exist on disk yet, and spawning git against
  // a nonexistent cwd throws instead of failing gracefully.
  const exists = existsSync(dir);
  const root = exists ? await git(["rev-parse", "--show-toplevel"], dir) : { code: 1, stdout: "" };
  if (root.code === 0) {
    dir = root.stdout;
  } else if (explicitId === undefined) {
    const reason = exists ? "is not a git repository" : "does not exist";
    throw new Error(
      `${dir} ${reason}; if the project already exists elsewhere, clone it here first — otherwise pass --id <stable-id> to create a new project there`,
    );
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
  return { id, dir, name: path.basename(dir) };
}
