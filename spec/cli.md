# CLI

Authoritative on command syntax, options, output, and exit codes.

Global behavior: plain text output, one line per project where applicable. `MARROW_HOME`
names the vault parent directory; every command that touches the vault's git history
actually runs `git` against `<MARROW_HOME>/vault.git`, the bare repo (see
`architecture.md` → Env overrides), initialized by [`init`](#init). Every command except
[`init`](#init), [`convention`](#convention), and [`update`](#update) requires that bare
repo to already exist. `marrow` checks before dispatch and prints `no vault at <path> —
run \`marrow init\`` to stderr, exit `1`, rather than letting the command fail with an
uncaught error.
`templates/`, `CONVENTION.md` and `package.json` are resolved relative to the running
tool's own install location, never relative to `MARROW_HOME`.

**Global flags.** `-h`/`--help` prints the usage block to stdout and exits `0`;
`<command> --help` (or `-h`) prints that one command's usage line, its one-line summary,
any documented options (one line each, in command-table order), and the
command's own help paragraph if it has one — all to stdout, exit `0`, and generated from
the same command table that drives dispatch. `-v`/`--version` prints `marrow <version>`,
read from the tool's own `package.json`, and exits `0`. [`grep`](#grep) is the exception: its
arguments are never parsed by marrow, so `-h`/`--help` after `marrow grep` reach `rg`
verbatim.

**Dispatch errors.** No command, an unknown command, a required argument missing, too
many positional arguments, or an unrecognized/malformed option prints usage to stderr
and exits `2`. Option errors print the parser's message first, then the command's usage
line. Usage text is generated from a single command table in `src/cli.ts`; the
per-command syntax below must match that table.

| Command                     | Purpose                                                                                   | Writes                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| [`init`](#init)             | initialize the local vault, empty or from an existing remote                              | vault (create/clone/configure/fetch)        |
| [`publish`](#publish)       | publish the vault to a new private GitHub remote                                          | GitHub, vault remote refs                   |
| [`status`](#status)         | show attached memory that needs attention                                                 | no                                          |
| [`sync`](#sync)             | commit and push project worktrees                                                         | project worktrees, vault                    |
| [`attach`](#attach)         | bring a project's `.agents/` under marrow — adopts if one exists, creates fresh otherwise | project directory, vault                    |
| [`refresh`](#refresh)       | reconcile every attached project's parent-repo footprint against the current templates    | project directories                         |
| [`detach`](#detach)         | end attachment, keeping ordinary files by default or parking them in the vault             | project worktree                            |
| [`doctor`](#doctor)         | verify marrow's setup and safety                                                          | vault remote refs (`fetch --prune` only)    |
| [`grep`](#grep)             | search across all project worktrees                                                       | no                                          |
| [`convention`](#convention) | print `CONVENTION.md`                                                                     | no                                          |
| [`update`](#update)         | update the managed install from its tracked `main` branch                                 | managed install                             |

`status` and `doctor` have separate contracts. `status` answers “What memory needs
attention now?” from local attached-worktree state. Its findings are informational; it
does not fetch or use the network. `doctor` answers “Is marrow configured and operating
safely?” It verifies installation, vault, worktree, remote, and convention mechanics;
it may fetch and classifies findings as `OK`, `WARN`, or `FAIL`. In short: `status`
reports the state of memory; `doctor` verifies the machinery preserving it.

## `init`

```
marrow init [--from <vault-url>] [--dry-run]
```

Without `--from`, ensures `<MARROW_HOME>/vault.git` exists with `git init --bare -b
main`. It creates `<MARROW_HOME>` if needed. It is idempotent: if the vault already
exists, it prints `vault already exists: <path>` and exits `0`. This local path never
configures `origin`, fetches, pushes, or creates a remote.

An existing vault path must be a bare git repository. Live and dry-run invocations refuse
an existing file, ordinary directory, non-bare repository, or unreadable path instead of
reporting it as initialized.

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
origin` (no `--exit-code`: that flag treats a remote with zero refs as unreachable, which
would misreport a freshly created, still-empty remote — exactly what `--from` points at
before the first `marrow publish`), and applies the same private-visibility policy used by
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
problem. When `origin` is configured but the push did not complete, it names `git -C
<MARROW_HOME>/vault.git push origin --all && marrow doctor`. After a completed push, it
names only `marrow doctor`. When the URL was read but origin configuration failed, it
names `git remote add`, the push, and `marrow doctor`. When the URL was not read, it names
`gh repo view`, then manual origin configuration and `marrow doctor`. The command must not
suggest deleting the repository, replacing an origin, force-pushing, or rewriting
history.

**Output.** In live mode, prints `publishing vault to private GitHub repository
<owner>/<repo>...` before the first external mutation. On success, prints the created
repository, configured origin URL, pushed branch count, and private-visibility
verification. With no project branches, the push still includes the `main` landing branch
and the branch count is `1`.

**Exit codes.** `2` (from `marrow` dispatch): missing `<owner>/<repo>` argument or an
unrecognized option. `1`: invalid slug, missing `gh`, missing local vault, existing
origin, landing-branch creation failure, GitHub creation failure, origin configuration
failure, push failure, fetch failure, reachability failure, or non-private visibility.
`0`: remote created, configured, pushed, fetched, reachable, and private.

## `status`

```
marrow status
```

`status` is the local, informational view of attached memory. It never fetches, uses the
network, or treats a finding as a health failure.

It writes `checking project status...` as a transient terminal status while it walks
every attached worktree, then replaces it with a grammatical summary, a blank line, and
an aligned table with `PROJECT`, `KEY`, `STATUS`, and `LAST COMMIT` columns. `PROJECT` is
the parent directory of the `.agents` worktree, abbreviated with `~` under the user's
home directory and shortened from the left when needed. `KEY` is the stable project
identity. `STATUS` combines local changes and sync state. Examples are `clean, synced`,
`1 uncommitted change, synced`, and `clean, 1 commit to push`. It appends memory signals
when present: `stale (parent 2 commits past stamp)`, `stale (parent distance from stamp
unmeasurable)`, `large current-state.md (418 lines)`, or `heavy worktree (5.6M)`.

`LAST COMMIT` prints the branch's current commit date and subject. It is shortened so one
long subject does not dominate the table, but never below a floor that preserves part of
the subject. An exact leading `<KEY>: ` is omitted from the displayed subject only.
"Uncommitted changes" counts files from `git status --porcelain`, not diff hunks.
Ahead/behind compares `HEAD` with the existing local `origin/<branch>` ref, so it may lag
the actual remote until another command fetches. The summary names project count,
missing worktrees, projects with uncommitted changes, sync work, stale projects,
oversized `current-state.md` files, heavy worktrees, and blocked-on-you items. Zero
signal counts are omitted, preserving the prior output when no signals exist.

Staleness compares the first `@<short-sha>` in a `.agents/current-state.md` line beginning
`As of YYYY-MM-DD (@<short-sha> + <parent commit subject>)` with the parent repo's
`HEAD`. Text after that first SHA on the same line is ignored. A descendant `HEAD` reports the number
of commits past the stamp. A stamp that no longer belongs to the parent `HEAD` history
reports an unmeasurable distance. `@no-HEAD` never reports stale. A parent directory
that is not a git repository and a missing or malformed stamp stay neutral in `status`;
[`doctor`](#doctor) owns stamp-conformance warnings.

A `current-state.md` over 300 physical lines reports as large, and a worktree whose
total content exceeds 5MB reports as heavy. Both are informational signals, not failures.
Weight is the recursive size of the worktree directory. `.agents/` is designed for prose
and the research records around it; a worktree that has grown to hold generated data,
fixtures, or tooling is worth knowing about, because every byte is pushed on each `sync`
and searched by each `grep`. The threshold is deliberately far above ordinary prose
growth. `doctor` does not duplicate this: file size is a memory-state fact, and this
document assigns those to `status`. After the table, a `Blocked on you:` section is printed
when any attached worktree has a line beginning exactly `Blocked on you:` in a direct
`plans/*.md` child. Each item prints the project key and that marker's first physical
line. The section is omitted when empty. `status` reads only these convention-guaranteed
markers, the canonical filename, and the stamp format; it does not interpret prose.

The table covers attached worktrees only. When the vault holds project branches with no
worktree here, a blank line and note follow the table — `2 project branches not attached
on this machine (normal — each machine can attach a different subset):` with one branch
per following indented line — so a partially attached machine is not read as a complete
view. With zero project worktrees, prints `No projects attached on this machine. Run
\`marrow attach <project-path>\` to get started.` instead, followed by `The vault has <n>
project branches not attached on this machine (normal — each machine can attach a
different subset):` and one branch per following indented line when any exist. An empty
vault and an unattached one do not print the same result.

A registered worktree whose directory no longer exists on disk (deleted outside marrow
rather than detached through it) still gets a row: `STATUS` prints
`missing` and `LAST COMMIT` prints `-`. After the table and any unattached-branch note,
a blank line separates this remediation when no other post-table section supplied one.
One line names every such project and its remediation. For exactly one, the branch name
is interpolated into a copy-pasteable command: `1 project missing its worktree directory;
run marrow detach <branch> to clear the registration`. For more than one, the line names
branches after a generic command: `2 projects missing their worktree directories; run
marrow detach <project> to clear the registration: <branch>, <branch>`.

**Exit codes.** `0` after dispatch, regardless of findings. The global no-vault guard
exits `1`; malformed options exit `2` before `status` runs.

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
diverged worktree with remote changes is left untouched, and one error line prints exact
manual reconciliation steps. The steps are guidance only; marrow never merges, rebases,
or stashes on its own (`architecture.md` → Non-goals). Dirty and diverged are
independent. The steps cover whichever combination applies: dirty-and-behind (not
diverged) names `git stash`,
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
as well. Concurrent syncs of the same project serialize on git's own lock. A lock failure
is reported as an error and makes the command exit `1`. Retrying it is safe.

A target whose worktree directory has been deleted out from under its registration (a
`missing` worktree, `architecture.md` → Design model) is skipped rather than crashing:
its branch and history are untouched either way. Naming it as an explicit target is an
error (the same as naming an unknown project); appearing only because no targets were
given is a warning. Either way the printed line names the path and
`marrow detach <branch>` as the remediation. It is still included in the final push, since
pushing only touches the branch ref, not the worktree directory.

**Exit codes.** `0`: nothing failed. `1`: an unknown or ambiguous project name was given, an
explicitly named target's worktree directory was missing, the fetch failed, a target needed
manual reconciliation, a target's `git add`/`git commit` failed, or the push failed.

## `attach`

```
marrow attach <project-path> [--id <stable-id>] [--dry-run]
```

`<project-path>` resolves to its parent Git repository's top-level directory, `--id` or
not — a subdirectory of a repo always lands `.agents/` at the repo root, not the
subdirectory. The one exception is a `<project-path>` that isn't inside a git repository
at all (including one that doesn't exist yet): with `--id` given, that path is kept
literally, since this is the fresh-create case (`marrow attach /path/to/new-project --id
local/new-project`) and there's no repo root to resolve to. Without `--id`, that same case
still aborts — deriving an identity requires an existing repo's `origin`. Its default
identity is the normalized repository name from the GitHub `origin`, and its branch is
exactly that identity (`notes`, `docs`, `marrow`). SSH and HTTPS forms produce the same
identity. `--id` supplies a stable identity for a project without a supported origin, or
for a GitHub project that needs a non-default name. The path basename is a display name
only.

Before deciding, `attach` fetches `origin` when the vault has one; a fetch failure aborts.
This also happens under `--dry-run`, so a preview may refresh vault remote-tracking refs.
It then reconciles the local path and matching branch: an ordinary `.agents/` with no
branch is adopted; no `.agents/` with no branch is created fresh; no `.agents/` with a
branch attaches that branch. A matching worktree already at the path succeeds without
changing it — unless its directory is missing (`architecture.md` → Design model): reporting
success there would be a false one, since nothing would exist on disk despite the `0` exit,
so this aborts instead and names `marrow detach <branch>` as the remediation. The same
applies when the branch is already attached at a different path whose directory is missing.
An ordinary `.agents/` plus an existing branch, a different worktree at the path, or the
same branch attached (and present) elsewhere on this machine aborts without mutation.
The existing-branch reattachment mode never regenerates or rewrites the persistence
block itself, and by itself never writes a README, commits, or pushes. The one exception
is downstream of the parent-instruction-block step below: when that step adds or updates
the `.agents` note, it also records the note's version in the README's ledger and commits
that one-line change immediately (see "Parent instruction block" below) — the same as it
would for any other outcome that needed the note fixed.

**Parent-repo `.gitignore` (both paths).** `.agents/` must end up ignored by the project's
own repo: `doctor` checks it on every run, and the persistence block `attach` writes into
`.agents/README.md` states it outright. So whenever `.agents/` is not already ignored,
both paths append `.agents/` to `<project-path>/.gitignore`, creating that file if absent
— and neither ever commits it. `attach` never commits in a repo it doesn't own, so the
parent-repo commit of that change is the user's to make; the line printed says so. The
adopt path makes and verifies its backup before appending this line. The
fresh path appends even when `<project-path>` is not a git repository yet, so that a later
`git init` there cannot pick `.agents/` up; the adopt path instead treats a non-repo parent
as a precondition failure (see the state table below). A parent that already **tracks**
`.agents/` in its index aborts on either path, with the untracking steps printed.

**Parent instruction block (successful and dry-run paths).** After any successful attach
mode, including a no-op result for a project marrow already manages, `attach` checks
`<project>/AGENTS.md` and `<project>/CLAUDE.md`. A note is recognized by its opener
(`> [!NOTE]`, case-insensitive) and a markdown link to `.agents/README.md` anywhere in the
maximal run of consecutive `>`-prefixed lines starting at that opener — there is no
trailing version tag in the note itself; the version it was last written against lives in
`.agents/README.md`'s `marrow-versions` ledger instead (`CONVENTION.md` → Version ledger).
This match is a superset of the old tag-anchored shape, so an already-attached project's
note with a legacy trailing `> <p align="right">v<N></p>` line is still fully recognized
and replaced, tag included. A recognized note whose text matches `templates/agents-block.md`
exactly is left unchanged. Any other recognized note is stale, whether its content differs
by a version's worth of change or only by wording drift: live `attach` replaces just that
note in place with the current template text, leaving the rest of the file untouched, and
prints `Project instructions:`, an indented relative path, and `marrow .agents note updated
(v<old> -> v<new>)` — or `(v<version>, not verbatim)` when the version is unchanged and only
the wording drifted, since `v2 -> v2` would say nothing. `<old>` reads a legacy trailing tag
when the note being replaced still has one, else the ledger's existing `agents-note` entry,
else the literal `unknown` (a project whose note has never been recorded in the ledger).
When neither file has a recognized note at all, live `attach` instead prepends the
current block to `AGENTS.md` when it exists, otherwise to `CLAUDE.md` when it exists,
otherwise to a new `AGENTS.md`, printing `marrow .agents note added`. If either checked
file contains `.agents` references outside a recognized marrow note, it prints one count
row per file, such as `2 existing .agents references found; review for inconsistent
guidance`. References inside recognized current or stale notes are excluded from this
review count. Arbitrary `.agents` prose with no recognized note is never interpreted as
an agents block.
`--dry-run` prints the same target and review note, with `would update`/`would add`
phrasing matching which case applies, without writing.

Whenever this step actually adds or replaces the note (live only, never `--dry-run`),
it also records the current template version under the `agents-note` key in
`.agents/README.md`'s ledger and, if that changed the file's on-disk bytes, commits that
one-line change on the vault branch immediately (`<project>: record marrow .agents note
version`) and pushes when the vault has an `origin` — the same as every other write
`attach` makes to the vault worktree. A same-value rewrite (the ledger already recorded
the version being written again) leaves nothing to commit.

**Claude Code redirect (successful and dry-run paths, after the parent instruction block
step).** Claude Code auto-loads `CLAUDE.md`, never `AGENTS.md` directly, so a project
carrying the marrow note only in `AGENTS.md` silently strands Claude Code agents — the
note, and the `.agents/README.md` pointer inside it, never reaches context regardless of
wording. Whenever `<project>/AGENTS.md` exists (including one this same attach just
created) and `<project>/CLAUDE.md` does not, live `attach` creates `CLAUDE.md` from
`templates/claude-redirect.md` — a two-line stub whose `@AGENTS.md` import syntax Claude
Code actually resolves (a plain markdown link does not) — and prints `Claude Code
compatibility:` followed by `CLAUDE.md                 redirect to AGENTS.md added`. A
`CLAUDE.md` that already exists is never modified, however it does or doesn't redirect:
only a fully missing file is created. `--dry-run` prints `would add redirect to AGENTS.md`
without writing; because it never creates the AGENTS.md this check depends on, `--dry-run`
does not preview the redirect for a project that starts with neither file.

**Parent agent memory config (successful and dry-run paths).** After any successful attach
mode, including a no-op result for a project marrow already manages, `attach` disables
agent-managed memory in parent project config files so `.agents/` remains the
marrow-managed persistent working-memory channel. It writes `<project>/.codex/config.toml` with
`[features] memories = false`, `[memories] use_memories = false`, and
`[memories] generate_memories = false`. It writes `<project>/.claude/settings.json` with
`"autoMemoryEnabled": false`. Existing files are updated in place and unrelated keys are
preserved. The live command prints `Updated project settings:`, one indented line per
changed file using paths relative to `<project-path>`. When no setting needs to change,
it prints `Project settings already up to date.` instead. `--dry-run` prints a matching
`Would update project settings:` block without writing.

For a project that is already managed, live `attach` also creates a missing
`.agents/current-state.md` from `templates/current-state.md`, commits it to that project's
vault branch with `<project>: add current-state`, and pushes when the vault has an
`origin`. Existing `current-state.md` files are never overwritten. `--dry-run` prints the
same existing-attachment summary plus `.agents/current-state.md would be created` without
writing.

When live `attach` changes any parent project file in the instruction or agent memory config
steps, it prints one final `marrow did not commit these project files.` reminder after
those sections.

**Success summary.** Successful attach modes identify the managed project with three fields:
`project` is the absolute parent project path, `location` is the absolute `.agents` path,
and `key` is the stable marrow identity. An existing attachment starts with
`<project> is already managed by marrow`. Attaching an existing branch starts with
`attached <project> to marrow`.

### Adopting an existing `.agents/`

**Preconditions** (checked before any project or project-branch mutation; the initial
origin fetch described above may refresh remote-tracking refs; first failure aborts with
a message on stderr and exit `1`, `--dry-run` included):

1. `<project-path>/.agents` must be a directory (not e.g. a plain file).
2. `<project-path>/.agents/.git` must not exist (i.e. it isn't already a marrow worktree).
3. The deterministic `<identity>` branch must not already exist.
4. `<project-path>` must be a git repository, and `.agents` must not be **tracked** by it (see
   the state table below).

| Parent-repo state of `.agents`       | Precondition result | What happens                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ignored (matched by `.gitignore`)    | pass                | proceeds silently                                                                                                                                                                                                                 |
| untracked, not ignored               | pass                | appends `.agents/` to `<project-path>/.gitignore` (creating the file if absent); prints a reminder that _the parent-repo commit of that `.gitignore` change is the user's to make_ — `attach` never commits in a repo it doesn't own |
| tracked (in the parent repo's index) | **abort**           | prints the exact untracking steps (`git rm -r --cached .agents`, add `.gitignore`, commit) and tells the user to re-run `attach` after — this is a manual, attended step; see `safety.md`                                            |
| not a git repository                 | **abort**           | reports that the parent directory isn't a git repo                                                                                                                                                                                |

**`--dry-run`**: runs preconditions and the `.gitignore`-state check (reporting what it
_would_ append, without writing), prints `would attach <project> to marrow` with `project`,
`location`, and `key` fields, prints the planned adopt mode, then runs the parent config
checks described above and exits `0`. It does not write project files, alter the worktree
registry, or change a project branch. The initial fetch may update vault remote-tracking
refs. It is safe to run against a real project.

**Live run**, once preconditions pass:

1. **Backup.** `tar -czf <MARROW_HOME>/backups/<project>-<UTC-timestamp>-<uuid>.tar.gz -C <project> .agents`, where `<UTC-timestamp>` is a sub-second ISO timestamp (colons and the decimal point replaced with `-`) and `<uuid>` is a random UUID — collision-proof across same-basename projects, explicit `--id` values, and repeated or concurrent adoptions on the same day. The generated path is checked against disk before `tar` runs, and the tarball's size and `tar -tzf` listing are both checked after; any failure aborts before the project is changed.
2. **Ignore.** If needed, append `.agents/` to the parent `.gitignore`. The verified backup exists before this first project write.
3. **Move aside.** `<project>/.agents` → `<project>/.agents.pre-marrow` (rename, same volume — not a copy).
4. **Create the worktree.** `git worktree add --orphan -b <identity> <project>/.agents` runs against `<MARROW_HOME>/vault.git`. On failure, step 3 is undone (`.agents.pre-marrow` renamed back to `.agents`) before erroring out — the project directory is never left without a `.agents/`.
5. **Restore contents.** Every entry under `.agents.pre-marrow/` — including dotfiles — is moved into the new (currently empty) worktree, then `.agents.pre-marrow` is removed.
6. **Working-memory files.** `templates/persistence-block.md` (`{{project}}`/`{{branch}}` substituted, read from the tool's own install location) is appended to `.agents/README.md`; if no `README.md` existed, one is created first from `templates/readme-seed.md`. Either way, the block's current version is recorded under the `persistence-block` key in the README's frontmatter ledger (`CONVENTION.md` → Version ledger) in the same write. If `current-state.md` is absent, marrow creates it from `templates/current-state.md` with the current date, parent `HEAD` short SHA (or `no-HEAD` when the parent has no commit), and a truncated summary of that commit's subject line (blank when there is no commit). An existing `current-state.md` is never overwritten.
7. **Commit and push.** `git add -A`, commit `<project>: adopt into marrow`. If the vault has no `origin` remote, the commit is left local; otherwise `git push -u origin <project>`.

**Verification.** After the push succeeds, or after the commit when there is no origin, a
recursive file-count/size snapshot of the new worktree (excluding `.git`) is compared
against the snapshot taken before step 1. The command prints `attached <project> to marrow`
with `project`, `location`, and `key` fields; an `Adopted existing .agents` block with
the backup path, `files: <before> before, <after> after`, and `size: <before>B before,
<after>B after`; then `vault: pushed origin/<project>` or `vault: not pushed (no origin
configured)`. If the after-count or after-size is _smaller_ than before, the commit (and
push, if any) have already happened, but the command then prints a `WARNING possible
content loss` naming the backup tarball and exits `1` — a human needs to look.
Otherwise it runs the parent config steps described above and exits `0`. Those files are
parent-repo changes, and marrow prints that the user must commit them. The
persistence-block append and required-file creation account for the normal small size
increase; the count only decreases in an actual loss.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project-path>` argument. `1`: any
precondition failure, backup failure, project-file write failure, worktree-creation
failure, commit/push failure, or a post-adoption content-count/size shrink. `0`: adopted
cleanly.

### Creating a fresh `.agents/`

Used automatically when `<project-path>/.agents` and its identity branch do not exist. It
creates the project directory if needed, then runs the same worktree-creation, README, and
`current-state.md` seeding (from templates read from the tool's own install location),
and commit/push steps as the adopt path (steps 4, 6, 7 above), plus
the shared `.gitignore` handling and parent config step described above — which here runs
against a directory that may have just been created and need not be a git repo at all. The
commit message is `<project>: init via marrow attach`. There is no backup step — there is
nothing to back up. As with adopt, a missing `origin` remote on the vault leaves the commit
local and reports `vault: not pushed (no origin configured)` after the attach result.
`--dry-run` reports the `.gitignore` and parent config steps it would take, prints the
same `project`, `location`, and `key` fields with `plan: create new .agents`, then runs
the parent instruction-block check described above and exits `0` without changing the
project, worktree registry, or project branch. Its initial fetch may update vault
remote-tracking refs.
Exit `2` on a missing `<project-path>` argument, `1` on the branch-exists failure above, a
project-file write failure, or a worktree/commit/push failure, and `0` on success.

## `refresh`

```
marrow refresh [project...] [--dry-run]
```

Reconciles every attached project's marrow-managed footprint — the `.agents` note in
`AGENTS.md`/`CLAUDE.md`, the `.agents/README.md` working-memory persistence block, the
`CLAUDE.md` redirect stub, and the `.codex`/`.claude` memory-disable settings — against
whatever the current templates say. The note and redirect/settings concerns are the batch
form of `attach`'s already-attached path (see `attach` → Parent instruction block, Claude
Code redirect, Parent agent memory config above), calling those same functions per project
rather than redefining them; the persistence-block concern mirrors `doctor`'s own
`persistenceBlockStatus` check and reuses `attach`'s `writeReadme` as its mutator. It never
touches `.agents/current-state.md` (creation or staleness — that stays `sync`'s and
`attach`'s remediation) and never fetches, commits, or pushes any vault git state — unlike
`attach`, a `refresh` that updates the note or the persistence block leaves the resulting
`.agents/README.md` ledger edit uncommitted, for a later `marrow sync` to pick up.

**Targets.** Resolved exactly like [`sync`](#sync): the named local project directory
basenames (or exact branch names), or every attached project worktree if none are named.
Every target this command can name is by definition already attached — there is no
create/adopt path to gate. Each target resolves independently to exactly one worktree; a
target matching none prints `unknown project: <target>`, one matching more than one prints
`ambiguous name <target> matches: <path1>, <path2>`, and either way the remaining targets
still proceed. A target whose worktree directory is missing is skipped rather than
crashing: naming it explicitly prints `ERROR` and fails the command, appearing only because
no targets were given prints `WARN` and continues — either way the line names the path and
`marrow detach <branch>` as the remediation, matching `sync`'s equivalent case exactly.

**Per project.** Whether a resolved, present project needs anything is checked first and
silently, using the same read-only checks `doctor` already uses (`agentsBlockStatus`,
`persistenceBlockStatus`, `needsClaudeRedirect`, and the equivalent settings check). A
project that is already fully current is counted and skipped without printing anything for
it. A project needing at least one of the four concerns fixed gets one `<name>:` heading,
then `refresh` runs `ensureAgentMemoryDisabled`, `ensureAgentsBlock`, `ensureClaudeRedirect`,
and (if the persistence block needs it) `writeReadme`, printing whatever each step itself
prints (including a concern that turns out to already be fine, such as `Project settings
already up to date.` when only the note was stale) underneath the heading — a labeled
`.agents/README.md ... would add/update working memory block (v<old> -> v<new>)` line for
the persistence-block concern, mirroring the note's own labeling. `--dry-run` previews every
needing-work project's plan without writing anything. `refresh` writes plain files in the
parent project directory exactly as `attach` does, plus `.agents/README.md` in the vault
worktree for the note-version ledger and the persistence block — never `current-state.md`,
and never a commit. A final `refresh: <n> project(s) updated, <m> unchanged` line closes
the run, where `<n>` counts projects that needed at least one fix (live or previewed) and
`<m>` counts only successfully checked projects that needed none — skipped or
target-resolution-failed projects count toward neither.

**Exit codes.** `0`: every resolved target was checked (whether or not anything needed
fixing). `1`: an unknown or ambiguous project name was given, or an explicitly named
target's worktree directory was missing.

## `detach`

```
marrow detach <project> [--vault-only] [--dry-run]
```

Ends a project's attachment while retaining its vault branch. `<project>` resolves like a
`sync` target: the local project directory basename, or the exact branch name; exactly one
match is required — no match is `unknown project: <project>`, more than one is `ambiguous
name <project> matches: <paths>`. Neither mode deletes a branch or touches a configured
remote.

The registered worktree's state and the file-disposition flag decide what happens:

| Transition | Command and behavior |
| --- | --- |
| Attached → unmanaged, files kept | Bare `detach` removes the marrow persistence block — recognized by its heading and identifying sentence, including an older differently-headed historical form — and the frontmatter version ledger — delimiters included, if nothing else remains in them — from `.agents/README.md`. It commits only that removal from the prior branch tip, releases the worktree registration, removes the `.git` pointer, and leaves `.agents/` on disk as ordinary files. Dirty worktrees are allowed because disk is the record; the uncommitted-change count is reported and unrelated README edits remain only in the retained files. |
| Attached → branch-only | `detach --vault-only` removes the worktree directory and retains its branch. It refuses a dirty worktree because the branch becomes the only copy. This is reversible parking. Re-running `marrow attach <project-path>` later picks up exactly where it left off. |
| Directory already missing (`architecture.md` → Design model) | Either form clears the stale registration only with `git worktree remove --force <path>`. There is no directory to keep or remove, so the flag is ignored. |

The default is a one-way exit rather than parking. It leaves an ordinary `.agents/`
directory while the same branch remains in the vault, so a later `attach` refuses the
local-content-plus-existing-branch conflict and tells the user to inspect both sources.
No mode is provided to merge them automatically.

Default detach does not edit the parent repository. It leaves `.agents/` ignored, leaves
the `.agents` instruction note in `AGENTS.md`/`CLAUDE.md`, and leaves `.codex`/`.claude`
memory settings unchanged. Those files express the working-memory convention rather than
vault backing. The command prints each retained artifact and how to change it. The marrow
persistence block inside `.agents/README.md` is different: its worktree, sync, status, and
doctor claims become false after detachment, so the default removes it before releasing the
worktree — along with the frontmatter version ledger, since a detached project's retained
files should carry no marrow bookkeeping at all. No backup tarball is needed: the default
deletes no content, and `--vault-only` refuses unless the retained branch already holds all
content.

**`--dry-run`.** Prints the full plan for the selected disposition and writes nothing.
The default previews a dirty worktree successfully and says its changes remain in the
retained files. `--vault-only --dry-run` still refuses a dirty worktree; dry runs preview
a plan, not a bypass of that mode's safety boundary.

**Output.** Both modes print the retained branch. The default names the retained file path,
warns when it began dirty, and lists the parent artifacts left unchanged. `--vault-only`
prints any unpushed commit count still held on the branch. For an already-missing worktree,
the output notes that nothing was pushed or deleted.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project>` argument. `1`: unknown or
ambiguous project name, a dirty `--vault-only` refusal, persistence-block commit failure,
or worktree-release failure. `0`: detached cleanly, or the dry-run preview printed.

## `doctor`

```
marrow doctor [--verbose]
```

`doctor` verifies the machinery that preserves memory: the installation, vault,
worktrees, remotes, and mechanical convention requirements. Unlike `status`, it may use
the network and refresh `origin/*` refs. It never writes project files, working memory,
or vault project branches. It checks whether a stamp is well formed, but ordinary
staleness, file size, and blocked-on-you markers belong only to `status`.

It writes `checking vault and project worktree health...` as a transient terminal status,
then runs the fixed checks below in order. `WARN` and `FAIL` lines always print. `OK`
lines print only with `--verbose`/`-v`; a clean default run prints only the summary.
Per-project `WARN` and `FAIL` lines remain explicit. Checks that pass for every attached
project are summarized as one `OK` line rather than one per project. Output ends with
`doctor: OK`, `doctor: OK (<n> warnings)`, or `doctor: FAIL (<n> failures[, <n> warnings])`:

| Check                                                                                                                                                                                                                         | Result on failure                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git --version` is at least 2.42, the release that added `git worktree add --orphan`                                                                                                                                         | FAIL below 2.42 — `attach` and `publish` cannot run at all. WARN if the version string cannot be parsed, so an exotic build is never blocked. Checked first, before any vault finding |
| Every locally registered worktree is named `.agents`                                                                                                                                                                          | FAIL                                                                                                                                                                    |
| Every registered worktree's directory still exists on disk                                                                                                                                                                    | WARN per missing worktree, naming the path and `marrow detach <branch>` as the remediation |
| Project branches in the vault with no worktree on this machine are listed by name                                                                                                                                            | Never fails — reported as an `OK` line. Attaching a subset is a deliberate choice, not drift; it is surfaced only because it bounds what `grep` and `status` can see    |
| Every project worktree's parent repo ignores `.agents` (`git check-ignore -q -- .agents` in the parent dir). A parent directory that is not a git repository at all passes — there is nothing it could commit `.agents/` into | FAIL                                                                                                                                                                    |
| Every project worktree's parent `AGENTS.md`/`CLAUDE.md` carries the current marrow `.agents` note, recognized the same way `attach`'s parent instruction block check recognizes it                                              | WARN per project missing or carrying a stale note, with `marrow refresh <project-dir>` as the remediation. Home-directory paths in the command may print with `~`            |
| Every project worktree's `.agents/README.md` carries the current working-memory persistence block, by the same exact-content comparison `attach` uses                                                                          | WARN per project missing or carrying a stale block, with `marrow refresh <project-dir>` as the remediation |
| Whenever a project worktree's parent `AGENTS.md` exists, its parent `CLAUDE.md` also exists (so Claude Code, which only auto-loads `CLAUDE.md`, actually loads the note) — a parent with no `AGENTS.md` at all passes, since there is nothing to redirect | WARN per project with `AGENTS.md` but no `CLAUDE.md`, with `marrow refresh <project-dir>` as the remediation |
| No `*-plan.md` file sits directly in a project worktree's root. This catches only the legacy `-plan.md` naming: current guidance places plans at `plans/<slug>.md` (`../CONVENTION.md` → Files — the suffix stutters, though existing `-plan.md` files stay valid). `status`'s blocked-on-you scan reads only a direct `plans/*.md` child, so a root-level plan is invisible to it | WARN per project, naming the count and `move them into plans/` as the remediation. Never FAIL — misplaced plans degrade one `status` signal; they do not break marrow or risk data |
| Every project worktree contains the required `current-state.md` resumption record with a well-formed line beginning `As of YYYY-MM-DD (@<short-sha> + <parent commit subject>)` (`@no-HEAD` is also valid)                                          | WARN per project missing `.agents/current-state.md` or carrying a malformed stamp, with `marrow sync <project>` after correction                                        |
| `origin` remote is configured on `<MARROW_HOME>/vault.git`                                                                                                                                                                    | WARN if absent                                                                                                                                                          |
| `origin` is reachable (`git ls-remote origin`; no `--exit-code`, so a reachable remote with zero refs — e.g. before the first `marrow publish` — is not misreported as unreachable) | FAIL if unreachable                                                                                                                                                     |
| `origin` refs can be refreshed (`git fetch --prune origin`)                                                                                                                                                                   | FAIL if fetch fails                                                                                                                                                     |
| `origin` visibility is `PRIVATE`, checked via `gh repo view --json visibility` when `gh` is on `PATH`                                                                                                                         | FAIL if a successful `gh` call reports non-`PRIVATE`; WARN (not FAIL) if `gh` is absent or the call itself fails for any other reason (e.g. not a GitHub-hosted remote) |
| Each project worktree isn't more than 20 commits ahead of `origin/<branch>`, and has an `origin/<branch>` to compare against at all                                                                                           | WARN only; missing refs may be aggregated with `marrow sync` as the remediation                                                                                         |
| No tarball under `<MARROW_HOME>/backups/` is older than 30 days                                                                                                                                                               | WARN only, aggregated to one line naming the count and the directory (never one line per tarball — backups are never auto-deleted, so that would only grow)            |
| `marrow` resolves on `PATH` (`Bun.which("marrow")`)                                                                                                                                                                           | WARN only                                                                                                                                                               |

`doctor` checks the **vault's** origin only — the tool repo's own git hygiene is not
marrow's concern, the same as it is not marrow's job to audit attached projects' parent repos.

A worktree reported missing is excluded from every other per-project check that needs its
directory (`.agents`-ignored, ahead/behind) — there is nothing on disk to check — so those
checks' `OK` summaries count only present worktrees.

The vault's worktree registry is the source of each path; marrow does not require a common
projects root.

**Exit codes.** `1` if any check produces `FAIL`; `0` otherwise. `WARN` never affects the
exit code. Malformed options exit `2` before `doctor` runs.

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

marrow adds **no content-based default exclusions** beyond `-g '!.git'`, which exists to
keep `rg` out of VCS internals rather than to filter project content. A mature `.agents/`
can hold scripts, fixtures, and generated output alongside its prose, and skipping those
by default would make `grep` report a partial search as a complete one — the exact failure
the unattached-branch caveat above exists to prevent, one level down. Scoping is the
caller's, and `rg`'s own globs already do it: `marrow grep "TODO" -g '*.md'` searches prose
only. Because `rg-args` land after marrow's own flags, any glob given this way composes
with the `.git` exclusion rather than replacing it.

When the vault holds project branches that have no worktree on this machine, `grep`
writes one caveat line to **stderr** before running the search, naming the count and the
branches:

```
marrow grep: searched 4 of 7 project branches; 3 branches in the vault not attached on this machine (attach with `marrow attach <project-path>`): docs, notes, scratch
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
every remaining worktree is missing, `grep` prints `No project worktrees.` to stdout after
reporting the missing registrations and exits `0`, the same as the zero-worktree case.

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

Reads and prints `CONVENTION.md` from the tool's own install location, not from
`MARROW_HOME`. Exits `0`. A missing or unreadable install copy surfaces as an unrecovered
I/O error and exits nonzero.

## `update`

```
marrow update
```

Updates the managed install (the checkout `bin/install` creates at
`~/.local/share/marrow`) from its tracked `main` branch. Takes no arguments or options
and does not require a vault.

There is one updater implementation: `update` locates the managed checkout, then spawns
that checkout's own `bin/install` with inherited stdout/stderr and returns its exit code.
It never re-implements the fetch/reset logic in TypeScript.

`toolRoot` (the currently running checkout, physically resolved) is compared against the
expected managed-checkout path `$HOME/.local/share/marrow`, itself physically resolved so
a symlinked `$HOME` is still recognized — the same handling `bin/setup`/`bin/uninstall`
use. Two outcomes:

- **Running from the managed checkout:** spawns `<managed>/bin/install`.
- **Running from a local development checkout, or any other checkout:** refuses, prints
  that this is a local checkout and must be updated with git, and exits `1` without
  touching anything.

`bin/install` itself remains authoritative for the origin check, the dirty-checkout
refusal, the fetch, and re-running `bin/setup` — `update` surfaces whatever it reports.
Missing `HOME`, a managed checkout with no `bin/install`, or the installer's own failure
(wrong origin, dirty checkout, fetch failure, setup failure) all exit nonzero with one
actionable message.

**Exit codes.** `2` (from `marrow` dispatch): an unexpected extra argument. `1`: `HOME`
unset, not the managed checkout, missing installer, or the installer's own nonzero exit.
`0`: the installer ran and reported success — either `already up to date` or `updated
<old-short-sha> -> <new-short-sha>`.

## Typical workflow

```bash
marrow init                            # one-time: create the vault's bare repo
marrow init --from git@github.com:example-owner/marrow-vault.git --dry-run # alternative: preview existing remote setup
marrow publish example-owner/marrow-vault --dry-run # optional after local init: preview private remote creation
marrow status                          # attached memory needing attention
marrow sync                            # commit + push everything dirty
marrow sync notes -m "weekly review"   # one project, a real message
marrow attach /path/to/project --dry-run   # preview before touching a real project
marrow attach /path/to/project             # for real; attended when adopting existing memory
marrow attach /path/to/new-project --id local/new-project # no prior .agents/ — created fresh instead
marrow detach old-project               # keep ordinary files; branch stays in the vault
marrow detach old-project --vault-only  # remove clean local files; branch stays in the vault
marrow doctor                          # verify marrow's setup and safety
marrow grep "TODO" -C2                 # cross-project search, rg flags pass through
marrow convention                      # what should be inside .agents/
marrow update                          # update the managed install (refuses a dev checkout)
```
