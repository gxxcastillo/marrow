# marrow spec

Canonical description of how marrow works: its design model, its CLI contract, and its
safety guarantees. Each file is self-contained and cross-links the others. This spec
describes the system as it exists today — no changelog sections, no "previously this
was X" notes; git history is the record of how it got here.

marrow gives each project's `.agents/` working-memory directory a private git backing: a
worktree of a private vault repo, on a branch named after the project, pushed to a
private remote. marrow is two repos — the tool (this one) and a separate vault that
holds nothing but that data — see `architecture.md` → "Two repos: tool and vault". This
spec is about marrow the tool. What actually goes inside `.agents/` — file names,
maintenance discipline, promotion rules — is `../CONVENTION.md`'s job, not this spec's.

## Spec files

| File | Use it for |
|---|---|
| [architecture.md](./architecture.md) | design model — tool/vault repo split, worktree-as-registry, branch model, repo layout, env overrides, non-goals |
| [cli.md](./cli.md) | every command: arguments, options, behavior, output shape, exit codes |
| [safety.md](./safety.md) | the hard guarantees — private-remote requirement, no history rewrites, `add`'s backup/rollback/verification contract when adopting, attended operation, known gaps |

If the spec files disagree with each other: `safety.md` wins on anything
safety-related, `cli.md` wins on command syntax and exit codes, `architecture.md` wins on
everything else.

If the spec disagrees with the running code: treat that as a bug in one of the two, not
as license to pick whichever is convenient — fix the spec to match a deliberate code
change, or fix the code if the spec was the intended design.

## Canonical names

- Tool repo: `marrow` (`gxxcastillo/marrow`), lives at `~/dev/marrow` — an ordinary dev
  project
- Vault repo: `marrow-vault` (`gxxcastillo/marrow-vault`), bare, lives outside `~/dev`
- CLI command: `marrow`
- Vault parent directory (`MARROW_HOME`): `~/.marrow` by default, overridable — contains
  `vault.git/` (the bare repo), `backups/`, and `logs/`
- Per-project worktree path: `<project-path>/.agents`
- No config file — the registry is `git worktree list` against `<MARROW_HOME>/vault.git`

```bash
marrow status
marrow sync ossa -m "weekly review"
marrow add ~/dev/sobremesa --dry-run
marrow doctor
marrow grep "TODO"
```

## What lives outside this spec

- **`../.agents/plans/implementation-plan.md`** — the phased build plan and the one-time
  migration sequencing/inventory for the nine real `~/dev` projects. Point-in-time
  planning content, not durable design; superseded by this spec wherever the two would
  otherwise overlap. It lives in marrow's own `.agents/` vault worktree, so a tool-repo
  checkout without the vault will not have it — nothing in this spec depends on reading
  it.
- **`../AGENTS.md`** — build discipline for agents working on marrow's own code (Bun/
  TypeScript conventions, test rules) and the operating discipline for running marrow
  against real projects (attended migration, per-project order). Points here for the
  durable safety guarantees rather than restating them.
- **`../CONVENTION.md`** — what `.agents/` directories contain and how they're
  maintained. marrow backs them; it does not define their contents.
