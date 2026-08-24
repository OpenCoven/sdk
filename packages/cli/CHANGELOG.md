# @opencoven/dev-cli

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Serialize native keyring mutations across CLI processes with non-secret
  owner-local lock records.
- Distinguish reused OpenCoven PIDs with per-process random markers without
  stealing locks from a matching live owner solely because of age.
- Prove the Cave instance before storing or sending native-keyring credentials.
