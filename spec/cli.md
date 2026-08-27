# CLI

Authoritative on command syntax, options, output, and exit codes.

Global behavior: plain text output, one line per project where applicable. Every command
assumes `MARROW_HOME` is an initialized git repository; if it is not, a command fails with
an uncaught error (stack trace, non-zero exit) rather than a clean message — this is a
known gap, not a designed error path. Unknown command, or a required argument missing,
prints usage to stderr and exits `2`.

| Command | Purpose | Mutates |
|---|---|---|
| [`status`](#status) | per-project worktree health | no |
| [`sync`](#sync) | commit + push project worktrees | project worktrees, vault |
| [`adopt`](#adopt) | bring an existing `.agents/` under marrow | project dir, vault |
| [`new`](#new) | create a fresh `.agents/` worktree | project dir, vault |
| [`doctor`](#doctor) | vault + worktree health checks | no |
| [`grep`](#grep) | search across all project worktrees | no |
| [`convention`](#convention) | print `CONVENTION.md` | no |

## `status`

```
marrow status
```

For each project worktree (from `git worktree list --porcelain` against `MARROW_HOME`,
excluding `main`): one tab-separated line —
`<branch>\t<clean|dirty (N)>\t<+ahead/-behind|no upstream>\t<last commit date + subject|no commits>`.
"Dirty" counts lines from `git status --porcelain` (i.e. files changed, not diff hunks).
Ahead/behind compares `HEAD` against the local `origin/<branch>` ref — it does not fetch
first, so it can be stale relative to a remote no one has pulled recently. Ends with one
summary line: `<N> project(s), <M> dirty`. With zero project worktrees, prints
`No project worktrees.` instead. Always exits `0`.

## `sync`

```
marrow sync [project...] [-m <message>] [--auto]
```

Targets: the named projects, or every project worktree if none are named. Unknown
project names are reported and make the run report failure (see exit codes below), but do
not stop the remaining targets from being processed.

For each target: if dirty (`git status --porcelain` non-empty), `git add -A` then
`git commit -m "<message>"`. Commit message is `<project>: <text>`, where `<text>` is the
`-m` value if given, else `sync <ISO-8601 local timestamp, second precision>`. A clean
project is skipped — its last commit is untouched.

After every target has been processed (regardless of per-project failures), one
`git push origin --all` runs from `MARROW_HOME`. If `origin` isn't configured, the push is
skipped with a warning (not a failure). Concurrent syncs of the same project serialize on
git's own lock; a lock failure should be treated as retryable, not a hard error.

`--auto`: for a session-end hook or a periodic timer. Every line normally printed to
stdout/stderr instead appends to `<MARROW_HOME>/logs/sync.log` (created if absent), one
line per action, each prefixed with an ISO-8601-local timestamp. A push failure (offline,
unreachable remote) is logged as a warning, never raised as a failure. `--auto` always
exits `0`, even when a target project failed to commit or the push failed — it is a
backstop and must never break a hook chain or a launchd job.

**Exit codes.** `0`: nothing failed (or `--auto`, unconditionally). `1` (non-`--auto`
only): an unknown project name was given, a target's `git add`/`git commit` failed, or the
push failed.

## `adopt`

```
marrow adopt <project> [--dry-run]
```

`<project>` resolves against `MARROW_DEV_ROOT` (bare name, e.g. `ossa`) or as a path if it
contains a `/`. Either way the project name used for the branch is the resolved
directory's basename.

**Preconditions** (checked before anything is written; first failure aborts with a message
on stderr and exit `1`, `--dry-run` included):

1. `<project>/.agents` must exist and be a directory.
2. `<project>/.agents/.git` must not exist (i.e. it isn't already a marrow worktree).
3. No branch named `<project>` may already exist in `MARROW_HOME`.
4. `<project>` must be a git repository, and `.agents` must not be **tracked** by it (see
   the state table below).

| Parent-repo state of `.agents` | Precondition result | What happens |
|---|---|---|
| ignored (matched by `.gitignore`) | pass | proceeds silently |
| untracked, not ignored | pass | appends `.agents/` to `<project>/.gitignore` (creating the file if absent); prints a reminder that *the parent-repo commit of that `.gitignore` change is the user's to make* — adopt never commits in a repo it doesn't own |
| tracked (in the parent repo's index) | **abort** | prints the exact untracking steps (`git rm -r --cached .agents`, add `.gitignore`, commit) and tells the user to re-run `adopt` after — this is a manual, attended step; see `safety.md` |
| not a git repository | **abort** | reports that the parent directory isn't a git repo |

**`--dry-run`**: runs preconditions and the `.gitignore`-state check (reporting what it
*would* append, without writing), then prints the six numbered steps below with resolved
paths, and exits `0`. Nothing is written to disk in either the project directory or
`MARROW_HOME` — safe to run against a real project.

**Live run**, once preconditions pass:

1. **Backup.** `tar -czf <MARROW_HOME>/backups/<project>-<ISO-date>.tar.gz -C <project> .agents`. The tarball's size and `tar -tzf` listing are both checked; any failure aborts before anything is moved.
2. **Move aside.** `<project>/.agents` → `<project>/.agents.pre-marrow` (rename, same volume — not a copy).
3. **Create the worktree.** `git worktree add --orphan -b <project> <project>/.agents` run against `MARROW_HOME`. On failure, step 2 is undone (`.agents.pre-marrow` renamed back to `.agents`) before erroring out — the project directory is never left without a `.agents/`.
4. **Restore contents.** Every entry under `.agents.pre-marrow/` — including dotfiles — is moved into the new (currently empty) worktree, then `.agents.pre-marrow` is removed.
5. **README.** `templates/persistence-block.md` (`{{project}}` substituted) is appended to `.agents/README.md`; if no `README.md` existed, one is created first from `templates/readme-seed.md`.
6. **Commit and push.** `git add -A`, commit `<project>: adopt into marrow`, `git push -u origin <project>`.

**Verification.** After push succeeds, a recursive file-count/size snapshot of the new
worktree (excluding `.git`) is compared against the snapshot taken before step 1. If the
after-count or after-size is *smaller* than before, the commit and push have already
happened, but the command prints a `WARNING possible content loss` naming the backup
tarball and exits `1` — a human needs to look. Otherwise it prints the before/after
counts, sizes, and the backup path, and exits `0`. The persistence-block append and README
creation account for the normal small size increase; the count only decreases in an actual
loss.

**Exit codes.** `2` (from `marrow` dispatch): missing `<project>` argument. `1`: any
precondition failure, backup failure, worktree-creation failure, commit/push failure, or a
post-adoption content-count/size shrink. `0`: adopted cleanly.

## `new`

```
marrow new <project>
```

For a project with **no** existing `.agents/`. Fails (exit `1`) if `.agents` already
exists (points at `adopt` instead) or if a branch named `<project>` already exists in
`MARROW_HOME`. Otherwise: creates `<project>/` if needed, runs the same worktree-creation,
README-seeding (from `templates/readme-seed.md` — there is no prior README to append to),
and commit/push steps as `adopt` (steps 3, 5, 6 above), with the commit message
`<project>: init via marrow new`. There is no backup step — there is nothing to back up.
Exit `2` on a missing `<project>` argument, `1` on any of the failures above or a
worktree/commit/push failure, `0` on success.

## `doctor`

```
marrow doctor
```

Runs a fixed set of checks, each producing one `OK`/`WARN`/`FAIL` line, printed in this
order, followed by a summary line (`doctor: OK` or `doctor: FAIL`):

| Check | Result on failure |
|---|---|
| Every local branch (except `main`) has a worktree at `<MARROW_DEV_ROOT>/<branch>/.agents` | FAIL |
| Every project worktree's parent repo ignores `.agents` (`git check-ignore -q -- .agents` in the parent dir) | FAIL |
| `origin` remote is configured on `MARROW_HOME` | FAIL if absent |
| `origin` is reachable (`git ls-remote --exit-code origin`) | FAIL if unreachable |
| `origin` visibility is `PRIVATE`, checked via `gh repo view --json visibility` when `gh` is on `PATH` | FAIL if a successful `gh` call reports non-`PRIVATE`; WARN (not FAIL) if `gh` is absent or the call itself fails for any other reason (e.g. not a GitHub-hosted remote) |
| Each project worktree isn't more than 20 commits ahead of `origin/<branch>`, and has an `origin/<branch>` to compare against at all | WARN only |
| No tarball under `backups/` is older than 30 days | WARN only |
| `marrow` resolves on `PATH` (`Bun.which("marrow")`) | WARN only |

Path comparisons resolve both sides with `fs.realpath` before comparing, so a worktree
under a symlinked mount (e.g. macOS's `/var` → `/private/var`) isn't reported as
misplaced. A branch/worktree check that can't resolve a path at all (nothing exists there)
counts as a mismatch. Exit `1` if any check produced a `FAIL` line, `0` otherwise — `WARN`
never affects the exit code.

## `grep`

```
marrow grep <pattern> [rg-args...]
```

Runs across every project worktree path (not `MARROW_HOME` itself, not `main`'s files).
Prefers `rg --hidden --no-ignore -g '!.git' <pattern> [rg-args...] <worktree paths...>`;
falls back to `grep -rn --exclude-dir=.git <pattern> <worktree paths...> [rg-args...]` if
`rg` isn't on `PATH`. The `-g '!.git'` exclusion is deliberate and load-bearing:
`rg --hidden --no-ignore` on its own still descends into `.git` directories (verified
empirically — `--no-ignore` only disables `.gitignore`-based filtering, it does not by
itself keep `rg` out of VCS internals the way plain `--hidden` alone would). `rg-args` are
passed through verbatim after the pattern, before the worktree paths, so ordinary `rg`
flags (`-i`, `-C3`, …) work as expected.

Output streams directly to the terminal (not buffered/parsed by marrow). With zero
project worktrees, prints `No project worktrees.` and exits `0` without invoking `rg`/
`grep` at all. Otherwise the exit code is whatever the underlying `rg`/`grep` process
returns — conventionally `0` (match found), `1` (no match), `2` (usage/other error). `2`
also results from `marrow`'s own dispatch if `<pattern>` is omitted entirely.

## `convention`

```
marrow convention
```

Reads and prints `<MARROW_HOME>/CONVENTION.md` verbatim. Exits `0`, or crashes with an
uncaught error if the file is missing (see the top-of-file caveat about `MARROW_HOME`
assumptions).

## Typical workflow

```bash
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow sync ossa -m "weekly review"    # one project, a real message
marrow adopt sobremesa --dry-run       # preview before touching a real project
marrow adopt sobremesa                 # for real, attended (see ../AGENTS.md)
marrow new some-brand-new-project      # no prior .agents/ to migrate
marrow doctor                          # health check after any of the above
marrow grep "TODO" -C2                 # cross-project search, rg flags pass through
marrow convention                      # what should be inside .agents/
```
