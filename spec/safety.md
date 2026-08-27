# Safety

Authoritative on anything safety-related. `architecture.md` and `cli.md` describe *what*
marrow does; this file describes the guarantees that must keep holding regardless of what
else changes.

marrow's core risk is structural: `add`, when adopting an existing `.agents/`, moves real
content out of a real project directory and re-homes it as a git worktree. Every rule
below exists to make that operation either safe or loud about not being safe — never
silently lossy.

## Private-only vault

The vault's (`<MARROW_HOME>/vault.git`) `origin` must be a **private** remote
(`gxxcastillo/marrow-vault`). The project branches carry personal planning content —
including, for `sobremesa`, `solid-forms`, `ultra-sound-music`, `embracingroots`, and
`event-link`, content about projects whose own repos are public. This is a stricter bar
than the tool repo (`gxxcastillo/marrow`) needs, which is exactly why they're separate
repos: the tool repo could in principle go public later (open, deferred question — see
`architecture.md` → Non-goals) without ever putting the vault at risk.

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

## No destructive git operations, ever

Never force-push. Never rewrite history — on any vault project branch, the vault's
minimal `main` landing branch, or the tool repo's own `main`. This applies even to
`event-link`, whose parent repo is public and once tracked `.agents/` directly in its
history: the fix there is to untrack going forward, not to scrub the past. That was
decided deliberately, not left undecided — the content stays in that repo's public
history and marrow does not touch it. A branch that needs correcting gets a new commit,
the same as any other git history — never `reset --hard` + force-push, never
`filter-repo`.

## Backup before mutate

When `add` is adopting an existing `.agents/`, its first live action is always a tar
backup of the project's current `.agents/`, written under `<MARROW_HOME>/backups/`,
verified non-empty and listable before anything else happens (`cli.md` → `add`, step 1).
If the backup can't be produced or verified, `add` aborts before touching the project
directory at all. The original content is only
ever **moved**, never deleted outright: it goes through a same-volume rename to
`.agents.pre-marrow`, and that staging directory is only removed once its contents have
been moved into the new worktree.

**Backups are never auto-deleted.** They accumulate under `<MARROW_HOME>/backups/` — a
plain directory outside any git working tree, so there's no `.gitignore` entry needed to
keep them out of a repo — until a human removes them. `doctor` warns — never fails — on a
tarball older than 30 days, as a nudge, not a cleanup mechanism.

## Rollback on partial failure

If worktree creation (`git worktree add --orphan`) fails after the original `.agents/` has
already been renamed aside, `add` renames it straight back before reporting the error.
The project directory is never left in a state with no `.agents/` at all, and no half-built
worktree is left behind for a human to find later. This is the only mutation `add`
performs on error; every other precondition failure aborts before anything is written.

## Content-preservation verification

Every live adopt run (`add` against an existing `.agents/`) snapshots the recursive file
count and total size of the source `.agents/` before starting, and re-snapshots the
destination worktree (excluding `.git`) after the commit and push have already landed. If
the after-snapshot is smaller in either dimension, `add` still reports success up through
the push — the commit is real and already on the branch — but exits `1` with an explicit
`WARNING possible content loss` naming the backup tarball, so a human is never left
assuming the migration was silently lossy. Test coverage enforces the same invariant
directly: a test must fail if `add` ever loses a file while adopting, verified by
comparing recursive directory listings (including dotfiles) before and after, independent
of the count/size heuristic.

## Tracked-parent-repo refusal

If a project's parent repo already tracks `.agents/` in its index (`eos`, and — until its
own untracking — `event-link`), `add` refuses outright rather than attempting to
`git rm --cached` on a repo it doesn't own. It prints the exact untracking commands and
stops; the human runs them, commits in the parent repo themselves, and re-invokes `add`.
marrow never commits inside a project's own repository — the only repo it ever commits
into is the vault, via its worktrees. This holds even when the "project" being adopted is
marrow's own tool repo (Phase 5, self-adoption): `add` may append `.agents/` to that
repo's `.gitignore` on disk, but it still never commits that change itself — the human
does, the same as for any other project.

## Attended operation

`add` has no interactive confirmation prompt — nothing in the code stops an agent from
invoking it unattended, in either mode. That gap is intentional but not free: the
operating rule is that a human is present and approving each real (non-`--dry-run`) `add`
that adopts an existing project, one project at a time. This is a human/agent discipline,
not a code-enforced gate — see `../AGENTS.md` for the concrete rule, and
`../.agents/plans/implementation-plan.md` (vault worktree) for the per-project migration
order it governs.
`--dry-run` exists precisely so that rule can be honored without giving up a preview: it
runs every precondition check and prints the full plan against a real project directory
without writing anything, anywhere.

## Known gaps

- **No symlink hardening.** `add` accepts a project path and does not canonicalize it
  or refuse symlinked components before writing, in either mode. This is an accepted gap:
  its write surface is the explicitly supplied project's `.agents/` path and marrow's own
  `backups/`, but a symlinked `.agents` or project directory has not been specifically
  defended against.
- **No credential handling.** marrow stores and moves plain files; it has no concept of
  secrets, and `.agents/` content is expected to follow the same "no credentials" norm as
  the rest of the personal-planning convention (`../CONVENTION.md`). marrow does not
  scan for or redact anything.

## Test isolation

`bun test` fixtures build throwaway stand-ins for both repos under a temp directory: a
fake tool root (so `templates/`/`CONVENTION.md` resolution is exercised without touching
the real install), a fake `MARROW_HOME` vault (including a `file://`-backed bare `origin`),
and explicit disposable project paths in each of the three gitignore states. Tests refuse
to run if `MARROW_HOME` would resolve to the real vault location. This is the mechanism
that makes it safe to exercise `add`'s live (non-`--dry-run`) adopt path in CI/local test runs
at all — see `../AGENTS.md` for the full build-discipline rule this backs.
