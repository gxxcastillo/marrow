# Architecture

Authoritative on design and both repos' own structure. `cli.md` wins on command syntax and
exit codes; `safety.md` wins on anything safety-related.

## Intent

Nine-plus projects under `~/dev` each keep a `.agents/` working-memory directory —
resumption context, plans, deferred work, research records (format: `../CONVENTION.md`).
Left alone, these directories are gitignored and exist only on one machine, with no
history and no backup. marrow fixes that by giving each project's `.agents/` a private
git backing, without merging that content into the project's own repo or into marrow's
own tool history.

## Two repos: tool and vault

marrow is deliberately two separate git repos, not one:

- **The tool repo** (`marrow`) — the CLI, this spec, `CONVENTION.md`, and the templates.
  It's an ordinary coding project: it lives at `~/dev/marrow`, alongside every other
  project under `~/dev`, has one branch (`main`), and its own git hygiene is the same as
  any other repo there.
- **The vault** — the git backing for every project's `.agents/` data: one orphan branch
  per adopted project, checked out as a worktree at `<project-path>/.agents`
  inside that project's own directory. The vault is not a coding project — it holds no
  code of its own, only per-project data — so it does not live under `~/dev`. It is a
  **bare** git repository at `~/.marrow/vault.git` by default, with `~/.marrow/backups/`
  and `~/.marrow/logs/` alongside it as ordinary (non-git-tracked) sibling directories.

Splitting these apart resolves a real structural problem: the tool repo and the vault
used to be the same repository, which meant marrow could never adopt its own `.agents/`
without nesting a worktree inside its own main checkout. With the split, marrow's own
`.agents/` is an ordinary `marrow add .` from the tool checkout — a vault worktree at
`~/dev/marrow/.agents`, right next to the tool's own source, no different from any other
adopted project. That is the whole of the rationale; the retrofit it required is recorded
as Phase 2.5 of the build plan (`../.agents/plans/implementation-plan.md`, in the vault
worktree).

## Design model

**Zero config; worktrees are this machine's registry.** There is no config file listing
projects. `status`, `sync`, `doctor`, and `grep` discover the projects attached on the
current machine from `git worktree list --porcelain` against the vault. A vault clone
contains every project branch but may attach only the projects checked out locally. A
branch without a local worktree is normal, not a health failure.

**Project identity is independent of checkout path.** A GitHub project's identity is its
normalized parent-repo `origin`, `github.com/<owner>/<repo>`; SSH and HTTPS forms resolve
to the same identity. Its vault branch is `projects/<identity>`. `add --id <id>` supplies
the identity for a project without a supported origin. A directory basename is a local
display label only. This lets `~/dev/ossa` and `~/dev-stuff/ossa` attach the same branch.

**Branches never merge.** No shared history between any two project branches — each is
an independent orphan history, and none of them share history with the tool repo's
`main` either, since they now live in a different repository entirely. Cross-project
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
| `MARROW_HOME` | vault parent directory — contains `vault.git/` (the bare repo git commands actually target), `backups/`, and `logs/` | `~/.marrow` |

There is no env var for the tool's own location. `templates/` and `CONVENTION.md` are
resolved relative to wherever the running `marrow` install actually lives on disk —
independent of `MARROW_HOME` — so `marrow convention` and the README-seeding step of
`add` work correctly regardless of where the vault is configured to be. This is
one fewer thing to configure, not a gap: the tool's own location is never ambiguous to
code that's already running from it. There is no projects-root setting either: `add`
takes a project path, and registered worktree paths come from the vault.

`MARROW_HOME` exists primarily so `bun test` can point at a throwaway vault instead of
real data. Test project paths are ordinary explicit temp-directory paths — see
`../AGENTS.md` for the test-isolation discipline and guard.

## Repo layout

**Tool repo** (`~/dev/marrow`, `main` branch):

