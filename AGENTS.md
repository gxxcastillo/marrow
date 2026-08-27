# AGENTS.md — orientation for agents working on marrow

Read this first, then `README.md` (what marrow is), then `spec/README.md` for how marrow
actually works: design, CLI contract, and safety guarantees. If `.agents/` exists, read its
`README.md` for private working context before changing behavior. The spec is authoritative
on durable design and behavior. Do not re-derive or re-litigate decisions recorded there; if
one is unclear or wrong, stop and surface it rather than improvising.

This file carries build discipline and the operating rules for running marrow against real
projects. It holds no copy of private plans, inventories, or work in flight.

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
  never touch real project repos or the real vault. The `MARROW_HOME` override points tests at a
  throwaway vault; project paths in tests are explicit — see `spec/architecture.md` →
  Env overrides and `spec/safety.md` → Test isolation.
- Prose style for anything written to docs or the convention: short declarative sentences,
  facts with file names and numbers, no evaluative flourish, no marketing language.

## Safety rules (hard)

The durable safety guarantees — backup-before-mutate, no force-push/history-rewrite,
private-remote requirement, rollback/verification contract — are canonical in
`spec/safety.md`. This section only covers rules specific to *building and migrating
with* marrow, not to marrow's own behavior:

- Adopting a real project's existing `.agents/` is **attended only**. Never run
  `marrow add` live against existing project memory autonomously. `marrow add
  <project-path> --dry-run` is safe to run unattended; the live command is not.
- Some projects still track `.agents/` in their parent repo and need an attended untracking
  step before `add` will accept them. Project-specific inventories belong in `.agents/`,
  not here.
- Creating the vault's private GitHub remote with `marrow publish <owner>/<repo>`
  requires explicit user go-ahead — never do it on your own initiative.
  `spec/safety.md` → Private-only vault owns the requirement itself; `marrow doctor`
  re-verifies visibility on every run once the remote exists.

## Working memory

Project working memory belongs in `.agents/` when that directory is present. Structure and
maintenance rules are `marrow convention`. Write notes there, not into the tool repo — this
repo carries code, spec, `CONVENTION.md`, `README.md` and this file, and nothing that
tracks private status or work in flight. Sync before ending a session in which you wrote
there. Do not use a harness-provided per-user memory store for this project.
