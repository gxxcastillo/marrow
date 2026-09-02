import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { countLabel } from "./format";
import { renderTemplate, templateVersion } from "./memory-files";
import { readLedgerEntry, upsertLedgerEntry } from "./version-ledger";

export async function agentsBlock(toolRoot: string, project: string): Promise<string> {
  return renderTemplate(toolRoot, "agents-block.md", { project });
}

function normalizedBlock(content: string): string {
  return content.replaceAll("\r\n", "\n").trim();
}

// Anchored on the `[!NOTE]` opener and the link to `.agents/README.md` — not on
// headline bold text, which drifts with wording (v1's "Agent memory" vs v2's "Agent
// working memory"), and no longer on a trailing version tag (the version now lives in
// the `.agents/README.md` ledger, not the note itself). The match extends across every
// consecutive `>`-prefixed line starting at the opener, a superset of the old
// tag-anchored pattern: an old note's trailing `> <p align="right">v3</p>` line is
// itself `>`-prefixed, so it's still fully captured and replaced, not left as debris.
const NOTE_BLOCKQUOTE_RE = /^> \[!note\](?:\r?\n>.*)*/im;
const AGENTS_NOTE_LINK = "[`.agents/README.md`](.agents/README.md)";
// A legacy tag, if still present within a matched note span, labels a not-yet-migrated
// project's display version — for output only, never for deciding staleness.
const LEGACY_VERSION_TAG_RE = /> <p align="right">v(\d+(?:\.\d+)*)<\/p>/;

export function findAgentsNote(content: string): { index: number; length: number } | undefined {
  const match = NOTE_BLOCKQUOTE_RE.exec(content);
  if (!match || !match[0].includes(AGENTS_NOTE_LINK)) return undefined;
  return { index: match.index, length: match[0].length };
}

// The canonical parent instruction filenames marrow looks for, in priority order.
// Shared so a caller like `doctor` can name them in a message without restating
// the list as a literal that could drift out of sync with what's actually checked.
export const PARENT_INSTRUCTION_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;

async function parentInstructionFiles(projectDir: string): Promise<{ name: string; path: string; content: string }[]> {
  const files = [];
  for (const name of PARENT_INSTRUCTION_FILENAMES) {
    const file = path.join(projectDir, name);
    if (!existsSync(file)) continue;
    files.push({ name, path: file, content: await readFile(file, "utf8") });
  }
  return files;
}

export type StaleAgentsBlockFile = {
  path: string;
  content: string;
  note: { index: number; length: number };
  fromVersion: string;
};

export type AgentsBlockStatus =
  | { kind: "current" }
  | { kind: "missing" }
  | {
      kind: "stale";
      currentVersion: string;
      files: StaleAgentsBlockFile[];
    };

// Labels a stale note for display only, never for deciding staleness (that's exact
// content comparison, same as ever): a legacy embedded tag if the note being replaced
// still has one (an old-format project, not yet migrated), else the ledger's existing
// `agents-note` entry (an already-migrated project on a later bump), else "unknown".
function noteFromVersion(noteText: string, agentsReadme: string | undefined): string {
  const legacy = LEGACY_VERSION_TAG_RE.exec(noteText);
  if (legacy) return legacy[1];
  return (agentsReadme !== undefined ? readLedgerEntry(agentsReadme, "agents-note") : undefined) ?? "unknown";
}

// Recognizes the canonical note by its opener and its link to `.agents/README.md`,
// regardless of prose wording changes elsewhere in the note, so a template edit doesn't
// strand every already-attached project with a permanently "unrecognized" block.
// Recognition is not acceptance: only text matching the template exactly is current.
// Any other recognized note is stale, including one whose wording is the only thing
// that drifted — treating same-content-family drift as current is what let four
// projects carry one banner shape and five another while all nine claimed v2.
export async function agentsBlockStatus(
  toolRoot: string,
  projectDir: string,
  agentsPath: string,
  project: string,
): Promise<AgentsBlockStatus> {
  const block = normalizedBlock(await agentsBlock(toolRoot, project));
  const currentVersion = await templateVersion(toolRoot, "agents-block.md");
  const readmePath = path.join(agentsPath, "README.md");
  const agentsReadme = existsSync(readmePath) ? await readFile(readmePath, "utf8") : undefined;
  const stale: StaleAgentsBlockFile[] = [];
  let current = false;
  for (const file of await parentInstructionFiles(projectDir)) {
    // Found against the file's own raw content (not the \n-normalized copy above) so
    // note.index/length stay valid offsets into file.content — writing that back later
    // must not silently rewrite a CRLF file's line endings to LF.
    const note = findAgentsNote(file.content);
    if (!note) continue;
    const noteText = file.content.slice(note.index, note.index + note.length);
    // Exact match against the extracted note span, not a substring search over the whole
    // file: a version bump that only removes trailing content (e.g. the v3 -> v4 tag
    // drop) makes the new, shorter template text a literal prefix of every not-yet-
    // migrated project's still-old note, which `.includes()` would wrongly call current.
    if (normalizedBlock(noteText) === block) {
      current = true;
      continue;
    }
    stale.push({ path: file.path, content: file.content, note, fromVersion: noteFromVersion(noteText, agentsReadme) });
  }
  if (stale.length > 0) return { kind: "stale", currentVersion, files: stale };
  if (current) return { kind: "current" };
  return { kind: "missing" };
}

