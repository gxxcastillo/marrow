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

- **Self-hosted vault.** `main` = tool + docs. One orphan branch per project, branch name
  = project directory name. Worktree checked out at `~/dev/<project>/.agents`.
- **Zero config; worktrees are the registry.** `marrow status`/`sync`/`doctor` discover
  projects from `git worktree list --porcelain` run in `MARROW_HOME`, excluding the main
  checkout. No config file. A worktree whose path doesn't match
  `<MARROW_DEV_ROOT>/<branch>/.agents` is a `doctor` error, not a supported state.
- **Branches never merge.** No shared history between `main` and project branches, or
  between project branches. Cross-project search is `marrow grep`, not git.
- **Deliberate syncs are primary; automation is the floor.** Agents working in a project
  run `marrow sync <project> -m "<summary>"` at session end (per the Persistence block in
  each `.agents/README.md`). A Claude Code `SessionEnd` hook and a launchd timer run
  `marrow sync --auto` as backstops.
- **Env overrides** (primarily for tests): `MARROW_HOME` (vault repo path, default
  `~/dev/marrow`), `MARROW_DEV_ROOT` (projects root, default `~/dev`).

Push races are structurally impossible between projects (disjoint branches). Concurrent
syncs of the same project serialize on git's own locks; treat a lock failure as a retryable
warning, not an error.

## 3. Repo layout (main branch)

