import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDefinitionDigest } from '@opencoven/coven-client';
import { afterEach, describe, expect, test } from 'vitest';

import {
  canaryDefinition,
  harnessAssertedSecurity,
  parseDaemonCanaryArguments,
  quietScheduleHour,
  runDaemonScenario,
  verifyCovenVersion,
} from '../scripts/verify-automations-v1-daemon.mjs';
import type {
  DaemonCanaryClient,
  DaemonCanaryCommandContext,
  DaemonCanaryEventQuery,
} from '../scripts/verify-automations-v1-daemon.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = resolve(root, 'scripts/verify-automations-v1-daemon.mjs');
const scratchRoots: string[] = [];
const servers: Server[] = [];
const uid = process.getuid?.() ?? -1;
const actions = [
  'coven.automations.command.v1',
  'coven.automations.definition.create.v1',
  'coven.automations.definition.revise.v1',
  'coven.automations.definition.activate.v1',
  'coven.automations.definition.pause.v1',
  'coven.automations.definition.disable.v1',
  'coven.automations.definition.get.v1',
  'coven.automations.definition.list.v1',
  'coven.automations.events.subscribe.v1',
  'coven.automations.occurrence.history.v1',
  'coven.automations.run.history.v1',
];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const path of scratchRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function scratch(): string {
  const path = mkdtempSync(resolve(realpathSync(tmpdir()), 'cvs-'));
  chmodSync(path, 0o700);
  scratchRoots.push(path);
  return path;
}

interface Flaws {
  replayCommits?: boolean;
  acceptsMismatch?: boolean;
  acceptsStale?: boolean;
  integrityDrift?: boolean;
  forgetsAdoptionsOnRestart?: boolean;
  checkpointRewinds?: boolean;
  subscribeOmitsFinalPage?: boolean;
  missingAction?: string;
  historyNonEmpty?: boolean;
  eventDigestMatches?: boolean;
}

interface FakeEvent {
  sequence: number;
  kind: string;
  causation: { adoptionKey: string };
  payload: { revision: number; definitionDigest: { algorithm: string; canonicalization: string; value: string } };
}

type Result = Record<string, unknown>;

