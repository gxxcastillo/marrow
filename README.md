# marrow

marrow privately versions and syncs per-project agent working memory without putting that
memory in each project's own git history. Adopted projects get a vault-backed worktree
for their local memory directory, one private branch per project.

marrow preserves private working memory. It does not define or replace a project's
shared sources of truth.

This repo is the CLI tool. The vault is a separate repo under `MARROW_HOME` (default
`~/.marrow`) that holds the memory branches and must stay **private**. See
`spec/architecture.md` → "Two repos: tool and vault" for the full design, including the
`.agents/` directory convention.

## Requirements

- [Bun](https://bun.sh) and git 2.42+ (needed for `git worktree add --orphan`).
- [`rg`](https://github.com/BurntSushi/ripgrep) (ripgrep), required for `marrow grep`.
- [`gh`](https://cli.github.com) (GitHub CLI), required for `marrow publish` and for
  `marrow doctor`'s full private-visibility verification. Without it, doctor still runs
  but can't confirm the vault's GitHub remote is actually private.

Developed and tested on macOS; CI (see `.github/workflows/ci.yml`) also covers Linux.
Native Windows is not supported or claimed — WSL should work like Linux but is untested.

## Install

Without a local checkout:

```
curl -fsSL https://raw.githubusercontent.com/gxxcastillo/marrow/main/bin/install | bash
```

Clones the tool to `~/.local/share/marrow`, then runs the step below. Safe to re-run —
it updates the existing clone in place, reporting `already up to date` or exactly what
changed. `bin/uninstall` reverses it: removes the clone and its `~/.local/bin/marrow`
symlink, but leaves the vault (your project data, under `MARROW_HOME`) untouched. The
tool checkout and the vault intentionally live on separate deletion boundaries — one is
disposable, the other is not (`spec/architecture.md` → "Two repos: tool and vault").

With a local checkout:

```
bin/setup
```

Symlinks `bin/marrow` onto `~/.local/bin` and creates the vault at `MARROW_HOME`
(default `~/.marrow`). Safe to re-run.

Either way, confirm the install:

```
marrow --version
marrow doctor
```

`doctor` on a brand-new vault reports a clean, empty state — that's expected before you've
adopted anything.

## Keeping marrow itself up to date

```
marrow update
```

Re-runs the managed install's own updater (`bin/install`) — one updater implementation,
whether you invoke it through `marrow update` or by re-running the curl command above.
It refuses to run from a local development checkout (this repo cloned and run directly);
update that with `git pull` instead. It never resets a checkout with local changes, and
it doesn't require a vault to exist.

## First adoption

marrow starts with only a **local** vault — nothing has been pushed anywhere yet. A
local-only vault is fully usable for a single machine; `marrow publish <owner>/<repo>`
is a separate, explicit step for when you want a private GitHub remote (for backup or a
second machine). Nothing in first adoption requires it.

Preview before touching a real project:

```
marrow add /path/to/project --dry-run
```

Then for real:

```
marrow add /path/to/project
```

If the project has no existing `.agents/`, this creates one fresh — no mutation of
anything that already exists. If it **does** have an existing `.agents/`, live adoption:

- moves that directory into a new vault-backed worktree, after writing a verified backup
  tarball under `<MARROW_HOME>/backups/` (`spec/safety.md` → "Backup before mutate");
- may edit the parent project's `.gitignore`, `.codex/config.toml`,
  `.claude/settings.json`, and `AGENTS.md`/`CLAUDE.md` — printed, never committed; you
  review and commit those changes yourself.

**Adopting an existing `.agents/` is attended-only** — run it yourself, watching the
output; don't script or automate that step (`spec/safety.md` → "Attended operation").

## Everyday commands

```
marrow add /path/to/project            # adopt a project into the vault
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow grep "TODO" -C2                 # search across every adopted project
marrow doctor                          # full health check
marrow update                          # update the managed install (refuses a dev checkout)
marrow --help                          # command list; <command> --help for one
```

Full command reference, including multi-machine and remote setup: `spec/cli.md`. Design:
`spec/architecture.md`. Safety guarantees: `spec/safety.md`. Working-memory convention:
`CONVENTION.md`.

## Limits

marrow does not canonicalize symlinked paths before writing (no symlink hardening), and
it has no concept of secrets — it never scans or redacts anything. Don't put credentials
in `.agents/`. Full accepted-gaps list: `spec/safety.md` → "Known gaps".

## License

MIT — see `LICENSE`.
