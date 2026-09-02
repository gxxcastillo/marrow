import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";
import { readLedgerEntry, upsertLedgerEntry } from "./version-ledger";

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

// A leading `<!-- marrow:template-version N -->` line marks marrow's own bundled
// template source; it is never written into a real project's file, only read by
// marrow's own tooling to know what version a template currently is.
const TEMPLATE_VERSION_RE = /^<!-- marrow:template-version (\d+(?:\.\d+)*) -->\r?\n/;

export async function renderTemplate(
  toolRoot: string,
  name: string,
  substitutions: Record<string, string>,
): Promise<string> {
  let content = await readFile(path.join(toolRoot, "templates", name), "utf8");
  content = content.replace(TEMPLATE_VERSION_RE, "");
  for (const [key, value] of Object.entries(substitutions)) content = content.replaceAll(`{{${key}}}`, value);
  return content;
}

// marrow's own bundled template failing to parse is a marrow bug, not a project
// problem — throwing here mirrors `agentsBlockStatus`'s same precedent.
export async function templateVersion(toolRoot: string, name: string): Promise<string> {
  const raw = await readFile(path.join(toolRoot, "templates", name), "utf8");
  const match = TEMPLATE_VERSION_RE.exec(raw);
  if (!match) throw new Error(`marrow's bundled template ${name} has no recognizable template-version tag`);
  return match[1];
}

// `\r?\n` (not bare `\n`): a CRLF README must still be recognized, or the fenced/trailing
// section goes undetected and gets duplicated below instead of replaced in place. The
// opening tag's version suffix is optional (not required-absent): a real already-adopted
// project's fence still reads `<!-- marrow:persistence-block v2 -->` until its next
// `refresh`, and the fence markers alone are already an unambiguous, version-agnostic
// signal — matching only the tag-less form here would strand every old-versioned fence
// behind the weaker sentence-based legacy fallback below, which anchors on `## Persistence`
// and would leave the old opening tag line behind as orphaned debris (it precedes that
// anchor, so it falls outside the matched, replaced span).
const FENCED_PERSISTENCE_RE = /<!-- marrow:persistence-block(?: v[\d.]+)? -->[\s\S]*?<!-- \/marrow:persistence-block -->\r?\n?/;
// Stops at the next heading (or true end-of-string) rather than devouring the rest of the
// file — an old-style README may have content of the user's own after this section.
const TRAILING_PERSISTENCE_SECTION_RE = /^## Persistence\r?\n[\s\S]*?(?=\r?\n#{1,6}[ \t]|(?![\s\S]))/m;
// Fences are authoritative. The older unfenced format is recognized only by the
// identifying sentence emitted by marrow before fences shipped; a user's unrelated
// `## Persistence` section must never be treated as managed content.
const LEGACY_MARROW_PERSISTENCE_RE = /^This directory is a git worktree of the private (?:`marrow` repo|marrow vault) \(branch: `[^`\r\n]+`\)\.\r?$/m;

function persistenceSection(existing: string): RegExpExecArray | null {
  const fenced = FENCED_PERSISTENCE_RE.exec(existing);
  if (fenced) return fenced;
  const legacy = TRAILING_PERSISTENCE_SECTION_RE.exec(existing);
  return legacy && LEGACY_MARROW_PERSISTENCE_RE.test(legacy[0]) ? legacy : null;
}

function normalized(content: string): string {
  return content.replaceAll("\r\n", "\n").trim();
}

function replacePersistenceSection(existing: string, match: RegExpExecArray, block: string): string {
  const before = existing.slice(0, match.index).replace(/(?:\r?\n)+$/, "");
  const after = existing.slice(match.index + match[0].length).replace(/^(?:\r?\n)+/, "");
  return after.length > 0 ? `${before}\n\n${block}\n\n${after}\n` : `${before}\n\n${block}\n`;
}

export function withoutPersistenceSection(existing: string): string | null {
  const match = persistenceSection(existing);
  if (!match) return null;
  const before = existing.slice(0, match.index).replace(/(?:\r?\n)+$/, "");
  const after = existing.slice(match.index + match[0].length).replace(/^(?:\r?\n)+/, "");
  if (before && after) return `${before}\n\n${after}`;
  if (before) return `${before}\n`;
  return after;
}

export async function writeReadme(toolRoot: string, agentsPath: string, project: string, branch: string): Promise<void> {
  const substitutions = { project, branch };
  const rawBlock = await renderTemplate(toolRoot, "persistence-block.md", substitutions);
  const readmePath = path.join(agentsPath, "README.md");
  const blockVersion = await templateVersion(toolRoot, "persistence-block.md");

  if (!existsSync(readmePath)) {
    const seeded = `${await renderTemplate(toolRoot, "readme-seed.md", substitutions)}\n${rawBlock}`;
    await writeFile(readmePath, upsertLedgerEntry(seeded, "persistence-block", blockVersion));
    return;
  }

  const existing = await readFile(readmePath, "utf8");
  const match = persistenceSection(existing);
  if (match) {
    const replaced = replacePersistenceSection(existing, match, normalized(rawBlock));
    await writeFile(readmePath, upsertLedgerEntry(replaced, "persistence-block", blockVersion));
    return;
  }

  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  const appended = `${existing}${sep}${rawBlock}`;
  await writeFile(readmePath, upsertLedgerEntry(appended, "persistence-block", blockVersion));
}

export type PersistenceBlockStatus =
  | { kind: "current" }
  | { kind: "stale"; currentVersion: string; installedVersion: string | undefined }
  | { kind: "missing" };

// Mirrors `agentsBlockStatus`'s exact-content comparison: current means the freshly
// rendered block text (fence comments included) appears verbatim in the README,
// regardless of what the ledger claims. A recognized section that doesn't match
// exactly is stale; no README, or one with no recognizable section at all, is missing.
export async function persistenceBlockStatus(
  toolRoot: string,
  agentsPath: string,
  project: string,
  branch: string,
): Promise<PersistenceBlockStatus> {
  const currentVersion = await templateVersion(toolRoot, "persistence-block.md");
  const readmePath = path.join(agentsPath, "README.md");
  if (!existsSync(readmePath)) return { kind: "missing" };

  const existing = await readFile(readmePath, "utf8");
  const currentBlock = normalized(await renderTemplate(toolRoot, "persistence-block.md", { project, branch }));
  const match = persistenceSection(existing);
  if (!match) return { kind: "missing" };
  // Exact match against the extracted fenced (or legacy) section, not a substring search
  // over the whole file — see the identical fix and rationale in `agentsBlockStatus`.
  if (normalized(match[0]) === currentBlock) return { kind: "current" };
  return { kind: "stale", currentVersion, installedVersion: readLedgerEntry(existing, "persistence-block") };
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
