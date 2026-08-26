import { readFile, rm, writeFile } from 'node:fs/promises';

const hpkePath = 'packages/cave/src/hpke-bound-v1.ts';
const testPath = 'tests/cave-hpke-bound-v1.spec.ts';
const workflowPath = '.github/workflows/verify-cave-hpke-vector.yml';
const scriptPath = 'scripts/verify-cave-hpke-vector.mjs';

function replaceExactly(source, before, after, label, expected = 1) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== expected) {
    throw new Error(`${label}: expected ${expected} source matches, received ${occurrences}.`);
  }
  return source.split(before).join(after);
}

let hpke = await readFile(hpkePath, 'utf8');
hpke = replaceExactly(
  hpke,
  `async function serializePublicKey(
  suite: CipherSuite,
  key: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(await suite.kem.serializePublicKey(key));
}

`,
  '',
  'unnecessary CryptoKey helper',
);
hpke = replaceExactly(
  hpke,
  `    const responsePublicKey = await serializePublicKey(suite, responseRecipient.publicKey);`,
  `    const responsePublicKey = new Uint8Array(
      await suite.kem.serializePublicKey(responseRecipient.publicKey),
    );`,
  'inferred public-key serialization',
);
hpke = replaceExactly(
  hpke,
  `      ...(input.requestEkm === undefined ? {} : { ekm: input.requestEkm }),`,
  `      ...(input.requestEkm === undefined
        ? {}
        : { ekm: await suite.kem.deriveKeyPair(input.requestEkm) }),`,
  'deterministic request EKM derivation',
);
await writeFile(hpkePath, hpke, 'utf8');

let test = await readFile(testPath, 'utf8');
test = replaceExactly(
  test,
  `    ).rejects.toSatisfy((error: unknown) => errorCode(error) === 'reconcile_required');`,
  `    ).rejects.toMatchObject({ code: 'reconcile_required' });`,
  'fail-closed matcher',
  3,
);
test = replaceExactly(
  test,
  `function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code') as string | undefined
    : undefined;
}

`,
  '',
  'unused error helper',
);
await writeFile(testPath, test, 'utf8');

await rm(workflowPath, { force: true });
await rm(scriptPath, { force: true });
