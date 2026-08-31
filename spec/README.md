# marrow spec

Canonical description of marrow's design, CLI contract, and safety guarantees. The spec
describes the system as it exists today; git history records how it got here.

## Spec files

| File                                 | Use it for                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [architecture.md](./architecture.md) | design model — tool/vault repo split, worktree-as-registry, branch model, repo layout, env overrides, non-goals                                                    |
| [cli.md](./cli.md)                   | every command: arguments, options, behavior, output shape, exit codes                                                                                              |
| [safety.md](./safety.md)             | the hard guarantees — private-remote requirement, no history rewrites, `add`'s backup/rollback/verification contract when adopting, attended operation, known gaps |

If the spec files disagree with each other: `safety.md` wins on anything
safety-related, `cli.md` wins on command syntax and exit codes, `architecture.md` wins on
everything else.

If the spec disagrees with the running code: treat that as a bug in one of the two, not
as license to pick whichever is convenient — fix the spec to match a deliberate code
change, or fix the code if the spec was the intended design.

What `.agents/` directories contain and how they are maintained lives in
`../CONVENTION.md`. marrow does not interpret project prose. It recognizes only the
convention's mechanical structure where a command contract requires it.