```
marrow/
├── README.md
├── AGENTS.md
├── CONVENTION.md            # canonical .agents/ content convention
├── .agents/                 # vault worktree (branch `marrow`) — working memory; gitignored
├── spec/                    # this directory
├── templates/
│   ├── readme-seed.md       # seeds a fresh `marrow add`; {{project}} substituted
│   └── persistence-block.md # appended to every adopted/created README.md
├── src/
│   ├── cli.ts                # entry, arg parsing (node:util parseArgs), dispatch
│   ├── git.ts                 # Bun.spawn git wrapper; worktree discovery; status helpers
│   ├── project.ts             # project-arg resolution; README templating
│   └── commands/
│       ├── status.ts, sync.ts, add.ts, doctor.ts, grep.ts, convention.ts
├── test/                     # bun test; fixtures build a throwaway tool root + vault
├── bin/
│   ├── marrow                # `#!/usr/bin/env bun` shim; exports run() from cli.ts
│   └── install               # one-time setup: symlinks bin/marrow onto PATH, inits the vault
├── package.json               # name, bin entry; no runtime dependencies
└── .gitignore                 # node_modules/, .agents/ (the vault worktree)
```

marrow has adopted itself: the `.agents/` entry above is an ordinary vault worktree on the
`marrow` branch, checked out right here, no different from any other adopted project's.
marrow's own working memory — the build plan included — lives there rather than in this
tree; this spec's `README.md` → "What lives outside this spec" says what moved and why a
checkout without the vault is still complete.

Install: `bin/install` symlinks `bin/marrow` onto `PATH`, then runs `marrow init` (see
`cli.md` → `init`) to create the vault's bare repo; both steps are idempotent and neither
touches the vault's GitHub remote. Currently `~/.local/bin/marrow -> ~/dev/marrow/bin/marrow`.

**Vault** (`~/.marrow` by default, no `main`/tool content, ever):

```
.marrow/
├── vault.git/                 # bare repo; one orphan branch per adopted project
├── backups/                   # tarballs made by `add` when adopting — never auto-deleted
└── logs/                      # `sync --auto` log
```

`backups/` and `logs/` sit outside `vault.git/` and outside any git working tree — there
is nothing to gitignore, since there's no enclosing repo to accidentally track them into.

## Non-goals

- **Not a sync tool for `.agents/` *content* rules.** What belongs inside `.agents/` —
  file names, when to promote content upward, maintenance discipline — is
  `../CONVENTION.md`'s job. marrow only backs the directory with git; it has no opinion
  on what's written there.
- **No CLI framework, no runtime dependencies.** Argument handling is a command table in
  `src/cli.ts` over `node:util`'s `parseArgs`. Seven commands and three flags do not earn
  commander or yargs, and a runtime dependency would cost the install story: `bin/install`
  is a symlink onto `PATH` plus `marrow init`, with no `bun install` step at the
  install location. `grep`'s verbatim `rg` pass-through is also easier with no parser in
  the way: its arguments are never parsed by marrow at all.
- **No merge, no cross-project history.** Project branches are permanently disjoint from
  each other and from the tool repo's `main`. There is no planned "combine everything"
  view beyond `marrow grep`.
- **No automatic cross-machine conflict resolution.** `sync` fetches and fast-forwards a
  clean behind worktree. Dirty or diverged worktrees require manual reconciliation; marrow
  never merges, rebases, or rewrites history for them.
- **No daemon beyond a plain scheduler.** Automation is a session-end hook plus a periodic
  timer (`sync --auto`), not a long-running process.
- **No wrapping of other tools, no beads/ossa integration beyond the documented seam.**
  `sync`'s algorithm has a deliberate extension point — if `<worktree>/.beads/` exists,
  a beads JSONL flush would run before committing — but that seam is unbuilt until beads
  is piloted inside one real `.agents/` directory. Nothing should be built against it yet.
- **No public tool repo yet.** The tool/vault split is motivated by the vault not being a
  coding project, not by an intent to open-source the tool — that remains a separate,
  still-open, still-deferred question with no action attached. The split does happen to
  leave that door open without further rework, since the tool repo is already clean of
  private data.
