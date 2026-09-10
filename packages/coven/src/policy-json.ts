export class PolicyJsonError extends SyntaxError {
  constructor() {
    super('Session policy JSON is invalid.');
    this.name = 'PolicyJsonError';
  }
}

/** Parse bounded wire JSON without losing duplicate keys or malformed Unicode. */
export function parsePolicyJson(
  bytes: Uint8Array,
  maxBytes: number,
  integerNumbersOnly = false,
): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) {
    throw new PolicyJsonError();
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new PolicyJsonError();
    throw error;
  }
  let position = 0;
  const fail = (): never => { throw new PolicyJsonError(); };
  const whitespace = (): void => {
    while (' \t\r\n'.includes(text[position] ?? '\0')) position++;
  };
  const string = (): string => {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '\\') {
        position++;
      } else if (character === '"') {
        let value: unknown;
        try {
          value = JSON.parse(text.slice(start, position));
        } catch (error) {
          if (error instanceof SyntaxError) return fail();
          throw error;
        }
        if (typeof value !== 'string' || !value.isWellFormed()) return fail();
        return value;
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 16) return fail();
    whitespace();
    const character = text[position];
    if (character === '"') return string();
    if (character === '{' || character === '[') {
      const object = character === '{';
      const end = object ? '}' : ']';
      const record: Record<string, unknown> = {};
      const array: unknown[] = [];
      const keys = new Set<string>();
      position++;
      whitespace();
      if (text[position] !== end) {
        while (true) {
          whitespace();
          if (object) {
            if (text[position] !== '"') return fail();
            const key = string();
            if (keys.has(key)) return fail();
            keys.add(key);
            whitespace();
            if (text[position++] !== ':') return fail();
            Object.defineProperty(record, key, {
              value: value(depth + 1), enumerable: true,
            });
          } else {
            array.push(value(depth + 1));
          }
          whitespace();
          if (text[position] !== ',') break;
          position++;
        }
      }
      if (text[position++] !== end) return fail();
      return object ? record : array;
    }
    for (const [literal, result] of [
      ['true', true], ['false', false], ['null', null],
    ] as const) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(position));
    if (number === null) return fail();
    if (integerNumbersOnly && /[.eE]/.test(number[0])) return fail();
    position += number[0].length;
    const parsed = Number(number[0]);
    return Number.isFinite(parsed) ? parsed : fail();
  };
  const parsed = value(1);
  whitespace();
  if (position !== text.length) return fail();
  return parsed;
}
