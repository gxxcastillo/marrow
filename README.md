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

## Dependencies

`bun` and git 2.42+.

## Install

Without a local checkout:

```
curl -fsSL https://raw.githubusercontent.com/gxxcastillo/marrow/main/bin/install | bash
```

Clones the tool to `~/.local/share/marrow`, then runs the step below. Safe to re-run —
it updates the existing clone in place. `bin/uninstall` reverses it: removes the clone
and its `~/.local/bin/marrow` symlink, but leaves the vault (your project data)
untouched.

With a local checkout:

```
bin/setup
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
