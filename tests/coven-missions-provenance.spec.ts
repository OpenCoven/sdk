import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  CovenMissionCancellation,
  CovenMissionEnvelopeRef,
  CovenMissionFamiliarRef,
  CovenMissionReason,
  CovenMissionResult,
  CovenMissionState,
  CovenMissionSubmitInput,
  CovenMissionView,
} from '@opencoven/coven-client';
import { expect, expectTypeOf, test } from 'vitest';

import type {
  CommandName,
  CommandPayloadByCommand,
  FamiliarRevisionRef,
  MissionEnvelopeRef,
  MissionReason,
  MissionResult,
  MissionState,
  MissionSubmitPayload,
  MissionView,
} from '../packages/coven/fixtures/automations-missions-v1/coven.automations.v1.js';
import provenance from '../packages/coven/fixtures/automations-missions-v1/provenance.json' with { type: 'json' };
import schema from '../packages/coven/fixtures/automations-missions-v1/command-envelope.schema.json' with { type: 'json' };

type ReadonlyContract<T> = T extends object ? { readonly [K in keyof T]: ReadonlyContract<T[K]> } : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

test('pins the exact producer schemas, declarations and Rust sources', () => {
  expect(provenance.repository).toBe('OpenCoven/coven');
  expect(provenance.commit).toBe('49142cee3532633b00ef272d411e1a41e021f663');
  expect(Object.keys(provenance.files).sort()).toEqual(['command-envelope.schema.json', 'common.schema.json', 'coven.automations.v1.d.ts']);
  for (const [file, source] of Object.entries(provenance.files)) {
    const bytes = readFileSync(new URL(`../packages/coven/fixtures/automations-missions-v1/${file}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
  }
  expect(provenance.sources).toEqual({
    'types.rs': { path: 'crates/coven-cli/src/automations/contract/types.rs', sha256: '560589cac7fe77f327f4d06297bb9d1205f8625c8149167c80cf8a338972ebb6' },
    'command_matrix.rs': { path: 'crates/coven-cli/src/automations/command_matrix.rs', sha256: '14b6d373971d4ed04ca8900a177af76da1008dc1e8b7ef7bbe4b04987b937efa' },
  });
});

test('the public mission types are the pinned producer types, in both directions', () => {
  expectTypeOf<Same<CovenMissionView, ReadonlyContract<MissionView>>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionSubmitInput, ReadonlyContract<MissionSubmitPayload>>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionState, MissionState>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionReason, MissionReason>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionResult, ReadonlyContract<MissionResult>>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionFamiliarRef, ReadonlyContract<FamiliarRevisionRef>>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionEnvelopeRef, ReadonlyContract<MissionEnvelopeRef>>>().toEqualTypeOf<true>();
  expectTypeOf<Same<CovenMissionCancellation, ReadonlyContract<NonNullable<MissionView['cancellation']>>>>().toEqualTypeOf<true>();
  expectTypeOf<Extract<CommandName, `mission.${string}`>>().toEqualTypeOf<'mission.submit.v1' | 'mission.get.v1' | 'mission.cancel.v1'>();
  expectTypeOf<CommandPayloadByCommand['mission.cancel.v1']>().toEqualTypeOf<{ missionId: string; reason?: string }>();
});

test('the client bounds match the pinned schema', () => {
  const defs = schema.$defs as unknown as Record<string, { properties: Record<string, Record<string, unknown>> }>;
  const submit = defs.missionSubmit!.properties;
  const task = submit.task as { properties: Record<string, { minLength: number; maxLength: number }> };
  expect([task.properties.statement!.minLength, task.properties.statement!.maxLength]).toEqual([1, 200]);
  expect([task.properties.prompt!.minLength, task.properties.prompt!.maxLength]).toEqual([1, 32_768]);
  const limits = submit.limits as { properties: { timeoutMinutes: { minimum: number; maximum: number } } };
  expect([limits.properties.timeoutMinutes.minimum, limits.properties.timeoutMinutes.maximum]).toEqual([1, 60]);
  const cancel = defs.missionCancel!.properties;
  expect(cancel.reason).toEqual({ type: 'string', maxLength: 500 });
  expect((defs.missionId as unknown as { pattern: string }).pattern).toBe('^mission-[0-9a-f]{32}$');
  const view = defs.missionView as unknown as { required: string[]; properties: Record<string, unknown> };
  expect(view.required).toEqual(['missionId', 'occurrenceId', 'revision', 'state', 'terminal', 'principal', 'familiar',
    'envelope', 'project', 'task', 'submittedAt', 'validUntil', 'attempts']);
  expect(Object.keys(view.properties).sort()).toEqual(['attempts', 'cancellation', 'envelope', 'familiar', 'missionId',
    'occurrenceId', 'principal', 'project', 'reason', 'result', 'revision', 'state', 'submittedAt', 'task', 'terminal',
    'validUntil']);
});
