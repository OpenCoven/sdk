export const CAVE_CONTRACT_API_VERSION = '1.0';

export const CAVE_CONTRACT_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'scope_denied',
  'not_found',
  'conflict',
  'rate_limited',
  'pairing_pending',
  'pairing_denied',
  'pairing_expired',
  'incompatible_version',
  'service_unavailable',
  'reconcile_required',
  'internal_error',
] as const;

export const CAVE_CONTRACT_LIMITS = Object.freeze({
  cursorCharacters: 512,
  declarationIdCharacters: 64,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  errorMessageCharacters: 256,
  requestIdCharacters: 64,
});

export function isCaveContractErrorCode(value: string): boolean {
  return (CAVE_CONTRACT_ERROR_CODES as readonly string[]).includes(value);
}
