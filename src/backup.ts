// Collision-proof backup tarball construction for `add`'s adopt path. Kept
// out of src/commands/add.ts to stay under that file's line budget.

import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { run } from "./git";

export class BackupError extends Error {}

// Sub-second UTC timestamp plus a random UUID suffix, so two adoptions of the
// same project basename — same day, same millisecond, concurrent processes —
// never produce the same name. The branch/identity id is never used here: an
// explicit `--id` may contain `/`, which is not a valid path segment.
export function backupName(project: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${project}-${ts}-${crypto.randomUUID()}.tar.gz`;
}

// Tars up <projectDir>/.agents into <marrowHome>/backups/, verifying the
// result is non-empty and listable before returning. Throws BackupError on
// any failure, including the (practically unreachable, but checked so a
// collision can never silently overwrite a prior backup) case where a
// generated name already exists.
export async function backupAgents(projectDir: string, projectName: string, marrowHome: string): Promise<string> {
  const backupsDir = path.join(marrowHome, "backups");
  await mkdir(backupsDir, { recursive: true });

  let tarball = path.join(backupsDir, backupName(projectName));
  for (let attempts = 0; existsSync(tarball); attempts++) {
    if (attempts >= 10) throw new BackupError("could not generate a unique backup path, aborting");
    tarball = path.join(backupsDir, backupName(projectName));
  }

  const made = await run("tar", ["-czf", tarball, "-C", projectDir, ".agents"], marrowHome);
  if (made.code !== 0 || (await stat(tarball)).size === 0) throw new BackupError(`backup failed, aborting: ${made.stderr}`);
  const listed = await run("tar", ["-tzf", tarball], marrowHome);
  if (listed.code !== 0 || listed.stdout === "") throw new BackupError("backup tarball failed to list, aborting");
  return tarball;
}
