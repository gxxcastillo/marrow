# Safety

Authoritative on anything safety-related. `architecture.md` and `cli.md` describe *what*
marrow does; this file describes the guarantees that must keep holding regardless of what
else changes.

marrow's core risk is structural: `adopt` moves real content out of a real project
directory and re-homes it as a git worktree. Every rule below exists to make that
operation either safe or loud about not being safe — never silently lossy.

## Private-only vault

`MARROW_HOME`'s `origin` must be a **private** remote. The project branches carry
personal planning content — including, for `sobremesa`, `solid-forms`,
`ultra-sound-music`, `embracingroots`, and `event-link`, content about projects whose own
repos are public. Creating that remote (`gh repo create ... --private`) requires an
explicit human go-ahead the first time; every push after that assumes the remote's
visibility hasn't changed underneath it. `doctor` re-checks visibility on every run (via
`gh repo view --json visibility` when `gh` is available) specifically to catch that drift
— see `cli.md` → `doctor`.

## No destructive git operations, ever

Never force-push. Never rewrite history, on `main` or on any project branch. This applies
even to `event-link`, whose parent repo is public and once tracked `.agents/` directly in
its history: the fix there is to untrack going forward, not to scrub the past (see
`../plans/implementation-plan.md` decision log). A project branch that needs correcting
gets a new commit, the same as any other git history — never `reset --hard` + force-push,
never `filter-repo`.

## Backup before mutate

`adopt`'s first live action is always a tar backup of the project's current `.agents/`,
written under `<MARROW_HOME>/backups/`, verified non-empty and listable before anything
else happens (`cli.md` → `adopt`, step 1). If the backup can't be produced or verified,
`adopt` aborts before touching the project directory at all. The original content is only
ever **moved**, never deleted outright: it goes through a same-volume rename to
`.agents.pre-marrow`, and that staging directory is only removed once its contents have
been moved into the new worktree.

**Backups are never auto-deleted.** They accumulate under `backups/` (gitignored) until a
human removes them. `doctor` warns — never fails — on a tarball older than 30 days, as a
nudge, not a cleanup mechanism.

## Rollback on partial failure

If worktree creation (`git worktree add --orphan`) fails after the original `.agents/` has
already been renamed aside, `adopt` renames it straight back before reporting the error.
The project directory is never left in a state with no `.agents/` at all, and no half-built
worktree is left behind for a human to find later. This is the only mutation `adopt`
performs on error; every other precondition failure aborts before anything is written.

## Content-preservation verification

Every live `adopt` run snapshots the recursive file count and total size of the source
`.agents/` before starting, and re-snapshots the destination worktree (excluding `.git`)
after the commit and push have already landed. If the after-snapshot is smaller in either
dimension, `adopt` still reports success up through the push — the commit is real and
already on the branch — but exits `1` with an explicit `WARNING possible content loss`
naming the backup tarball, so a human is never left assuming the migration was silently
lossy. Test coverage enforces the same invariant directly: a test must fail if `adopt`
ever loses a file, verified by comparing recursive directory listings (including
dotfiles) before and after, independent of the count/size heuristic.

## Tracked-parent-repo refusal

If a project's parent repo already tracks `.agents/` in its index (`eos`, and — until its
own untracking — `event-link`), `adopt` refuses outright rather than attempting to
`git rm --cached` on a repo it doesn't own. It prints the exact untracking commands and
stops; the human runs them, commits in the parent repo themselves, and re-invokes `adopt`.
marrow never commits inside a project's own repository — the only repo it ever commits
into is itself (`MARROW_HOME` and its worktrees).

## Attended operation

`adopt` and `new` have no interactive confirmation prompt — nothing in the code stops an
agent from invoking them unattended. That gap is intentional but not free: the operating
rule is that a human is present and approving each real (non-`--dry-run`) `adopt` of an
existing project, one project at a time. This is a human/agent discipline, not a
code-enforced gate — see `../AGENTS.md` for the concrete rule and the per-project
migration order it governs. `--dry-run` exists precisely so that rule can be honored
without giving up a preview: it runs every precondition check and prints the full plan
against a real project directory without writing anything, anywhere.

## Known gaps

- **No symlink hardening.** Unlike a filesystem-mutation tool operating on arbitrary
  user-supplied paths, `adopt`/`new` do not canonicalize paths or refuse symlinked
  components before writing. This is an accepted gap for a tool whose write surface is
  limited to `<MARROW_DEV_ROOT>/<project>/.agents` and marrow's own `backups/` — not a
  general-purpose filesystem tool's threat model — but it means a symlinked `.agents` or
  a symlinked project directory has not been specifically defended against.
- **No credential handling.** marrow stores and moves plain files; it has no concept of
  secrets, and `.agents/` content is expected to follow the same "no credentials" norm as
  the rest of the personal-planning convention (`../CONVENTION.md`). marrow does not
  scan for or redact anything.

## Test isolation

`bun test` fixtures build a throwaway `MARROW_HOME`/`MARROW_DEV_ROOT` pair under a temp
directory (including a `file://`-backed bare `origin`, and — for `adopt`/`new`/`doctor`
tests — real, disposable parent project repos in each of the three gitignore states) and
refuse to run if `MARROW_HOME` would resolve to the real `~/dev/marrow`. This is the
mechanism that makes it safe to exercise `adopt`'s live (non-`--dry-run`) path in CI/local
test runs at all — see `../AGENTS.md` for the full build-discipline rule this backs.
