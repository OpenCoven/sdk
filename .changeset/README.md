# Changesets

Add a changeset for every user-visible package change:

```bash
corepack pnpm@10.34.0 changeset
```

The four 0.1 release packages use one fixed version. The private
`@opencoven/dev-cli` workspace is deliberately outside that fixed group.
Choose:

- `patch` for compatible fixes and additive implementation changes;
- `minor` for pre-1.0 breaking changes or substantial new public APIs;
- `major` only after the project reaches 1.0.

Documentation-only, test-only, and repository-maintenance changes need no
changeset unless they alter a published package.
