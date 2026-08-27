# Architecture

Authoritative on design and the repo's own structure. `cli.md` wins on command syntax and
exit codes; `safety.md` wins on anything safety-related.

## Intent

Nine-plus projects under `~/dev` each keep a `.agents/` working-memory directory —
resumption context, plans, deferred work, research records (format: `../CONVENTION.md`).
Left alone, these directories are gitignored and exist only on one machine, with no
history and no backup. marrow fixes that by giving each project's `.agents/` a private
git backing, without merging that content into the project's own repo or into marrow's
own tool history.

## Design model

**Self-hosted vault, one repo, three roles.** `main` carries the CLI and this spec.
`CONVENTION.md` is the canonical `.agents/` content convention. Everything else is data:
one orphan branch per adopted project, branch name equal to the project directory name,
checked out as a git worktree at `<MARROW_DEV_ROOT>/<project>/.agents`.

**Zero config; worktrees are the registry.** There is no config file listing adopted
projects. `status`, `sync`, `doctor`, and `grep` all discover projects the same way:
`git worktree list --porcelain` run in `MARROW_HOME`, parsed into `{path, branch}` pairs,
excluding the main checkout (the entry whose branch is `main`). Adopting or dropping a
project is a `git worktree` operation, nothing more — there is no separate registry to
fall out of sync with reality.

**Branches never merge.** No shared history between `main` and any project branch, or
between two project branches — each is an independent orphan history. Cross-project
search is `marrow grep`, not `git log` or `git merge`. This makes push races between
projects structurally impossible (disjoint branches); a concurrent sync of the *same*
project serializes on git's own lock and should be treated as a retryable warning, not an
error.

**Deliberate syncs are primary; automation is the floor.** The expected rhythm is an
agent running `marrow sync <project> -m "<summary>"` at the end of a working session (per
the Persistence block appended to every adopted `.agents/README.md`). Scheduled/hook-driven
`marrow sync --auto` is a backstop for forgotten syncs, not the primary mechanism —
see `cli.md` → `sync`.

## Env overrides

| Var | Purpose | Default |
|---|---|---|
| `MARROW_HOME` | vault repo path (where `main` and every worktree registry entry live) | `~/dev/marrow` |
| `MARROW_DEV_ROOT` | projects root; worktrees are expected at `<MARROW_DEV_ROOT>/<project>/.agents` | `~/dev` |

These exist primarily so `bun test` can point both at throwaway temp directories instead
of real data — see `../AGENTS.md` for the test-isolation discipline and guard.

## Repo layout (`main` branch)

```
marrow/
├── README.md
├── AGENTS.md
├── CONVENTION.md            # canonical .agents/ content convention
├── plans/implementation-plan.md
├── spec/                    # this directory
├── templates/
│   ├── readme-seed.md       # seeds `marrow new`; {{project}} substituted
│   └── persistence-block.md # appended to every adopted/new README.md
├── src/
│   ├── cli.ts                # entry, arg parsing (node:util parseArgs), dispatch
│   ├── git.ts                 # Bun.spawn git wrapper; worktree discovery; status helpers
│   ├── project.ts             # project-arg resolution; README templating
│   └── commands/
│       ├── status.ts, sync.ts, adopt.ts, new.ts, doctor.ts, grep.ts, convention.ts
├── test/                     # bun test; fixtures build a throwaway vault + dev root
├── bin/marrow                # `#!/usr/bin/env bun` shim; exports run() from cli.ts
├── package.json               # name, bin entry; no runtime dependencies
├── .gitignore                 # backups/, logs/, node_modules/
├── backups/                   # tarballs made by `adopt` (gitignored, never auto-deleted)
└── logs/                      # `sync --auto` log (gitignored)
```

Install: `bin/marrow` symlinked onto `PATH` — currently `~/.local/bin/marrow ->
~/dev/marrow/bin/marrow`.

## Non-goals

- **Not a sync tool for `.agents/` *content* rules.** What belongs inside `.agents/` —
  file names, when to promote content upward, maintenance discipline — is
  `../CONVENTION.md`'s job. marrow only backs the directory with git; it has no opinion
  on what's written there.
- **No merge, no cross-project history.** Project branches are permanently disjoint from
  `main` and from each other. There is no planned "combine everything" view beyond
  `marrow grep`.
- **No multi-machine sync beyond `git clone` + re-running worktree setup.** A `marrow
  restore` command for a second machine is unspecked; not needed until one materializes.
- **No daemon beyond a plain scheduler.** Automation is a session-end hook plus a periodic
  timer (`sync --auto`), not a long-running process.
- **No wrapping of other tools, no beads/ossa integration beyond the documented seam.**
  `sync`'s algorithm has a deliberate extension point — if `<worktree>/.beads/` exists,
  a beads JSONL flush would run before committing — but that seam is unbuilt until beads
  is piloted inside one real `.agents/` directory. Nothing should be built against it yet.
- **No public split (yet).** If marrow-the-tool should ever go public, `src/` could fork
  into a public repo with this one staying private-data-only. No action follows from this
  today; noted only so the one-repo choice isn't mistaken for permanent.
