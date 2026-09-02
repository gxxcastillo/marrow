// A small version ledger recording marrow's own template-authored block versions
// (the `.agents/README.md` persistence block, the AGENTS.md/CLAUDE.md note) in
// `.agents/README.md`'s YAML frontmatter, under one `marrow-versions:` key. No YAML
// library — the ledger is always a flat `  key: value` map, hand-parsed with regex.
// See `.agents/plans/version-ledger-plan.md` for the design rationale.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LEDGER_BLOCK_RE = /^marrow-versions:\r?\n((?:  [^\r\n]*\r?\n?)*)/m;
const LEDGER_ENTRY_LINE_RE = /^  ([a-z][a-z0-9-]*): (.+)$/gm;

function ledgerEntries(blockBody: string): { order: string[]; values: Map<string, string> } {
  const values = new Map<string, string>();
  const order: string[] = [];
  for (const match of blockBody.matchAll(LEDGER_ENTRY_LINE_RE)) {
    if (!values.has(match[1])) order.push(match[1]);
    values.set(match[1], match[2]);
  }
  return { order, values };
}

// Missing frontmatter, missing `marrow-versions:` block, or no matching key all
// return `undefined` — callers must treat that as "not verified current," never as
// "assume current."
export function readLedgerEntry(readmeContent: string, key: string): string | undefined {
  const fm = FRONTMATTER_RE.exec(readmeContent ?? "");
  if (!fm) return undefined;
  const block = LEDGER_BLOCK_RE.exec(fm[1]);
  if (!block) return undefined;
  return ledgerEntries(block[1]).values.get(key);
}

// Joins a frontmatter body with whatever follows it, normalized to exactly one blank
// line of separation when there is anything to separate from — regardless of how many
// (if any) newlines `rest` already starts with, so repeated writes stay idempotent
// instead of accumulating blank lines.
function withFrontmatter(body: string, rest: string): string {
  const trimmedRest = rest.replace(/^\r?\n+/, "");
  return trimmedRest.length > 0 ? `---\n${body}\n---\n\n${trimmedRest}` : `---\n${body}\n---\n`;
}

// Adds or updates exactly one ledger entry, never touching entries for other keys
// or any foreign frontmatter content. Three cases: no frontmatter at all (prepend a
// fresh one); frontmatter exists with no `marrow-versions:` key (insert one just
// before the closing fence); `marrow-versions:` already exists (replace the entry in
// place, or append it to the block).
export function upsertLedgerEntry(readmeContent: string, key: string, value: string): string {
  const content = readmeContent ?? "";
  const entryLine = `  ${key}: ${value}`;
  const fm = FRONTMATTER_RE.exec(content);

  if (!fm) return withFrontmatter(`marrow-versions:\n${entryLine}`, content);

  const body = fm[1];
  const rest = content.slice(fm[0].length);
  const block = LEDGER_BLOCK_RE.exec(body);

  if (!block) {
    const newBody = body.length > 0 ? `${body}\nmarrow-versions:\n${entryLine}` : `marrow-versions:\n${entryLine}`;
    return withFrontmatter(newBody, rest);
  }

  const { order, values } = ledgerEntries(block[1]);
  if (!values.has(key)) order.push(key);
  values.set(key, value);
  const newBlockBody = order.map((k) => `  ${k}: ${values.get(k)}`).join("\n");
  const newBody = body.slice(0, block.index) + `marrow-versions:\n${newBlockBody}` + body.slice(block.index + block[0].length);
  return withFrontmatter(newBody, rest);
}

// Removes the whole `marrow-versions:` block. If that empties the frontmatter (no
// other keys left), the frontmatter delimiters are removed too, joining directly to
// whatever followed. Used by `detach`, whose retained files should carry no marrow
// bookkeeping at all.
export function stripLedger(readmeContent: string): string {
  const content = readmeContent ?? "";
  const fm = FRONTMATTER_RE.exec(content);
  if (!fm) return content;

  const body = fm[1];
  const rest = content.slice(fm[0].length);
  const block = LEDGER_BLOCK_RE.exec(body);
  if (!block) return content;

  const before = body.slice(0, block.index).replace(/\r?\n$/, "");
  const after = body.slice(block.index + block[0].length).replace(/^\r?\n/, "");
  const newBody = [before, after].filter((s) => s.length > 0).join("\n");
  return newBody.length === 0 ? rest : withFrontmatter(newBody, rest);
}
