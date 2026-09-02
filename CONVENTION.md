# The .agents/ convention

Canonical structure and maintenance rules for `.agents/` directories. Per-project
`.agents/README.md` files route locally and point here. If they disagree, this file wins.

## Purpose

`.agents/` is private per-project working memory: resumption context, plan lifecycle,
deferred work, agent guidance, and research records. It is gitignored by the parent repo
and backed by the private marrow vault as a git worktree.

Ownership boundary:

1. Marrow preserves private working memory. It does not define or replace a project's
   shared sources of truth.
2. Project instructions identify the authoritative sources for accepted requirements,
   contracts, intended behavior, architecture, operational rules, and team policy when
   those sources are not obvious.
3. `.agents/` owns private working history, progress, plan lifecycle (status, next
   step, dependencies, discovered work), investigations, deferred work, working
   decisions, and resumption context.
4. A task-local decision may remain in `.agents/`. A constraint future contributors
   must honor must be canonized in the appropriate shared source before the work is
   considered complete.
5. Route by what landing the work would change, not by what the document is called: if
   finishing work forces an edit to it — progress, status, next step, in-flight
   sequencing — it is stateful working memory and belongs in `.agents/` or the tracker;
   if only a changed decision would force an edit, it is stateless and a candidate to
   canonize under the rule above. Catching yourself editing a committed document
   because work finished, not because a decision changed, means the document is
   misplaced. Stateful memory never goes in git; a committed spec stays canonical.
6. If `.agents/` conflicts with a designated authority, the designated authority wins.
   If code/tests and a designated authority conflict, treat that as a mismatch to
   reconcile; `.agents/` never adjudicates it.
7. Link from `.agents/` to authoritative material rather than maintaining a second copy
   when practical.
8. Working history may remain private. Historical rationale needed by the wider project
   must be canonized in a shared record. Canonizing is never a license to quote private
   notes verbatim.
9. Project instructions designate that project's authorities; `CONVENTION.md` governs
   `.agents/` structure and maintenance. When the two disagree, the project's
   instructions win on authority designation and `CONVENTION.md` wins on `.agents/`
   itself.
10. Placement, not only precedence: put a rule in the narrowest shared source that
    everyone who must honor it already reads.
11. Audience gate for the stateless half: commit only what the committed doc's actual
    audience must honor — the same test as the rule above, applied to how much of a
    plan's content to commit, not just where one rule goes. A solo maintainer is often
    that whole audience, so the full stateless plan can be committed and designated
    authoritative (personal-project case). A broader audience — a team, or consumers who
    never need execution detail — usually gets only the decisions and contracts; work
    breakdown stays stateless but moves to a narrower shared source (a team doc, the
    issue tracker) instead of the audience-facing one, with embedded decisions still
    canonized individually as they're made.

Examples of shared sources: specs, schemas, ADRs, docs, issue trackers, code/tests, and
project instructions. None is required universally, and no rule here assumes a `spec/`
directory or any other fixed project layout.

**Canonize** a decision or its rationale when future contributors must honor or
rediscover it: move it out of `.agents/` into a durable home that binds them. Future need
decides what gets canonized — not every planning decision becomes project documentation.
The destination is named each time and is usually a shared source above, but not always: a
procedure in `agent-notes.md` is canonized as a harness skill once it is operational enough
to reuse. Same boundary, same test, different home.

A substantial plan is two documents fused: the stateless spec of the work (decisions,
work breakdown, acceptance criteria) and the stateful state of the work (done, next,
discovered). Split them on landing the same way — content to the project's designated
shared source, naming one first if none exists yet for plans; lifecycle to
`.agents/plans/` or the tracker.

## Parent instruction block

Every committed parent instruction file that points at `.agents/` uses this canonical
block. The source template is `templates/agents-block.md`. A material wording change
updates the template and tests in the same commit.

```markdown
> [!NOTE]
> **Agent working memory:** Read [`.agents/README.md`](.agents/README.md) before
> non-trivial work — coding or not — and keep it current as you go. It holds private
> working state; it does not replace the project's designated shared sources of truth.
```

This text is strict-verbatim; project-specific policy lives outside this block. `attach` keys
off the text itself: a note matching the template exactly is left alone, any recognized note
that differs is replaced in place with the current text, and prose with no recognizable note
at all is treated as missing. A note is recognized by its opener and its link to
`.agents/README.md`, so wording may drift without stranding it — there is no trailing version
tag in the note itself. The version the note was last written against lives in
`.agents/README.md`'s version ledger instead (see `## Version ledger` below), updated in the
same step `attach`/`refresh` replace the note. That recorded version labels the repair; it
does not decide whether one happens, so a template fix reaches every attached project on its
next `attach`/`refresh` without a version bump. Bump the version when the meaning changes, not
for every edit.

## Files

Every `.agents/` directory contains:

- `README.md` — routing guide, the version ledger, and the Persistence block. It is the
  entry point and marrow's own bookkeeping, not an artifact: the types below do not
  classify it, and `detach` strips its ledger and block.
- `current-state.md` — shortest resumption context: what landed, where it lives, next
  step.

### The five types

