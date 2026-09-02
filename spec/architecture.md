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
  `~/.marrow/vault.git` by default, with `~/.marrow/backups/` alongside it as an ordinary
  (non-git-tracked) sibling directory.

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
`docs`, `marrow`). `attach --id <id>` supplies the identity for a project without a supported origin,
or for a GitHub project that needs a non-default name. A directory basename is a local
display label only. This lets `/work/notes` and `/other/notes` attach the same branch.

**Branches never merge.** No shared history between any two project branches — each is
an independent orphan history, and none of them share history with the tool repo's
`main` either, since they now live in a different repository entirely. The vault's own
`main` is only a GitHub default branch with a short README; it is not registry data,
project memory, or tool configuration. Cross-project search is `marrow grep`, not `git
log` or `git merge`. This makes push races between projects structurally impossible
(disjoint branches); a concurrent sync of the _same_ project serializes on git's own lock
and reports a lock failure as an error. Retrying that failure is safe.

**Deliberate syncs are the mechanism.** The expected rhythm is an agent running
`marrow sync <project> -m "<summary>"` when work lands or a decision is made (per the
Persistence block appended to every adopted `.agents/README.md`). Automation
(scheduled/hook-driven syncing) is deliberately not built — see Non-goals below.

## Env overrides

| Var           | Purpose                                                                                       | Default     |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| `MARROW_HOME` | vault parent directory — contains `vault.git/` (the bare repo git commands actually target) and `backups/` | `~/.marrow` |

