const pairingSecretUnsentErrors = new WeakSet<object>();

export function markPairingSecretUnsentError<T>(error: T): T {
  if (typeof error !== 'object' || error === null) {
    return error;
  }

  pairingSecretUnsentErrors.add(error);
  return error;
}

export function consumePairingSecretUnsentError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!pairingSecretUnsentErrors.has(error)) {
    return false;
  }
  pairingSecretUnsentErrors.delete(error);
  return true;
}
