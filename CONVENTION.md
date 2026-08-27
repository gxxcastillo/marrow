# The .agents/ convention

Canonical structure and maintenance rules for `.agents/` directories. Per-project
`.agents/README.md` files route locally and point here. If they disagree, this file wins.

## Purpose

`.agents/` is private per-project working memory: resumption context, plans, deferred
work, agent guidance, and research records. It is gitignored by the parent repo and
backed by the private marrow vault as a git worktree.

`.agents/` is not the design source of truth. Put rules in the highest durable layer that
fits:

1. Code and tests — behavior.
2. `spec/` — design rules, formats, contracts.
3. `AGENTS.md` / `CLAUDE.md` — build discipline and stable orientation.
4. `.agents/` — current state, active plans, private context, and guidance that fits
   nowhere above.

Promote durable rationale upward when work lands. A procedure in `agent-notes.md` should
become a harness skill when it is operational enough to reuse.

## Files

- `README.md` — routing guide only, plus the Persistence block.
- `current-state.md` — shortest resumption context: what landed, where it lives, next
  step.
- `agent-notes.md` — durable agent-facing guidance that is not code, spec, or build
  discipline.
- `deferred-items.md` — accepted limitations and deliberately deferred work, each with
  the reason. Remove items once done, encoded upstream, or dropped.
- `plans/<slug>-plan.md` — optional. Use only for substantial active work. Delete or
  collapse it when the work lands and durable rationale has moved up.
- Optional: `analysis/` for dated reviews; `research/` for private research records and
  tools.

Do not use harness-provided per-user memory for project memory except as a pointer to
`.agents/`.

## Maintenance

- Edit in place. Git history replaces inline correction ledgers.
- Collapse progress logs when work lands. Keep final state, not round-by-round history.
- Sync substantive changes that should survive handoff or project switching:
  `marrow sync <project> -m "<one-line summary>"`.
- Check freshness semantically. `current-state.md`, active plans, and
  `deferred-items.md` must agree with the latest user decision. A clean branch can still
  be stale.
- Do not leave `.agents/` as the sole copy of a durable rule.

## Persistence block

Every `.agents/README.md` ends with this block, substituting the project name:

```markdown
## Persistence

This directory is a git worktree of the private `marrow` repo (branch: `<project>`).
It is never committed to the parent repo. Convention: `marrow convention`.

- After substantive changes that should survive handoff or project switching:
  `marrow sync <project> -m "<one-line summary of what changed>"`.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
```
