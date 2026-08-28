# CLI

Authoritative on command syntax, options, output, and exit codes.

Global behavior: plain text output, one line per project where applicable. `MARROW_HOME`
names the vault parent directory; every command that touches the vault's git history
actually runs `git` against `<MARROW_HOME>/vault.git`, the bare repo (see
`architecture.md` → Env overrides), initialized by [`init`](#init). Every command except
[`init`](#init) and [`convention`](#convention) requires that bare repo to already exist:
`marrow` checks for it before dispatching and prints `no vault at <path> — run \`marrow
init\`` to stderr, exit `1`, rather than letting the command underneath fail with an
uncaught error.
`templates/`, `CONVENTION.md` and `package.json` are resolved relative to the running
tool's own install location, never relative to `MARROW_HOME`.

**Global flags.** `-h`/`--help` prints the usage block to stdout and exits `0`;
`<command> --help` (or `-h`) prints that one command's usage line, its one-line summary,
any documented options (one line each, in the command's own `[flags]` order), and the
command's own help paragraph if it has one — all to stdout, exit `0`, and generated from
the same command table this document is. `-v`/`--version` prints `marrow <version>`, read
from the tool's own `package.json`, and exits `0`. [`grep`](#grep) is the exception: its
arguments are never parsed by marrow, so `-h`/`--help` after `marrow grep` reach `rg`
verbatim.

**Dispatch errors.** No command, an unknown command, a required argument missing, or an
unrecognized/malformed option prints usage to stderr and exits `2`. Option errors print
the parser's message first, then the command's usage line. Usage text is generated from a
single command table in `src/cli.ts` — the per-command syntax in this document and in
`--help` come from the same source.

| Command                     | Purpose                                                                                   | Mutates                              |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| [`init`](#init)             | initialize the local vault, empty or from an existing remote                              | vault (create/clone/configure/fetch) |
| [`publish`](#publish)       | publish the vault to a new private GitHub remote                                          | GitHub, vault remote refs            |
| [`status`](#status)         | per-project worktree health                                                               | no                                   |
| [`sync`](#sync)             | commit + push project worktrees                                                           | project worktrees, vault             |
| [`add`](#add)               | bring a project's `.agents/` under marrow — adopts if one exists, creates fresh otherwise | project dir, vault                   |
| [`detach`](#detach)         | remove a project's worktree, keeping its branch in the vault                              | project dir (worktree only)          |
| [`doctor`](#doctor)         | vault + worktree health checks                                                            | no                                   |
| [`grep`](#grep)             | search across all project worktrees                                                       | no                                   |
| [`convention`](#convention) | print `CONVENTION.md`                                                                     | no                                   |

## `init`

```
marrow init [--from <vault-url>] [--dry-run]
```

Without `--from`, ensures `<MARROW_HOME>/vault.git` exists with `git init --bare -b
main`. It creates `<MARROW_HOME>` if needed. It is idempotent: if the vault already
exists, it prints `vault already exists: <path>` and exits `0`. This local path never
configures `origin`, fetches, pushes, or creates a remote.

With `--from`, initializes this machine from an already-created private vault remote.
`<vault-url>` is a generic Git URL. There are only two accepted local states:

| Local state                                                                                            | Behavior                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `<MARROW_HOME>/vault.git` does not exist                                                               | Bare-clone `<vault-url>` into that path, fetch remote refs, and verify reachability/private visibility |
| `<MARROW_HOME>/vault.git` exists, has no local branches, has no project worktrees, and has no `origin` | Configure `origin`, fetch remote refs, and verify reachability/private visibility                      |

Every other local state is refused before mutation: an existing `origin`, any local
branch, any project worktree, or a non-bare/non-git file at the vault path. `init --from`
never merges histories, reconciles two populated vaults, replaces an origin, pushes, or
creates a remote.

**`--dry-run`.** Without `--from`, prints whether the local empty-vault init would run.
With `--from`, checks the vault path state and prints whether it would clone or hydrate
the local vault. It may run read-only Git checks against `<vault-url>`, but it does not
create directories, configure remotes, fetch into the local vault, or push.

**Live `--from` run.** After clone or hydrate, fetches `origin`, verifies `git ls-remote
--exit-code origin`, and applies the same private-visibility policy used by
[`doctor`](#doctor): a successful `gh` visibility result must be `PRIVATE`; missing `gh`
or an unsupported non-GitHub URL is a warning, not a failure. A successful `gh` result of
`PUBLIC` or `INTERNAL` is a failure.

**Output.** Without `--from`, prints `initialized vault: <path>` or `vault already
exists: <path>`. With `--from`, prints whether it cloned or hydrated the vault, the
configured origin URL, fetched branch count, and private-visibility result or warning.

**Exit codes.** `2` (from `marrow` dispatch): an unrecognized option or a missing value
for `--from`. `1`: `<MARROW_HOME>` could not be created; `git init`, clone, origin
configuration, fetch, or reachability failed; the local state was refused; or a
successful visibility check reported a non-private remote. `0`: local vault exists or
was created, or the remote vault was cloned/hydrated, fetched, reachable, and not known
public.

## `publish`

```
marrow publish <owner>/<repo> [--dry-run]
```

Publishes the local vault to a new private GitHub repository, configures it as `origin`
on `<MARROW_HOME>/vault.git`, pushes every local vault branch, fetches remote refs, then
verifies reachability and private visibility. Before the remote is created, `publish`
ensures the vault has a minimal `main` branch containing only a README for GitHub's
default branch. This command is GitHub-specific because it uses `gh`.

Calling `publish` live is the explicit authorization to create the GitHub repository
named by `<owner>/<repo>`. The slug must contain exactly one slash, non-empty owner and
repo segments, and only GitHub repository slug characters (`A-Z`, `a-z`, `0-9`, `.`,
`_`, and `-`). `publish` requires `gh` on `PATH`, an initialized local vault, and no
configured `origin`. It refuses to replace an existing origin. It never force-pushes and
never deletes a GitHub repository, including after partial failure.

**`--dry-run`.** Checks the local vault path, existing-origin precondition, slug syntax,
and local branch list. It prints the intended repository, the origin URL that would be
configured, and the branches that would be pushed, including the `main` landing branch if
it would need to be created. It does not invoke `gh` and does not run any Git mutation.

**Live run.** The steps are:

1. Ensure local branch `main` exists with the standard vault README if it was absent.
2. Create the GitHub repository as private.
3. Read the repository's canonical Git URL.
4. Add that URL as `origin` on the local vault.
5. Push all local vault branches with ordinary `git push origin --all`.
6. Fetch remote refs.
7. Verify `origin` is reachable.
8. Verify GitHub reports the repository visibility as `PRIVATE`.

If GitHub creation succeeds but a later step fails, the command exits `1` with a partial
failure report naming the created repository, whether `origin` was configured, whether
any push completed, and the exact safe next command to run after fixing the reported
problem. The safe next command is either `marrow doctor` when the local origin is already
configured or `git -C <MARROW_HOME>/vault.git remote add origin <url>` followed by
`marrow doctor` when only the GitHub repository exists. The command must not suggest
deleting the repository, replacing an origin, force-pushing, or rewriting history.

**Output.** In live mode, prints `publishing vault to private GitHub repository
<owner>/<repo>...` before the first external mutation. On success, prints the created
repository, configured origin URL, pushed branch count, and private-visibility
verification. With no project branches, the push still includes the `main` landing branch
and the branch count is `1`.

**Exit codes.** `2` (from `marrow` dispatch): missing `<owner>/<repo>` argument or an
unrecognized option. `1`: invalid slug, missing `gh`, missing local vault, existing
origin, landing-branch creation failure, GitHub creation failure, origin configuration
failure, push failure, fetch failure, reachability failure, or non-private visibility. `0`: remote created,
configured, pushed, fetched, reachable, and private.

## `status`

```
marrow status
```

Prints a grammatical summary first, a blank line, then an aligned table with `PROJECT`,
`KEY`, `STATUS`, and `LAST COMMIT` columns. `PROJECT` is the parent directory of the
`.agents` worktree, abbreviated with `~` when it is under the user's home directory, and
shortened from the left when needed. `KEY` shows the stable project identity. `STATUS`
combines the local change state and sync
state, e.g. `clean, synced`, `1 uncommitted change, synced`, or `clean, 1 commit to push`.
`LAST COMMIT` prints the date and subject of the branch's current commit and is shortened
when needed so one long subject does not dominate the table. When the subject starts with
the exact `KEY` plus `: `, that redundant prefix is omitted from the display only.
"Uncommitted changes" counts lines from
`git status --porcelain` (i.e. files changed, not diff hunks). Ahead/behind compares
`HEAD` against the local `origin/<branch>` ref — it does not fetch first, so it can be
stale relative to a remote no one has pulled recently. The summary names the project
count, missing worktrees, uncommitted projects, and sync work remaining.

The table covers attached worktrees only. When the vault holds project branches with no
worktree here, a blank line and note follow the table — `2 project branches not attached
here:` with one branch per following indented line — so a partially attached machine is
not read as a complete view. With zero project worktrees, prints `No projects attached on this machine.
Run \`marrow add <project-path>\` to get started.` instead, followed by `The vault has
<n> project branches not attached here:` and one branch per following indented line when
any exist — an empty vault and an unattached one are different situations and must not
print the same thing. Always exits `0`.

A registered worktree whose directory no longer exists on disk (deleted out from under the
registration, rather than detached through marrow) still gets a row: `STATUS` prints
`missing` and `LAST COMMIT` prints `-`. After the table and any unattached-branch note,
a blank line separates this remediation from the table when there was no earlier
post-table note. One further line names every such project and its remediation:
`1 project missing its worktree directory; run \`marrow detach
<project>\` to clear the registration: <branch>`.

## `sync`

```
marrow sync [project...] [-m <message>]
```

Targets: the named local project directory basenames (or exact branch names), or every
attached project worktree if none are named. Each target resolves independently to exactly
one worktree; a target matching none prints `unknown project: <target>`, one matching more
than one prints `ambiguous name <target> matches: <path1>, <path2>`, and either way the
remaining targets still proceed. Two targets that resolve to the same worktree sync it
once, not twice.

`sync` fetches first. A clean worktree behind its upstream fast-forwards. A dirty or
diverged worktree with remote changes is left untouched, and one error line prints the
exact reconciliation steps (`project.ts`'s `trackedMessage` style — printed guidance,
never run by marrow, which still never merges, rebases, or stashes on its own,
`architecture.md` → Non-goals). Dirty and diverged are independent and the steps cover
whichever combination applies: dirty-and-behind (not diverged) names `git stash`,
`git merge --ff-only origin/<branch>`, `git stash pop`; diverged (local and remote both
hold commits the other lacks) names `git pull --no-rebase origin <branch>`, which resolves
the divergence with an ordinary merge commit on the project's own branch; dirty *and*
diverged at once names both, in order — stash, pull, pop — so the uncommitted changes
survive the reconciliation rather than being silently at risk under a bare pull. For each
remaining dirty target,
`git add -A` then `git commit -m "<message>"`. Commit message is `<project>: <text>`, where
`<text>` is the `-m` value if given, else `sync <ISO-8601 local timestamp, second
precision>`. A clean project is skipped — its last commit is untouched. Bare `marrow sync
-m "<message>"` (no targets, more than one project dirty) prints one notice line first,
since the same message is about to land on every dirty project's commit.

After every target has been processed (regardless of per-project failures), `sync` pushes
every project branch attached on this machine — `git push origin <branch>...` over the
full local worktree list, not just the named targets — run once from
`<MARROW_HOME>/vault.git`. This is scoped deliberately: `init --from`'s bare clone mirrors
every branch as a local head, including branches this machine has never attached, and
pushing `--all` would push those stale local heads too, failing non-fast-forward the
moment another machine has advanced one of them. If `origin` isn't configured, the push is
skipped with a warning (not a failure); with no project worktrees attached, it is skipped
as well. Concurrent syncs of the same project serialize on git's own lock; a lock failure
should be treated as retryable, not a hard error.

A target whose worktree directory has been deleted out from under its registration (a
`missing` worktree, `../architecture.md` → Design model) is skipped rather than crashing:
its branch and history are untouched either way. Naming it as an explicit target is an
error (the same as naming an unknown project); appearing only because no targets were
given is a warning. Either way the printed line names the path and
`marrow detach <branch>` as the remediation. It is still included in the final push, since
pushing only touches the branch ref, not the worktree directory.

**Exit codes.** `0`: nothing failed. `1`: an unknown or ambiguous project name was given, an
explicitly named target's worktree directory was missing, the fetch failed, a target needed
manual reconciliation, a target's `git add`/`git commit` failed, or the push failed.

## `add`

```
marrow add <project-path> [--id <stable-id>] [--dry-run]
```

`<project-path>` resolves to its parent Git repository's top-level directory, `--id` or
not — a subdirectory of a repo always lands `.agents/` at the repo root, not the
subdirectory. The one exception is a `<project-path>` that isn't inside a git repository
at all (including one that doesn't exist yet): with `--id` given, that path is kept
literally, since this is the fresh-create case (`marrow add /path/to/new-project --id
local/new-project`) and there's no repo root to resolve to. Without `--id`, that same case
still aborts — deriving an identity requires an existing repo's `origin`. Its default
identity is the normalized repository name from the GitHub `origin`, and its branch is
exactly that identity (`notes`, `docs`, `marrow`). SSH and HTTPS forms produce the same
identity. `--id` supplies a stable identity for a project without a supported origin, or
for a GitHub project that needs a non-default name. The path basename is a display name
only.

Before deciding, `add` fetches `origin` when the vault has one; a fetch failure aborts.
It then reconciles the local path and matching branch: an ordinary `.agents/` with no
branch is adopted; no `.agents/` with no branch is created fresh; no `.agents/` with a
branch attaches that branch. A matching worktree already at the path succeeds without
changing it — unless its directory is missing (`architecture.md` → Design model): reporting
success there would be a false one, since nothing would exist on disk despite the `0` exit,
so this aborts instead and names `marrow detach <branch>` as the remediation. The same
applies when the branch is already attached at a different path whose directory is missing.
An ordinary `.agents/` plus an existing branch, a different worktree at the path, or the
same branch attached (and present) elsewhere on this machine aborts without mutation.
Attach never writes a README, commits, or pushes.

**Parent-repo `.gitignore` (both paths).** `.agents/` must end up ignored by the project's
own repo: `doctor` checks it on every run, and the persistence block `add` writes into
`.agents/README.md` states it outright. So whenever `.agents/` is not already ignored,
both paths append `.agents/` to `<project-path>/.gitignore`, creating that file if absent
— and neither ever commits it. `add` never commits in a repo it doesn't own, so the
parent-repo commit of that change is the user's to make; the line printed says so. The
fresh path appends even when `<project-path>` is not a git repository yet, so that a later
`git init` there cannot pick `.agents/` up; the adopt path instead treats a non-repo parent
as a precondition failure (see the state table below). A parent that already **tracks**
`.agents/` in its index aborts on either path, with the untracking steps printed.

**Parent instruction block (successful and dry-run paths).** After any successful add
mode, including a no-op result for a project marrow already manages, `add` checks
`<project>/AGENTS.md` and `<project>/CLAUDE.md`. The canonical block ends with a
right-aligned version tag, a note block that starts with `> [!Note]` followed by
`Agent memory` text and ends with a line like `> <p align="right">v1</p>`
(case-insensitive `v`, one or more dot-separated numeric groups, so older dotted versions
like `V2.3.2` are recognized too) — any note matching that shape is recognized regardless
of the wording around it. A recognized note whose version matches the current
`templates/agents-block.md` version is left unchanged. A recognized note carrying any
other version is stale: live `add` replaces just that note in place with the current
template text, leaving the rest of the file untouched, and prints `Project
instructions:`, an indented relative path, and `marrow .agents note updated (v<old> ->
v<new>)`. When neither file has a recognized note at all, live `add` instead prepends the
current block to `AGENTS.md` when it exists, otherwise to `CLAUDE.md` when it exists,
otherwise to a new `AGENTS.md`, printing `marrow .agents note added`. If either checked
file already contains `.agents` references, it prints one count row per file, such as
`2 existing .agents references found; review for inconsistent guidance`. Arbitrary
`.agents` prose with no recognized note is never interpreted as an agents block.
`--dry-run` prints the same target and review note, with `would update`/`would add`
phrasing matching which case applies, without writing.

**Parent agent memory config (successful and dry-run paths).** After any successful add
mode, including a no-op result for a project marrow already manages, `add` disables
agent-managed memory in parent project config files so `.agents/` remains the durable
working-memory channel. It writes `<project>/.codex/config.toml` with
`[features] memories = false`, `[memories] use_memories = false`, and
`[memories] generate_memories = false`. It writes `<project>/.claude/settings.json` with
`"autoMemoryEnabled": false`. Existing files are updated in place and unrelated keys are
preserved. The live command prints `Updated project settings:`, one indented line per
changed file using paths relative to `<project-path>`. When no setting needs to change,
it prints `Project settings already up to date.` instead. `--dry-run` prints a matching
`Would update project settings:` block without writing.

When live `add` changes any parent project file in the instruction or agent memory config
steps, it prints one final `marrow did not commit these project files.` reminder after
those sections.

**Success summary.** Successful add modes identify the managed project with three fields:
`project` is the absolute parent project path, `location` is the absolute `.agents` path,
and `key` is the stable marrow identity. A no-op existing attachment starts with
`<project> is already managed by marrow`. Attaching an existing branch starts with
`attached <project> to marrow`.

### Adopting an existing `.agents/`

**Preconditions** (checked before anything is written; first failure aborts with a message
on stderr and exit `1`, `--dry-run` included):

1. `<project-path>/.agents` must be a directory (not e.g. a plain file).
2. `<project-path>/.agents/.git` must not exist (i.e. it isn't already a marrow worktree).
3. The deterministic `<identity>` branch must not already exist.
4. `<project-path>` must be a git repository, and `.agents` must not be **tracked** by it (see
   the state table below).

| Parent-repo state of `.agents`       | Precondition result | What happens                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ignored (matched by `.gitignore`)    | pass                | proceeds silently                                                                                                                                                                                                                 |
| untracked, not ignored               | pass                | appends `.agents/` to `<project-path>/.gitignore` (creating the file if absent); prints a reminder that _the parent-repo commit of that `.gitignore` change is the user's to make_ — `add` never commits in a repo it doesn't own |
| tracked (in the parent repo's index) | **abort**           | prints the exact untracking steps (`git rm -r --cached .agents`, add `.gitignore`, commit) and tells the user to re-run `add` after — this is a manual, attended step; see `safety.md`                                            |
| not a git repository                 | **abort**           | reports that the parent directory isn't a git repo                                                                                                                                                                                |

**`--dry-run`**: runs preconditions and the `.gitignore`-state check (reporting what it
_would_ append, without writing), prints `would add <project> to marrow` with `project`,
`location`, and `key` fields, prints the planned adopt mode, then runs the parent config
checks described above and exits `0`. Nothing is written to disk in either the project
directory or the vault — safe to run against a real project.

**Live run**, once preconditions pass:

1. **Backup.** `tar -czf <MARROW_HOME>/backups/<project>-<ISO-date>.tar.gz -C <project> .agents`. The tarball's size and `tar -tzf` listing are both checked; any failure aborts before anything is moved.
2. **Move aside.** `<project>/.agents` → `<project>/.agents.pre-marrow` (rename, same volume — not a copy).
3. **Create the worktree.** `git worktree add --orphan -b <identity> <project>/.agents` runs against `<MARROW_HOME>/vault.git`. On failure, step 2 is undone (`.agents.pre-marrow` renamed back to `.agents`) before erroring out — the project directory is never left without a `.agents/`.
4. **Restore contents.** Every entry under `.agents.pre-marrow/` — including dotfiles — is moved into the new (currently empty) worktree, then `.agents.pre-marrow` is removed.
5. **README.** `templates/persistence-block.md` (`{{project}}` substituted, read from the tool's own install location) is appended to `.agents/README.md`; if no `README.md` existed, one is created first from `templates/readme-seed.md`.
6. **Commit and push.** `git add -A`, commit `<project>: adopt into marrow`. If the vault has no `origin` remote, the commit is left local; otherwise `git push -u origin <project>`.
7. **Parent config.** Update the parent project's Codex and Claude Code memory config
   files, then the parent instruction block described above. These files are parent-repo
   changes; marrow prints that the user must commit them.

**Verification.** After the push (or the no-origin notice) succeeds, a recursive
file-count/size snapshot of the new worktree (excluding `.git`) is compared against the
snapshot taken before step 1. If the after-count or after-size is _smaller_ than before,
the commit (and push, if any) have already happened, but the command prints a `WARNING
possible content loss` naming the backup tarball and exits `1` — a human needs to look.
Otherwise it prints `added <project> to marrow` with `project`, `location`, and `key`
fields; an `Adopted existing .agents` block with the backup path, `files: <before>
before, <after> after`, and `size: <before>B before, <after>B after`; then `vault: pushed
origin/<project>` or `vault: not pushed (no origin configured)`,
and exits `0`. The persistence-block append and README creation account for the normal
small size increase; the count only decreases in an actual loss.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project-path>` argument. `1`: any
precondition failure, backup failure, worktree-creation failure, commit/push failure, or a
post-adoption content-count/size shrink. `0`: adopted cleanly.

### Creating a fresh `.agents/`

Used automatically when `<project-path>/.agents` does **not** exist and its identity branch
does not exist. Otherwise: creates the
project directory if needed, runs the same worktree-creation, README-seeding (from
`templates/readme-seed.md`, read from the tool's own install location — there is no prior
README to append to), and commit/push steps as the adopt path (steps 3, 5, 6 above), plus
the shared `.gitignore` handling and parent config step described above — which here runs
against a directory that may have just been created and need not be a git repo at all. The
commit message is `<project>: init via marrow add`. There is no backup step — there is
nothing to back up. As with adopt, a missing `origin` remote on the vault leaves the commit
local and reports `vault: not pushed (no origin configured)` after the add result.
`--dry-run` reports the `.gitignore` and parent config steps it would take, prints the
same `project`, `location`, and `key` fields with `plan: create new .agents`, then runs
the parent instruction-block check described above and exits `0` without touching disk.
Exit `2` on a missing
`<project-path>` argument, `1` on the branch-exists failure above or a
worktree/commit/push failure, `0` on success.

## `detach`

```
marrow detach <project> [--dry-run]
```

Removes a project's worktree from this machine while leaving its branch, and everything on
it, untouched in the vault. `<project>` resolves like a `sync` target: the local project
directory basename, or the exact branch name; exactly one match is required — no match is
`unknown project: <project>`, more than one is `ambiguous name <project> matches: <paths>`.
`detach` never touches the branch or a configured remote — it is not a deletion, and
re-attaching the same branch later (`marrow add <project-path>` at any checkout path) picks
up exactly where it left off.

The registered worktree's state decides what happens:

| Worktree state                          | Behavior                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Directory already missing (`architecture.md` → Design model) | Clears the registration only (`git worktree remove --force <path>`); there is nothing on disk to remove |
| Clean (no uncommitted changes)           | `git worktree remove <path>`                                                                                       |
| Dirty (uncommitted changes present)      | Refuses; prints the uncommitted-change count and both remediation paths: `marrow sync <project>` first, or discard with `git -C <path> checkout -- . && git -C <path> clean -fd` |

**`--dry-run`.** Runs the same resolution and dirty check, prints what it would do, and
exits `0` without touching disk. A dirty worktree still refuses under `--dry-run`, the same
as live — dry runs preview a plan, not a bypass of the refusal.

**Output.** On success, prints the retained branch name and, for a clean non-missing
worktree, any unpushed commit count still held on that branch (nothing was lost — those
commits just aren't reachable from a local worktree anymore). For an already-missing
worktree, notes that nothing was pushed or deleted, since the directory was already gone.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project>` argument. `1`: unknown or
ambiguous project name, a dirty-worktree refusal, or a `git worktree remove` failure. `0`:
detached cleanly, or the dry-run preview printed successfully.

## `doctor`

```
marrow doctor
```

Writes `checking vault and project worktree health...` as a transient terminal status,
then replaces it with the fixed set of checks, printed in this order. Checks that pass
for every attached project may be summarized as one `OK` line. Per-project `FAIL` and
`WARN` lines stay explicit. Output ends with `doctor: OK`, `doctor: OK (<n> warnings)`, or
`doctor: FAIL (<n> failures[, <n> warnings])`:

| Check                                                                                                                                                                                                                         | Result on failure                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git --version` is at least 2.42, the release that added `git worktree add --orphan`                                                                                                                                         | FAIL below 2.42 — `add` and `publish` cannot run at all. WARN if the version string cannot be parsed, so an exotic build is never blocked. Checked first, before any vault finding |
| Every locally registered worktree is named `.agents`                                                                                                                                                                          | FAIL                                                                                                                                                                    |
| Every registered worktree's directory still exists on disk                                                                                                                                                                    | WARN per missing worktree, naming the path and `marrow detach <branch>` as the remediation |
| Project branches in the vault with no worktree on this machine are listed by name                                                                                                                                            | Never fails — reported as an `OK` line. Attaching a subset is a deliberate choice, not drift; it is surfaced only because it bounds what `grep` and `status` can see    |
| Every project worktree's parent repo ignores `.agents` (`git check-ignore -q -- .agents` in the parent dir). A parent directory that is not a git repository at all passes — there is nothing it could commit `.agents/` into | FAIL                                                                                                                                                                    |
| `origin` remote is configured on `<MARROW_HOME>/vault.git`                                                                                                                                                                    | WARN if absent                                                                                                                                                          |
| `origin` is reachable (`git ls-remote --exit-code origin`)                                                                                                                                                                    | FAIL if unreachable                                                                                                                                                     |
| `origin` refs can be refreshed (`git fetch --prune origin`)                                                                                                                                                                   | FAIL if fetch fails                                                                                                                                                     |
| `origin` visibility is `PRIVATE`, checked via `gh repo view --json visibility` when `gh` is on `PATH`                                                                                                                         | FAIL if a successful `gh` call reports non-`PRIVATE`; WARN (not FAIL) if `gh` is absent or the call itself fails for any other reason (e.g. not a GitHub-hosted remote) |
| Each project worktree isn't more than 20 commits ahead of `origin/<branch>`, and has an `origin/<branch>` to compare against at all                                                                                           | WARN only; missing refs may be aggregated with `marrow sync` as the remediation                                                                                         |
| No tarball under `<MARROW_HOME>/backups/` is older than 30 days                                                                                                                                                               | WARN only, aggregated to one line naming the count and the directory (never one line per tarball — backups are never auto-deleted, so that would only grow)            |
| `marrow` resolves on `PATH` (`Bun.which("marrow")`)                                                                                                                                                                           | WARN only                                                                                                                                                               |

`doctor` checks the **vault's** origin only — the tool repo's own git hygiene is not
marrow's concern, the same as it is not marrow's job to audit adopted parent repos.

A worktree reported missing is excluded from every other per-project check that needs its
directory (`.agents`-ignored, ahead/behind) — there is nothing on disk to check — so those
checks' `OK` summaries count only present worktrees.

The vault's worktree registry is the source of each path; marrow does not require a common
projects root. Exit `1` if any check produced a `FAIL` line, `0` otherwise — `WARN` never
affects the exit code.

## `grep`

```
marrow grep <pattern> [rg-args...]
```

Runs across every project worktree path (not the tool repo's own files, not anything
under `MARROW_HOME` directly), via
`rg --hidden --no-ignore -g '!.git' <pattern> [rg-args...] <worktree paths...>`. `rg` is a
hard requirement: without it on `PATH`, `marrow grep` prints `rg is required for marrow
grep` and exits `1` rather than falling back to a different search — a prior BSD `grep`
fallback changed match semantics silently and was removed. The `-g '!.git'` exclusion is
deliberate and load-bearing: `rg --hidden --no-ignore` on its own still descends into
`.git` directories (verified empirically — `--no-ignore` only disables `.gitignore`-based
filtering, it does not by itself keep `rg` out of VCS internals the way plain `--hidden`
alone would). `rg-args` are passed through verbatim after the pattern, before the worktree
paths, so ordinary `rg` flags (`-i`, `-C3`, …) work as expected. marrow does not parse them
at all — that includes `-h`/`--help`, which `rg` receives rather than marrow (see "Global
flags" above).

When the vault holds project branches that have no worktree on this machine, `grep`
writes one caveat line to **stderr** before running the search, naming the count and the
branches:

```
marrow grep: searched 4 of 7 project branches; 3 branches in the vault not attached on this machine (attach with `marrow add <project-path>`): docs, notes, scratch
```

This is stderr, never stdout, so it does not contaminate the match stream callers pipe,
and it does not affect the exit code. It exists because a partial search that reports as
a complete one is a false negative — the searcher concludes the note isn't there. The
same line appears (worded `no project branches are attached here`) in the zero-worktree
case, where the bare `No project worktrees.` would otherwise read as "the vault is
empty".

A registered worktree whose directory is missing (`architecture.md` → Design model) is
excluded from the search rather than passed to `rg`/`grep` as a nonexistent path. One
stderr line names the skipped branches and `marrow detach <project>` as the remediation,
same channel and same non-contamination rule as the unattached-branches caveat above. If
every remaining worktree is missing, `grep` prints `No project worktrees.` to stdout (after
the stderr notice) and exits `0`, the same as the zero-worktree case.

Output streams directly to the terminal (not buffered/parsed by marrow). With zero
project worktrees, prints `No project worktrees.` to stdout and exits `0` without
invoking `rg` at all (this also means `rg`'s absence is never reported in that case).
Otherwise, once `rg` is confirmed on `PATH`, the exit code is whatever the `rg` process
returns — conventionally `0` (match found), `1` (no match), `2` (usage/other error). `1`
also results if `rg` isn't on `PATH`; `2` also results from `marrow`'s own dispatch if
`<pattern>` is omitted entirely.

## `convention`

```
marrow convention
```

Reads and prints `CONVENTION.md` verbatim from the tool's own install location (not from
`MARROW_HOME` — see the top-of-file caveat). Exits `0`, or crashes with an uncaught error
if the file is missing.

## Typical workflow

```bash
marrow init                            # one-time: create the vault's bare repo
marrow init --from git@github.com:example-owner/marrow-vault.git --dry-run # preview existing remote setup
marrow publish example-owner/marrow-vault --dry-run # preview private remote creation
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow sync notes -m "weekly review"   # one project, a real message
marrow add /path/to/project --dry-run   # preview before touching a real project
marrow add /path/to/project             # for real; attended when adopting existing memory
marrow add /path/to/new-project --id local/new-project # no prior .agents/ — created fresh instead
marrow detach old-project               # stop tracking it here; branch stays in the vault
marrow doctor                          # health check after any of the above
marrow grep "TODO" -C2                 # cross-project search, rg flags pass through
marrow convention                      # what should be inside .agents/
```
