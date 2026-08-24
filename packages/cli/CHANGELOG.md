# @opencoven/dev-cli

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Serialize native keyring mutations across CLI processes with non-secret
  owner-local lock records.
- Recover bounded-age owner locks so a reused PID cannot strand native
  credential mutations.
