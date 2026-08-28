import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

async function template(toolRoot: string, name: string, substitutions: Record<string, string>): Promise<string> {
  let content = await readFile(path.join(toolRoot, "templates", name), "utf8");
  for (const [key, value] of Object.entries(substitutions)) content = content.replaceAll(`{{${key}}}`, value);
  return content;
}

// Creates README.md from the seed template if absent, then appends the
// persistence block (both templates substituted with the project name).
// `toolRoot` is the running tool's own install location, resolved
// independently of MARROW_HOME — see spec/architecture.md -> "Env overrides".
export async function writeReadme(toolRoot: string, agentsPath: string, project: string, branch: string): Promise<void> {
  const substitutions = { project, branch };
  const block = await template(toolRoot, "persistence-block.md", substitutions);
  const readmePath = path.join(agentsPath, "README.md");

  if (!existsSync(readmePath)) {
    await writeFile(readmePath, `${await template(toolRoot, "readme-seed.md", substitutions)}\n${block}`);
    return;
  }

  const existing = await readFile(readmePath, "utf8");
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(readmePath, `${existing}${sep}${block}`);
}

export async function agentsBlock(toolRoot: string, project: string): Promise<string> {
  return template(toolRoot, "agents-block.md", { project });
}

function normalizedBlock(content: string): string {
  return content.replaceAll("\r\n", "\n").trim();
}

const AGENTS_NOTE_RE =
  /^> \[!note\]\s*\n> \s*\*\*Agent memory:\*\*[\s\S]*?^> <p align="right">v(\d+(?:\.\d+)*)<\/p>\s*$/im;

function findAgentsNote(content: string): { index: number; length: number; version: string } | undefined {
  const match = AGENTS_NOTE_RE.exec(content);
  return match ? { index: match.index, length: match[0].length, version: match[1] } : undefined;
}

async function parentInstructionFiles(projectDir: string): Promise<{ name: string; path: string; content: string }[]> {
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(projectDir, name);
    if (!existsSync(file)) continue;
    files.push({ name, path: file, content: await readFile(file, "utf8") });
  }
  return files;
}

type StaleAgentsBlockFile = {
  path: string;
  content: string;
  note: { index: number; length: number; version: string };
};

type AgentsBlockStatus =
  | { kind: "current" }
  | { kind: "missing" }
  | {
      kind: "stale";
      currentVersion: string;
      files: StaleAgentsBlockFile[];
    };

// Recognizes the canonical note by its trailing version tag regardless of wording
// changes around it, so a template edit doesn't strand every already-adopted project
// with a permanently "unrecognized" block.
async function agentsBlockStatus(toolRoot: string, projectDir: string, project: string): Promise<AgentsBlockStatus> {
  const block = normalizedBlock(await agentsBlock(toolRoot, project));
  const currentVersion = findAgentsNote(block)?.version;
  const stale: StaleAgentsBlockFile[] = [];
  let current = false;
  for (const file of await parentInstructionFiles(projectDir)) {
    const content = file.content.replaceAll("\r\n", "\n");
    if (normalizedBlock(content).includes(block)) {
      current = true;
      continue;
    }
    const note = findAgentsNote(content);
    if (!note) continue;
    if (currentVersion === undefined || note.version === currentVersion) {
      current = true;
      continue;
    }
    stale.push({ path: file.path, content, note });
  }
  if (stale.length > 0 && currentVersion !== undefined) return { kind: "stale", currentVersion, files: stale };
  if (current) return { kind: "current" };
  return { kind: "missing" };
}

async function agentsMentionCounts(projectDir: string): Promise<{ name: string; count: number }[]> {
  return (await parentInstructionFiles(projectDir))
    .map((file) => ({
      name: file.name,
      count: file.content.split("\n").filter((line) => line.includes(".agents")).length,
    }))
    .filter((file) => file.count > 0);
}

async function agentsBlockTarget(projectDir: string): Promise<string> {
  const agents = path.join(projectDir, "AGENTS.md");
  if (existsSync(agents)) return agents;
  const claude = path.join(projectDir, "CLAUDE.md");
  return existsSync(claude) ? claude : agents;
}

function reviewNotes(counts: { name: string; count: number }[]): string[] {
  return counts.map(({ name, count }) => {
    const noun = count === 1 ? "reference" : "references";
    return `  ${name.padEnd(25)} ${count} existing .agents ${noun} found; review for inconsistent guidance`;
  });
}

// Joins the block with whatever follows using exactly one blank line, regardless of
// how much (if any) whitespace already separated them.
function joinWithBlankLine(head: string, tail: string): string {
  const trimmedTail = tail.replace(/^\n+/, "");
  return trimmedTail.length === 0 ? `${head}\n` : `${head}\n\n${trimmedTail}`;
}

export async function ensureAgentsBlock(toolRoot: string, projectDir: string, project: string, dryRun: boolean): Promise<boolean> {
  const status = await agentsBlockStatus(toolRoot, projectDir, project);
  if (status.kind === "current") return false;
  const mentionCounts = await agentsMentionCounts(projectDir);

  if (status.kind === "stale") {
    if (dryRun) {
      console.log("");
      console.log("Project instructions:");
      for (const file of status.files) {
        const relativeTarget = path.relative(projectDir, file.path);
        const label = `v${file.note.version} -> v${status.currentVersion}`;
        console.log(`  ${relativeTarget.padEnd(25)} would update marrow .agents note (${label})`);
      }
      for (const note of reviewNotes(mentionCounts)) console.log(note);
      return false;
    }
    const block = normalizedBlock(await agentsBlock(toolRoot, project));
    console.log("");
    console.log("Project instructions:");
    for (const file of status.files) {
      const relativeTarget = path.relative(projectDir, file.path);
      const label = `v${file.note.version} -> v${status.currentVersion}`;
      const before = file.content.slice(0, file.note.index);
      const after = file.content.slice(file.note.index + file.note.length);
      await writeFile(file.path, before + joinWithBlankLine(block, after));
      console.log(`  ${relativeTarget.padEnd(25)} marrow .agents note updated (${label})`);
    }
    for (const note of reviewNotes(mentionCounts)) console.log(note);
    return true;
  }

  const target = await agentsBlockTarget(projectDir);
  const relativeTarget = path.relative(projectDir, target);
  if (dryRun) {
    console.log("");
    console.log("Project instructions:");
    console.log(`  ${relativeTarget.padEnd(25)} would add marrow .agents note`);
    for (const note of reviewNotes(mentionCounts)) console.log(note);
    return false;
  }
  await mkdir(projectDir, { recursive: true });
  const block = normalizedBlock(await agentsBlock(toolRoot, project));
  const existing = existsSync(target) ? await readFile(target, "utf8") : "";
  await writeFile(target, joinWithBlankLine(block, existing));
  console.log("");
  console.log("Project instructions:");
  console.log(`  ${relativeTarget.padEnd(25)} marrow .agents note added`);
  for (const note of reviewNotes(mentionCounts)) console.log(note);
  return true;
}

// --- Parent-repo `.agents/` ignore handling -------------------------------
// `.agents/` must end up ignored by the project's own repo: `doctor` checks it
// on every run and the persistence block promises it. See spec/cli.md -> `add`.

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
    `Then re-run: marrow add ${projectDir}`
  );
}
