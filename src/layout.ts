import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// 5MiB. Flags today's one outlier (pho, ~5.6M) with >10x headroom over the
// next-largest real worktree (472K) — see `plans/layout-recognition-plan.md`.
export const WORKTREE_WEIGHT_KB_THRESHOLD = 5 * 1024;

// Direct `*-plan.md` children of the worktree root, not `plans/*.md`. This
// catches only the legacy `-plan.md` naming: current guidance places plans at
// `plans/<slug>.md` (`../CONVENTION.md` → Files — the suffix stutters, though
// existing `-plan.md` files stay valid). A bare-named root file can't be told
// apart from a legitimate root file (`current-state.md`, `deferred-items.md`,
// `agent-notes.md`) without reading content, which marrow does not do
// (`../spec/architecture.md` → Non-goals: measure and locate, never
// interpret). A root-level plan is invisible to `status`'s blocked-on-you scan
// (`memory-files.ts`'s `blockedOnYouLines` reads only a direct `plans/*.md`
// child). Purely structural: no file content is read.
export async function misplacedPlanFiles(agentsPath: string): Promise<string[]> {
  const entries = await readdir(agentsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-plan.md"))
    .map((entry) => entry.name)
    .sort();
}

async function directorySizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += await directorySizeBytes(fullPath);
    else if (entry.isFile()) total += (await stat(fullPath)).size;
  }
  return total;
}

// Recursive size of the whole worktree directory, in KB. A worktree's own
// `.git` is a small pointer file (the real object store lives in the vault's
// bare repo), so this measures content, not git bookkeeping.
export async function worktreeWeightKb(agentsPath: string): Promise<number> {
  return (await directorySizeBytes(agentsPath)) / 1024;
}
