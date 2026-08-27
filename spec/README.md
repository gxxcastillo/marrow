# marrow spec

Canonical description of how marrow works: its design model, its CLI contract, and its
safety guarantees. Each file is self-contained and cross-links the others. This spec
describes the system as it exists today — no changelog sections, no "previously this
was X" notes; git history is the record of how it got here.

marrow gives each project's `.agents/` working-memory directory a private git backing: a
worktree of this repo on a branch named after the project, pushed to one private remote.
This spec is about marrow the tool. What actually goes inside `.agents/` — file names,
maintenance discipline, promotion rules — is `../CONVENTION.md`'s job, not this spec's.

## Spec files

| File | Use it for |
|---|---|
| [architecture.md](./architecture.md) | design model — self-hosted vault, worktree-as-registry, branch model, repo layout, env overrides, non-goals |
| [cli.md](./cli.md) | every command: arguments, options, behavior, output shape, exit codes |
| [safety.md](./safety.md) | the hard guarantees — private-remote requirement, no history rewrites, adopt's backup/rollback/verification contract, attended operation, known gaps |

If the spec files disagree with each other: `safety.md` wins on anything
safety-related, `cli.md` wins on command syntax and exit codes, `architecture.md` wins on
everything else.

If the spec disagrees with the running code: treat that as a bug in one of the two, not
as license to pick whichever is convenient — fix the spec to match a deliberate code
change, or fix the code if the spec was the intended design.

## Canonical names

- Project/repo: `marrow`
- CLI command: `marrow`
- Vault root (`MARROW_HOME`): `~/dev/marrow` by default, overridable
- Projects root (`MARROW_DEV_ROOT`): `~/dev` by default, overridable
- Per-project worktree path: `<MARROW_DEV_ROOT>/<project>/.agents`
- No config file — the registry is `git worktree list` against `MARROW_HOME`

```bash
marrow status
marrow sync ossa -m "weekly review"
marrow adopt sobremesa --dry-run
marrow doctor
marrow grep "TODO"
```

## What lives outside this spec

- **`../plans/implementation-plan.md`** — the phased build plan and the one-time
  migration sequencing/inventory for the nine real `~/dev` projects. Point-in-time
  planning content, not durable design; superseded by this spec wherever the two would
  otherwise overlap.
- **`../AGENTS.md`** — build discipline for agents working on marrow's own code (Bun/
  TypeScript conventions, test rules) and the operating discipline for running marrow
  against real projects (attended migration, per-project order). Points here for the
  durable safety guarantees rather than restating them.
- **`../CONVENTION.md`** — what `.agents/` directories contain and how they're
  maintained. marrow backs them; it does not define their contents.
