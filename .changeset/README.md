# Changesets

Add a changeset for every user-visible package change:

```bash
corepack pnpm@10.34.0 changeset
```

All five public packages use one fixed version. Choose:

- `patch` for compatible fixes and additive implementation changes;
- `minor` for pre-1.0 breaking changes or substantial new public APIs;
- `major` only after the project reaches 1.0.

Documentation-only, test-only, and repository-maintenance changes need no
changeset unless they alter a published package.
