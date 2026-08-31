import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAVE_DEFAULT_CAPABILITY_CONTRACT,
  CAVE_PAIRING_SCOPES,
  CAVE_PRIVILEGED_ACTION_CLASSES,
  CAVE_PRIVILEGED_ACTION_REQUIREMENTS,
  createCaveCapabilityRegistry,
  createDefaultCaveCapabilityRegistry,
  parsePrivilegedConfirmation,
  parseVerifiedCaveContractFixture,
  validatePrivilegedOperationId,
} from '@opencoven/cave-client';
import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturePath = resolve(root, 'packages/cave/fixtures/contract-fixture.json');
const digestPath = resolve(root, 'packages/cave/fixtures/contract-fixture.sha256');

const OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';

describe('privileged capability requirements', () => {
  test('every privileged action class has a requirement keyed by a declared pairing scope', () => {
    expect([...CAVE_PRIVILEGED_ACTION_CLASSES]).toEqual([
      'attachment-transfer',
      'rich-content',
      'attention-response',
      'task-handoff',
      'github-action',
    ]);

    const pairingScopes: ReadonlySet<string> = new Set(CAVE_PAIRING_SCOPES);
    for (const actionClass of CAVE_PRIVILEGED_ACTION_CLASSES) {
      const requirement = CAVE_PRIVILEGED_ACTION_REQUIREMENTS[actionClass];
      expect(requirement.actionClass).toBe(actionClass);
      // Scope names are drawn only from the fixture-declared pairing scope
      // vocabulary — never invented.
      expect(pairingScopes.has(requirement.requiredScope)).toBe(true);
      expect(requirement.requiresConfirmation).toBe(true);
      expect(requirement.idempotencyKey).toBe('operation-uuid');
    }

    expect(CAVE_PRIVILEGED_ACTION_REQUIREMENTS['attachment-transfer'].requiredScope).toBe(
      'attachments:write',
    );
    expect(CAVE_PRIVILEGED_ACTION_REQUIREMENTS['rich-content'].requiredScope).toBe(
      'chat:write',
    );
    expect(CAVE_PRIVILEGED_ACTION_REQUIREMENTS['attention-response'].requiredScope).toBe(
      'conversations:write',
    );
    expect(CAVE_PRIVILEGED_ACTION_REQUIREMENTS['task-handoff'].requiredScope).toBe(
      'tasks:write',
    );
    expect(CAVE_PRIVILEGED_ACTION_REQUIREMENTS['github-action'].requiredScope).toBe(
      'github:write',
    );
  });

  test('requirements are frozen', () => {
    for (const actionClass of CAVE_PRIVILEGED_ACTION_CLASSES) {
      expect(Object.isFrozen(CAVE_PRIVILEGED_ACTION_REQUIREMENTS[actionClass])).toBe(
        true,
      );
    }
    expect(Object.isFrozen(CAVE_PRIVILEGED_ACTION_REQUIREMENTS)).toBe(true);
  });
});

