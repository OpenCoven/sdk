const CAVE_PAIRING_SECRET_UNSENT = Symbol.for(
  '@opencoven/cave-client/pairing-secret-unsent',
);

export function markPairingSecretUnsentError<T>(error: T): T {
  if (typeof error !== 'object' || error === null) {
    return error;
  }

  try {
    Object.defineProperty(error, CAVE_PAIRING_SECRET_UNSENT, { value: true });
  } catch {
    return error;
  }

  return error;
}

export function isPairingSecretUnsentError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    return Reflect.get(error, CAVE_PAIRING_SECRET_UNSENT) === true;
  } catch {
    return false;
  }
}
