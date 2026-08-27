# CLI

Authoritative on command syntax, options, output, and exit codes.

Global behavior: plain text output, one line per project where applicable. `MARROW_HOME`
names the vault parent directory; every command that touches the vault's git history
actually runs `git` against `<MARROW_HOME>/vault.git`, the bare repo (see
`architecture.md` → Env overrides), created by [`init`](#init). Every command other than
`init` assumes that bare repo already exists; if it doesn't, a command fails with an
uncaught error (stack trace, non-zero exit) rather than a clean message — this is a known
gap, not a designed error path. `templates/`, `CONVENTION.md` and `package.json` are
resolved relative to the running tool's own install location, never relative to
`MARROW_HOME`.

**Global flags.** `-h`/`--help` prints the usage block to stdout and exits `0`;
`<command> --help` (or `-h`) prints that one command's usage line and summary, also to
stdout, exit `0`. `-v`/`--version` prints `marrow <version>`, read from the tool's own
`package.json`, and exits `0`. [`grep`](#grep) is the exception: its arguments are never
parsed by marrow, so `-h`/`--help` after `marrow grep` reach `rg` verbatim.

**Dispatch errors.** No command, an unknown command, a required argument missing, or an
unrecognized/malformed option prints usage to stderr and exits `2`. Option errors print
the parser's message first, then the command's usage line. Usage text is generated from a
single command table in `src/cli.ts` — the per-command syntax in this document and in
`--help` come from the same source.

| Command | Purpose | Mutates |
|---|---|---|
| [`init`](#init) | create or hydrate the vault's bare repo | vault (creates/configures) |
| [`status`](#status) | per-project worktree health | no |
| [`sync`](#sync) | commit + push project worktrees | project worktrees, vault |
| [`add`](#add) | bring a project's `.agents/` under marrow — adopts if one exists, creates fresh otherwise | project dir, vault |
| [`doctor`](#doctor) | vault + worktree health checks | no |
| [`grep`](#grep) | search across all project worktrees | no |
| [`convention`](#convention) | print `CONVENTION.md` | no |

## `init`

```
marrow init [--from <vault-url>]
```

Without `--from`, ensures `<MARROW_HOME>/vault.git` exists with `git init --bare -b main`.
With `--from`, creates a bare clone of the supplied vault, or hydrates an empty local vault
by configuring `origin` and fetching its branches. It refuses to replace a non-empty vault
or a different configured origin. `--from` never creates a remote; the caller supplies an
already-created private vault. When `gh` can determine the origin visibility, `init`
refuses a non-private source. Exit `0` on success, `1` on clone, fetch, or safety failure.

## `status`

```
marrow status
```

Prints an aligned table with `PROJECT`, `KEY`, `CHANGES`, `SYNC`, and `LAST COMMIT`
columns. `PROJECT` is the parent directory of the `.agents` worktree, abbreviated with
`~` when it is under the user's home directory. `KEY` shows the stable project identity;
its internal `projects/` branch namespace is omitted.
`CHANGES` is `clean` or a count of uncommitted changes. `SYNC` is `synced`, `not pushed`,
or a count of commits to push and/or pull. "Uncommitted changes" counts lines from
`git status --porcelain` (i.e. files changed, not diff hunks). Ahead/behind compares
`HEAD` against the local `origin/<branch>` ref — it does not fetch first, so it can be
stale relative to a remote no one has pulled recently. Ends with a grammatical summary of
the project count, uncommitted projects, and sync work remaining. With zero project
worktrees, prints `No projects attached on this machine. Run \`marrow add <project-path>\` to get started.`
instead. Always exits `0`.

## `sync`

```
marrow sync [project...] [-m <message>] [--auto]
```

Targets: the named local project directory basenames (or exact branch names), or every
attached project worktree if none are named. An ambiguous or unknown name is reported and
does not stop remaining targets.

`sync` fetches first. A clean worktree behind its upstream fast-forwards. A dirty or
diverged worktree with remote changes is left untouched and reported for manual
reconciliation. For each remaining dirty target, `git add -A` then
`git commit -m "<message>"`. Commit message is `<project>: <text>`, where `<text>` is the
`-m` value if given, else `sync <ISO-8601 local timestamp, second precision>`. A clean
project is skipped — its last commit is untouched.

After every target has been processed (regardless of per-project failures), one
`git push origin --all` runs from `<MARROW_HOME>/vault.git`. If `origin` isn't configured,
the push is skipped with a warning (not a failure). Concurrent syncs of the same project
serialize on git's own lock; a lock failure should be treated as retryable, not a hard
error.

`--auto`: for a session-end hook or a periodic timer. Every line normally printed to
stdout/stderr instead appends to `<MARROW_HOME>/logs/sync.log` (created if absent), one
line per action, each prefixed with an ISO-8601-local timestamp. A push failure (offline,
unreachable remote) is logged as a warning, never raised as a failure. `--auto` always
exits `0`, even when a target project failed to commit or the push failed — it is a
backstop and must never break a hook chain or a launchd job.

**Exit codes.** `0`: nothing failed (or `--auto`, unconditionally). `1` (non-`--auto`
only): an unknown project name was given, a target's `git add`/`git commit` failed, or the
push failed.

## `add`

```
marrow add <project-path> [--id <stable-id>] [--dry-run]
```

`<project-path>` resolves to its parent Git repository's top-level directory. Its identity
is the normalized GitHub `origin`, `github.com/<owner>/<repo>`, and its branch is
`projects/<identity>`. SSH and HTTPS forms produce the same identity. `--id` supplies a
stable identity for a project without a supported origin. The path basename is a display
name only.

Before deciding, `add` fetches `origin` when the vault has one; a fetch failure aborts.
It then reconciles the local path and matching branch: an ordinary `.agents/` with no
branch is adopted; no `.agents/` with no branch is created fresh; no `.agents/` with a
branch attaches that branch. A matching worktree already at the path succeeds without
changing it. An ordinary `.agents/` plus an existing branch, a different worktree at the
path, or the same branch attached elsewhere on this machine aborts without mutation.
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

### Adopting an existing `.agents/`

**Preconditions** (checked before anything is written; first failure aborts with a message
on stderr and exit `1`, `--dry-run` included):

1. `<project-path>/.agents` must be a directory (not e.g. a plain file).
2. `<project-path>/.agents/.git` must not exist (i.e. it isn't already a marrow worktree).
3. The deterministic `projects/<identity>` branch must not already exist.
4. `<project-path>` must be a git repository, and `.agents` must not be **tracked** by it (see
   the state table below).

| Parent-repo state of `.agents` | Precondition result | What happens |
|---|---|---|
| ignored (matched by `.gitignore`) | pass | proceeds silently |
| untracked, not ignored | pass | appends `.agents/` to `<project-path>/.gitignore` (creating the file if absent); prints a reminder that *the parent-repo commit of that `.gitignore` change is the user's to make* — `add` never commits in a repo it doesn't own |
| tracked (in the parent repo's index) | **abort** | prints the exact untracking steps (`git rm -r --cached .agents`, add `.gitignore`, commit) and tells the user to re-run `add` after — this is a manual, attended step; see `safety.md` |
| not a git repository | **abort** | reports that the parent directory isn't a git repo |

**`--dry-run`**: runs preconditions and the `.gitignore`-state check (reporting what it
*would* append, without writing), then prints the six numbered steps below with resolved
paths, and exits `0`. Nothing is written to disk in either the project directory or the
vault — safe to run against a real project.

**Live run**, once preconditions pass:

1. **Backup.** `tar -czf <MARROW_HOME>/backups/<project>-<ISO-date>.tar.gz -C <project> .agents`. The tarball's size and `tar -tzf` listing are both checked; any failure aborts before anything is moved.
2. **Move aside.** `<project>/.agents` → `<project>/.agents.pre-marrow` (rename, same volume — not a copy).
3. **Create the worktree.** `git worktree add --orphan -b projects/<identity> <project>/.agents` runs against `<MARROW_HOME>/vault.git`. On failure, step 2 is undone (`.agents.pre-marrow` renamed back to `.agents`) before erroring out — the project directory is never left without a `.agents/`.
4. **Restore contents.** Every entry under `.agents.pre-marrow/` — including dotfiles — is moved into the new (currently empty) worktree, then `.agents.pre-marrow` is removed.
5. **README.** `templates/persistence-block.md` (`{{project}}` substituted, read from the tool's own install location) is appended to `.agents/README.md`; if no `README.md` existed, one is created first from `templates/readme-seed.md`.
6. **Commit and push.** `git add -A`, commit `<project>: adopt into marrow`. If the vault has no `origin` remote, the commit is left local; otherwise `git push -u origin <project>`.

**Verification.** After the push (or the no-origin notice) succeeds, a recursive file-count/size snapshot of the new
worktree (excluding `.git`) is compared against the snapshot taken before step 1. If the
after-count or after-size is *smaller* than before, the commit (and push, if any) have already
happened, but the command prints a `WARNING possible content loss` naming the backup
tarball and exits `1` — a human needs to look. Otherwise it prints the add result with
before/after counts and sizes, the backup path, then `pushed: origin/<project>` or `not
pushed: vault has no origin`, and exits `0`. The persistence-block append and README
creation account for the normal small size increase; the count only decreases in an actual
loss.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project-path>` argument. `1`: any
precondition failure, backup failure, worktree-creation failure, commit/push failure, or a
post-adoption content-count/size shrink. `0`: adopted cleanly.

### Creating a fresh `.agents/`

Used automatically when `<project-path>/.agents` does **not** exist and its identity branch
does not exist. Otherwise: creates the
project directory if needed, runs the same worktree-creation, README-seeding (from
`templates/readme-seed.md`, read from the tool's own install location — there is no prior
README to append to), and commit/push steps as the adopt path (steps 3, 5, 6 above), plus
the shared `.gitignore` handling described above — which here runs against a directory
that may have just been created and need not be a git repo at all. The commit message is
`<project>: init via marrow add`. There is no backup step — there is
nothing to back up. As with adopt, a missing `origin` remote on the vault leaves the commit
local and reports `not pushed: vault has no origin` after the add result. `--dry-run`
reports the `.gitignore` step it would take, then prints the three steps with resolved
paths, and exits `0` without touching disk. Exit `2` on a missing
`<project-path>` argument, `1` on the branch-exists failure above or a
worktree/commit/push failure, `0` on success.

## `doctor`

```
marrow doctor
```

Runs a fixed set of checks, each producing one `OK`/`WARN`/`FAIL` line, printed in this
order, followed by a summary line (`doctor: OK` or `doctor: FAIL`):

| Check | Result on failure |
|---|---|
| Every locally registered worktree is named `.agents` | FAIL |
| Every project worktree's parent repo ignores `.agents` (`git check-ignore -q -- .agents` in the parent dir). A parent directory that is not a git repository at all passes — there is nothing it could commit `.agents/` into | FAIL |
| `origin` remote is configured on `<MARROW_HOME>/vault.git` | WARN if absent |
| `origin` is reachable (`git ls-remote --exit-code origin`) | FAIL if unreachable |
| `origin` visibility is `PRIVATE`, checked via `gh repo view --json visibility` when `gh` is on `PATH` | FAIL if a successful `gh` call reports non-`PRIVATE`; WARN (not FAIL) if `gh` is absent or the call itself fails for any other reason (e.g. not a GitHub-hosted remote) |
| Each project worktree isn't more than 20 commits ahead of `origin/<branch>`, and has an `origin/<branch>` to compare against at all | WARN only |
| No tarball under `<MARROW_HOME>/backups/` is older than 30 days | WARN only |
| `marrow` resolves on `PATH` (`Bun.which("marrow")`) | WARN only |

`doctor` checks the **vault's** origin only — the tool repo's own git hygiene (whether
`~/dev/marrow` itself is clean, pushed, etc.) isn't marrow's concern, the same as it
isn't marrow's job to audit `pho`'s or `ossa`'s own repos.

The vault's worktree registry is the source of each path; marrow does not require a common
projects root. Exit `1` if any check produced a `FAIL` line, `0` otherwise — `WARN` never
affects the exit code.

## `grep`

```
marrow grep <pattern> [rg-args...]
```

Runs across every project worktree path (not the tool repo's own files, not anything
under `MARROW_HOME` directly). Prefers
`rg --hidden --no-ignore -g '!.git' <pattern> [rg-args...] <worktree paths...>`;
falls back to `grep -rn --exclude-dir=.git <pattern> <worktree paths...> [rg-args...]` if
`rg` isn't on `PATH`. The `-g '!.git'` exclusion is deliberate and load-bearing:
`rg --hidden --no-ignore` on its own still descends into `.git` directories (verified
empirically — `--no-ignore` only disables `.gitignore`-based filtering, it does not by
itself keep `rg` out of VCS internals the way plain `--hidden` alone would). `rg-args` are
passed through verbatim after the pattern, before the worktree paths, so ordinary `rg`
flags (`-i`, `-C3`, …) work as expected. marrow does not parse them at all — that
includes `-h`/`--help`, which `rg` receives rather than marrow (see "Global flags"
above).

Output streams directly to the terminal (not buffered/parsed by marrow). With zero
project worktrees, prints `No project worktrees.` and exits `0` without invoking `rg`/
`grep` at all. Otherwise the exit code is whatever the underlying `rg`/`grep` process
returns — conventionally `0` (match found), `1` (no match), `2` (usage/other error). `2`
also results from `marrow`'s own dispatch if `<pattern>` is omitted entirely.

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
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow sync ossa -m "weekly review"    # one project, a real message
marrow add ~/dev/sobremesa --dry-run   # preview before touching a real project
marrow add ~/dev/sobremesa             # for real, attended (see ../AGENTS.md)
marrow add ~/dev/some-brand-new-project # no prior .agents/ — created fresh instead
marrow doctor                          # health check after any of the above
marrow grep "TODO" -C2                 # cross-project search, rg flags pass through
marrow convention                      # what should be inside .agents/
```
