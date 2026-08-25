const pairingExchangeAttempts = new WeakMap<object, object>();
const pairingExchangeUnsentAttempts = new WeakMap<object, Set<object>>();
const pairingExchangeUnsentErrors = new WeakMap<object, Set<object>>();

export function beginPairingExchangeUnsentAttempt(context: object): object {
  const existing = pairingExchangeAttempts.get(context);
  if (existing !== undefined) {
    endPairingExchangeUnsentAttempt(context, existing);
  }
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
  const errors = pairingExchangeUnsentErrors.get(attempt);
  if (errors === undefined) {
    return;
  }
  pairingExchangeUnsentErrors.delete(attempt);
  for (const error of errors) {
    const attempts = pairingExchangeUnsentAttempts.get(error);
    if (attempts === undefined) {
      continue;
    }
    attempts.delete(attempt);
    if (attempts.size === 0) {
      pairingExchangeUnsentAttempts.delete(error);
    }
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
    let attempts = pairingExchangeUnsentAttempts.get(error);
    if (attempts === undefined) {
      attempts = new Set();
      pairingExchangeUnsentAttempts.set(error, attempts);
    }
    attempts.add(attempt);

    let errors = pairingExchangeUnsentErrors.get(attempt);
    if (errors === undefined) {
      errors = new Set();
      pairingExchangeUnsentErrors.set(attempt, errors);
    }
    errors.add(error);
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

  const attempts = pairingExchangeUnsentAttempts.get(error);
  if (attempts === undefined || !attempts.has(attempt)) {
    return false;
  }
  attempts.delete(attempt);
  if (attempts.size === 0) {
    pairingExchangeUnsentAttempts.delete(error);
  }
  const errors = pairingExchangeUnsentErrors.get(attempt);
  if (errors !== undefined) {
    errors.delete(error);
    if (errors.size === 0) {
      pairingExchangeUnsentErrors.delete(attempt);
    }
  }
  return true;
}
