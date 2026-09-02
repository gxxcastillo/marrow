// Parent-repo `.agents/` ignore handling. `.agents/` must end up ignored by the
// project's own repo: `doctor` checks it on every run and the persistence block
// promises it. See spec/cli.md -> `attach`.

import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

export type IgnoreState = "ignored" | "untracked" | "tracked" | "no-repo";

export async function gitignoreState(projectDir: string): Promise<IgnoreState> {
  const tracked = await git(["ls-files", "--", ".agents"], projectDir);
  if (tracked.code !== 0) return "no-repo";
  if (tracked.stdout.length > 0) return "tracked";
  const ignoreCheck = await git(["check-ignore", "-q", "--", ".agents"], projectDir);
  if (ignoreCheck.code === 0) return "ignored";
  if (ignoreCheck.code === 1) return "untracked";
  return "no-repo";
}

// Appending is safe even when the parent is not a git repo yet — a later
// `git init` there then can't pick `.agents/` up. marrow never commits in a repo
// it doesn't own, so committing the change is the user's job, and the line says so.
export async function ensureIgnored(projectDir: string, state: IgnoreState, dryRun: boolean): Promise<void> {
  if (state === "ignored") return;
  if (dryRun) {
    console.log(`${projectDir}/.agents is not ignored — would append '.agents/' to .gitignore.`);
    return;
  }
  const gitignorePath = path.join(projectDir, ".gitignore");
  const existing = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
  await appendFile(gitignorePath, `${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}.agents/\n`);
  console.log(
    state === "no-repo"
      ? `appended '.agents/' to ${projectDir}/.gitignore — not a git repo yet, so it takes effect if you run 'git init' here.`
      : `appended '.agents/' to ${projectDir}/.gitignore — commit that change in the parent repo yourself.`,
  );
}

// A parent repo that tracks `.agents/` needs an attended untracking step first;
// marrow will not run `git rm --cached` on a repo it doesn't own.
export function trackedMessage(projectDir: string): string {
  return (
    `${projectDir}/.agents is tracked by its parent repo. Untrack it first (attended step):\n` +
    `  cd ${projectDir}\n` +
    `  git rm -r --cached .agents\n` +
    `  echo '.agents/' >> .gitignore\n` +
    `  git add .gitignore\n` +
    `  git commit -m "untrack .agents"\n` +
    `Then re-run: marrow attach ${projectDir}`
  );
}
