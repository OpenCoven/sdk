type SnapshotResult =
  | { valid: true; value: unknown }
  | { valid: false };

const INVALID_SNAPSHOT: SnapshotResult = { valid: false };
const MAX_MANAGED_SNAPSHOT_DEPTH = 64;

function snapshotValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): SnapshotResult {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { valid: true, value };
  }
  if (typeof value !== 'object' || depth > MAX_MANAGED_SNAPSHOT_DEPTH) {
    return INVALID_SNAPSHOT;
  }
  if (ancestors.has(value)) {
    return INVALID_SNAPSHOT;
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Reflect.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return INVALID_SNAPSHOT;
  }

  if (value instanceof Uint8Array) {
    if (prototype !== Uint8Array.prototype) {
      return INVALID_SNAPSHOT;
    }
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key),
      )
    ) {
      return INVALID_SNAPSHOT;
    }
    const snapshot: number[] = [];
    for (let index = 0; index < keys.length; index += 1) {
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
    const lengthDescriptor = descriptors.length;
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
    const keys = Reflect.ownKeys(descriptors);
    if (
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

    ancestors.add(value);
    const snapshot: unknown[] = [];
    try {
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
          return INVALID_SNAPSHOT;
        }
        const nested = snapshotValue(descriptor.value, ancestors, depth + 1);
        if (!nested.valid) {
          return INVALID_SNAPSHOT;
        }
        snapshot.push(nested.value);
      }
    } finally {
      ancestors.delete(value);
    }
    return { valid: true, value: Object.freeze(snapshot) };
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return INVALID_SNAPSHOT;
  }

  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => {
      if (typeof key !== 'string') {
        return true;
      }
      const descriptor = descriptors[key];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
    })
  ) {
    return INVALID_SNAPSHOT;
  }

  ancestors.add(value);
  const snapshot = Object.create(null) as Record<string, unknown>;
  try {
    for (const key of keys) {
      const descriptor = descriptors[key as string];
      if (descriptor === undefined) {
        return INVALID_SNAPSHOT;
      }
      const nested = snapshotValue(descriptor.value, ancestors, depth + 1);
      if (!nested.valid) {
        return INVALID_SNAPSHOT;
      }
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: nested.value,
        writable: false,
      });
    }
  } finally {
    ancestors.delete(value);
  }

  return { valid: true, value: Object.freeze(snapshot) };
}

/**
 * Captures a native bridge result exactly once through own data descriptors.
 * The returned value is a deep-frozen JSON-shaped copy with no reference to
 * the bridge-owned object graph.
 */
export function snapshotManagedResult(value: unknown): unknown {
  const result = snapshotValue(value, new WeakSet<object>(), 0);
  return result.valid ? result.value : undefined;
}