There is no env var for the tool's own location. `templates/`, `CONVENTION.md`, and
`package.json` are resolved relative to wherever the running `marrow` install lives —
independent of `MARROW_HOME` — so version output, `marrow convention`, and the
working-memory and parent-instruction steps of `attach` work correctly regardless of where
the vault is configured to be. This is
one fewer thing to configure, not a gap: the tool's own location is never ambiguous to
code that's already running from it. There is no projects-root setting either: `attach`
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
│   ├── agents-block.md      # parent instruction block printed by `marrow attach`
│   ├── claude-redirect.md   # CLAUDE.md stub planted when AGENTS.md exists without one
│   ├── current-state.md     # required resumption-context seed
│   ├── readme-seed.md       # seeds a fresh `marrow attach`; {{project}} substituted
│   └── persistence-block.md # appended to every adopted/created README.md
├── src/
│   ├── cli.ts               # entry, command table, arg parsing, dispatch
│   ├── agent-config.ts      # parent agent-memory settings
│   ├── backup.ts            # verified adoption tarballs
│   ├── claude-redirect.ts   # CLAUDE.md redirect stub for Claude Code auto-load
│   ├── format.ts            # shared output formatting
│   ├── git.ts               # git process wrapper; worktree and ref helpers
│   ├── gitignore.ts         # parent-repo .agents/ ignore-state handling
│   ├── identity.ts          # stable project identity resolution
│   ├── memory-files.ts      # seeding, stamp parsing, and status scans
│   ├── project.ts           # parent instruction block: recognition, status, writes
│   ├── remote.ts            # origin configuration and safety checks
│   ├── target-resolution.ts # shared target resolution for sync/refresh
│   ├── vault.ts             # vault initialization and landing branch
│   ├── version-ledger.ts    # .agents/README.md frontmatter version ledger
│   └── commands/
│       ├── init.ts, publish.ts, status.ts, sync.ts, attach.ts, refresh.ts
│       └── detach.ts, doctor.ts, grep.ts, convention.ts, update.ts
├── test/                     # bun test; fixtures build a throwaway tool root + vault
├── bin/
│   ├── marrow                # `#!/usr/bin/env bun` shim; exports run() from cli.ts
│   ├── setup                 # one-time local setup: symlinks bin/marrow onto PATH, inits the vault
│   ├── install               # no-checkout bootstrap: clones the tool repo, then runs setup
│   └── uninstall              # reverses install: removes the clone and its PATH symlink
├── package.json               # name, bin entry; no runtime dependencies
└── .gitignore                 # node_modules/, .agents/
```

The orphan-branch-per-project mechanism sets the tool's only hard version floor: `git
worktree add --orphan` requires git 2.42+. `bin/setup` refuses to proceed below it and
`doctor` re-checks, because `init` itself does not use `--orphan` — without the check,
setup would succeed and the first `attach` would fail on an unknown option. The floor
lives in `src/git.ts` (`MIN_GIT_MAJOR`/`MIN_GIT_MINOR`) and is mirrored in `bin/setup`,
which cannot import it.

Setup: `bin/setup` symlinks `bin/marrow` onto `PATH`, then runs `marrow init` (see
`cli.md` → `init`) to create the local vault's bare repo; both steps are idempotent and
neither touches the vault's GitHub remote. Remote lifecycle is explicit: `marrow
publish <owner>/<repo>` creates a new private GitHub vault remote, while `marrow init
--from <vault-url>` attaches a machine to an existing private vault remote.

`bin/setup` assumes a local checkout of the tool repo already exists. `bin/install`
covers the case where it doesn't: it clones the tool repo to a fixed path
(`~/.local/share/marrow`), then runs that checkout's `bin/setup`. It is meant to be run
via `curl | bash` against the raw file, and it is idempotent — re-running it updates the
existing managed clone (fetch + hard reset to the tracked branch) instead of re-cloning,
reporting `already up to date (<sha>)` or `updated <old-sha> -> <new-sha>`, and it refuses
to touch a `~/.local/share/marrow` that isn't a checkout of this repo's `origin`. The
clone is sparse: `test/` is excluded (dev-only, not needed to run marrow), and the sparse
pattern persists across the update path's fetch + reset since it's stored in the clone's
own git config. `bin/uninstall` reverses it: it removes the managed clone and the
`~/.local/bin/marrow` symlink only when each still points at what `install` created, and
never touches the vault — deleting real project data is never an automatic side effect of
removing the tool.

`marrow update` (`cli.md` → `update`) gives the managed install a first-party update path
that doesn't require a local checkout of the tool repo at all: it locates
`~/.local/share/marrow` (physical-path resolved, so a symlinked `$HOME` is still
recognized), confirms the currently running checkout *is* that managed one, and spawns its
`bin/install`. There is one updater implementation — `update` never reimplements the
fetch/reset logic in TypeScript. Run from a local development checkout, it refuses and
points at git instead; it never resets a development checkout. It does not require a vault
to exist and has no `--dry-run` — the underlying `bin/install` is idempotent and safe to
preview by reading, not by a flagged dry mode.

The managed checkout at `~/.local/share/marrow` (and its `~/.local/bin/marrow` symlink)
intentionally live outside `MARROW_HOME`. The tool checkout is disposable and replaceable
— `marrow update`/`bin/install` freely fetch and hard-reset it — while `MARROW_HOME` holds
irreplaceable user data (the vault, tarball backups). Keeping them on separate deletion
boundaries means `bin/uninstall` can freely remove the former and never risks the latter;
it is a safety property, not a filesystem convention.

**Vault** (`~/.marrow` by default, project branches plus a minimal `main` landing branch):

```
.marrow/
├── vault.git/                 # bare repo; project branches plus GitHub landing main
└── backups/                   # tarballs made by `attach` when adopting — never auto-deleted
```

`backups/` sits outside `vault.git/` and outside any git working tree — there is nothing
to gitignore, since there's no enclosing repo to accidentally track it into.

## Non-goals

- **Not a sync tool for `.agents/` prose.** What belongs inside `.agents/`, when to
  promote it, and how to maintain it are `../CONVENTION.md`'s job. marrow recognizes the
  canonical current-state filename, stamp, blocked marker, and size threshold required
  by `status` and `doctor`. It does not interpret the prose.
- **No CLI framework, no runtime dependencies.** Argument handling is a command table in
  `src/cli.ts` over `node:util`'s `parseArgs`. The fixed command and flag surface does not
  earn commander or yargs, and a runtime dependency would cost the install story: `bin/setup`
  is a symlink onto `PATH` plus `marrow init`, with no `bun install` step at the
  install location. `grep`'s verbatim `rg` pass-through is also easier with no parser in
  the way: its arguments are never parsed by marrow at all.
- **No merge, no cross-project history.** Project branches are permanently disjoint from
  each other and from the tool repo's `main`. `status` composes current local state and
  `grep` searches attached content. Neither combines branch histories.
- **No automatic cross-machine conflict resolution.** `sync` fetches and fast-forwards a
  clean behind worktree. Dirty or diverged worktrees require manual reconciliation; marrow
  never merges, rebases, or rewrites history for them.
- **No daemon, no scheduled automation.** `sync` had a `--auto` mode for a session-end hook
  or periodic timer; it was removed with nothing yet invoking it (see `git log` for the
  working implementation if the hook/launchd decision is later made the other way).
  Automation, if built, stays a plain scheduler — never a long-running process.
- **No wrapping of other tools.** marrow backs project memory with git; it does not
  orchestrate editor, agent, issue-tracker, or task-runner workflows.