The convention admits five artifact types. A file's type is its home, never its content:
marrow recognizes a type only by where the file sits, and a reader gets the same answer
the same way.

| type       | home                                    | shape       | holds                                          |
| ---------- | --------------------------------------- | ----------- | ---------------------------------------------- |
| `state`    | `current-state.md`, `deferred-items.md` | named files | where the work is now                          |
| `guidance` | `agent-notes.md`                        | named file  | how to work in this repo                       |
| `plan`     | `plans/<slug>.md`                       | directory   | the stateful half of substantial active work   |
| `research` | `research/<slug>.md`                    | directory   | evidence generated to answer an open question  |
| `analysis` | `analysis/<slug>.md`                    | directory   | judgment reached over evidence already in hand |

The two shapes behave differently, and the difference is what keeps this vocabulary from
prescribing anything. `state` and `guidance` are named files: one file, one job, and only
`current-state.md` is required. `plan`, `research`, and `analysis` are directories holding
many. A directory a project has never needed is **absent, not missing** — a project that
has done no research is not out of compliance, and `doctor` never fails a project for a
type it does not have.

- `deferred-items.md` — accepted limitations and deliberately deferred work, each with
  the reason. Remove items once done, canonized upstream, or dropped.
- `agent-notes.md` — private agent-facing guidance that is not code, spec, or build
  discipline.
- `plans/<slug>.md` — a plan's stateful half only: status, next step, dependencies,
  discovered work. Link to the stateless half (decisions, work breakdown, acceptance
  criteria) in its designated shared source rather than duplicating it here. Use only for
  substantial active work. A plan waiting on the user also carries the blocked-on-you line
  below. Delete or collapse it when the work lands and any rationale future contributors
  need has been canonized. The filename carries the subject, not the type — the directory
  already says `plan`, so a `-plan` suffix only stutters. Files that already carry one are
  fine and need no rename.

### Research and analysis

Research produces evidence; analysis produces judgment. A pilot, spike, survey, or
experiment is research: the answer is not in hand, so data gets generated. An audit,
review, assessment, or reconciliation is analysis: the material already exists and a
verdict is reached over it.

The two form a loop, not a sequence. Analysis finds the evidence missing, research
generates it, analysis judges what came back — and that may cycle several times or never
start at all. Only the exits are one-way: into a `plan` when judgment is settled enough to
commit to action, into `state` as the record of what happened, and out of `.agents/`
entirely when something must bind future contributors, which is canonizing.

Research is the only type that owns a workspace, and that follows from the definition:
generating evidence needs apparatus, reaching judgment needs prose. A research record may
own one — `research/<slug>.md` alongside a `research/<slug>/` directory holding the
scripts, fixtures, and outputs that record depends on. The workspace is an attachment to
that artifact, not an artifact itself: nothing here defines types for what goes inside it,
and no rule below applies to its contents. Keep it beside the record that explains it,
delete it with that record, and remember that everything in `.agents/` is pushed on every
sync and searched by every `marrow grep` — a workspace that has become large or purely
generated is a candidate for the project's own repo, ignored scratch space, or deletion.
`marrow status` reports a worktree over 5MB as heavy for this reason.

### Moving between types

Material that changes kind is **recast** — rewritten into the new type's shape, not moved.
A research finding becomes a plan by being written as one.

A file already of its type but in the wrong place is **refiled** — moved, content
untouched. `doctor`'s `move them into plans/` names a refile.

Neither is canonizing. Canonizing leaves `.agents/`; recasting and refiling stay inside it.
`attach` and `adopt` are marrow's own operations rather than movements of material:
`attach` brings a project's `.agents/` under the vault, and `adopt` is the path `attach`
takes when one is already there. A team choosing to use marrow is "adopting marrow" in
ordinary English, unrelated to either.

### `.agents/` holds no spec

Do not create `.agents/spec/`. If the content is a spec it belongs in the project's spec,
committed — see rule 11 for the personal-project case, where a solo maintainer is the whole
audience and the stateless whole can be committed and designated authoritative. If it is
not a spec it belongs in one of the five types above. A directory named for a destination
it has not reached makes stalled canonizing look like conformance, and its contents drift:
they read as authoritative while being neither committed nor current.

### Admitting a sixth type

The five above are the set. A sixth is admitted only when all of these hold:

1. **Distinct lifecycle** — a different trigger to create it, to delete it, and to go
   stale. Same triggers as an existing type means it is a variant of that type and lives
   in that home.
2. **Not grouped by origin** — a tool, an agent, or an author is not a type. Every tool
   taken up wants a directory of its own and each request is individually reasonable;
   that is how five types become fifteen.
3. **Not already routed** — if a rule here already says where the material goes, follow
   the rule.
4. **Seen independently in several projects** — grounds to hear the question, never
   grounds to answer it yes.

Default is no. Two worked examples, both declined. A directory holding one tool's issue
export beside a dated log of that tool's trial fails (1) — two lifecycles in one directory
— and (2). A `spec/` directory fails (3) against the rule above.

Do not use harness-provided per-user memory for project memory except as a pointer to
`.agents/`.

## Blocked-on-you line

