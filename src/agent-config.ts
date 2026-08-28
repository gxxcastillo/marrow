import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const codexMemorySettings = [
  { table: "features", key: "memories", value: false },
  { table: "memories", key: "use_memories", value: false },
  { table: "memories", key: "generate_memories", value: false },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tomlTableHeader(line: string): { name: string; array: boolean } | null {
  let i = 0;
  while (i < line.length && /\s/.test(line[i])) i += 1;
  if (line[i] !== "[") return null;
  i += 1;
  const array = line[i] === "[";
  if (array) i += 1;

  const start = i;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  while (i < line.length) {
    const ch = line[i];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quote = null;
      i += 1;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "]") {
      const name = line.slice(start, i).trim();
      i += 1;
      if (array) {
        if (line[i] !== "]") return null;
        i += 1;
      }
      const rest = line.slice(i).trim();
      return name.length > 0 && (rest === "" || rest.startsWith("#")) ? { name, array } : null;
    }
    i += 1;
  }
  return null;
}

function tableName(line: string): string | null {
  const header = tomlTableHeader(line);
  return header !== null && !header.array ? header.name : null;
}

function withFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function appendTable(content: string, table: string, key: string, value: boolean): string {
  if (content.trim().length === 0) return `[${table}]\n${key} = ${value}\n`;
  const base = withFinalNewline(content);
  const prefix = base.endsWith("\n\n") ? "" : "\n";
  return `${base}${prefix}[${table}]\n${key} = ${value}\n`;
}

function setTomlBoolean(content: string, table: string, key: string, value: boolean): string {
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.replace(/\n+$/, "").split("\n");
  const start = lines.findIndex((line) => tableName(line) === table);
  if (start === -1) return appendTable(normalized, table, key, value);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (tomlTableHeader(lines[i]) !== null) {
      end = i;
      break;
    }
  }
  let insert = end;
  while (insert > start + 1 && lines[insert - 1].trim() === "") insert -= 1;

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  let inserted = false;
  const next: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > start && i < end && keyPattern.test(lines[i])) {
      if (!inserted) {
        next.push(`${key} = ${value}`);
        inserted = true;
      }
      continue;
    }
    if (i === insert && !inserted) {
      next.push(`${key} = ${value}`);
      inserted = true;
    }
    next.push(lines[i]);
  }
  if (!inserted) next.push(`${key} = ${value}`);
  return withFinalNewline(next.join("\n").replace(/\n+$/, ""));
}

function codexConfigWithMemoryDisabled(content: string): string {
  let next = content;
  for (const setting of codexMemorySettings) {
    next = setTomlBoolean(next, setting.table, setting.key, setting.value);
  }
  return next;
}

function claudeSettingsWithMemoryDisabled(content: string): string {
  const parsed = content.trim().length === 0 ? {} : JSON.parse(content);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Claude Code settings must be a JSON object");
  }
  const settings = parsed as Record<string, unknown>;
  if (!("$schema" in settings)) settings.$schema = "https://json.schemastore.org/claude-code-settings.json";
  settings.autoMemoryEnabled = false;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export async function ensureAgentMemoryDisabled(projectDir: string, dryRun: boolean): Promise<boolean> {
  const codexConfig = path.join(projectDir, ".codex", "config.toml");
  const claudeSettings = path.join(projectDir, ".claude", "settings.json");
  const changes = [
    {
      path: codexConfig,
      next: codexConfigWithMemoryDisabled,
      label: "Codex memory disabled",
    },
    {
      path: claudeSettings,
      next: claudeSettingsWithMemoryDisabled,
      label: "Claude Code auto memory disabled",
    },
  ];

  const changed: string[] = [];
  for (const change of changes) {
    const existing = existsSync(change.path) ? await readFile(change.path, "utf8") : "";
    const next = change.next(existing);
    if (next === existing) continue;
    changed.push(`  ${path.relative(projectDir, change.path).padEnd(25)} ${change.label}`);
    if (!dryRun) {
      await mkdir(path.dirname(change.path), { recursive: true });
      await writeFile(change.path, next);
    }
  }

  console.log("");
  if (changed.length === 0) {
    console.log("Project settings already up to date.");
    return false;
  }
  if (dryRun) {
    console.log("Would update project settings:");
    for (const entry of changed) console.log(entry);
    return false;
  }
  console.log("Updated project settings:");
  for (const entry of changed) console.log(entry);
  return true;
}
