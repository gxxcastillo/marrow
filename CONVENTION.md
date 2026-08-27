# The .agents/ convention

Canonical description of how `.agents/` directories are structured and maintained across
projects. Per-project `.agents/README.md` files route within their own directory
and point here; they do not restate this document. When this convention and a project
README disagree, this document wins — fix the README.

## What .agents/ is

Per-project working memory for agents: resumption context, working guidance, deferred
work, active plans, and research records. It is gitignored by the parent repo and backed
by the private `marrow` repo as a git worktree (see Persistence below).

`.agents/` is **not** the design source of truth. Layered authority, most durable first:

1. Code and tests — behavior.
2. `spec/` (where the project has one) — design rules, formats, contracts.
3. Committed `AGENTS.md` / `CLAUDE.md` — build discipline and stable orientation.
4. `.agents/` — current state, plans in flight, guidance that fits nowhere above.

A rule written in two places will drift; put it in the highest layer it belongs to and
reference it from below. Promote durable rationale upward when work lands: design rules
to `spec/`, decisions to ADRs (where the project keeps them), behavior to code and tests.
One more promotion path: when an `agent-notes.md` entry is *operational* (a procedure an
agent should execute) rather than *informational* (context an agent should know), promote
it to a harness skill — per-repo `.claude/skills/` for project procedures, `~/.claude/`
skills for portfolio-wide ones — and leave a pointer in `agent-notes.md`.

## Standard files

- `README.md` — routing guide only: what's in this directory and where to start. Not a
  status ledger. Contains the Persistence block (see below).
- `current-state.md` — shortest resumption context: what landed most recently, where it
  lives, the next step. Budget: readable in one pass, ~200 lines. When it exceeds that,
  delete detail that code, spec, tests, or git history now carry.
- `agent-notes.md` — durable agent-facing working guidance for this repo that is not
  code, spec, or build discipline (e.g. style feedback, tooling lessons). Each entry:
  what happened, why it matters, how to apply.
- `deferred-items.md` — accepted limitations and deliberately deferred work, each with
  the reason. Remove items once done, encoded upstream, or explicitly dropped.
- `plans/<slug>-plan.md` — one file per substantial line of work: decisions, sequencing,
  acceptance criteria. Delete (or collapse to a short closing record) when the work lands
  and its durable rationale has been promoted. Prefer a new focused plan over growing a
  broad historical tracker.
- Optional, as needed: `analysis/` (dated point-in-time reviews, `YYYY-MM-DD.md`, each
  stating its provenance), `research/` (private research records and tools).

Do not use a harness-provided per-user memory store for project memory; if a harness
offers one, it may hold only a pointer to `.agents/`.

## Maintenance rules

- **Edit in place; history replaces narrative.** The directory is under git (marrow).
  Correct and delete freely — do not append "later that same day…" correction ledgers or
  keep superseded text for the record. The record is `git log`.
- **Progress logs collapse when work lands.** A landed plan keeps its final state and a
  short "what shipped" note, not the round-by-round history.
- **Sync deliberately.** Commit with a real one-line summary via `marrow sync` at session
  end (see Persistence). Automation backstops forgotten syncs with timestamp messages;
  it is the floor, not the norm.
- **Freshness is semantic, not only git state.** When asked whether `.agents/` is up to
  date, check that `current-state.md`, active plans, and `deferred-items.md` agree with
  the latest user decision. A clean, synced branch can still be stale if it tells the
  next agent to do superseded work.
- **Nothing here is the sole copy of a *rule*.** Plans, state, and research records live
  here; design rules and build discipline do not.

## Persistence block (standard README section)

Every `.agents/README.md` ends with this block, substituting the project name:

```markdown
## Persistence

This directory is a git worktree of the private `marrow` repo (branch: `<project>`).
It is never committed to the parent repo. Convention: `marrow convention`.

- Before ending a session in which you wrote here:
  `marrow sync <project> -m "<one-line summary of what changed>"`.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows unsynced changes; `marrow doctor` checks the setup.
```
