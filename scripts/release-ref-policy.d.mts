export type ReleaseRef =
  | 'refs/heads/main'
  | 'refs/heads/release/sdk-v0.0.1';

export function isReleaseRef(value: unknown): value is ReleaseRef;
