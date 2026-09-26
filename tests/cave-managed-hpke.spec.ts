import { createManagedCaveClient as createNative, type CaveManagedNativeTransport } from '@opencoven/cave-client';
import {
  createManagedCaveClient as createBrowser,
  type CaveManagedCredentialTransport,
  type CaveManagedDiscoveredEndpoint,
} from '@opencoven/cave-client/managed';
import type { OperationContext, PageOptions } from '@opencoven/sdk-core';
import { describe, expect, test, vi } from 'vitest';
import { inspect } from 'node:util';

import { createCaveHpkeBoundRequest } from '../packages/cave/src/hpke-bound-v1.js';
import { createTestHpkeAuthority } from './helpers/cave-hpke-authority.js';

const CURSOR = 'eyJwYWdlIjoyfQ';
const PROJECT = { id: 'project-1', name: 'Chat', root: '/chat', color: '#7c3aed', repoUrl: 'https://github.com/OpenCoven/chat',
  createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T01:00:00.000Z' };
const page = (cursor?: string) => ({
  apiVersion: '1.0', minimumClientVersion: '0.0.1',
  capabilities: ['projects', 'cursors'], operations: ['projects.list'],
  data: { projects: cursor === undefined ? [PROJECT] : [] },
  cursor: cursor === undefined ? { next: CURSOR, hasMore: true } : { current: cursor, hasMore: false },
});
const unused = () => Promise.reject(new Error('Unexpected transport operation'));
type Authority = CaveManagedDiscoveredEndpoint;
type V2 = Extract<Authority, { version: 2 }>;
function discoveryResult(value: Authority) {
  return { bytes: JSON.stringify({ version: value.version, endpoint: value.endpoint.url,
    ...value.freshness, ...(value.version === 2 ? { authority: value.authority } : {}) }),
  record: { ...value.record, processAlive: true } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(mode: 'browser' | 'native', discoveryOptions?: { signal: AbortSignal }) {
  const crypto = await createTestHpkeAuthority();
  const a: V2 = { ...crypto.discovered, record: { identity: 'owner-checked', device: 7, inode: 11 } };
  const b: V2 = { ...a, freshness: { ...a.freshness, nonce: 'A'.repeat(43) } };
  let current: Authority = a;
  const read = vi.fn(() => Promise.resolve(discoveryResult(current)));
  const hpke = vi.fn((options: PageOptions, authority: V2, context?: OperationContext): Promise<unknown> => {
    expect(context?.signal.aborted).toBe(false);
    const authentication = { mechanism: 'hpke-bound-v1', keyId: authority.authority.keyId };
    return Promise.resolve(mode === 'browser' ? { authentication, value: page(options.cursor) }
      : { authentication, statusCode: 200, payload: page(options.cursor) });
  });
  const legacy = vi.fn((options: PageOptions) => Promise.resolve(mode === 'browser'
    ? page(options.cursor) : { statusCode: 200, payload: page(options.cursor) }));
  const transport = mode === 'browser' ? {
    health: unused, managedPairingCreate: unused, managedPairingPoll: unused,
    managedPairingExchange: unused, managedCredentialStatus: unused, managedForgetCredential: unused,
    listProjects: legacy, managedHpkeListProjects: hpke,
  } : {
    health: unused, pairingCreate: unused, pairingPoll: unused, pairingExchange: unused,
    pairingCommit: unused, pairingDiscard: unused, credentialState: unused, forgetCredential: unused,
    familiars: unused, listFamiliars: unused, listProjects: legacy, listConversations: unused,
    getConversation: unused, listConversationMessages: unused, listProjectsHpke: hpke,
  };
  const options = { transport, discovery: { source: { read }, ...(
    discoveryOptions === undefined ? {} : { options: discoveryOptions }
  ) } };
  const client = mode === 'browser' ? createBrowser(options as { transport: CaveManagedCredentialTransport })
    : createNative(options as { transport: CaveManagedNativeTransport });
  return { client, transport, read, hpke, legacy, crypto, a, b, set: (value: Authority) => { current = value; } };
}

describe.each(['browser', 'native'] as const)('%s managed HPKE read continuity', (mode) => {
  test('honors configured discovery cancellation as well as operation cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = await fixture(mode, { signal: controller.signal });
    await expect(f.client.listProjects()).rejects.toMatchObject({ code: 'aborted' });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.hpke).not.toHaveBeenCalled();
  });

  test('rechecks cancellation after a transport method accessor runs', async () => {
    const f = await fixture(mode);
    const controller = new AbortController();
    Object.defineProperty(f.transport, mode === 'browser' ? 'managedHpkeListProjects' : 'listProjectsHpke', {
      get() { controller.abort(); return f.hpke; },
    });
    await expect(f.client.listProjects({ signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(f.hpke).not.toHaveBeenCalled();
  });

  test.each([[1, false], [1, true], [2, false], [2, true]] as const)(
    'checks the v%s deadline with configured discovery signal %s after a blocking accessor', async (version, configuredSignal) => {
    const f = await fixture(mode, configuredSignal ? { signal: new AbortController().signal } : undefined);
    if (version === 1) f.set({ version: 1, endpoint: f.a.endpoint, record: f.a.record,
      freshness: { ...f.a.freshness, nonce: 'legacy' } });
    const method = version === 1 ? 'listProjects'
      : mode === 'browser' ? 'managedHpkeListProjects' : 'listProjectsHpke';
    const called = version === 1 ? f.legacy : f.hpke;
    Object.defineProperty(f.transport, method, {
      get() {
        const until = performance.now() + 30;
        while (performance.now() < until) { /* Model a blocking host accessor. */ }
        return called;
      },
    });
    await expect(f.client.listProjects({ timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
    expect(called).not.toHaveBeenCalled();
  });

  test('owns nested authenticated payload data before parsing and freezes public DTOs', async () => {
    const f = await fixture(mode);
    const get = vi.fn((target: object, key: PropertyKey): unknown => key === 'name' ? 'host value' : Reflect.get(target, key));
    const project = new Proxy({ ...PROJECT }, { get });
    const payload = { ...page(), data: { projects: [project] } };
    const authentication = { mechanism: 'hpke-bound-v1', keyId: f.a.authority.keyId };
    f.hpke.mockResolvedValue(mode === 'browser' ? { authentication, value: payload }
      : { authentication, statusCode: 200, payload });
    const result = await f.client.listProjects();
    expect(result.data[0]?.name).toBe(PROJECT.name);
    expect(get).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data[0])).toBe(true);
  });

  test('cancels an in-flight authenticated adapter when the discovery signal aborts', async () => {
    const controller = new AbortController();
    const f = await fixture(mode, { signal: controller.signal });
    const entered = deferred<OperationContext>();
    const response = deferred<unknown>();
    f.hpke.mockImplementation((_options, _authority, context) => {
      entered.resolve(context!);
      return response.promise;
    });
    const iterator = f.client.iterateProjects({ maxPages: 2 });
    const next = iterator.next();
    const rejected = expect(next).rejects.toMatchObject({ code: 'aborted' });
    const context = await entered.promise;
    controller.abort();
    const adapterAborted = context.signal.aborted;
    const authentication = { mechanism: 'hpke-bound-v1', keyId: f.a.authority.keyId };
    try {
      await rejected;
    } finally {
      response.resolve(mode === 'browser' ? { authentication, value: page() }
        : { authentication, statusCode: 200, payload: page() });
    }
    expect(adapterAborted).toBe(true);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(f.hpke).toHaveBeenCalledOnce();
  });

  test.each(['discovery', 'iterator'] as const)('scopes %s cancellation correctly after buffering a completed page', async (owner) => {
    const controller = new AbortController();
    const f = await fixture(mode, owner === 'discovery' ? { signal: controller.signal } : undefined);
    const second = { ...PROJECT, id: 'project-2' };
    const payload = { ...page(), data: { projects: [PROJECT, second] } };
    const authentication = { mechanism: 'hpke-bound-v1', keyId: f.a.authority.keyId };
    f.hpke.mockResolvedValue(mode === 'browser' ? { authentication, value: payload }
      : { authentication, statusCode: 200, payload });
    const iterator = f.client.iterateProjects({ maxPages: 2,
      ...(owner === 'iterator' ? { signal: controller.signal } : {}) });
    await expect(iterator.next()).resolves.toMatchObject({ value: PROJECT });
    controller.abort();
    if (owner === 'discovery') await expect(iterator.next()).resolves.toMatchObject({ value: second });
    await expect(iterator.next()).rejects.toMatchObject({ code: 'aborted' });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.hpke).toHaveBeenCalledOnce();
  });

  test('captures discovery configuration without evaluating accessors', async () => {
    const f = await fixture(mode);
    const get = vi.fn(() => { throw new Error('private bearer from discovery getter'); });
    const options = Object.defineProperty({ transport: f.transport }, 'discovery', { get });
    let error: unknown;
    try {
      if (mode === 'browser') createBrowser(options as { transport: CaveManagedCredentialTransport });
      else createNative(options as { transport: CaveManagedNativeTransport });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(TypeError);
    expect(get).not.toHaveBeenCalled();
    expect(inspect(error)).not.toContain('private bearer');
  });

  test('allows stable legacy discovery without authenticating or sharing standalone read continuity', async () => {
    const f = await fixture(mode);
    const controller = new AbortController();
    f.set({ version: 1, endpoint: f.a.endpoint, record: f.a.record,
      freshness: { ...f.a.freshness, nonce: 'legacy' } });
    await f.client.listProjects({ signal: controller.signal });
    expect(f.legacy).toHaveBeenCalledOnce();
    f.set(f.a);
    await f.client.listProjects({ signal: controller.signal });
    f.set(f.b);
    await f.client.listProjects({ signal: controller.signal });
    expect(f.hpke).toHaveBeenCalledTimes(2);
  });

  test('does not retry a native failure or invoke result accessors', async () => {
    const f = await fixture(mode);
    f.hpke.mockRejectedValueOnce(Object.assign(new Error('private bearer'), { code: 'service_unavailable', retryable: true }));
    await expect(f.client.listProjects()).rejects.toMatchObject({ code: 'service_unavailable' });
    expect(f.hpke).toHaveBeenCalledOnce();
    const getter = vi.fn(() => { throw new Error('private bearer'); });
    f.hpke.mockResolvedValue(Object.defineProperty({}, 'authentication', { get: getter }));
    let error: unknown;
    try { await f.client.listProjects(); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'invalid_response', retryable: false });
    expect(getter).not.toHaveBeenCalled();
    expect(inspect(error)).not.toContain('private bearer');
  });

  test.each([false, true])('keeps interleaved iterators independent with discovery signal %s', async (configuredSignal) => {
    const f = await fixture(mode, configuredSignal ? { signal: new AbortController().signal } : undefined);
    const first = f.client.iterateProjects({ maxPages: 2 });
    expect(f.read).not.toHaveBeenCalled();
    await expect(first.next()).resolves.toMatchObject({ value: PROJECT, done: false });
    f.set(f.b);
    const second = f.client.iterateProjects({ maxPages: 2 });
    await expect(second.next()).resolves.toMatchObject({ value: PROJECT, done: false });
    await expect(first.next()).rejects.toMatchObject({ code: 'reconcile_required', retryable: false });
    await expect(second.next()).resolves.toMatchObject({ done: true });
    expect(f.hpke.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, undefined, CURSOR]);
    expect(f.legacy).not.toHaveBeenCalled();
  });

  test.each(['record', 'endpoint', 'key', 'downgrade'] as const)('rejects %s replacement within an iterator', async (field) => {
    const f = await fixture(mode);
    const iterator = f.client.iterateProjects({ maxPages: 2 });
    await iterator.next();
    const next = structuredClone(f.a);
    if (field === 'record') next.record.inode++;
    if (field === 'endpoint') next.endpoint.url = 'http://127.0.0.1:3021/';
    if (field === 'key') {
      const other = await createTestHpkeAuthority();
      next.authority = other.discovered.authority;
    }
    f.set(field === 'downgrade' ? { version: 1, endpoint: next.endpoint, record: next.record,
      freshness: { ...next.freshness, nonce: 'legacy' } } : next);
    await expect(iterator.next()).rejects.toMatchObject({ retryable: false });
    expect(f.hpke).toHaveBeenCalledOnce();
    expect(f.legacy).not.toHaveBeenCalled();
  });

  test('retains the client downgrade latch but allows independent authority rotation', async () => {
    const f = await fixture(mode);
    await f.client.listProjects();
    f.set(f.b);
    await f.client.listProjects();
    f.set({ version: 1, endpoint: f.a.endpoint, record: f.a.record,
      freshness: { ...f.a.freshness, nonce: 'legacy' } });
    await expect(f.client.listProjects()).rejects.toMatchObject({ retryable: false });
    expect(f.hpke).toHaveBeenCalledTimes(2);
    expect(f.legacy).not.toHaveBeenCalled();
  });

  test('rejects pending v1 discovery when another read has already observed v2', async () => {
    const f = await fixture(mode);
    const gate = deferred<ReturnType<typeof discoveryResult>>();
    f.read.mockImplementationOnce(() => gate.promise);
    const pending = f.client.listProjects().catch((error: unknown) => error);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    await f.client.listProjects();
    gate.resolve(discoveryResult({ version: 1, endpoint: f.a.endpoint, record: f.a.record,
      freshness: { ...f.a.freshness, nonce: 'legacy' } }));
    await expect(pending).resolves.toMatchObject({ code: 'reconcile_required', retryable: false });
    expect(f.hpke).toHaveBeenCalledOnce();
    expect(f.legacy).not.toHaveBeenCalled();
  });

  test('does not forward a legacy iterator cursor after upgrading to v2', async () => {
    const f = await fixture(mode);
    f.set({ version: 1, endpoint: f.a.endpoint, record: f.a.record,
      freshness: { ...f.a.freshness, nonce: 'legacy' } });
    const iterator = f.client.iterateProjects({ maxPages: 2 });
    await iterator.next();
    f.set(f.a);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'reconcile_required', retryable: false });
    expect(f.legacy).toHaveBeenCalledOnce();
    expect(f.hpke).not.toHaveBeenCalled();
  });

  test.each(['listFamiliars', 'listConversations', 'listConversationMessages', 'getConversation'] as const)(
    'authenticates %s through its exact adapter operation', async (method) => {
      const f = await fixture(mode);
      const conversation = { id: 'one', familiarId: 'familiar-1', harness: 'copilot', model: 'model', runtime: 'cli',
        title: 'Read', origin: 'chat', status: 'complete', exitCode: 0, pending: false,
        createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' };
      const value = { ...page(), capabilities: ['familiars', 'conversations', 'conversation-messages', 'cursors'],
        operations: ['familiars.list', 'conversations.list', 'conversations.read', 'messages.list'],
        data: method === 'getConversation' ? { conversation }
          : method === 'listFamiliars' ? { familiars: [] }
            : method === 'listConversations' ? { conversations: [] } : { messages: [] },
        cursor: { hasMore: false } };
      const adapter = vi.fn((...args: unknown[]) => {
        const authority = args.at(-2) as V2;
        expect(Object.isFrozen(authority)).toBe(true);
        const authentication = { mechanism: 'hpke-bound-v1', keyId: authority.authority.keyId };
        return Promise.resolve(mode === 'browser' ? { authentication, value }
          : { authentication, statusCode: 200, payload: value });
      });
      Object.assign(f.transport, { [mode === 'browser' ? `managedHpke${method[0]!.toUpperCase()}${method.slice(1)}` : `${method}Hpke`]: adapter });
      if (method === 'getConversation') await expect(f.client.getConversation('one')).resolves.toEqual(conversation);
      else if (method === 'listConversationMessages') await expect(f.client.listConversationMessages('one')).resolves.toMatchObject({ data: [] });
      else await expect(f.client[method]()).resolves.toMatchObject({ data: [] });
      expect(adapter).toHaveBeenCalledOnce();
      expect(f.legacy).not.toHaveBeenCalled();
    },
  );

  test('authenticates the legacy familiar roster through its dedicated adapter', async () => {
    const f = await fixture(mode);
    const familiar = { id: 'familiar-1', display_name: 'Cedar', role: 'guide' };
    const value = { ok: true, familiars: [familiar] };
    const payload = { ...page(), data: { familiars: [familiar] } };
    const authentication = { mechanism: 'hpke-bound-v1', keyId: f.a.authority.keyId };
    const adapter = vi.fn(() => Promise.resolve(mode === 'browser' ? { authentication, value }
      : { authentication, statusCode: 200, payload }));
    Object.assign(f.transport, { [mode === 'browser' ? 'managedHpkeFamiliars' : 'familiarsHpke']: adapter });
    const result = await f.client.familiars();
    expect(result).toEqual([{ id: 'familiar-1', displayName: 'Cedar', role: 'guide' }]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(adapter).toHaveBeenCalledOnce();
  });

  test.each(['return', 'throw', 'abort'] as const)('does not dispatch after %s during discovery or cancel another iterator', async (action) => {
    const f = await fixture(mode);
    const gate = deferred<ReturnType<typeof discoveryResult>>();
    f.read.mockImplementationOnce(() => gate.promise);
    const controller = new AbortController();
    const first = f.client.iterateProjects({ maxPages: 2, signal: controller.signal });
    const pending = first.next().catch((error: unknown) => error);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    const reason = new Error('consumer stopped');
    const terminal = action === 'return' ? first.return(undefined)
      : action === 'throw' ? first.throw(reason).catch((error: unknown) => error)
        : (controller.abort(), Promise.resolve());
    if (action === 'throw') {
      await expect(pending).resolves.toBe(reason);
      await expect(terminal).resolves.toBe(reason);
    } else {
      await expect(pending).resolves.toMatchObject({ code: 'aborted' });
      await terminal;
    }
    gate.resolve(discoveryResult(f.a));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.hpke).not.toHaveBeenCalled();
    await expect(first.next()).resolves.toMatchObject({ done: true });
    const other = f.client.iterateProjects({ maxPages: 1 });
    await expect(other.next()).resolves.toMatchObject({ value: PROJECT });
    await other.return(undefined);
    expect(f.hpke).toHaveBeenCalledOnce();
  });

  test('returning one iterator does not cancel a sibling using the same caller signal', async () => {
    const f = await fixture(mode);
    const controller = new AbortController();
    const first = f.client.iterateProjects({ signal: controller.signal });
    const second = f.client.iterateProjects({ signal: controller.signal });
    await first.next();
    await second.next();
    await first.return(undefined);
    expect(controller.signal.aborted).toBe(false);
    await expect(second.next()).resolves.toMatchObject({ done: true });
    expect(f.hpke.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, undefined, CURSOR]);
  });

  test('fails closed when a v2 adapter method is missing or its authentication is wrong', async () => {
    const f = await fixture(mode);
    Reflect.deleteProperty(f.transport, mode === 'browser' ? 'managedHpkeListProjects' : 'listProjectsHpke');
    await expect(f.client.listProjects()).rejects.toMatchObject({ code: 'unsupported_operation', retryable: false });
    expect(f.legacy).not.toHaveBeenCalled();
    const malformed = await fixture(mode);
    malformed.hpke.mockResolvedValue({ authentication: { mechanism: 'hpke-bound-v1', keyId: 'wrong' },
      ...(mode === 'browser' ? { value: page() } : { statusCode: 200, payload: page() }) });
    await expect(malformed.client.listProjects()).rejects.toMatchObject({ code: 'invalid_response', retryable: false });
  });

  test('performs exactly one concrete HPKE exchange per page with fresh envelopes and unchanged cursors', async () => {
    const f = await fixture(mode);
    const nonces: string[] = [];
    f.hpke.mockImplementation(async (options, _authority, context) => {
      const url = `${f.a.endpoint.url}/api/client/v1/projects?limit=${options.limit}`
        + (options.cursor === undefined ? '' : `&cursor=${options.cursor}`);
      const bound = await createCaveHpkeBoundRequest({ discovered: f.crypto.discovered,
        instanceId: f.crypto.instanceId, url, method: 'GET',
        authorization: { kind: 'bearer', value: 'B'.repeat(43) } });
      const opened = await f.crypto.open(new Request(url, { headers: bound.headers }));
      nonces.push(opened.binding.requestNonce);
      const response = await f.crypto.respond(opened, 200, page(options.cursor));
      const verified = await bound.open(response, { maxBodyBytes: 65536, signal: context!.signal });
      const value: unknown = JSON.parse(new TextDecoder().decode(verified.body));
      const authentication = { mechanism: 'hpke-bound-v1', keyId: f.a.authority.keyId };
      return mode === 'browser' ? { authentication, value }
        : { authentication, statusCode: verified.status, payload: value };
    });
    const results = [];
    for await (const project of f.client.iterateProjects({ maxPages: 2 })) results.push(project);
    expect(results).toEqual([PROJECT]);
    expect(f.hpke.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, CURSOR]);
    expect(new Set(nonces).size).toBe(2);
  });
});

