## Persistence

This directory is a git worktree of the private marrow vault (branch: `{{branch}}`).
It is never committed to the parent repo. Convention: `marrow convention`.

- After substantive changes that should survive handoff or project switching:
  `marrow sync {{project}} -m "<one-line summary of what changed>"`.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
