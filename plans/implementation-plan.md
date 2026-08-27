# marrow — implementation plan

Written 2026-08-26. Standalone: no originating conversation is needed to execute this.
Owner: Gabriel (gxxcastillo). Implementing agents: read `AGENTS.md` first.

## 1. Context and goal

Nine projects under `~/dev` keep agent working memory in a `.agents/` directory —
resumption context, plans, deferred work, research records. The convention is documented
per-repo (best iteration: `~/dev/ossa/.agents/README.md`). Problems this plan fixes:

1. **No backup.** Most `.agents/` directories are gitignored and exist only on this
   machine. ~2.7MB of irreplaceable material (authorization ledgers, research records,
   negative results, private tools) — pho alone is 1.7MB.
2. **Append-only bloat.** With no version control, corrections accrue as inline narrative
   ("later that same day…"). pho's `current-state.md` is 211KB; its README is 43KB.
   Git history is the fix: edit in place, history keeps the record.
3. **Convention drift.** Three generations of the convention exist across projects, with
   inconsistent file names and two projects still committing `.agents/` to their parent
   repos (one of them public).

The fix: each `.agents/` becomes a git worktree of this private repo (`marrow`), on an
orphan branch named after the project. A small CLI (`marrow`) manages adoption, sync,
and health. `CONVENTION.md` (this repo) becomes the single canonical convention document.

### Current inventory (verified 2026-08-26)

| Project | `.agents` size | Parent repo | Visibility | `.agents` git state | Special handling |
|---|---|---|---|---|---|
| pho | 1.7M | gxxcastillo/pho | private | ignored | largest; contains `research/` with code and a `.claude/` empty dir; migrate with extra verification |
| ossa | 28K | gxxcastillo/ossa | private | ignored | none — good first adoption |
| sobremesa | 236K | gxxcastillo/sobremesa | public | ignored | none |
| solid-forms | 132K | gxxcastillo/solid-forms | public | ignored | none |
| ultra-sound-music | 464K | ultra-sound-music/ultra-sound-music | public | ignored | has subdirs `feedback/`, `plans/`, `spec/` |
| embracingroots | 36K | arosefiddle/embracingroots | public | ignored | none |
| c8platform | 40K | c8labs/c8platform | private | **untracked, not ignored** | add `.agents/` to `.gitignore` (commit to parent) during adoption |
| eos | 16K | gxxcastillo/eos | private | **tracked in parent repo** | `git rm -r --cached .agents` + ignore + commit in parent; history retention fine (private) |
| event-link | 60K | gxxcastillo/event-link | **public** | **tracked in parent repo** | untrack + ignore + commit; content stays in public history — **open decision #1** |

`personal-site` and `c8platform-smoke-6725` have no `.agents/` and are out of scope
(`marrow new` covers future projects).

## 2. Design

Superseded by `spec/architecture.md`, which is authoritative on the design model —
including the tool/vault repo split decided 2026-08-26 (§7 Decisions #3; build work in
Phase 2.5 below). Do not restate design content here; if this plan and the spec ever
disagree, the spec wins and this section should be trimmed further to match, not the
other way around.

## 3. Repo layout

Superseded by `spec/architecture.md` → "Repo layout", which now describes two trees (the
`marrow` tool repo and the separate vault repo) instead of one.

## 4. CLI specification

Superseded by `spec/cli.md`, which is authoritative on every command's arguments,
options, behavior, output, and exit codes — including the path changes from the Phase 2.5
tool/vault split.

## 5. Testing

