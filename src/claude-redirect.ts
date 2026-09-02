import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderTemplate } from "./memory-files";
import { PARENT_INSTRUCTION_FILENAMES } from "./project";

// Claude Code only auto-loads `CLAUDE.md`, never `AGENTS.md` directly — a plain markdown
// link to AGENTS.md doesn't either, only the `@file` import syntax does. A project that
// carries the marrow note in `AGENTS.md` with no `CLAUDE.md` at all silently strands
// Claude Code agents: the note, and the `.agents/README.md` pointer inside it, is never
// loaded into context no matter how the note is worded. This plants a minimal redirect
// stub so the note actually reaches the agent. An existing `CLAUDE.md`, however it does or
// doesn't redirect, is left untouched — only a fully missing file is created.
const [AGENTS_FILENAME, CLAUDE_FILENAME] = PARENT_INSTRUCTION_FILENAMES;

function redirectPaths(projectDir: string): { agents: string; claude: string } {
  return { agents: path.join(projectDir, AGENTS_FILENAME), claude: path.join(projectDir, CLAUDE_FILENAME) };
}

export function needsClaudeRedirect(projectDir: string): boolean {
  const { agents, claude } = redirectPaths(projectDir);
  return existsSync(agents) && !existsSync(claude);
}

export async function ensureClaudeRedirect(toolRoot: string, projectDir: string, dryRun: boolean): Promise<boolean> {
  if (!needsClaudeRedirect(projectDir)) return false;

  console.log("");
  console.log("Claude Code compatibility:");
  if (dryRun) {
    console.log(`  ${CLAUDE_FILENAME.padEnd(25)} would add redirect to ${AGENTS_FILENAME}`);
    return false;
  }
  await writeFile(redirectPaths(projectDir).claude, await renderTemplate(toolRoot, "claude-redirect.md", {}));
  console.log(`  ${CLAUDE_FILENAME.padEnd(25)} redirect to ${AGENTS_FILENAME} added`);
  return true;
}
