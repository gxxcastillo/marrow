# marrow

Private git backing for the `.agents/` working-memory directories across `~/dev` projects.

Each project's `.agents/` stays gitignored by its parent repo but becomes a git worktree of
this repo, on a branch named after the project. One private remote backs up all of them;
git history replaces the append-only narrative style the directories used before.

This repo holds three things:

- **The tool** — a small Bun/TypeScript CLI (`marrow`) that adopts, syncs, and checks the
  worktrees. See `plans/implementation-plan.md`.
- **The convention** — `CONVENTION.md`, the single canonical description of how `.agents/`
  directories are structured and maintained. Per-project READMEs point here instead of
  restating it.
- **The data** — one branch per project (`pho`, `ossa`, `sobremesa`, …), each checked out as
  a worktree at `~/dev/<project>/.agents`. Branches are orphans; they never merge with
  `main` or each other.

This repo must remain **private**: the project branches contain personal planning content,
including for projects whose own repos are public.

## Status

Phase 1 done: `git.ts` wrapper, `status`, `sync`, and the `marrow` CLI entry point are
built and tested (`bun test`, 21 tests). No project has been adopted yet — Phase 2
(`adopt`, `new`, `doctor`, `grep`, `convention`) is next. Start with `AGENTS.md`, then
`plans/implementation-plan.md`.
