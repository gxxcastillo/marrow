# marrow

Private git backing for the `.agents/` working-memory directories across `~/dev` projects.

Each project's `.agents/` stays gitignored by its parent repo but becomes a git worktree of
a separate private vault repo, on a stable branch derived from the parent repo's identity. git history replaces
the append-only narrative style the directories used before.

marrow is two repos, not one — see `spec/architecture.md` → "Two repos: tool and vault"
for the full rationale:

- **This repo — the tool.** A small Bun/TypeScript CLI (`marrow`) that adds (creating,
  adopting, or attaching), syncs, and checks the worktrees, plus `CONVENTION.md` (the single canonical
  description of how `.agents/` directories are structured and maintained — per-project
  READMEs point here instead of restating it) and this spec. An ordinary dev project,
  lives at `~/dev/marrow` like everything else under `~/dev`. Design, CLI contract, and
  safety guarantees: `spec/README.md`.
- **The vault — a separate repo, outside `~/dev`.** Holds nothing but data: one orphan
  branch per adopted project (`pho`, `ossa`, `sobremesa`, …), each checked out as a
  worktree at `<project-path>/.agents`. Branches never merge with each other or with
  this repo's `main`. It is not a coding project, which is exactly why it doesn't live
  alongside the ones that are.

The vault must remain **private**: the project branches contain personal planning
content, including for projects whose own repos are public.

## Install

```
bin/install
```

To set up another machine from an existing vault:
```
bin/install --from git@github.com:gxxcastillo/marrow-vault.git
marrow add ~/dev-stuff-and-things/ossa
```

Symlinks `bin/marrow` onto `~/.local/bin`, then runs `marrow init` to create the vault as
a bare repo at `MARROW_HOME` (default `~/.marrow`). Safe to re-run — both steps are no-ops
if already done, and it refuses to overwrite a non-marrow file already at the symlink
target. It never touches the vault's GitHub remote — that's a separate step gated on
explicit go-ahead, see `AGENTS.md` → Safety rules.

Equivalent by hand:
```
ln -s <this-checkout>/bin/marrow ~/.local/bin/marrow
marrow init
```

`MARROW_HOME` (vault parent, default `~/.marrow`) is overridable — see
`spec/architecture.md` → "Env overrides".

## Status

Phase 2.5 shipped: the code matches `spec/`'s two-repo design — this repo (the tool) stays
at `~/dev/marrow`; the vault is a separate bare repo at `~/.marrow/vault.git`, with
`~/.marrow/backups/` and `~/.marrow/logs/` alongside it. `templates/` and `CONVENTION.md`
resolve from the tool's own install location, not from `MARROW_HOME`, so `marrow` works
correctly regardless of where the vault lives.

Phase 3's local, attended migration is complete. The initial inventory — `ossa`,
`solid-forms`, `embracingroots`, `c8platform`, `ultra-sound-music`, `sobremesa`, `pho`,
`eos`, and `event-link` — is attached to the local vault. Each adoption has its backup
tarball under `~/.marrow/backups/`.

The vault has no remote yet. Creating or connecting its private remote remains gated on
Gabriel's explicit approval. Until then, branches are local-only and `marrow doctor`
reports `WARN no 'origin' remote configured` by design. The one-time migration record and
the remote-lifecycle plan live in `.agents/plans/`.

### Everyday commands, once projects are adopted

```
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow sync ossa -m "weekly review"    # one project, a real message
marrow grep "TODO" -C2                 # search across every adopted project
marrow doctor                          # full health check
marrow --help                          # command list; <command> --help for one
```

Full command reference: `spec/cli.md`. Safety guarantees: `spec/safety.md`.
