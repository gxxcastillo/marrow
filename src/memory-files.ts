import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

export const CURRENT_STATE_LINE_THRESHOLD = 300;

export interface CurrentStateStamp {
  date: string;
  revision: string;
}

export interface CurrentStateInfo {
  content: string;
  lineCount: number;
  stamp: CurrentStateStamp | null;
}

export type ParentFreshness =
  | { kind: "current" }
  | { kind: "stale"; commitsPast: number | null }
  | { kind: "unavailable" };

const CURRENT_STATE_STAMP_RE = /^As of (\d{4}-\d{2}-\d{2}) \([^\r\n]*?@([0-9a-fA-F]+|no-HEAD)(?=[,;)\s])/m;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseCurrentStateStamp(content: string): CurrentStateStamp | null {
  const match = content.match(CURRENT_STATE_STAMP_RE);
  if (!match || !validDate(match[1])) return null;
  return { date: match[1], revision: match[2] };
}

function physicalLineCount(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(content) ? lines - 1 : lines;
}

export async function readCurrentState(agentsPath: string): Promise<CurrentStateInfo | null> {
  const statePath = path.join(agentsPath, "current-state.md");
  if (!existsSync(statePath)) return null;
  const content = await readFile(statePath, "utf8");
  return { content, lineCount: physicalLineCount(content), stamp: parseCurrentStateStamp(content) };
}

export async function parentFreshness(parentPath: string, stamp: CurrentStateStamp): Promise<ParentFreshness> {
  if (stamp.revision === "no-HEAD") return { kind: "current" };

  const inside = await git(["rev-parse", "--is-inside-work-tree"], parentPath);
  if (inside.code !== 0) return { kind: "unavailable" };
  const head = await git(["rev-parse", "--verify", "HEAD^{commit}"], parentPath);
  if (head.code !== 0) return { kind: "unavailable" };
  const stamped = await git(["rev-parse", "--verify", `${stamp.revision}^{commit}`], parentPath);
  if (stamped.code !== 0) return { kind: "stale", commitsPast: null };
  if (stamped.stdout === head.stdout) return { kind: "current" };

  const ancestor = await git(["merge-base", "--is-ancestor", stamped.stdout, head.stdout], parentPath);
  if (ancestor.code !== 0) return { kind: "stale", commitsPast: null };
  const count = await git(["rev-list", "--count", `${stamped.stdout}..${head.stdout}`], parentPath);
  const commitsPast = count.code === 0 && /^\d+$/.test(count.stdout) ? Number(count.stdout) : null;
  return { kind: "stale", commitsPast };
}

export async function blockedOnYouLines(agentsPath: string): Promise<string[]> {
  const plansPath = path.join(agentsPath, "plans");
  if (!existsSync(plansPath)) return [];
  const files = (await readdir(plansPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const lines: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(plansPath, file), "utf8");
    const line = content.split(/\r\n|\r|\n/).find((item) => item.startsWith("Blocked on you:"));
    if (line) lines.push(line);
  }
  return lines;
}

export async function renderTemplate(
  toolRoot: string,
  name: string,
  substitutions: Record<string, string>,
): Promise<string> {
  let content = await readFile(path.join(toolRoot, "templates", name), "utf8");
  for (const [key, value] of Object.entries(substitutions)) content = content.replaceAll(`{{${key}}}`, value);
  return content;
}

// `\r?\n` (not bare `\n`): a CRLF README must still be recognized, or the fenced/trailing
// section goes undetected and gets duplicated below instead of replaced in place.
const FENCED_PERSISTENCE_RE = /<!-- marrow:persistence-block v[\d.]+ -->[\s\S]*?<!-- \/marrow:persistence-block -->\r?\n?/;
// Stops at the next heading (or true end-of-string) rather than devouring the rest of the
// file — an old-style README may have content of the user's own after this section.
const TRAILING_PERSISTENCE_SECTION_RE = /^## Persistence\r?\n[\s\S]*?(?=\r?\n#{1,6}[ \t]|(?![\s\S]))/m;

function normalized(content: string): string {
  return content.replaceAll("\r\n", "\n").trim();
}

function replacePersistenceSection(existing: string, match: RegExpExecArray, block: string): string {
  const before = existing.slice(0, match.index).replace(/(?:\r?\n)+$/, "");
  const after = existing.slice(match.index + match[0].length).replace(/^(?:\r?\n)+/, "");
  return after.length > 0 ? `${before}\n\n${block}\n\n${after}\n` : `${before}\n\n${block}\n`;
}

async function writeReadme(toolRoot: string, agentsPath: string, project: string, branch: string): Promise<void> {
  const substitutions = { project, branch };
  const rawBlock = await renderTemplate(toolRoot, "persistence-block.md", substitutions);
  const readmePath = path.join(agentsPath, "README.md");

  if (!existsSync(readmePath)) {
    await writeFile(readmePath, `${await renderTemplate(toolRoot, "readme-seed.md", substitutions)}\n${rawBlock}`);
    return;
  }

  const existing = await readFile(readmePath, "utf8");
  const match = FENCED_PERSISTENCE_RE.exec(existing) ?? TRAILING_PERSISTENCE_SECTION_RE.exec(existing);
  if (match) {
    await writeFile(readmePath, replacePersistenceSection(existing, match, normalized(rawBlock)));
    return;
  }

  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(readmePath, `${existing}${sep}${rawBlock}`);
}

export function hasCurrentState(agentsPath: string): boolean {
  return existsSync(path.join(agentsPath, "current-state.md"));
}

export async function ensureCurrentState(toolRoot: string, agentsPath: string, project: string): Promise<boolean> {
  if (hasCurrentState(agentsPath)) return false;
  const statePath = path.join(agentsPath, "current-state.md");
  const parent = path.dirname(agentsPath);
  const head = await git(["rev-parse", "--short", "HEAD"], parent);
  const parentRevision = head.code === 0 ? head.stdout : "no-HEAD";
  const date = new Date().toISOString().slice(0, 10);
  const content = await renderTemplate(toolRoot, "current-state.md", { project, date, parentRevision });
  await writeFile(statePath, content);
  return true;
}

export async function writeMemoryFiles(
  toolRoot: string,
  agentsPath: string,
  project: string,
  branch: string,
): Promise<void> {
  await writeReadme(toolRoot, agentsPath, project, branch);
  await ensureCurrentState(toolRoot, agentsPath, project);
}
