export function isReleaseRef(value) {
  return value === 'refs/heads/main'
    || value === 'refs/heads/release/sdk-v0.0.1';
}