- `bun test`. Fixtures build throwaway stand-ins for both repos in the two-repo design: a
  fake tool root (for `templates/`/`CONVENTION.md` resolution) and a fake bare vault (a
  fake `MARROW_DEV_ROOT` with 2–3 fake project repos — one ignoring `.agents`, one
  untracked, one tracking it — plus a `file://` bare repo as the vault's own `origin`).
  Phase 0–2's fixtures already do the vault half of this; Phase 2.5 adds the tool-root
  half.
- End-to-end per command: adopt (happy path, each precondition failure, dry-run,
  content-preservation check including dotfiles), sync (dirty/clean, custom message,
  offline push, `--auto` exit code), status, doctor (each failure mode), new, grep.
- A test must fail if adopt ever loses a file (compare recursive listings).
- Guard: tests refuse to run if `MARROW_HOME` resolves to the real vault location
  (`~/dev/marrow` originally; `~/.marrow` from Phase 2.5 on).

## 6. Phases

**Phase 0 — bootstrap.** `git init` done (2026-08-26). Initial commit of the docs already
in the repo. Create the remote **after Gabriel's explicit go-ahead**: `gh repo create
gxxcastillo/marrow --private --source ~/dev/marrow --push`; verify visibility is PRIVATE.
*Accept: `git log` shows the docs commit; `gh repo view` shows PRIVATE.*

**Phase 1 — core.** `git.ts` wrapper + `status` + `sync` working against test fixtures.
*Accept: all Phase-1 tests green; `marrow status` runs against the real (still empty)
vault without error.*

**Phase 2 — lifecycle.** `adopt`, `new`, `doctor`, `grep`, `convention`, the templates,
PATH shim. *Accept: full test suite green, including the content-preservation and
precondition tests; `marrow adopt --dry-run ossa` prints a correct plan against the real
tree (read-only).*

**Phase 2.5 — tool/vault repo split (retrofit).** Decided 2026-08-26, see §7 Decisions
#3. Inserted between Phase 2 and Phase 3 — not renumbered further out, so existing
cross-references to Phase 3/4/5 elsewhere (`AGENTS.md`, `spec/architecture.md`) stay
valid — because Phase 3 must not begin migrating real projects into a vault structure
that's about to move. The shipped Phase 0–2 code still implements the original one-repo
design; `spec/architecture.md` already describes the target two-repo design as of this
plan revision, so until this phase lands, spec and code are intentionally out of sync
(see `README.md` → Status for current ground truth).

1. Create the vault as a **bare** git repo at `~/.marrow/vault.git` by default.
   `MARROW_HOME` continues to be overridable, and now names the `~/.marrow`-style parent
   directory (containing `vault.git/`, `backups/`, `logs/`), not the bare repo itself.
2. `backups/` and `logs/` move to `~/.marrow/backups/` and `~/.marrow/logs/`, as siblings
   of `vault.git/` outside any git working tree — neither needs a `.gitignore` entry
   anymore, since there's no enclosing repo to accidentally track them into.
3. `gh repo create gxxcastillo/marrow-vault --private` — requires Gabriel's explicit
   go-ahead, the same gate Phase 0 used for the tool repo's remote. Verify
   `gh repo view gxxcastillo/marrow-vault --json visibility` is PRIVATE before the first
   push.
4. Re-point every git-invoking command (`git.ts`, and the `adopt`/`new`/`sync`/`doctor`
   commands built on it) at `<MARROW_HOME>/vault.git` as the actual repo path.
5. Drop the `branch !== "main"` filter in `listProjectWorktrees` — a bare vault has no
   `main` worktree to exclude, so every registered worktree is a real project by
   construction.
6. Resolve `templates/` and `CONVENTION.md` relative to the running tool's own install
   location, independent of `MARROW_HOME` — `adopt`, `new`, and `convention` all need
   this change; today they read from `MARROW_HOME`, which stops being where the tool's
   own files live.
7. Update `doctor`'s origin/reachability/visibility checks to target the vault repo
   specifically — the tool repo's own git hygiene isn't marrow's concern, the same as it
   isn't marrow's job to audit `pho`'s or `ossa`'s own repos.
8. Update test fixtures to build a throwaway tool root *and* a throwaway bare vault
   (instead of one merged fixture — see §5 Testing); extend the `MARROW_HOME` real-path
   guard to also refuse resolving to the real `~/.marrow`.
9. Update `README.md`/`AGENTS.md` install instructions for the new vault bootstrap step.

*Accept: full test suite green against the two-repo fixtures; `marrow adopt --dry-run
ossa` and `marrow doctor` both run correctly against the real split (tool checkout at
`~/dev/marrow`, vault at `~/.marrow/vault.git`); `gh repo view gxxcastillo/marrow-vault`
shows PRIVATE.*

**Phase 3 — migration (ATTENDED, Gabriel approving each project).** Depends on Phase 2.5
landing first. Order:
1. `ossa` (small, clean) — adopt, then verify: file diff vs. tarball, `git log` on the
   branch, README block present, project session still reads `.agents/` normally.
2. `solid-forms`, `embracingroots`, `c8platform` (fix its `.gitignore` per
   `spec/cli.md` → `adopt`), `ultra-sound-music`, `sobremesa`.
3. `pho` — after the pattern is proven. Extra care: 1.7M, contains `research/` code and
   an empty `.claude/` dir; verify counts match exactly.
4. `eos` — manual untracking first (in eos: `git rm -r --cached .agents`, add to
   `.gitignore`, commit), then adopt.
5. `event-link` — same untracking flow (decision #7.1: untrack going forward, no
   history rewrite).
*Accept: `marrow doctor` fully green; `marrow status` shows nine clean, pushed projects.*

**Phase 4 — automation + convention rollout.**
- Claude Code `SessionEnd` hook in `~/.claude/settings.json` running `marrow sync --auto`
  (verify hook config shape against current Claude Code docs; show Gabriel the settings
  diff before writing).
- launchd: `~/Library/LaunchAgents/com.gxxcastillo.marrow.plist`, `StartInterval` 1800,
  runs `marrow sync --auto`, stdout/err → `logs/`. Load with `launchctl bootstrap
  gui/$(id -u)`.
- Trim each adopted `.agents/README.md` of convention-restating prose in favor of the
  Persistence block + `CONVENTION.md` pointer (small, per-project judgment; commit via
  `marrow sync`).
*Accept: end a session → commit appears; wait a timer cycle → auto-sync log line; all
nine READMEs carry the block.*

**Phase 5 — deferred (do not build now).** Marrow self-adoption (`marrow` branch for its
own `.agents/`) — structurally unblocked by the Phase 2.5 tool/vault split: once the tool
repo and the vault are separate, self-adoption is an ordinary `marrow adopt marrow`
(worktree of the vault, checked out at `~/dev/marrow/.agents`, `adopt`'s normal
untracked-state handling appends `.agents/` to the tool repo's own `.gitignore`) — no
special-casing needed. Still deliberately deferred, not urgent, just no longer blocked.
Also deferred: beads flush seam in `sync` (pilot beads inside `~/dev/pho/.agents/`
first); compaction passes on pho's oversized files (separate effort, enabled by history).

## 7. Decisions

1. **event-link public history — resolved 2026-08-26.** Do not rewrite history. Untrack
   `.agents/` going forward only (`git rm -r --cached`, ignore, commit); existing content
   stays in the public repo's history.
2. **Tarball retention — resolved 2026-08-26.** Keep `backups/` tarballs until Phase 4
   completes, then Gabriel deletes them manually. (Location moves to `~/.marrow/backups/`
   under Phase 2.5; the retention policy itself is unchanged.)
3. **Tool/vault repo split — resolved 2026-08-26; supersedes the "future split if marrow
   goes public" framing this decision originally held.** The tool (`marrow` — CLI, spec,
   tests) stays at `~/dev/marrow`, a normal dev project like every other. The vault (the
   git-backed `.agents/` data — every project's orphan branches) moves to a separate
   private repo (`gxxcastillo/marrow-vault`), bare, outside `~/dev`, at
   `~/.marrow/vault.git` by default. Motivation: the vault isn't a coding project — it's
   infrastructure backing data that lives distributed across other projects
   (`<project>/.agents`) — and forcing it to share both a directory and a git repo with
   the tool's own source created a real structural problem: marrow could never adopt its
   own `.agents/` without nesting a worktree inside its own main checkout. The split
   resolves that self-hosting collision with zero special-casing (see Phase 5) and
   mirrors the tool-repo/private-workspace separation `~/dev/ossa/spec/architecture.md`
   ("Name And Split") already established for `ossa` — a reusable tool repo plus a
   separate private workspace that need not live under `~/dev` at all. See
   `spec/architecture.md` and Phase 2.5 for the resulting design and build work. Whether
   the tool repo additionally goes fully public later remains separate, still open, and
   still not acted on.

## 8. Out of scope

Beads integration (beyond the documented seam), ossa integration, compaction tooling,
multi-machine sync beyond `git clone` + re-running worktree setup (a `marrow restore`
command may be specced later if a second machine materializes), any daemon beyond
launchd, wrapping any other tool.