describe('capability registry against the authoritative fixture', () => {
  test('the default capability contract mirrors the pinned fixture exactly', () => {
    const fixture = parseVerifiedCaveContractFixture(
      readFileSync(fixturePath, 'utf8'),
      readFileSync(digestPath, 'utf8').trim(),
    );

    // A fixture re-import forces a reviewed update of the default snapshot.
    expect([...CAVE_DEFAULT_CAPABILITY_CONTRACT.capabilities]).toEqual([
      ...fixture.contract.capabilities,
    ]);
    expect(CAVE_DEFAULT_CAPABILITY_CONTRACT.operations.length).toBe(
      fixture.contract.operations.length,
    );
    expect([...CAVE_DEFAULT_CAPABILITY_CONTRACT.operations]).toEqual([
      ...fixture.contract.operations,
    ]);
  });

  test('the pinned fixture declares thirteen operations and none carry a privileged scope', () => {
    const fixture = parseVerifiedCaveContractFixture(
      readFileSync(fixturePath, 'utf8'),
      readFileSync(digestPath, 'utf8').trim(),
    );

    expect(fixture.contract.operations.length).toBe(13);

    const privilegedScopes = new Set([
      'chat:write',
      'conversations:write',
      'attachments:write',
      'tasks:write',
      'github:write',
    ]);
    for (const operation of fixture.contract.operations) {
      expect(privilegedScopes.has(operation.scope ?? '')).toBe(false);
    }
    for (const capability of fixture.contract.capabilities) {
      expect([
        'attachments',
        'tasks',
        'github',
        'rich-content',
        'attention',
      ]).not.toContain(capability);
    }
  });

  test('every privileged action class resolves undeclared under the pinned fixture', () => {
    const fixture = parseVerifiedCaveContractFixture(
      readFileSync(fixturePath, 'utf8'),
      readFileSync(digestPath, 'utf8').trim(),
    );
    const registry = createCaveCapabilityRegistry(fixture.contract);

    for (const actionClass of CAVE_PRIVILEGED_ACTION_CLASSES) {
      const resolution = registry.resolve(actionClass);
      expect(resolution.status).toBe('undeclared');
      expect(resolution.declaredOperations).toEqual([]);
      expect(resolution.requirement).toBe(
        CAVE_PRIVILEGED_ACTION_REQUIREMENTS[actionClass],
      );
    }
  });

  test('resolution is computed per call and returns frozen descriptors', () => {
    const registry = createDefaultCaveCapabilityRegistry();
    const first = registry.resolve('github-action');
    const second = registry.resolve('github-action');

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.declaredOperations)).toBe(true);
    expect(Object.isFrozen(first.requirement)).toBe(true);
  });

  test('an undeclared class becomes declared only when the contract declares a scoped operation', () => {
    // Synthetic test fixture: proves the gate is fixture-driven, not a
    // hardcoded refusal. No upstream contract is implied by this shape.
    const synthetic = {
      capabilities: ['conversations', 'attachments'],
      operations: [
        {
          id: 'attachments.upload',
          families: ['attachments'],
          ingress: 'authenticated',
          method: 'POST',
          path: '/api/client/v1/conversations/:id/attachments',
          scope: 'attachments:write',
        },
      ],
    };
    const registry = createCaveCapabilityRegistry(synthetic);

    const declared = registry.resolve('attachment-transfer');
    expect(declared.status).toBe('declared');
    expect(declared.declaredOperations.map((operation) => operation.id)).toEqual([
      'attachments.upload',
    ]);

    // Other privileged classes stay undeclared under the same contract.
    expect(registry.resolve('github-action').status).toBe('undeclared');
  });

  test('rejects malformed contract sources and unknown action classes', () => {
    expect(() =>
      createCaveCapabilityRegistry(null as unknown as Parameters<
        typeof createCaveCapabilityRegistry
      >[0]),
    ).toThrowError(TypeError);
    expect(() =>
      createCaveCapabilityRegistry({
        capabilities: [],
        operations: 'nope',
      } as unknown as Parameters<typeof createCaveCapabilityRegistry>[0]),
    ).toThrowError(TypeError);

    const registry = createDefaultCaveCapabilityRegistry();
    expect(() =>
      registry.resolve('not-a-class' as never),
    ).toThrowError(TypeError);
    expect(() => registry.resolve('not-a-class' as never)).not.toThrowError(
      /not-a-class/u,
    );
  });
});

describe('privileged confirmation and operation id', () => {
  test('confirmation requires exactly confirmed true', () => {
    expect(parsePrivilegedConfirmation({ confirmed: true })).toBe(true);

    for (const malformed of [
      undefined,
      null,
      'confirmed',
      {},
      { confirmed: false },
      { confirmed: 'true' },
      { confirmed: 1 },
      { confirmed: true, extra: true },
    ]) {
      expect(() => parsePrivilegedConfirmation(malformed)).toThrowError(TypeError);
    }
  });

  test('privileged operation ids follow the Client v1 UUID contract', () => {
    expect(validatePrivilegedOperationId(OPERATION_ID)).toBe(OPERATION_ID);
    expect(
      validatePrivilegedOperationId('018F4F1A-77C2-7A31-8A15-55A25AABA001'),
    ).toBe(OPERATION_ID);

    for (const malformed of ['nope', '018f4f1a-77c2-7a31-8a15-55a25aaba00', 42]) {
      expect(() => validatePrivilegedOperationId(malformed)).toThrowError(TypeError);
      try {
        validatePrivilegedOperationId(malformed);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain(String(malformed));
      }
    }
  });
});
