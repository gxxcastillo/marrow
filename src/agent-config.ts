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
      const rawName = line.slice(start, i).trim();
      const name =
        rawName.length >= 2 && (rawName[0] === '"' || rawName[0] === "'") && rawName[rawName.length - 1] === rawName[0]
          ? rawName.slice(1, -1)
          : rawName;
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

// A value can span multiple lines (an array or inline table split across lines); this
// walks forward from the key's line tracking bracket depth (honoring quotes and comments)
// so the whole old value is replaced instead of leaving its continuation lines dangling.
function valueLineSpan(lines: string[], start: number, limit: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let count = 0;
  for (let li = start; li < limit; li += 1) {
    count += 1;
    const line = lines[li];
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quote === '"') {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quote = null;
        continue;
      }
      if (quote === "'") {
        if (ch === "'") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "#") break;
      if (ch === "[" || ch === "{") depth += 1;
      else if (ch === "]" || ch === "}") depth -= 1;
    }
    if (depth <= 0) break;
  }
  return count;
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
  for (let i = 0; i < lines.length; ) {
    if (i > start && i < end && keyPattern.test(lines[i])) {
      if (!inserted) {
        next.push(`${key} = ${value}`);
        inserted = true;
      }
      i += valueLineSpan(lines, i, end);
      continue;
    }
    if (i === insert && !inserted) {
      next.push(`${key} = ${value}`);
      inserted = true;
    }
    next.push(lines[i]);
    i += 1;
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
  const hasSchema = "$schema" in settings;
  // Already correct: return the original text untouched rather than round-tripping
  // through JSON.stringify, which would reformat (and report as "changed") a file
  // whose whitespace/indentation doesn't happen to match our canonical 2-space output.
  if (hasSchema && settings.autoMemoryEnabled === false) return content;
  if (!hasSchema) settings.$schema = "https://json.schemastore.org/claude-code-settings.json";
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
  const skipped: string[] = [];
  for (const change of changes) {
    const existing = existsSync(change.path) ? await readFile(change.path, "utf8") : "";
    let next: string;
    try {
      next = change.next(existing);
    } catch (err) {
      // An unrelated pre-existing file the project already has (e.g. hand-edited,
      // invalid JSON) must not turn a successful attach into a reported failure —
      // skip just this file and let the rest of `add` finish normally.
      skipped.push(`  ${path.relative(projectDir, change.path).padEnd(25)} could not update: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (next === existing) continue;
    changed.push(`  ${path.relative(projectDir, change.path).padEnd(25)} ${change.label}`);
    if (!dryRun) {
      await mkdir(path.dirname(change.path), { recursive: true });
      await writeFile(change.path, next);
    }
  }

  console.log("");
  for (const entry of skipped) console.log(entry);
  if (changed.length === 0) {
    if (skipped.length === 0) console.log("Project settings already up to date.");
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
