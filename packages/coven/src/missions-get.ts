import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { object } from './automations-read-validation.js';
import type { CovenMissionRefusal } from './missions-commands.js';
import { freezeMissionJson, isMissionView, missionIdShape, type CovenMissionView } from './missions-view.js';

const ACTION = 'coven.automations.mission.get.v1';

/** A mission read. It needs no adoption key: it changes nothing. */
export interface CovenMissionGetRequest {
  readonly action: typeof ACTION;
  readonly missionId: string;
}

const READ_CODES: Readonly<Record<string, number>> = {
  VALIDATION_FAILED: 400, NOT_FOUND: 404, CAPABILITY_UNSUPPORTED: 422, INTERNAL: 500,
};

export function missionGetRequest(missionId: string): CovenMissionGetRequest {
  return Object.freeze({ action: ACTION, missionId });
}

export function isMissionGetRequest(request: unknown): boolean {
  return object(request) && request.action === ACTION;
}

/** Serializes a mission read from its own data fields, or fails with `invalid_options`. */
export function missionGetBytes(request: unknown): Buffer {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(request);
  } catch {
    throw new CovenClientError(normalizeCovenError({ code: 'invalid_options' }, 'missions.get'));
  }
  const action = descriptors.action;
  const missionId = descriptors.missionId;
  if (Reflect.ownKeys(descriptors).length !== 2 || action === undefined || !Object.hasOwn(action, 'value') ||
    action.value !== ACTION || missionId === undefined || !Object.hasOwn(missionId, 'value') ||
    !missionIdShape(missionId.value)) {
    throw new CovenClientError(normalizeCovenError({ code: 'invalid_options' }, 'missions.get'));
  }
  return Buffer.from(JSON.stringify({ action: ACTION, missionId: missionId.value as string }));
}

/**
 * The view, a typed refusal, or `undefined` for an answer that is not this
 * mission's view. A read of another principal's mission answers `NOT_FOUND`.
 */
export function decodeMissionGet(
  status: number,
  bytes: Uint8Array,
  missionId: string,
): { readonly outcome: 'read'; readonly mission: CovenMissionView } |
  { readonly outcome: 'rejected'; readonly error: CovenMissionRefusal } | undefined {
  let value: unknown;
  try {
    value = parsePolicyJson(bytes, 16_384);
  } catch {
    return undefined;
  }
  if (!object(value) || value.action !== ACTION) return undefined;
  if (value.ok === false && value.accepted === false && value.status === 'rejected') {
    const error = value.error;
    if (Object.hasOwn(value, 'result') || !object(error) || typeof error.code !== 'string' ||
      READ_CODES[error.code] !== status || error.httpStatus !== status || typeof error.retryable !== 'boolean') {
      return undefined;
    }
    return { outcome: 'rejected', error: { code: error.code, retryable: error.retryable, httpStatus: status } };
  }
  const mission = value.result;
  if (status !== 200 || value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(value, 'error') || !isMissionView(mission) || mission.missionId !== missionId) return undefined;
  return { outcome: 'read', mission: freezeMissionJson(mission) };
}