async function agentsMentionCounts(projectDir: string): Promise<{ name: string; count: number }[]> {
  return (await parentInstructionFiles(projectDir))
    .map((file) => {
      let reviewContent = file.content;
      let note = findAgentsNote(reviewContent);
      while (note) {
        reviewContent = reviewContent.slice(0, note.index) + reviewContent.slice(note.index + note.length);
        note = findAgentsNote(reviewContent);
      }
      return {
        name: file.name,
        count: reviewContent.split("\n").filter((line) => line.includes(".agents")).length,
      };
    })
    .filter((file) => file.count > 0);
}

async function agentsBlockTarget(projectDir: string): Promise<string> {
  const [primary, fallback] = PARENT_INSTRUCTION_FILENAMES;
  const agents = path.join(projectDir, primary);
  if (existsSync(agents)) return agents;
  const claude = path.join(projectDir, fallback);
  return existsSync(claude) ? claude : agents;
}

// A version bump is a migration; an unchanged tag means only the wording drifted. Naming
// the difference keeps `v2 -> v2` out of the output.
export function updateLabel(from: string, to: string): string {
  return from === to ? `v${to}, not verbatim` : `v${from} -> v${to}`;
}

function reviewNotes(counts: { name: string; count: number }[]): string[] {
  return counts.map(
    ({ name, count }) =>
      `  ${name.padEnd(25)} ${countLabel(count, "existing .agents reference", "existing .agents references")} found; review for inconsistent guidance`,
  );
}

// Joins the block with whatever follows using exactly one blank line, regardless of
// how much (if any) whitespace already separated them.
function joinWithBlankLine(head: string, tail: string): string {
  const trimmedTail = tail.replace(/^\n+/, "");
  return trimmedTail.length === 0 ? `${head}\n` : `${head}\n\n${trimmedTail}`;
}

// After writing the note into the parent project, records the template version marrow
// wrote in the `.agents/README.md` ledger — the only place that version now lives.
async function recordAgentsNoteVersion(toolRoot: string, agentsPath: string): Promise<void> {
  const readmePath = path.join(agentsPath, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, upsertLedgerEntry(readme, "agents-note", await templateVersion(toolRoot, "agents-block.md")));
}

export async function ensureAgentsBlock(
  toolRoot: string,
  projectDir: string,
  agentsPath: string,
  project: string,
  dryRun: boolean,
  precomputedStatus?: AgentsBlockStatus,
): Promise<boolean> {
  const status = precomputedStatus ?? (await agentsBlockStatus(toolRoot, projectDir, agentsPath, project));
  if (status.kind === "current") return false;
  const mentionCounts = await agentsMentionCounts(projectDir);

  if (status.kind === "stale") {
    if (dryRun) {
      console.log("");
      console.log("Project instructions:");
      for (const file of status.files) {
        const relativeTarget = path.relative(projectDir, file.path);
        const label = updateLabel(file.fromVersion, status.currentVersion);
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
      const label = updateLabel(file.fromVersion, status.currentVersion);
      const before = file.content.slice(0, file.note.index);
      const after = file.content.slice(file.note.index + file.note.length);
      await writeFile(file.path, before + joinWithBlankLine(block, after));
      console.log(`  ${relativeTarget.padEnd(25)} marrow .agents note updated (${label})`);
    }
    await recordAgentsNoteVersion(toolRoot, agentsPath);
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
  await recordAgentsNoteVersion(toolRoot, agentsPath);
  console.log("");
  console.log("Project instructions:");
  console.log(`  ${relativeTarget.padEnd(25)} marrow .agents note added`);
  for (const note of reviewNotes(mentionCounts)) console.log(note);
  return true;
}
