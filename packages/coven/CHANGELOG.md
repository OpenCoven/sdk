# @opencoven/coven-client

## 0.0.1

- Initial experimental SDK foundation. This version is not yet published.
- Add opt-in Automations v1 capability discovery and its authenticated Unix
  GET transport through the public package root.
- Validate bounded raw capability catalogs, preserve supported, experimental,
  and refused variants, and report missing, planned, or unnegotiated
  advertisements as unavailable.
- Preserve connected-peer security, cancellation, deadlines, and the existing
  health-only client behavior. Capability discovery does not provide receipt
  authentication, execution authority, mutations, or certification.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