A plan whose next action belongs to the user, not to an agent, carries one line directly
under its title:

```
Blocked on you: <what is needed, one line> (YYYY-MM-DD)
```

`Blocked on you:` is strict-verbatim so the line stays greppable across projects. The rest
is free text and may wrap, but keep the essential ask on the first physical line, since that
is what a grep prints. The date is when the line was written. It is a separate line from any
`Status:` the plan already keeps — a plan can be in progress and blocked at once, and
overwriting a substantive status to record a blocker loses state. This convention does not
standardize `Status:` itself.

Use the line only when the next action is the user's: it needs credentials or authority
they alone hold, needs physical or judgment verification, or waits on their review. A plan
that merely runs attended does not qualify — being present while an agent works is an
execution mode, not a handoff. Neither does work that is paused, unstarted, or blocked on
something other than the user.

Say what is actually needed. A line the user cannot act on without reconstructing context
is not finished. If the ask is self-contained, the line is enough; if it is not, the line
names the phase or section holding the steps, and that phase is written for the person who
has to run them: what to do, what to expect, what to report back. Delete the line when the
work resumes, leaving any `Status:` line alone. While it stands, `current-state.md`'s next step
names the plan.

## Maintenance

- Update on events, not at session end. When work lands, a decision is made, or a plan
  changes status, update `current-state.md` (and the affected plan) in the same working
  step, then sync: `marrow sync <project> -m "<one-line summary>"`. The task is not done
  until memory agrees with reality. Sessions end without warning — never defer memory
  updates to a wrap-up pass.
- Stamp freshness. `current-state.md` opens with
  `As of YYYY-MM-DD (<parent repo> @<short-sha>)`, refreshed with every content update.
  Use `@no-HEAD` only when the parent has no commit to name.
- Anchor regenerable evidence. A plan or research record that treats raw output (a
  rerun, a report file, a sweep) as disposable because it is cheap to regenerate must
  still name what it depended on — commit/tree-state, config, or data/fixture version —
  next to the summarized result. Without that anchor, "just rerun it" stops being a
  checkable claim once the code has moved on.
- Repair on read. At session start, check the stamp against `git log` (parent repo and
  `.agents/`) before trusting `current-state.md`; if reality has moved past it, reconcile
  before building on it. A clean branch can still be stale, and `current-state.md`,
  active plans, and `deferred-items.md` must agree with the latest user decision.
- Apply conventions on touch, not on sight. A `.agents/` directory that predates a rule
  is not out of compliance. When you edit a file the rule governs, bring that file into
  line in the same step — you have already done the reasoning the rule needs. Do not
  sweep a directory to conform it: retrofitting a judgment-bearing rule across files you
  have not reasoned about invents state. Mechanical conformance — canonical blocks,
  required files, stamp format — is `attach`'s and `doctor`'s job, not a reading agent's. A
  deliberate migration is a plan, run attended.
- Edit in place. Git history replaces inline correction ledgers.
- Collapse progress logs when work lands. Keep final state, not round-by-round history.
  Discard pure execution history; git retains it. Move dated evidence that remains useful
  to an `analysis/` record and link that record from `current-state.md` when it still
  matters to resumption.
- Do not leave `.agents/` as the sole copy of a rule future contributors must honor —
  canonize it in the appropriate shared source first.

## Version ledger

`.agents/README.md` opens with a YAML frontmatter block — its literal first bytes,
ahead of the `#` title — recording the version of each marrow-authored template block
present in the file:

```markdown
---
marrow-versions:
  persistence-block: 4
  agents-note: 4
---
```

This ledger holds marrow's own template versions only — never project-specific
metadata. It is how `doctor`/`refresh` label a repair (`v<old> -> v<new>`) once a note
or block no longer carries its own inline tag; the version tag itself has been dropped
from both templates for exactly this reason (see `## Parent instruction block` and
`## Persistence block`). `detach`'s default mode removes the whole ledger, along with
the frontmatter delimiters if nothing else remains in them, since a detached project's
retained files should carry no marrow bookkeeping at all.

## Persistence block

Every `.agents/README.md` ends with this block, substituting the project name:

```markdown
<!-- marrow:persistence-block -->
## Working memory via marrow

This directory is a git worktree of the private marrow vault (branch: `<project>`).
It is never committed to the parent repo. Convention: `marrow convention`.

- Updating this directory is part of finishing work, not a wrap-up chore: when work
  lands, a decision is made, or a plan changes status, update `current-state.md` in the
  same step, then `marrow sync <project> -m "<one-line summary of what changed>"`.
- Canonize decisions and rationale that future contributors must honor: move them out
  of here into the appropriate shared source. Collapse or discard task-local planning
  context when it is no longer useful.
- On session start, check `current-state.md`'s `As of` stamp against `git log`;
  reconcile before building on stale state.
- Edit files in place; git history replaces inline correction narrative.
- `marrow status` shows memory needing attention; `marrow doctor` verifies
  marrow's setup and safety.
<!-- /marrow:persistence-block -->
```

Its own version — a template-boilerplate detail, not something a reader of the file
needs — lives only in the version ledger above, not inline in the fence.
