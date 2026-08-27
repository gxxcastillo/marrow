# marrow

marrow privately versions and syncs per-project agent working memory without putting that
memory in each project's own git history. Adopted projects get a vault-backed worktree
for their local memory directory, one private branch per project.

This repo is the CLI tool. The vault is a separate repo under `MARROW_HOME` (default
`~/.marrow`) that holds the memory branches and must stay **private**. See
`spec/architecture.md` → "Two repos: tool and vault" for the full design, including the
`.agents/` directory convention.

## Dependencies

`bun` and git 2.42+.

## Install

```
bin/install
```

Symlinks `bin/marrow` onto `~/.local/bin` and creates the vault at `MARROW_HOME`
(default `~/.marrow`). Safe to re-run.

## Everyday commands

```
marrow add /path/to/project            # adopt a project into the vault
marrow status                          # what's dirty, what's unpushed
marrow sync                            # commit + push everything dirty
marrow grep "TODO" -C2                 # search across every adopted project
marrow doctor                          # full health check
marrow --help                          # command list; <command> --help for one
```

Full command reference, including multi-machine and remote setup: `spec/cli.md`. Design:
`spec/architecture.md`. Safety guarantees: `spec/safety.md`. Working-memory convention:
`CONVENTION.md`.
