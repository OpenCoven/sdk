const pairingExchangeAttempts = new WeakMap<object, object>();
const pairingExchangeUnsentErrors = new WeakMap<object, object>();

export function beginPairingExchangeUnsentAttempt(context: object): object {
  const attempt = {};
  pairingExchangeAttempts.set(context, attempt);
  return attempt;
}

export function endPairingExchangeUnsentAttempt(
  context: object,
  attempt: object,
): void {
  if (pairingExchangeAttempts.get(context) === attempt) {
    pairingExchangeAttempts.delete(context);
  }
}

export function markPairingExchangeUnsentError<T>(
  error: T,
  context: object | undefined,
): T {
  if (typeof error !== 'object' || error === null) {
    return error;
  }

  const attempt =
    typeof context === 'object' && context !== null
      ? pairingExchangeAttempts.get(context)
      : undefined;
  if (attempt !== undefined) {
    pairingExchangeUnsentErrors.set(error, attempt);
  }
  return error;
}

export function consumePairingExchangeUnsentError(
  error: unknown,
  attempt: object,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const markedAttempt = pairingExchangeUnsentErrors.get(error);
  if (markedAttempt === undefined) {
    return false;
  }
  pairingExchangeUnsentErrors.delete(error);
  return markedAttempt === attempt;
}
