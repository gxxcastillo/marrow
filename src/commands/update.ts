// `marrow update`: re-runs the managed install's own updater. There is one
// updater implementation (bin/install's fetch + reset); this command never
// re-implements it in TypeScript, only locates and spawns it.

import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";

async function resolvePhysical(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

export async function updateCommand(toolRoot: string): Promise<number> {
  const home = process.env.HOME;
  if (!home) {
    console.error("marrow update: HOME is not set; cannot locate the managed install");
    return 1;
  }

  // Physical-path comparison, same as bin/setup/bin/uninstall: a symlinked
  // $HOME (or a symlinked managed clone) must still be recognized.
  const expected = path.join(home, ".local", "share", "marrow");
  const isManaged = existsSync(expected) && (await resolvePhysical(expected)) === (await resolvePhysical(toolRoot));
  if (!isManaged) {
    console.error(
      `marrow update: this is a local checkout at ${toolRoot}, not the managed install at ${expected}; ` +
        "update it with git instead (e.g. 'git pull')",
    );
    return 1;
  }

  const installer = path.join(expected, "bin", "install");
  if (!existsSync(installer)) {
    console.error(`marrow update: managed checkout at ${expected} is missing its installer at ${installer}`);
    return 1;
  }

  // bin/install itself owns the origin check, dirty-checkout refusal, fetch,
  // and re-running setup — update does not duplicate any of that.
  const proc = Bun.spawn([installer], { cwd: expected, env: { ...process.env }, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return proc.exited;
}