/** An in-memory stand-in for the daemon's command, event, and read semantics. */
function fakeDaemon(flaws: Flaws = {}) {
  const automationId = 'sdk-daemon-canary';
  const stream = { kind: 'automation', id: automationId };
  let revision = 0;
  let status = 'DRAFT';
  let tags: unknown = [];
  let integrity = '';
  let adoptions = new Map<string, { fingerprint: string; result: Result }>();
  const events: FakeEvent[] = [];

  const record = (kind: string, adoptionKey: string) => {
    events.push({
      sequence: events.length, kind, causation: { adoptionKey },
      payload: {
        revision,
        definitionDigest: {
          algorithm: 'sha256', canonicalization: 'jcs-rfc8785',
          value: flaws.eventDigestMatches === true ? integrity : 'a'.repeat(64),
        },
      },
    });
  };
  const rejected = (command: string, adoptionKey: string, error: Result): Result =>
    ({ outcome: 'rejected', command, adoptionKey, error: { retryable: false, ...error } });
  const command = (name: string, context: DaemonCanaryCommandContext, fingerprint: string, apply: () => Result) => {
    const prior = adoptions.get(context.adoptionKey);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        return Promise.resolve(flaws.acceptsMismatch === true ? prior.result
          : rejected(name, context.adoptionKey, { code: 'ADOPTION_REPLAY_MISMATCH' }));
      }
      return Promise.resolve(flaws.replayCommits === true ? prior.result
        : { ...prior.result, outcome: 'replayed', replay: { firstCommittedAt: '2026-10-03T06:00:00.000Z' } });
    }
    const result = apply();
    if (result.outcome === 'committed') adoptions.set(context.adoptionKey, { fingerprint, result });
    return Promise.resolve(result);
  };
  const transition = (
    name: string, kind: string, expected: number, context: DaemonCanaryCommandContext, next: string,
  ) => command(name, context, `${name}:${expected}`, () => {
    if (expected !== revision && flaws.acceptsStale !== true) {
      return rejected(name, context.adoptionKey, { code: 'REVISION_CONFLICT', currentRevision: revision });
    }
    revision += 1;
    status = next;
    record(kind, context.adoptionKey);
    return {
      outcome: 'committed', command: name, adoptionKey: context.adoptionKey, revision,
      result: { id: automationId, revision, status },
    };
  });
  const page = (after: number | null) => {
    const delivered = events.filter((event) => after === null || event.sequence > after);
    const last = delivered.at(-1)?.sequence ?? after;
    return {
      stream, after, events: delivered, nextAfter: last,
      checkpoint: `cp:${last ?? -1}`, checkpointExpiresAt: '2026-10-04T06:00:00.000Z',
    };
  };
  const read = (query: DaemonCanaryEventQuery) => {
    if ('checkpoint' in query) {
      const cursor = Number(query.checkpoint.slice(3));
      return page(flaws.checkpointRewinds === true || cursor < 0 ? null : cursor);
    }
    return page(query.after ?? null);
  };
  const history = { automationId, data: flaws.historyNonEmpty === true ? [{}] : [], cursor: { hasMore: false } };

  const client: DaemonCanaryClient = {
    capabilities: () => Promise.resolve({
      status: 'available', actions: actions.filter((action) => action !== flaws.missingAction),
    }),
    createDraft: (definition, context) => command('definition.create.v1', context, JSON.stringify(definition), () => {
      revision = 1;
      tags = (definition.display as { tags: unknown }).tags;
      const stored = { ...definition, revision: 1, lifecycleState: 'draft' };
      // The digest recipe removes `integrity`, but a document must carry one.
      const digest = computeDefinitionDigest({
        ...stored, integrity: { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: '0'.repeat(64) },
      });
      integrity = digest.status === 'computed' ? digest.digest.value : '';
      record('definition.created', context.adoptionKey);
      return {
        outcome: 'committed', command: 'definition.create.v1', adoptionKey: context.adoptionKey, revision,
        result: {
          revision,
          definition: {
            ...stored,
            integrity: {
              algorithm: 'sha256', canonicalization: 'jcs-rfc8785',
              value: flaws.integrityDrift === true ? 'b'.repeat(64) : integrity,
            },
          },
        },
      };
    }),
    revise: (_id, expected, definition, context) =>
      command('definition.revise.v1', context, `${expected}:${JSON.stringify(definition)}`, () => {
        if (expected !== revision && flaws.acceptsStale !== true) {
          return rejected('definition.revise.v1', context.adoptionKey, { code: 'REVISION_CONFLICT', currentRevision: revision });
        }
        revision += 1;
        status = 'PAUSED';
        tags = (definition.display as { tags: unknown }).tags;
        record('definition.revised', context.adoptionKey);
        return { outcome: 'committed', command: 'definition.revise.v1', adoptionKey: context.adoptionKey, revision };
      }),
    activate: (_id, expected, context) =>
      transition('definition.activate.v1', 'definition.activated', expected, context, 'ACTIVE'),
    pause: (_id, expected, context) =>
      transition('definition.pause.v1', 'definition.paused', expected, context, 'PAUSED'),
    disable: (_id, expected, context) =>
      transition('definition.disable.v1', 'definition.disabled', expected, context, 'DISABLED'),
    get: () => Promise.resolve({ routine: { id: automationId, status, tags }, revision, tombstonedAt: null }),
    list: () => Promise.resolve({ routines: [], revisionById: { [automationId]: revision }, tombstonedAtById: {} }),
    events: (query) => Promise.resolve(read(query)),
    subscribe: (query) => ({
      [Symbol.asyncIterator]() {
        let next: DaemonCanaryEventQuery | undefined = query;
        return {
          next() {
            if (next === undefined) return Promise.resolve({ done: true as const, value: undefined });
            const current = read(next);
            if (current.events.length === 0 && flaws.subscribeOmitsFinalPage === true) {
              return Promise.resolve({ done: true as const, value: undefined });
            }
            next = current.events.length === 0 ? undefined : { stream: query.stream, checkpoint: current.checkpoint };
            return Promise.resolve({ done: false as const, value: current });
          },
        };
      },
    }),
    occurrenceHistory: () => Promise.resolve(history),
    runHistory: () => Promise.resolve(history),
  };
  const restartDaemon = () => {
    if (flaws.forgetsAdoptionsOnRestart === true) adoptions = new Map();
    return Promise.resolve();
  };
  return { connect: () => Promise.resolve(client), restartDaemon };
}

function scenario(flaws: Flaws = {}) {
  return runDaemonScenario({ sdk: { computeDefinitionDigest }, scheduleHour: 21, ...fakeDaemon(flaws) });
}

