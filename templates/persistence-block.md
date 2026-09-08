<!-- marrow:template-version 6 -->
## Working memory via marrow

This directory is a git worktree of the private marrow vault (branch: `{{branch}}`).
It has its own complete git history, kept separate from the parent repo's: the
parent's `.gitignore` excludes this directory from the parent's history, not from git
itself. Convention: `marrow convention`.

- Updating this directory is part of finishing work, not a wrap-up chore: when work
  lands, a decision is made, or a plan changes status, update `current-state.md` in the
  same step, then `marrow sync {{project}} -m "<one-line summary of what changed>"`.
- Canonize decisions and rationale that future contributors must honor: move them out
  of here into the appropriate shared source. Collapse or discard task-local planning
  context when it is no longer useful.
- On session start, check `current-state.md`'s `As of` stamp against `git log`;
  reconcile before building on stale state.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows memory needing attention; `marrow doctor` verifies
  marrow's setup and safety.
