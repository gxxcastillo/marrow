# marrow

Private git backing for the `.agents/` working-memory directories across `~/dev` projects.

Each project's `.agents/` stays gitignored by its parent repo but becomes a git worktree of
a separate private vault repo, on a branch named after the project. git history replaces
the append-only narrative style the directories used before.

marrow is two repos, not one — see `spec/architecture.md` → "Two repos: tool and vault"
for the full rationale:

- **This repo — the tool.** A small Bun/TypeScript CLI (`marrow`) that adopts, syncs, and
  checks the worktrees, plus `CONVENTION.md` (the single canonical description of how
  `.agents/` directories are structured and maintained — per-project READMEs point here
  instead of restating it) and this spec. An ordinary dev project, lives at
  `~/dev/marrow` like everything else under `~/dev`. Design, CLI contract, and safety
  guarantees: `spec/README.md`.
- **The vault — a separate repo, outside `~/dev`.** Holds nothing but data: one orphan
  branch per adopted project (`pho`, `ossa`, `sobremesa`, …), each checked out as a
  worktree at `~/dev/<project>/.agents`. Branches never merge with each other or with
  this repo's `main`. It is not a coding project, which is exactly why it doesn't live
  alongside the ones that are.

The vault must remain **private**: the project branches contain personal planning
content, including for projects whose own repos are public.

## Install

`bin/marrow` is symlinked onto `PATH`: `ln -s ~/dev/marrow/bin/marrow ~/.local/bin/marrow`.

## Status

Phase 2 shipped (`status`, `sync`, `adopt`, `new`, `doctor`, `grep`, `convention` —
`bun test`, 43 tests) in the **original one-repo shape**: everything, tool and vault
alike, lives in this repo at `~/dev/marrow`. `spec/` now describes the **two-repo target
design** decided 2026-08-26 (tool here, vault elsewhere) — Phase 2.5, not yet started,
brings the code in line with it. No project has been adopted for real yet, so there's no
migrated data to move: this is the cheapest possible point to make the split. Start with
`AGENTS.md`, then `spec/README.md` for the target design, then
`plans/implementation-plan.md` for exactly what Phase 2.5 changes and what's next after
it (Phase 3: attended migration of the nine real projects).
