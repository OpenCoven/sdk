import { expect, test } from 'vitest';

import { canonicalAutomationJson, snapshotAutomationJson } from '../packages/coven/src/automations-canonical-json.js';

test('uses UTF16 property ordering and ECMAScript primitive encoding', () => {
  const value = snapshotAutomationJson({ '\ue000': 1, '😀': 2, '\r': 3, a: [-0, true, null, '\n"\\', Number.MAX_SAFE_INTEGER] });
  expect(value).toBeDefined();
  expect(canonicalAutomationJson(value!)).toBe('{"\\r":3,"a":[0,true,null,"\\n\\"\\\\",9007199254740991],"😀":2,"\ue000":1}');
});

test('removes only the covered top-level integrity member', () => {
  const value = snapshotAutomationJson({ integrity: 'excluded', nested: { integrity: 'covered' } });
  expect(canonicalAutomationJson(value!, true)).toBe('{"nested":{"integrity":"covered"}}');
  expect(canonicalAutomationJson(value!)).toBe('{"integrity":"excluded","nested":{"integrity":"covered"}}');
});

test.each([undefined, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '\ud800', { '\ud800': 'value' }])(
  'rejects unsupported JSON before canonicalization %#', (value) => {
    expect(snapshotAutomationJson(value)).toBeUndefined();
  },
);

test('captures descriptor values, never bridge proxy gets', () => {
  const input = new Proxy({ a: 'owned' }, { get() { throw new Error('untrusted'); } });
  const value = snapshotAutomationJson(input);
  expect(canonicalAutomationJson(value!)).toBe('{"a":"owned"}');
  expect(Object.isFrozen(value)).toBe(true);
});

test('rejects oversized arrays before enumerating their elements', () => {
  let enumerated = false;
  const input = new Proxy(new Array(4_097), { ownKeys() { enumerated = true; return []; } });
  expect(snapshotAutomationJson(input)).toBeUndefined();
  expect(enumerated).toBe(false);
});

test('opts into finite fractional JCS numbers without changing receipt defaults', () => {
  for (const value of [1.5, 1e-7]) {
    expect(snapshotAutomationJson(value)).toBeUndefined();
    expect(canonicalAutomationJson(snapshotAutomationJson(value, 'jcs')!)).toBe(JSON.stringify(value));
  }
  expect(canonicalAutomationJson(snapshotAutomationJson(-0, 'jcs')!)).toBe('0');
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(snapshotAutomationJson(value, 'jcs')).toBeUndefined();
  }
});
