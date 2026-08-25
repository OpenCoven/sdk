export const MANAGED_SNAPSHOT_LIMITS = Object.freeze({
  arrayElements: 64 * 1024,
  entries: 128 * 1024,
  nodes: 4 * 1024,
  stringCodeUnits: 64 * 1024,
  typedArrayElements: 64 * 1024,
});

export interface ManagedSnapshotBudget {
  maxArrayElements?: number;
  maxEntries?: number;
  maxNodes?: number;
  maxStringCodeUnits?: number;
  maxTypedArrayElements?: number;
}

export type ManagedSnapshotResult =
  | { valid: true; value: unknown }
  | { valid: false; limitExceeded: boolean };

interface SnapshotLimits {
  arrayElements: number;
  entries: number;
  nodes: number;
  stringCodeUnits: number;
  typedArrayElements: number;
}

interface SnapshotState {
  entries: number;
  nodes: number;
  readonly limits: SnapshotLimits;
  readonly visited: WeakSet<object>;
}

const INVALID_SNAPSHOT: ManagedSnapshotResult = {
  valid: false,
  limitExceeded: false,
};
const LIMITED_SNAPSHOT: ManagedSnapshotResult = {
  valid: false,
  limitExceeded: true,
};
const MAX_MANAGED_SNAPSHOT_DEPTH = 64;

function boundedLimit(
  value: number | undefined,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return maximum;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }
  return Math.min(value, maximum);
}

function snapshotLimits(
  budget: ManagedSnapshotBudget,
): SnapshotLimits | undefined {
  const arrayElements = boundedLimit(
    budget.maxArrayElements,
    MANAGED_SNAPSHOT_LIMITS.arrayElements,
  );
  const entries = boundedLimit(budget.maxEntries, MANAGED_SNAPSHOT_LIMITS.entries);
  const nodes = boundedLimit(budget.maxNodes, MANAGED_SNAPSHOT_LIMITS.nodes);
  const stringCodeUnits = boundedLimit(
    budget.maxStringCodeUnits,
    MANAGED_SNAPSHOT_LIMITS.stringCodeUnits,
  );
  const typedArrayElements = boundedLimit(
    budget.maxTypedArrayElements,
    MANAGED_SNAPSHOT_LIMITS.typedArrayElements,
  );
  if (
    arrayElements === undefined ||
    entries === undefined ||
    nodes === undefined ||
    stringCodeUnits === undefined ||
    typedArrayElements === undefined
  ) {
    return undefined;
  }
  return {
    arrayElements,
    entries,
    nodes,
    stringCodeUnits,
    typedArrayElements,
  };
}

function consume(state: SnapshotState, field: 'entries' | 'nodes', amount: number): boolean {
  const limit = state.limits[field];
  if (!Number.isSafeInteger(amount) || amount < 0 || state[field] > limit - amount) {
    return false;
  }
  state[field] += amount;
  return true;
}

function sameKeys(left: PropertyKey[], right: PropertyKey[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const seen = new Set(left);
  return seen.size === left.length && right.every((key) => seen.has(key));
}

function descriptorsForKeys(
  value: object,
  keys: PropertyKey[],
): Record<PropertyKey, PropertyDescriptor> | undefined {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return sameKeys(keys, Reflect.ownKeys(descriptors)) ? descriptors : undefined;
  } catch {
    return undefined;
  }
}

