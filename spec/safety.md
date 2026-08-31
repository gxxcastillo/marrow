# Safety

Authoritative on anything safety-related. `architecture.md` and `cli.md` describe _what_
marrow does; this file describes the guarantees that must keep holding regardless of what
else changes.

marrow's core risk is structural: `attach`, when adopting an existing `.agents/`, moves real
content out of a real project directory and re-homes it as a git worktree. Every rule
below exists to make that operation either safe or loud about not being safe — never
silently lossy.

## Private-only vault

The vault's (`<MARROW_HOME>/vault.git`) `origin` must be a **private** remote. The project
branches may carry private planning content, including content about projects whose own
repos are public. This is a stricter bar than the tool repo needs, which is why they're
separate repos.

Creating the vault's remote is handled only by `marrow publish <owner>/<repo>`, which is
GitHub-specific and always creates a private repository. Running that live command is the
explicit human go-ahead to create the repository named in the command. Connecting an
existing remote is handled only by `marrow init --from <vault-url>`, which never creates
a remote, never pushes, and refuses a remote that a successful visibility check reports
as non-private. Plain `marrow init` creates only the local bare vault and must never
configure or hydrate a remote.

Every push after setup assumes the remote's visibility hasn't changed underneath it.
`doctor` re-checks the vault's visibility on every run (via `gh repo view --json
visibility` when `gh` is available) specifically to catch that drift — see `cli.md` →
`doctor`. `doctor` does not audit the tool repo's own visibility or hygiene; that's an
ordinary dev-project concern, not a marrow safety property.

## No destructive shared-history operations

Never force-push. Never rewrite history on a vault project branch, the vault's minimal
`main` landing branch, or the tool repo's shared `main`. A branch that needs correcting
gets a new commit. Never use `reset --hard` plus force-push or `filter-repo`. `detach`
(`cli.md` → `detach`) never deletes history either. `--vault-only` and the
already-missing path leave the branch untouched. The file-retaining default adds one
ordinary commit removing the now-false persistence block before releasing the worktree.

The managed install at `~/.local/share/marrow` is a disposable local checkout, not a
shared history. Its official updater may fetch and hard-reset that checkout to
`origin/main` after verifying the official origin and a clean worktree. It never pushes,
and `marrow update` refuses to run from a development checkout.

## Backup before mutate

When `attach` is adopting an existing `.agents/`, its first project mutation occurs only
after a tar backup of the current `.agents/` is written under `<MARROW_HOME>/backups/`
and verified non-empty and listable (`cli.md` → `attach`, step 1). The initial vault origin
fetch may refresh remote-tracking refs before the backup; it does not touch the project.
Each backup's filename carries a sub-second UTC timestamp and a random UUID suffix, so
two adoptions of projects sharing a directory basename, two explicit `--id` values,
concurrent attempts, and repeated same-day attempts can never collide or overwrite a
prior tarball; a generated path is also checked against disk before `tar` runs. If the
backup can't be produced or verified, `attach` aborts before touching the project
directory at all. The original content is only
ever **moved**, never deleted outright: it goes through a same-volume rename to
`.agents.pre-marrow`, and that staging directory is only removed once its contents have
been moved into the new worktree.

**Backups are never auto-deleted.** They accumulate under `<MARROW_HOME>/backups/` — a
plain directory outside any git working tree, so there's no `.gitignore` entry needed to
keep them out of a repo — until a human removes them. `doctor` warns — never fails — when
any tarball is older than 30 days, aggregated to one line naming the count (a line per
tarball would be a permanent, ever-growing noise source, precisely because backups are
never auto-deleted), as a nudge, not a cleanup mechanism.

## Rollback on partial failure

If worktree creation (`git worktree add --orphan`) fails after the original `.agents/` has
already been renamed aside, `attach` renames it straight back before reporting the error.
The project directory is never left in a state with no `.agents/` at all, and no half-built
worktree is left behind for a human to find later. The verified backup remains. If
`.agents/` was not already ignored, the `.gitignore` append made after that backup may
also remain for the user to commit or remove. Preconditions abort before project or
project-branch mutation; the initial origin fetch may refresh vault remote-tracking refs.

## Content-preservation verification

Every live adopt run (`attach` against an existing `.agents/`) snapshots the recursive file
count and total size of the source `.agents/` before starting, and re-snapshots the
destination worktree (excluding `.git`) after the commit and push have already landed. If
the after-snapshot is smaller in either dimension, `attach` still reports success up through
the push — the commit is real and already on the branch — but exits `1` with an explicit
`WARNING possible content loss` naming the backup tarball, so a human is never left
assuming the adoption was silently lossy. Test coverage enforces the same invariant
directly: a test must fail if `attach` ever loses a file while adopting, verified by
comparing recursive directory listings (including dotfiles) before and after, independent
of the count/size heuristic.

## Tracked-parent-repo refusal

If a project's parent repo already tracks `.agents/` in its index, `attach` refuses outright
rather than attempting to `git rm --cached` on a repo it doesn't own. It prints the exact
untracking commands and stops; the human runs them, commits in the parent repo themselves,
and re-invokes `attach`. marrow never commits inside a project's own repository — the only
repo it ever commits into is the vault, via its worktrees. `attach` may append `.agents/` to a
parent repo's `.gitignore` on disk, but it still never commits that change itself.

## Attended operation

`attach` has no interactive confirmation prompt — nothing in the code stops an agent from
invoking it unattended, in either mode. That gap is intentional but not free: the
operating rule is that a human is present and approving each real (non-`--dry-run`) `attach`
that adopts an existing project, one project at a time. This is a human/agent discipline,
not a code-enforced gate — see `../AGENTS.md` for the concrete rule.
`--dry-run` exists precisely so that rule can be honored without giving up a preview. It
runs every precondition check and prints the full plan without changing the project,
worktree registry, or project branch. Its initial origin fetch may refresh the vault's
remote-tracking refs.

## Detach preserves the selected record

Default `detach` treats the files on disk as the record. It allows a dirty worktree,
removes only the fenced marrow persistence block or an identifiable historical unfenced
marrow block, and moves the complete `.agents/`
directory aside before clearing the worktree registration. It then moves the same
directory back and removes only its `.git` pointer. It never edits the parent repo and
never deletes unrelated `.agents/` content. The retained README keeps unrelated staged
and unstaged edits, while the vault commit contains only the block removal from the prior
branch tip. If registration removal fails, it restores the original path and README before
returning nonzero.

`detach --vault-only` treats the branch as the record. It refuses a dirty worktree before
removing anything, so every removed file already exists in retained branch history. The
default deletes no content and `--vault-only` has a complete branch copy, so neither mode
needs an adoption-style backup tarball.

## Known gaps

- **No symlink hardening.** `attach` accepts a project path and does not canonicalize it
  or refuse symlinked components before writing, in either mode. This is an accepted gap:
  its write surface is the explicitly supplied project's `.agents/` path and marrow's own
  `backups/`, but a symlinked `.agents` or project directory has not been specifically
  defended against.
- **No credential handling.** marrow stores and moves plain files; it has no concept of
  secrets, and `.agents/` content is expected to follow the same "no credentials" norm as
  the rest of the working-memory convention (`../CONVENTION.md`). marrow does not
  scan for or redact anything.

## Test isolation

`bun test` fixtures build throwaway stand-ins for both repos under a temp directory: a
fake tool root (so `templates/`/`CONVENTION.md` resolution is exercised without touching
the real install), a fake `MARROW_HOME` vault (including a `file://`-backed bare `origin`),
and explicit disposable project paths in each of the three gitignore states. Tests refuse
to run if `MARROW_HOME` would resolve to the real vault location. This is the mechanism
that makes it safe to exercise `attach`'s live (non-`--dry-run`) adopt path in CI/local test runs
at all — see `../AGENTS.md` for the full build-discipline rule this backs.
