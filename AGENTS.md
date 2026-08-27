# AGENTS.md — orientation for agents working on marrow

Read this first, then `README.md` (what marrow is, where the build stands), then
`spec/README.md` for how marrow actually works (design, CLI contract, safety guarantees),
then `.agents/plans/implementation-plan.md` — marrow's own vault worktree — for
build-phase sequencing, acceptance criteria, and the per-project migration table. The spec
is authoritative on durable design and behavior; the plan is authoritative on phase
sequencing and the one-time migration order. Do not
re-derive or re-litigate decisions recorded in either; if one is unclear or wrong, stop and
surface it rather than improvising. If the two ever disagree on something durable, the spec
wins — update the plan to match rather than trusting a stale copy of a decision.

This file carries build discipline and the operating rules for running marrow against real
projects. It holds no copy of the design, the current status, or the phase plan — those
live in the three files above, and a second copy here only goes stale.

## Build discipline

- Bun + TypeScript. No runtime dependencies — Bun built-ins and `node:util` `parseArgs`
  only, CLI frameworks included (`spec/architecture.md` → Non-goals). If a dependency
  seems necessary, stop and ask.
- Argument handling is the command table in `src/cli.ts`. Adding a command means adding one
  entry there: usage text, `--help`, required-argument checks and unknown-option errors are
  all generated from it.
- Keep it small. No source file over ~250 lines (excluding tests). A file growing past that
  is a sign the shape is wrong, not that the budget is.
- Shell out to `git` via `Bun.spawn`/`Bun.$`. Do not use a git library.
- Tests use `bun test` against throwaway fixture repos in a temp directory. Tests must
  never touch real repos under `~/dev`. The `MARROW_HOME` override points tests at a
  throwaway vault; project paths in tests are explicit — see `spec/architecture.md` →
  Env overrides and `spec/safety.md` → Test isolation.
- Prose style for anything written to docs or the convention: short declarative sentences,
  facts with file names and numbers, no evaluative flourish, no marketing language.

## Safety rules (hard)

The durable safety guarantees — backup-before-mutate, no force-push/history-rewrite,
private-remote requirement, rollback/verification contract — are canonical in
`spec/safety.md`. This section only covers rules specific to *building and migrating
with* marrow, not to marrow's own behavior:

- Migrating real projects (plan, Phase 3) is **attended only** — Gabriel present and
  approving each project. Never run `marrow add` against a real project's existing
  `.agents/` autonomously. `marrow add <project-path> --dry-run` is always safe to run
  unattended; the live command is not.
- Some projects still track `.agents/` in their parent repo and need an attended untracking
  step before `add` will accept them; one of those parent repos is public. The plan's
  inventory table is authoritative on which projects and what each one needs — follow it
  exactly rather than a copy of it.
- Creating the vault's private GitHub remote (`gh repo create gxxcastillo/marrow-vault
  --private`) requires Gabriel's explicit go-ahead — never do it on your own initiative.
  `spec/safety.md` → Private-only vault owns the requirement itself; `marrow doctor`
  re-verifies visibility on every run once the remote exists.

## Working memory

marrow has adopted itself, so its working memory lives where every other project's does:
`.agents/`, a vault worktree on the `marrow` branch. Structure and maintenance rules are
`marrow convention`; the build plan is `.agents/plans/implementation-plan.md`. Write notes
there, not into the tool repo — this repo carries code, spec, `CONVENTION.md`, `README.md`
and this file, and nothing that tracks status or work in flight. Sync before ending a
session you wrote in: `marrow sync marrow -m "<one-line summary>"`. Do not use a
harness-provided per-user memory store for this project.
