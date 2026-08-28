# .agents routing guide — {{project}}

Purpose: route agents to this project's working memory quickly. Structure and maintenance
rules: `marrow convention` (canonical; this file does not restate it).

## Ownership

This directory owns private working history, progress, plans, investigations, deferred
work, working decisions, and resumption context. The project's designated shared sources
remain authoritative for accepted requirements, contracts, intended behavior, architecture,
operational rules, and team policy.

## Start here

- `current-state.md` — shortest resumption context: what landed most recently, where it
  lives, the next step.

Other files are optional. Common choices are:

- `agent-notes.md` — private agent-facing working guidance for this repo.
- `deferred-items.md` — accepted limitations and deferred work, each with the reason.
- `plans/` — one focused plan file per substantial line of work.
