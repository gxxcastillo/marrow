# AGENTS.md — orientation for agents working on marrow

Read this first, then `spec/README.md` for how marrow actually works (design, CLI
contract, safety guarantees), then `plans/implementation-plan.md` for build-phase
sequencing, acceptance criteria, and the per-project migration table. The spec is
authoritative on durable design and behavior; the plan is authoritative on phase
sequencing and the one-time migration order. Do not re-derive or re-litigate decisions
recorded in either; if one is unclear or wrong, stop and surface it rather than
improvising. If the two ever disagree on something durable, the spec wins — update the
plan to match rather than trusting a stale copy of a decision.

## What this repo is

See `README.md`. One repo, three roles: the `marrow` CLI (Bun + TypeScript), the `.agents/`
convention document, and the per-project data branches. `main` carries code and docs only;
project branches carry planning data and are created exclusively by `marrow adopt` /
`marrow new`.

## Build discipline

- Bun + TypeScript. No runtime dependencies — Bun built-ins and `node:util` `parseArgs`
  only. If a dependency seems necessary, stop and ask.
- Keep it small. Target under ~400 lines of source (excluding tests). If you are exceeding
  that, you are building the wrong thing.
- Shell out to `git` via `Bun.spawn`/`Bun.$`. Do not use a git library.
- Tests use `bun test` against throwaway fixture repos in a temp directory. Tests must
  never touch real repos under `~/dev`. The `MARROW_HOME` and `MARROW_DEV_ROOT` env
  overrides exist for exactly this — see `spec/architecture.md` → Env overrides and
  `spec/safety.md` → Test isolation.
- Prose style for anything written to docs or the convention: short declarative sentences,
  facts with file names and numbers, no evaluative flourish, no marketing language.

## Safety rules (hard)

The durable safety guarantees — backup-before-mutate, no force-push/history-rewrite,
private-remote requirement, rollback/verification contract — are canonical in
`spec/safety.md`. This section only covers rules specific to *building and migrating
with* marrow, not to marrow's own behavior:

- Phases 0–2 must not touch any repo outside `~/dev/marrow` except throwaway test
  fixtures. (Satisfied — Phases 0–2 are complete.)
- Migrating real projects (plan, Phase 3) is **attended only** — Gabriel present and
  approving each project. Never run `marrow adopt` against a real project autonomously.
  `marrow adopt --dry-run <project>` is always safe to run unattended; the live command is
  not.
- Two projects (`eos`, `event-link`) currently have `.agents/` **tracked** in their parent
  repos, and `event-link` is public. Their migration steps differ — follow the migration
  table in the plan exactly.
- Creating the private GitHub remote (`gh repo create gxxcastillo/marrow --private`)
  required Gabriel's explicit go-ahead — done 2026-08-26; `marrow doctor` re-verifies
  visibility on every run going forward.

## Working memory

While building marrow, keep working notes as ordinary committed files in this repo
(`plans/`, or a `notes/` directory if needed). Marrow adopting its own `.agents/` is
deliberately deferred (plan, Phase 5). Do not use a harness-provided per-user memory
store for this project.
