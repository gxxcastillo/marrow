# AGENTS.md — orientation for agents working on marrow

Read this first, then `plans/implementation-plan.md`. The plan is the contract: it carries
every decision already made, per-phase acceptance criteria, and the per-project migration
table. Do not re-derive or re-litigate decisions recorded there; if the plan is unclear or
wrong, stop and surface it rather than improvising.

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
  overrides exist for exactly this — see the plan.
- Prose style for anything written to docs or the convention: short declarative sentences,
  facts with file names and numbers, no evaluative flourish, no marketing language.

## Safety rules (hard)

- Phases 0–2 must not touch any repo outside `~/dev/marrow` except throwaway test
  fixtures.
- Phase 3 (migrating real projects) is **attended only** — Gabriel present and approving
  each project. Never run `marrow adopt` against a real project autonomously.
- `adopt` always creates a tar backup before mutating anything, and never deletes the
  original content — it moves it. See the adopt algorithm in the plan.
- Never force-push. Never rewrite history on any branch of this repo.
- Two projects (`eos`, `event-link`) currently have `.agents/` **tracked** in their parent
  repos, and `event-link` is public. Their migration steps differ — follow the migration
  table exactly.
- Creating the private GitHub remote (`gh repo create gxxcastillo/marrow --private`)
  requires Gabriel's explicit go-ahead. Verify with `gh repo view gxxcastillo/marrow
  --json visibility` that it is PRIVATE before the first push.

## Working memory

While building marrow, keep working notes as ordinary committed files in this repo
(`plans/`, or a `notes/` directory if needed). Marrow adopting its own `.agents/` is
deliberately deferred (plan, Phase 5). Do not use a harness-provided per-user memory
store for this project.