```
marrow/
├── README.md
├── AGENTS.md
├── CONVENTION.md            # canonical .agents convention (already drafted)
├── plans/implementation-plan.md
├── templates/
│   ├── readme-seed.md       # seeds `marrow new`
│   └── persistence-block.md # appended to adopted READMEs
├── src/
│   ├── cli.ts               # entry, arg parsing (node:util parseArgs), dispatch
│   ├── git.ts               # thin Bun.spawn git wrapper; worktree discovery
│   └── commands/…           # one small module per command (or fold into cli.ts if tiny)
├── test/                    # bun test; fixtures in temp dirs only
├── bin/marrow               # `#!/usr/bin/env bun` shim importing src/cli.ts
├── package.json             # name, bin entry; no dependencies
├── .gitignore               # backups/, logs/, node_modules/
├── backups/                 # tarballs made by adopt (gitignored)
└── logs/                    # sync logs (gitignored)
```

Install: symlink `bin/marrow` into a PATH dir (`ln -s ~/dev/marrow/bin/marrow
~/.local/bin/marrow` or `bun link`). Record whichever is used in README.

## 4. CLI specification

Global behavior: plain text output, one line per project where applicable. Exit 0 on
success, 1 on any error, except `--auto` mode (below). Unknown command or bad args →
usage to stderr, exit 2.

### `marrow status`
For each project worktree: branch, clean/dirty (count of modified+untracked), ahead/behind
origin, last commit date + subject. One summary line at the end. Read-only.

### `marrow sync [project…] [-m <message>] [--auto]`
For each target (default: all project worktrees): if dirty, `git add -A` + commit.
Message: `-m` value prefixed with `<project>: `, else `<project>: sync <ISO-8601 local>`.
Then a single `git push origin --all` from `MARROW_HOME` (skip if no `origin`, warn).
`--auto`: for hook/timer use — quiet, auto-message only, always exit 0, log one line per
action to `logs/sync.log`, tolerate offline push failures with a logged warning.
Future seam (do not build now): if `<worktree>/.beads/` exists, run the beads JSONL
flush before committing (exact command TBD during the beads pilot — plan Phase 5).

### `marrow adopt <project> [--dry-run]`
`<project>` = name resolved against `MARROW_DEV_ROOT`, or a path. Algorithm:

1. Preconditions (abort with a clear message if any fail):
   - `<project>/.agents` exists and is a directory, not already a worktree of this repo
     (no `.git` file/dir inside it).
   - No branch named `<project>` exists in marrow.
   - Parent repo state: if `.agents` is ignored → OK. If untracked and not ignored →
     append `.agents/` to the parent's `.gitignore` and tell the user to commit that
     change (do not commit in the parent repo yourself). If **tracked** → print the
     required untracking steps and abort; untracking is a manual, attended step (see
     migration table).
2. Backup: `tar -czf backups/<project>-<ISO-date>.tar.gz -C <project> .agents`. Verify the
   tarball is non-empty and lists successfully. Never proceed on backup failure.
3. Move `<project>/.agents` → `<project>/.agents.pre-marrow` (rename, same volume).
4. `git worktree add --orphan -b <project> <project>/.agents` (git ≥ 2.42; verify the
   installed git supports this form, otherwise use the documented
   `git switch --orphan` fallback in a temp worktree).
5. Move contents of `.agents.pre-marrow/` into the new worktree (including dotfiles),
   remove the now-empty `.agents.pre-marrow`.
6. Append `templates/persistence-block.md` (with `<project>` substituted) to
   `.agents/README.md` (create the README from the template seed if absent).
7. Commit: `<project>: adopt into marrow` and push the branch.
8. Print a verification summary: file count and total size before (from the tarball
   listing) vs. after in the worktree — they must match (± the README block).
`--dry-run`: run step 1, then print what steps 2–7 would do. Keep tarballs until Gabriel
deletes them; `doctor` lists tarballs older than 30 days as a reminder.

### `marrow new <project>`
For a project with no `.agents/`: same as adopt steps 4, 6, 7 but starting from the
`templates/readme-seed.md` skeleton. Fails if `.agents` already exists (use adopt).

### `marrow doctor`
Checks, one line each, exit 1 if any fail: every project branch has a worktree at the
conventional path and vice versa; each worktree's parent repo ignores `.agents`; `origin`
exists, is reachable, and is **private** (`gh repo view --json visibility` when `gh` is
available; warn-only if `gh` is absent); no branch is unpushed by more than N commits
(warn); stale `backups/` tarballs (warn); `bin/marrow` on PATH (warn).

### `marrow grep <pattern> [rg-args…]`
`rg --hidden --no-ignore <pattern>` across all project worktree paths, excluding `.git`.
Falls back to `grep -rn` if `rg` is absent.

### `marrow convention`
Prints `CONVENTION.md` to stdout.

## 5. Testing

- `bun test`. Fixtures: build a fake `MARROW_DEV_ROOT` in a temp dir with 2–3 fake
  project repos (one ignoring `.agents`, one untracked, one tracking it) and a fake
  `MARROW_HOME` vault with a file:// bare repo as `origin`.
- End-to-end per command: adopt (happy path, each precondition failure, dry-run,
  content-preservation check including dotfiles), sync (dirty/clean, custom message,
  offline push, `--auto` exit code), status, doctor (each failure mode), new, grep.
- A test must fail if adopt ever loses a file (compare recursive listings).
- Guard: tests refuse to run if `MARROW_HOME` resolves to the real `~/dev/marrow`.

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

**Phase 3 — migration (ATTENDED, Gabriel approving each project).** Order:
1. `ossa` (small, clean) — adopt, then verify: file diff vs. tarball, `git log` on the
   branch, README block present, project session still reads `.agents/` normally.
2. `solid-forms`, `embracingroots`, `c8platform` (fix its `.gitignore` per §4),
   `ultra-sound-music`, `sobremesa`.
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
own `.agents/`); beads flush seam in `sync` (pilot beads inside `~/dev/pho/.agents/`
first); compaction passes on pho's oversized files (separate effort, enabled by history).

## 7. Decisions

1. **event-link public history — resolved 2026-08-26.** Do not rewrite history. Untrack
   `.agents/` going forward only (`git rm -r --cached`, ignore, commit); existing content
   stays in the public repo's history.
2. **Tarball retention — resolved 2026-08-26.** Keep `backups/` tarballs until Phase 4
   completes, then Gabriel deletes them manually.
3. **Open: future split** if marrow-the-tool should ever go public: fork `src/` out to a
   public repo, keep this one as the private data vault. No action now; noted so the
   one-repo choice isn't mistaken for permanent.

## 8. Out of scope

Beads integration (beyond the documented seam), ossa integration, compaction tooling,
multi-machine sync beyond `git clone` + re-running worktree setup (a `marrow restore`
command may be specced later if a second machine materializes), any daemon beyond
launchd, wrapping any other tool.
