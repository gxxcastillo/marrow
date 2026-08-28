import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

export async function renderTemplate(
  toolRoot: string,
  name: string,
  substitutions: Record<string, string>,
): Promise<string> {
  let content = await readFile(path.join(toolRoot, "templates", name), "utf8");
  for (const [key, value] of Object.entries(substitutions)) content = content.replaceAll(`{{${key}}}`, value);
  return content;
}

const FENCED_PERSISTENCE_RE = /<!-- marrow:persistence-block v[\d.]+ -->[\s\S]*?<!-- \/marrow:persistence-block -->\n?/;
const TRAILING_PERSISTENCE_SECTION_RE = /^## Persistence\n[\s\S]*$/m;

function normalized(content: string): string {
  return content.replaceAll("\r\n", "\n").trim();
}

function replacePersistenceSection(existing: string, match: RegExpExecArray, block: string): string {
  const before = existing.slice(0, match.index).replace(/\n+$/, "");
  const after = existing.slice(match.index + match[0].length).replace(/^\n+/, "");
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

async function writeCurrentState(toolRoot: string, agentsPath: string, project: string): Promise<void> {
  const statePath = path.join(agentsPath, "current-state.md");
  if (existsSync(statePath)) return;
  const parent = path.dirname(agentsPath);
  const head = await git(["rev-parse", "--short", "HEAD"], parent);
  const parentRevision = head.code === 0 ? head.stdout : "no-HEAD";
  const date = new Date().toISOString().slice(0, 10);
  const content = await renderTemplate(toolRoot, "current-state.md", { project, date, parentRevision });
  await writeFile(statePath, content);
}

export async function writeMemoryFiles(
  toolRoot: string,
  agentsPath: string,
  project: string,
  branch: string,
): Promise<void> {
  await writeReadme(toolRoot, agentsPath, project, branch);
  await writeCurrentState(toolRoot, agentsPath, project);
}