function snapshotValueUnsafe(
  value: unknown,
  state: SnapshotState,
  depth: number,
): ManagedSnapshotResult {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return { valid: true, value };
  }
  if (typeof value === 'string') {
    return value.length <= state.limits.stringCodeUnits
      ? { valid: true, value }
      : LIMITED_SNAPSHOT;
  }
  if (typeof value !== 'object' || depth > MAX_MANAGED_SNAPSHOT_DEPTH) {
    return INVALID_SNAPSHOT;
  }

  const objectValue = value;
  if (state.visited.has(objectValue)) {
    return INVALID_SNAPSHOT;
  }
  if (!consume(state, 'nodes', 1)) {
    return LIMITED_SNAPSHOT;
  }
  state.visited.add(objectValue);

  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(objectValue);
  } catch {
    return INVALID_SNAPSHOT;
  }

  if (value instanceof Uint8Array) {
    if (prototype !== Uint8Array.prototype) {
      return INVALID_SNAPSHOT;
    }
    let length: unknown;
    try {
      length = Reflect.get(objectValue, 'length');
    } catch {
      return INVALID_SNAPSHOT;
    }
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      return INVALID_SNAPSHOT;
    }
    if (length > state.limits.typedArrayElements || !consume(state, 'entries', length)) {
      return LIMITED_SNAPSHOT;
    }

    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(objectValue);
    } catch {
      return INVALID_SNAPSHOT;
    }
    if (
      keys.length !== length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= length,
      )
    ) {
      return INVALID_SNAPSHOT;
    }
    const descriptors = descriptorsForKeys(objectValue, keys);
    if (descriptors === undefined) {
      return INVALID_SNAPSHOT;
    }
    const snapshot: number[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'number' ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0 ||
        descriptor.value > 255
      ) {
        return INVALID_SNAPSHOT;
      }
      snapshot.push(descriptor.value);
    }
    return { valid: true, value: Object.freeze(snapshot) };
  }

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      return INVALID_SNAPSHOT;
    }
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(objectValue, 'length');
    } catch {
      return INVALID_SNAPSHOT;
    }
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return INVALID_SNAPSHOT;
    }

    const length = lengthDescriptor.value;
    if (length > state.limits.arrayElements || !consume(state, 'entries', length)) {
      return LIMITED_SNAPSHOT;
    }
    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(objectValue);
    } catch {
      return INVALID_SNAPSHOT;
    }
    if (
      keys.length !== length + 1 ||
      keys.some(
        (key) =>
          key !== 'length' &&
          (typeof key !== 'string' ||
            !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
            Number(key) >= length),
      )
    ) {
      return INVALID_SNAPSHOT;
    }
    const descriptors = descriptorsForKeys(objectValue, keys);
    if (descriptors === undefined) {
      return INVALID_SNAPSHOT;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return INVALID_SNAPSHOT;
      }
      const nested = snapshotValue(descriptor.value, state, depth + 1);
      if (!nested.valid) {
        return nested;
      }
      snapshot.push(nested.value);
    }
    return { valid: true, value: Object.freeze(snapshot) };
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return INVALID_SNAPSHOT;
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(objectValue);
  } catch {
    return INVALID_SNAPSHOT;
  }
  if (!consume(state, 'entries', keys.length)) {
    return LIMITED_SNAPSHOT;
  }
  const descriptors = descriptorsForKeys(objectValue, keys);
  if (descriptors === undefined) {
    return INVALID_SNAPSHOT;
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string') {
      return INVALID_SNAPSHOT;
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      return INVALID_SNAPSHOT;
    }
    const nested = snapshotValue(descriptor.value, state, depth + 1);
    if (!nested.valid) {
      return nested;
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: nested.value,
      writable: false,
    });
  }

  return { valid: true, value: Object.freeze(snapshot) };
}

function snapshotValue(
  value: unknown,
  state: SnapshotState,
  depth: number,
): ManagedSnapshotResult {
  try {
    return snapshotValueUnsafe(value, state, depth);
  } catch {
    return INVALID_SNAPSHOT;
  }
}

/**
 * Captures a native bridge result exactly once through own data descriptors.
 * Repeated identities, unsupported shapes, and budget exhaustion are rejected
 * before a bridge-owned graph can be expanded into JavaScript-owned state.
 */
export function snapshotManagedResultWithBudget(
  value: unknown,
  budget: ManagedSnapshotBudget = {},
): ManagedSnapshotResult {
  try {
    const limits = snapshotLimits(budget);
    if (limits === undefined) {
      return INVALID_SNAPSHOT;
    }
    return snapshotValue(
      value,
      {
        entries: 0,
        limits,
        nodes: 0,
        visited: new WeakSet<object>(),
      },
      0,
    );
  } catch {
    return INVALID_SNAPSHOT;
  }
}

/**
 * Captures a native bridge result exactly once through own data descriptors.
 * The returned value is a deep-frozen JSON-shaped copy with no reference to
 * the bridge-owned object graph.
 */
export function snapshotManagedResult(value: unknown): unknown {
  const result = snapshotManagedResultWithBudget(value);
  return result.valid ? result.value : undefined;
}
