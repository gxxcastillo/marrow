## Persistence

This directory is a git worktree of the private `marrow` repo (branch: `{{project}}`).
It is never committed to the parent repo. Convention: `marrow convention`.

- Before ending a session in which you wrote here:
  `marrow sync {{project}} -m "<one-line summary of what changed>"`.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
