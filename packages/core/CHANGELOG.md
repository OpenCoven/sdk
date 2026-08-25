# @opencoven/sdk-core

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Add optional atomic compare-and-delete support to the secret-store contract.
- Add reusable page contracts, strict page-option normalization, and bounded
  async page iteration. Limits default to `50`, reject values outside the safe
  integer range `1..100`, and accept only opaque strict canonical base64url
  cursors up to 512 characters.
- Require each iterator to have a positive `maxPages` or caller-owned
  `AbortSignal`; iteration is lazy, one page at a time, with no prefetch,
  automatic retry, or implicit whole-corpus walk.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
