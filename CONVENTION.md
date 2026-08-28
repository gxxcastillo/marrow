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

## Parent instruction block

Every committed parent instruction file that points at `.agents/` uses this canonical
block. The source template is `templates/agents-block.md`. A material wording change
updates the template and tests in the same commit.

```markdown
> [!NOTE]
> **Agent memory:** Read [`.agents/README.md`](.agents/README.md) before non-trivial
> work. It indexes private working notes. Update `.agents/` as plans, findings, and
> decisions change.
> <p align="right">v1</p>
```

This text is strict-verbatim; project-specific policy lives outside this block. The
version tag on the last line is what `add` keys off: a note ending in the current version
is left alone, a note ending in any other version is stale and gets replaced in place with
the current text, and prose with no recognizable note at all is treated as missing.
Bump the version whenever the wording changes.

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

- Update on events, not at session end. When work lands, a decision is made, or a plan
  changes status, update `current-state.md` (and the affected plan) in the same working
  step, then sync: `marrow sync <project> -m "<one-line summary>"`. The task is not done
  until memory agrees with reality. Sessions end without warning — never defer memory
  updates to a wrap-up pass.
- Stamp freshness. `current-state.md` opens with
  `As of YYYY-MM-DD (<parent repo> @<short-sha>)`, refreshed with every content update.
- Repair on read. At session start, check the stamp against `git log` (parent repo and
  `.agents/`) before trusting `current-state.md`; if reality has moved past it, reconcile
  before building on it. A clean branch can still be stale, and `current-state.md`,
  active plans, and `deferred-items.md` must agree with the latest user decision.
- Edit in place. Git history replaces inline correction ledgers.
- Collapse progress logs when work lands. Keep final state, not round-by-round history.
- Do not leave `.agents/` as the sole copy of a durable rule.

## Persistence block

Every `.agents/README.md` ends with this block, substituting the project name:

```markdown
<!-- marrow:persistence-block v1 -->
## Persistence

This directory is a git worktree of the private marrow vault (branch: `<project>`).
It is never committed to the parent repo. Convention: `marrow convention`.

- Updating this directory is part of finishing work, not a wrap-up chore: when work
  lands, a decision is made, or a plan changes status, update `current-state.md` in the
  same step, then `marrow sync <project> -m "<one-line summary of what changed>"`.
- On session start, check `current-state.md`'s `As of` stamp against `git log`;
  reconcile before building on stale state.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
<!-- /marrow:persistence-block -->
```