describe('daemon canary pin', () => {
  test('installs exactly the CLI version that CI expects, from the npm registry with integrity', () => {
    const directory = resolve(root, 'conformance/automations-v1-daemon');
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(resolve(directory, 'package-lock.json'), 'utf8')) as {
      lockfileVersion: number;
      packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
    };
    const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    const version = manifest.dependencies['@opencoven/cli'];
    expect(Object.keys(manifest.dependencies)).toEqual(['@opencoven/cli']);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(lock.lockfileVersion).toBe(3);
    const installed = Object.entries(lock.packages).filter(([path]) => path !== '');
    expect(installed.map(([path]) => path).sort()).toEqual([
      'node_modules/@opencoven/cli',
      'node_modules/@opencoven/cli-linux-x64',
      'node_modules/@opencoven/cli-macos',
      'node_modules/@opencoven/cli-macos-x64',
      'node_modules/@opencoven/cli-windows',
    ]);
    for (const [path, entry] of installed) {
      expect(entry.version).toBe(version);
      expect(entry.resolved).toBe(`https://registry.npmjs.org/${path.slice('node_modules/'.length)}/-/${path.split('/').at(-1)}-${version}.tgz`);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/u);
    }
    expect(workflow).toContain(`- name: Drive the released Coven v${version} daemon through the SDK`);
    expect(workflow).toContain(`--expect-version ${version}\n`);
    expect(workflow).toContain('npm ci --prefix "$COVEN_CLI_DIR" --ignore-scripts --no-audit --no-fund');
    expect(workflow).toContain('npm audit signatures --prefix "$COVEN_CLI_DIR"');
  });
});

describe('daemon canary arguments', () => {
  test('accepts a coven path and exact version, with or without the pnpm separator', () => {
    expect(parseDaemonCanaryArguments(['--', '--coven', 'bin/coven.js', '--expect-version', '0.4.7'])).toEqual({
      coven: resolve('bin/coven.js'), expectVersion: '0.4.7',
    });
  });

  test.each([
    [[]],
    [['--coven', 'coven']],
    [['--coven', 'coven', '--expect-version', 'v0.4.7']],
    [['--coven', 'coven', '--coven', 'other', '--expect-version', '0.4.7']],
    [['--coven', '--expect-version', '0.4.7']],
    [['--coven', 'coven', '--expect-version', '0.4.7', '--archive', 'x']],
  ])('refuses %j', (argv) => {
    expect(() => parseDaemonCanaryArguments(argv)).toThrow(/^usage:/u);
  });

  test('schedules the routine twelve hours from the activation hour', () => {
    expect(quietScheduleHour(new Date('2026-10-03T00:30:00Z'))).toBe(12);
    expect(quietScheduleHour(new Date('2026-10-03T13:59:00Z'))).toBe(1);
    expect(canaryDefinition(1)).toMatchObject({ trigger: { schedule: { rrule: 'FREQ=DAILY;BYHOUR=1' } } });
  });
});

describe('daemon canary scenario', () => {
  test('passes against a daemon with the released command and replay semantics', async () => {
    await expect(scenario()).resolves.toEqual({
      commands: 9, replays: 2, rejections: 2, events: 5, subscribePages: 2,
      eventDefinitionDigest: 'differs-from-definition-integrity',
    });
    await expect(scenario({ eventDigestMatches: true })).resolves.toMatchObject({
      eventDefinitionDigest: 'matches-definition-integrity',
    });
  });

  test.each<[string, Flaws, RegExp]>([
    ['a missing advertised action', { missingAction: 'coven.automations.run.history.v1' }, /capabilities: missing coven\.automations\.run\.history\.v1/u],
    ['a stored digest the SDK cannot reproduce', { integrityDrift: true }, /integrity does not match the SDK digest/u],
    ['a replay that commits again', { replayCommits: true }, /createDraft replay: expected definition\.create\.v1 replayed/u],
    ['a changed body accepted under a used key', { acceptsMismatch: true }, /createDraft mismatch: expected rejection ADOPTION_REPLAY_MISMATCH/u],
    ['a stale revision accepted', { acceptsStale: true }, /stale revise: expected rejection REVISION_CONFLICT/u],
    ['adoption records lost on restart', { forgetsAdoptionsOnRestart: true }, /activate replay after restart/u],
    ['a checkpoint that rewinds to the start', { checkpointRewinds: true }, /subscribe: the checkpoint resumed after null, expected 0/u],
    ['a subscription that ends without its empty page', { subscribeOmitsFinalPage: true }, /subscribe: expected a final empty page after sequence 4 with a checkpoint/u],
    ['history for a routine that never fired', { historyNonEmpty: true }, /occurrenceHistory: expected an empty final page/u],
  ])('fails closed on %s', async (_label, flaws, message) => {
    await expect(scenario(flaws)).rejects.toThrow(message);
  });
});