describe('browser managed familiar contract and analytics authority', () => {
  const report = { specVersion: '0.1.0', pass: true, properties: [{ property: 'Named Identity', pass: true }],
    violations: [], warnings: [] };
  const contract = { ok: true, id: 'cody', present: true, report };
  const analytics = { ok: true, analytics: { generatedAt: '2026-08-19T07:00:00Z', windows: {
    '7d': { attempts: 0, completed: 0, failed: 0, cancelled: 0, successRate: null, toolCalls: 0, toolFailures: 0,
      models: [], harnesses: [], coverage: {} } }, recentAttempts: [],
    backfill: { state: 'partial', imported: 12, remaining: 4 } } };
  const legacyV1 = (f: Awaited<ReturnType<typeof fixture>>): Authority => ({ version: 1, endpoint: f.a.endpoint,
    record: f.a.record, freshness: { ...f.a.freshness, nonce: 'legacy' } });

  test.each(['familiarContract', 'familiarAnalytics'] as const)(
    'authenticates %s through its dedicated adapter and never the plain method', async (method) => {
      const f = await fixture('browser');
      const plain = vi.fn(unused);
      const adapter = vi.fn((...args: unknown[]) => {
        const authority = args.at(-2) as V2;
        expect(Object.isFrozen(authority)).toBe(true);
        expect(args[0]).toBe('cody');
        return Promise.resolve({ authentication: { mechanism: 'hpke-bound-v1', keyId: authority.authority.keyId },
          value: method === 'familiarContract' ? contract : analytics });
      });
      Object.assign(f.transport, { [method]: plain,
        [method === 'familiarContract' ? 'managedHpkeFamiliarContract' : 'managedHpkeFamiliarAnalytics']: adapter });
      if (method === 'familiarContract') await expect(f.client.familiarContract('cody')).resolves.toMatchObject({ present: true });
      else await expect(f.client.familiarAnalytics('cody')).resolves.toMatchObject({ generatedAt: '2026-08-19T07:00:00Z' });
      expect(adapter).toHaveBeenCalledOnce();
      expect(plain).not.toHaveBeenCalled();
    },
  );

  test.each(['familiarContract', 'familiarAnalytics'] as const)(
    'refuses %s from a v1 authority once the client has observed v2', async (method) => {
      const f = await fixture('browser');
      const plain = vi.fn(() => Promise.resolve(method === 'familiarContract' ? contract : analytics));
      Object.assign(f.transport, { [method]: plain });
      await f.client.listProjects();
      f.set(legacyV1(f));
      const call = method === 'familiarContract' ? f.client.familiarContract('cody') : f.client.familiarAnalytics('cody');
      await expect(call).rejects.toMatchObject({ code: 'reconcile_required', retryable: false });
      expect(plain).not.toHaveBeenCalled();
    },
  );

  test.each(['familiarContract', 'familiarAnalytics'] as const)(
    'fails %s closed on v2 without an adapter instead of using the plain method', async (method) => {
      const f = await fixture('browser');
      const plain = vi.fn(() => Promise.resolve(method === 'familiarContract' ? contract : analytics));
      Object.assign(f.transport, { [method]: plain });
      const call = method === 'familiarContract' ? f.client.familiarContract('cody') : f.client.familiarAnalytics('cody');
      await expect(call).rejects.toMatchObject({ code: 'unsupported_operation', retryable: false });
      expect(plain).not.toHaveBeenCalled();
    },
  );

  test.each(['familiarContract', 'familiarAnalytics'] as const)(
    'keeps using the plain %s method while discovery is v1', async (method) => {
      const f = await fixture('browser');
      f.set(legacyV1(f));
      const plain = vi.fn(() => Promise.resolve(method === 'familiarContract' ? contract : analytics));
      Object.assign(f.transport, { [method]: plain });
      if (method === 'familiarContract') await expect(f.client.familiarContract('cody')).resolves.toMatchObject({ present: true });
      else await expect(f.client.familiarAnalytics('cody')).resolves.toMatchObject({ generatedAt: '2026-08-19T07:00:00Z' });
      expect(plain).toHaveBeenCalledOnce();
    },
  );
});
