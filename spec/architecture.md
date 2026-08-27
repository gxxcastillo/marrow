# Architecture

Authoritative on design and both repos' own structure. `cli.md` wins on command syntax and
exit codes; `safety.md` wins on anything safety-related.

## Intent

Projects can keep a `.agents/` working-memory directory: resumption context, plans,
deferred work, and research records (format: `../CONVENTION.md`). Left alone, these
directories are often gitignored and live on one machine, with no history and no backup.
marrow fixes that by giving each project's `.agents/` a private git backing, without
merging that content into the project's own repo or into marrow's own tool history.

## Two repos: tool and vault

marrow is deliberately two separate git repos, not one:

- **The tool repo** (`marrow`) — the CLI, this spec, `CONVENTION.md`, and the templates.
  It is an ordinary coding project with its own git history and hygiene.
- **The vault** — the git backing for every project's `.agents/` data: one orphan branch
  per adopted project, checked out as a worktree at `<project-path>/.agents`
  inside that project's own directory. The vault is not a coding project — it holds no
  code of its own, only per-project data plus a minimal GitHub landing README on `main`
  — so it lives outside normal project checkouts. It is a **bare** git repository at
  `~/.marrow/vault.git` by default, with `~/.marrow/backups/` and `~/.marrow/logs/`
  alongside it as ordinary (non-git-tracked) sibling directories.

Splitting these apart resolves a structural problem: if the tool repo and the vault are
the same repository, the tool cannot adopt its own `.agents/` without nesting a worktree
inside its own main checkout. With the split, a tool checkout can be adopted the same way
as any other project. That is the whole of the rationale.

## Design model

**Zero config; worktrees are this machine's registry.** There is no config file listing
projects. `status`, `sync`, `doctor`, and `grep` discover the projects attached on the
current machine from `git worktree list --porcelain` against the vault. A vault clone
contains every project branch but may attach only the projects checked out locally. A
branch without a local worktree is normal, not a health failure. Because that bounds
what the registry-reading commands can see, `grep`, `status`, and `doctor` each name the
unattached branches rather than presenting a partial view as a complete one — `cli.md`
per command.

**The registry can drift from the filesystem.** A worktree's directory can be deleted
outside marrow — by hand, by a wider cleanup, by an unrelated tool — while the vault still
carries the branch and the registration. `git worktree list --porcelain` reports this as
`prunable`; marrow calls it a **missing** worktree. It is not a health failure the way a
misplaced or untracked worktree is: the branch and its history are intact in the vault
either way. `status`, `sync`, `grep`, and `doctor` each surface it (`cli.md` per command)
rather than crashing on a `cwd` that no longer exists, and name `marrow detach <project>`
as the remediation — it clears the registration without touching the branch.

**Project identity is independent of checkout path.** A GitHub project's default identity
is its normalized repository name from the parent-repo `origin`; SSH and HTTPS forms
resolve to the same repo name. Its vault branch is exactly that identity (`notes`,
`docs`, `marrow`). `add --id <id>` supplies the identity for a project without a supported origin,
or for a GitHub project that needs a non-default name. A directory basename is a local
display label only. This lets `/work/notes` and `/other/notes` attach the same branch.

**Branches never merge.** No shared history between any two project branches — each is
an independent orphan history, and none of them share history with the tool repo's
`main` either, since they now live in a different repository entirely. The vault's own
`main` is only a GitHub default branch with a short README; it is not registry data,
project memory, or tool configuration. Cross-project search is `marrow grep`, not `git
log` or `git merge`. This makes push races between projects structurally impossible
(disjoint branches); a concurrent sync of the _same_ project serializes on git's own lock
and should be treated as a retryable warning, not an error.

**Deliberate syncs are primary; automation is the floor.** The expected rhythm is an
agent running `marrow sync <project> -m "<summary>"` at the end of a working session (per
the Persistence block appended to every adopted `.agents/README.md`). Scheduled/hook-driven
`marrow sync --auto` is a backstop for forgotten syncs, not the primary mechanism —
see `cli.md` → `sync`.

## Env overrides

| Var           | Purpose                                                                                                              | Default     |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `MARROW_HOME` | vault parent directory — contains `vault.git/` (the bare repo git commands actually target), `backups/`, and `logs/` | `~/.marrow` |

There is no env var for the tool's own location. `templates/` and `CONVENTION.md` are
resolved relative to wherever the running `marrow` install actually lives on disk —
independent of `MARROW_HOME` — so `marrow convention` and the README-seeding step of
`add` work correctly regardless of where the vault is configured to be. This is
one fewer thing to configure, not a gap: the tool's own location is never ambiguous to
code that's already running from it. There is no projects-root setting either: `add`
takes a project path, and registered worktree paths come from the vault.

`MARROW_HOME` exists primarily so `bun test` can point at a throwaway vault. Test project
paths are ordinary explicit temp-directory paths — see `../AGENTS.md` for the
test-isolation discipline and guard.

## Repo layout

**Tool repo**:

```
marrow/
├── README.md
├── AGENTS.md
├── CONVENTION.md            # canonical .agents/ content convention
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
└── .gitignore                 # node_modules/, .agents/
```

The orphan-branch-per-project mechanism sets the tool's only hard version floor: `git
worktree add --orphan` requires git 2.42+. `bin/install` refuses to proceed below it and
`doctor` re-checks, because `init` itself does not use `--orphan` — without the check,
install would succeed and the first `add` would fail on an unknown option. The floor
lives in `src/git.ts` (`MIN_GIT_MAJOR`/`MIN_GIT_MINOR`) and is mirrored in `bin/install`,
which cannot import it.

Install: `bin/install` symlinks `bin/marrow` onto `PATH`, then runs `marrow init` (see
`cli.md` → `init`) to create the local vault's bare repo; both steps are idempotent and
neither touches the vault's GitHub remote. Remote lifecycle is explicit: `marrow
publish <owner>/<repo>` creates a new private GitHub vault remote, while `marrow init
--from <vault-url>` attaches a machine to an existing private vault remote.

**Vault** (`~/.marrow` by default, project branches plus a minimal `main` landing branch):

```
.marrow/
├── vault.git/                 # bare repo; project branches plus GitHub landing main
├── backups/                   # tarballs made by `add` when adopting — never auto-deleted
└── logs/                      # `sync --auto` log
```

`backups/` and `logs/` sit outside `vault.git/` and outside any git working tree — there
is nothing to gitignore, since there's no enclosing repo to accidentally track them into.

## Non-goals

- **Not a sync tool for `.agents/` _content_ rules.** What belongs inside `.agents/` —
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
- **No wrapping of other tools.** marrow backs project memory with git; it does not
  orchestrate editor, agent, issue-tracker, or task-runner workflows.
