# The .agents/ convention

Canonical structure and maintenance rules for `.agents/` directories. Per-project
`.agents/README.md` files route locally and point here. If they disagree, this file wins.

## Purpose

`.agents/` is private per-project working memory: resumption context, plans, deferred
work, agent guidance, and research records. It is gitignored by the parent repo and
backed by the private marrow vault as a git worktree.

Ownership boundary:

1. Marrow preserves private working memory. It does not define or replace a project's
   shared sources of truth.
2. Project instructions identify the authoritative sources for accepted requirements,
   contracts, intended behavior, architecture, operational rules, and team policy when
   those sources are not obvious.
3. `.agents/` owns private working history, progress, plans, investigations, deferred
   work, working decisions, and resumption context.
4. A task-local decision may remain in `.agents/`. A constraint future contributors
   must honor must be distilled into the appropriate shared source before the work is
   considered complete.
5. If `.agents/` conflicts with a designated authority, the designated authority wins.
   If code/tests and a designated authority conflict, treat that as a mismatch to
   reconcile; `.agents/` never adjudicates it.
6. Link from `.agents/` to authoritative material rather than maintaining a second copy
   when practical.
7. Working history may remain private. Historical rationale needed by the wider project
   must be distilled into a shared record. Promotion is never a license to quote private
   notes verbatim.
8. Project instructions designate that project's authorities; `CONVENTION.md` governs
   `.agents/` structure and maintenance. When the two disagree, the project's
   instructions win on authority designation and `CONVENTION.md` wins on `.agents/`
   itself.
9. Placement, not only precedence: put a rule in the narrowest shared source that
   everyone who must honor it already reads.

Examples of shared sources: specs, schemas, ADRs, docs, issue trackers, code/tests, and
project instructions. None is required universally, and no rule here assumes a `spec/`
directory or any other fixed project layout.

Promote a decision or its rationale when future contributors must honor or rediscover
it. Future need drives promotion — not every planning decision becomes project
documentation. A procedure in `agent-notes.md` should become a harness skill when it is
operational enough to reuse.

## Parent instruction block

Every committed parent instruction file that points at `.agents/` uses this canonical
block. The source template is `templates/agents-block.md`. A material wording change
updates the template and tests in the same commit.

```markdown
> [!NOTE]
> **Agent working memory:** Read [`.agents/README.md`](.agents/README.md) before
> non-trivial work and keep it current as the work changes. It holds private working
> state; it does not replace the project's designated shared sources of truth.
> <p align="right">v2</p>
```

This text is strict-verbatim; project-specific policy lives outside this block. The
version tag on the last line is what `add` keys off: a note ending in the current version
is left alone, a note ending in any other version is stale and gets replaced in place with
the current text, and prose with no recognizable note at all is treated as missing.
Bump the version whenever the wording changes.

## Files

Every `.agents/` directory contains:

- `README.md` — routing guide only, plus the Persistence block.
- `current-state.md` — shortest resumption context: what landed, where it lives, next
  step.

Other files are project-specific. Common choices are:

- `agent-notes.md` — private agent-facing guidance that is not code, spec, or build
  discipline.
- `deferred-items.md` — accepted limitations and deliberately deferred work, each with
  the reason. Remove items once done, encoded upstream, or dropped.
- `plans/<slug>-plan.md` — optional. Use only for substantial active work. Delete or
  collapse it when the work lands and any rationale future contributors need has moved
  up.
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
  Use `@no-HEAD` only when the parent has no commit to name.
- Repair on read. At session start, check the stamp against `git log` (parent repo and
  `.agents/`) before trusting `current-state.md`; if reality has moved past it, reconcile
  before building on it. A clean branch can still be stale, and `current-state.md`,
  active plans, and `deferred-items.md` must agree with the latest user decision.
- Edit in place. Git history replaces inline correction ledgers.
- Collapse progress logs when work lands. Keep final state, not round-by-round history.
- Do not leave `.agents/` as the sole copy of a rule future contributors must honor —
  promote it to the appropriate shared source first.

## Persistence block

Every `.agents/README.md` ends with this block, substituting the project name:

```markdown
<!-- marrow:persistence-block v2 -->
## Persistence

This directory is a git worktree of the private marrow vault (branch: `<project>`).
It is never committed to the parent repo. Convention: `marrow convention`.

- Updating this directory is part of finishing work, not a wrap-up chore: when work
  lands, a decision is made, or a plan changes status, update `current-state.md` in the
  same step, then `marrow sync <project> -m "<one-line summary of what changed>"`.
- Promote decisions and rationale that future contributors must honor to the
  appropriate shared source. Collapse or discard task-local planning context when it
  is no longer useful.
- On session start, check `current-state.md`'s `As of` stamp against `git log`;
  reconcile before building on stale state.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
<!-- /marrow:persistence-block -->
```
