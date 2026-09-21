/** Internal owned JSON representation for bounded Automations local helpers. */
export type AutomationJson = null | boolean | number | string | readonly AutomationJson[] |
  { readonly [key: string]: AutomationJson };

/** Reject unsupported host objects before inspecting or hashing fields. Receipt calls keep safe-integer semantics. */
export function snapshotAutomationJson(input: unknown, numberMode: 'safe-integers' | 'jcs' = 'safe-integers'): AutomationJson | undefined {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let entries = 0;
  let characters = 0;
  const text = (value: string): string => {
    characters += value.length;
    if (characters > 256 * 1024 || !value.isWellFormed()) throw new TypeError();
    return value;
  };
  const visit = (value: unknown, depth: number): AutomationJson => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && (Number.isSafeInteger(value) ||
      (numberMode === 'jcs' && Number.isFinite(value)))) return value;
    if (typeof value === 'string') return text(value);
    if (typeof value !== 'object' || value === null || depth > 16 || ++nodes > 4_096 || ancestors.has(value)) {
      throw new TypeError();
    }
    ancestors.add(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const lengthDescriptor = array ? Object.getOwnPropertyDescriptor(value, 'length') : undefined;
    const arrayLength: unknown = lengthDescriptor?.value;
    if (array && (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof arrayLength !== 'number' || !Number.isSafeInteger(arrayLength) || arrayLength < 0 || arrayLength > 4_096)) {
      throw new TypeError();
    }
    const keys = Reflect.ownKeys(value);
    entries += keys.length;
    if (entries > 8_192 || keys.some((key) => typeof key !== 'string')) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const capturedKeys = Reflect.ownKeys(descriptors);
    const keySet = new Set(keys);
    if (capturedKeys.length !== keys.length || capturedKeys.some((key) => !keySet.has(key))) throw new TypeError();
    if (keys.some((key) => !Object.hasOwn(descriptors[key as string]!, 'value'))) throw new TypeError();
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== 'number' || length !== arrayLength || keys.length !== length + 1) {
        throw new TypeError();
      }
      const result: AutomationJson[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined) throw new TypeError();
        result.push(visit(descriptor.value, depth + 1));
      }
      ancestors.delete(value);
      return Object.freeze(result);
    }
    const result: Record<string, AutomationJson> = Object.create(null) as Record<string, AutomationJson>;
    for (const key of keys as string[]) result[text(key)] = visit(descriptors[key]!.value, depth + 1);
    ancestors.delete(value);
    return Object.freeze(result);
  };
  try {
    return visit(input, 0);
  } catch {
    return undefined;
  }
}

/** Input must be an owned snapshot. JCS uses UTF16 key order and ECMAScript primitives. */
export function canonicalAutomationJson(value: AutomationJson, omitIntegrity = false): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry: AutomationJson) => canonicalAutomationJson(entry)).join(',')}]`;
  const record = value as { readonly [key: string]: AutomationJson };
  return `{${Object.keys(record).sort().filter((key) => !omitIntegrity || key !== 'integrity')
    .map((key) => `${JSON.stringify(key)}:${canonicalAutomationJson(record[key]!)}`).join(',')}}`;
}