describe.skipIf(process.platform === 'win32')('harness-asserted peer identity', () => {
  async function listening(home: string) {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((ready) => server.listen(resolve(home, 'coven.sock'), ready));
  }

  function discovered(home: string, owner = uid) {
    return { endpoint: { kind: 'unix', path: resolve(home, 'coven.sock') }, owner: { kind: 'unix', uid: owner } };
  }

  test('asserts the canary uid only for its own private socket', async () => {
    const home = scratch();
    await listening(home);
    const security = harnessAssertedSecurity(discovered(home), home);
    expect(security.platform).toBe('unix');
    await expect(security.peerIdentity.inspectConnected({})).resolves.toEqual({ uid });
  });

  test('refuses another endpoint, another owner, or a shared home', async () => {
    const home = scratch();
    await listening(home);
    expect(() => harnessAssertedSecurity(
      { ...discovered(home), endpoint: { kind: 'unix', path: resolve(home, 'other.sock') } }, home,
    )).toThrow(/expected the canary's socket/u);
    expect(() => harnessAssertedSecurity(discovered(home, uid + 1), home)).toThrow(/not owned by the canary user/u);
    chmodSync(home, 0o755);
    expect(() => harnessAssertedSecurity(discovered(home), home)).toThrow(/private directory/u);
  });
});

describe.skipIf(process.platform === 'win32')('daemon canary process handling', () => {
  function fakeCoven(directory: string, mode: 'serve' | 'hang' | 'exit') {
    writeFileSync(resolve(directory, 'mode'), mode);
    const path = resolve(directory, 'coven.mjs');
    writeFileSync(path, `
import { createServer } from 'node:http';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
const [command] = process.argv.slice(2);
if (command === '--version') {
  process.stdout.write('coven v0.4.7 (fake)\\n');
  process.exit(0);
}
const mode = readFileSync(new URL('./mode', import.meta.url), 'utf8');
if (mode === 'exit') {
  process.stderr.write('fake daemon refused to start\\n');
  process.exit(3);
}
const home = process.env.COVEN_HOME;
const socket = home + '/coven.sock';
writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
const body = JSON.stringify({ capabilities: [] });
const server = createServer((request, response) => {
  if (mode === 'hang') return;
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
});
server.listen(socket, () => {
  writeFileSync(home + '/daemon.json', JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), socket }));
  process.stderr.write('fake daemon listening\\n');
});
process.on('SIGTERM', () => {
  server.close();
  rmSync(socket, { force: true });
  rmSync(home + '/daemon.json', { force: true });
  process.exit(0);
});
`);
    return path;
  }

  function runCanary(coven: string, temp: string) {
    return spawnSync(process.execPath, [scriptPath, '--coven', coven, '--expect-version', '0.4.7'], {
      env: { ...process.env, TMPDIR: temp }, encoding: 'utf8', timeout: 60_000,
    });
  }

  test('reports the version a binary prints and refuses any other', () => {
    const directory = scratch();
    const coven = fakeCoven(directory, 'serve');
    expect(verifyCovenVersion(coven, '0.4.7', directory)).toBe('coven v0.4.7 (fake)');
    expect(() => verifyCovenVersion(coven, '0.4.6', directory)).toThrow(/Expected coven v0\.4\.6, .* reported "coven v0\.4\.7 \(fake\)"/u);
  });

  test('stops the daemon and removes its home when the scenario fails', () => {
    const directory = scratch();
    const temp = scratch();
    const result = runCanary(fakeCoven(directory, 'serve'), temp);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('capabilities: expected coven.automations available');
    expect(result.stderr).toContain('--- coven daemon serve output ---\nfake daemon listening');
    const pid = Number(readFileSync(resolve(directory, 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/u);
    expect(readdirSync(temp)).toEqual([]);
  });

  test.each([['SIGTERM', 143], ['SIGINT', 130]] as const)(
    'stops the daemon and removes its home when %s interrupts a request', async (signal, code) => {
      const directory = scratch();
      const temp = scratch();
      const canary = spawn(process.execPath, [scriptPath, '--coven', fakeCoven(directory, 'hang'), '--expect-version', '0.4.7'], {
        env: { ...process.env, TMPDIR: temp }, stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      canary.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const exited = new Promise<number | null>((done) => canary.once('exit', (status) => done(status)));
      const pidPath = resolve(directory, 'pid');
      const deadline = Date.now() + 30_000;
      while (!existsSync(pidPath) && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 50));
      const pid = Number(readFileSync(pidPath, 'utf8'));
      canary.kill(signal);
      expect(await exited).toBe(code);
      expect(stderr).toContain(`Interrupted by ${signal}.`);
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH/u);
      expect(readdirSync(temp)).toEqual([]);
    },
  );

  test('reports a daemon that exits before it is ready', () => {
    const temp = scratch();
    const result = runCanary(fakeCoven(scratch(), 'exit'), temp);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('coven daemon serve exited before it was ready (code 3, signal null)');
    expect(result.stderr).toContain('fake daemon refused to start');
    expect(readdirSync(temp)).toEqual([]);
  });
});
