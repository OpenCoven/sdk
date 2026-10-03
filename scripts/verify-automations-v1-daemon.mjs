import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage =
  'usage: verify-automations-v1-daemon.mjs --coven <path to coven or @opencoven/cli bin/coven.js> --expect-version <x.y.z>';
const versionPattern = /^\d+\.\d+\.\d+$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
// sockaddr_un.sun_path is 104 bytes on macOS and 108 on Linux, including NUL.
const maxSocketPathBytes = 103;
const readinessTimeoutMs = 30_000;
const shutdownTimeoutMs = 15_000;
const logLimitBytes = 64 * 1024;
const automationId = 'sdk-daemon-canary';
const principalId = 'principal:sdk-daemon-canary';
const requiredActions = [
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

function fail(message) {
  throw new Error(message);
}

export function parseDaemonCanaryArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--') continue;
    if ((flag !== '--coven' && flag !== '--expect-version') || values.has(flag) ||
      value === undefined || value.startsWith('--')) {
      fail(usage);
    }
    values.set(flag, value);
    index += 1;
  }
  const coven = values.get('--coven');
  const expectVersion = values.get('--expect-version');
  if (coven === undefined || expectVersion === undefined || !versionPattern.test(expectVersion)) {
    fail(usage);
  }
  return { coven: resolve(coven), expectVersion };
}

/**
 * A schedule hour twelve hours away, so the brief activation cannot reach a
 * slot and occurrence and run history stay empty.
 */
export function quietScheduleHour(now = new Date()) {
  return (now.getUTCHours() + 12) % 24;
}

export function canaryDefinition(scheduleHour) {
  return {
    schemaVersion: 'coven.automations.v1',
    automationId,
    display: { name: 'SDK daemon canary', tags: ['canary'] },
    trigger: {
      variant: 'schedule', version: 1,
      schedule: { rrule: `FREQ=DAILY;BYHOUR=${scheduleHour}`, timezone: 'utc' },
    },
    action: { variant: 'familiarInvocation', version: 1, prompt: 'Report that the canary ran.' },
    binding: {
      familiarBindingPolicy: 'exact', familiarId: 'canary',
      authority: { approvalPolicyRef: 'policy://authority/familiars/canary' },
    },
    runtimeRequirements: { runtimeId: 'coven-code', capabilities: ['sessions.launch'] },
    policies: {
      timeout: { perRunMinutes: 5 },
      retry: { maxAttempts: 1, backoffPolicy: 'none' },
      concurrency: { overlap: 'forbid' },
      misfire: { disposition: 'latest' },
      retention: { occurrenceHistory: { classification: 'standard' } },
    },
  };
}

function context(adoptionKey) {
  return { adoptionKey, intent: 'Exercise the released daemon from the SDK canary.', principalId };
}

function expectCommitted(label, result, command, revision) {
  if (result?.outcome !== 'committed' || result.command !== command || result.revision !== revision) {
    fail(`${label}: expected ${command} committed at revision ${revision}, received ${describe(result)}.`);
  }
}

function expectReplayed(label, result, command, revision) {
  if (result?.outcome !== 'replayed' || result.command !== command || result.revision !== revision ||
    !timestampPattern.test(result.replay?.firstCommittedAt ?? '')) {
    fail(`${label}: expected ${command} replayed at revision ${revision}, received ${describe(result)}.`);
  }
}

function expectRejected(label, result, code, extra = {}) {
  if (result?.outcome !== 'rejected' || result.error?.code !== code || result.error.retryable !== false ||
    Object.entries(extra).some(([key, value]) => result.error[key] !== value)) {
    fail(`${label}: expected rejection ${code}, received ${describe(result)}.`);
  }
}

function describe(value) {
  try {
    return JSON.stringify(value, (key, entry) => (key === 'definition' ? '[definition]' : entry)).slice(0, 400);
  } catch {
    return String(value);
  }
}

function expectSequences(label, events, expected) {
  const actual = events.map((event) => `${event.sequence}:${event.kind}`);
  if (actual.join(',') !== expected.join(',')) {
    fail(`${label}: expected events [${expected.join(', ')}], received [${actual.join(', ')}].`);
  }
}

const lifecycleKinds = [
  '0:definition.created',
  '1:definition.revised',
  '2:definition.activated',
  '3:definition.paused',
  '4:definition.disabled',
];

/**
 * Drives one isolated daemon through the SDK's public client. `connect`
 * returns a client for the daemon as it currently runs; `restartDaemon` stops
 * it cleanly and starts it again over the same COVEN_HOME.
 */
export async function runDaemonScenario({ sdk, connect, restartDaemon, scheduleHour }) {
  let client = await connect();
  const capabilities = await client.capabilities();
  if (capabilities?.status !== 'available' || !Array.isArray(capabilities.actions)) {
    fail(`capabilities: expected coven.automations available, received ${describe(capabilities)}.`);
  }
  const missing = requiredActions.filter((action) => !capabilities.actions.includes(action));
  if (missing.length > 0) fail(`capabilities: missing ${missing.join(', ')}.`);

  const draft = canaryDefinition(scheduleHour);
  const created = await client.createDraft(draft, context('canary:create'));
  expectCommitted('createDraft', created, 'definition.create.v1', 1);
  const stored = created.result?.definition;
  const recomputed = sdk.computeDefinitionDigest(stored);
  if (stored?.revision !== 1 || stored.lifecycleState !== 'draft' || recomputed.status !== 'computed' ||
    recomputed.digest.value !== stored.integrity?.value) {
    fail(`createDraft: the stored definition's integrity does not match the SDK digest, received ${describe(stored?.integrity)}.`);
  }
  expectReplayed('createDraft replay', await client.createDraft(draft, context('canary:create')),
    'definition.create.v1', 1);
  expectRejected('createDraft mismatch', await client.createDraft(
    { ...draft, display: { name: 'Changed body', tags: ['canary'] } }, context('canary:create'),
  ), 'ADOPTION_REPLAY_MISMATCH');

  const stream = { kind: 'automation', id: automationId };
  const beforeRevise = await client.events({ stream });
  expectSequences('events from the start', beforeRevise.events, lifecycleKinds.slice(0, 1));
  const createdDigest = beforeRevise.events[0].payload.definitionDigest?.value;
  if (!sha256Pattern.test(createdDigest ?? '') ||
    beforeRevise.events[0].causation?.adoptionKey !== 'canary:create') {
    fail(`events: definition.created lacks a digest or its adoption key, received ${describe(beforeRevise.events[0])}.`);
  }

  const revision = { ...draft, lifecycleState: 'paused', display: { name: 'SDK daemon canary', tags: ['canary', 'revised'] } };
  expectCommitted('revise', await client.revise(automationId, 1, revision, context('canary:revise')),
    'definition.revise.v1', 2);
  expectRejected('stale revise', await client.revise(
    automationId, 1, { ...revision, display: { name: 'Stale', tags: ['canary'] } }, context('canary:revise-stale'),
  ), 'REVISION_CONFLICT', { currentRevision: 2 });
  expectCommitted('activate', await client.activate(automationId, 2, context('canary:activate')),
    'definition.activate.v1', 3);
  expectCommitted('pause', await client.pause(automationId, 3, context('canary:pause')),
    'definition.pause.v1', 4);

  const read = await client.get(automationId);
  if (read?.revision !== 4 || read.routine?.status !== 'PAUSED' || !read.routine.tags?.includes('revised')) {
    fail(`get: expected the paused revision 4 with the revised tags, received ${describe(read)}.`);
  }

  await restartDaemon();
  client = await connect();

  expectReplayed('activate replay after restart', await client.activate(automationId, 2, context('canary:activate')),
    'definition.activate.v1', 3);
  expectCommitted('disable', await client.disable(automationId, 4, context('canary:disable')),
    'definition.disable.v1', 5);

  const resumed = [];
  let pages = 0;
  let last;
  for await (const page of client.subscribe({ stream, checkpoint: beforeRevise.checkpoint })) {
    pages += 1;
    if (pages === 1 && page.after !== 0) {
      fail(`subscribe: the checkpoint resumed after ${page.after}, expected 0.`);
    }
    resumed.push(...page.events);
    last = page;
    if (pages > 10) fail('subscribe: no end of stream after 10 pages.');
  }
  expectSequences('subscribe from the pre-restart checkpoint', resumed, lifecycleKinds.slice(1));
  // The iterator yields one empty page so its checkpoint can be saved, then ends.
  if (last?.events?.length !== 0 || last.after !== 4 || last.nextAfter !== 4 ||
    typeof last.checkpoint !== 'string' || last.checkpoint.length === 0) {
    fail(`subscribe: expected a final empty page after sequence 4 with a checkpoint, received ${
      describe(last === undefined ? undefined : { ...last, events: last.events?.length })}.`);
  }
  const cursor = await client.events({ stream, after: 2 });
  expectSequences('events after sequence 2', cursor.events, lifecycleKinds.slice(3));

  const listed = await client.list();
  if (listed?.revisionById?.[automationId] !== 5) {
    fail(`list: expected revision 5, received ${describe(listed?.revisionById)}.`);
  }
  const occurrences = await client.occurrenceHistory(automationId, { limit: 5 });
  const runs = await client.runHistory(automationId, { limit: 5 });
  for (const [label, page] of [['occurrenceHistory', occurrences], ['runHistory', runs]]) {
    if (page?.automationId !== automationId || page.data?.length !== 0 || page.cursor?.hasMore !== false) {
      fail(`${label}: expected an empty final page, received ${describe(page)}.`);
    }
  }

  return {
    commands: 9,
    replays: 2,
    rejections: 2,
    events: lifecycleKinds.length,
    subscribePages: pages,
    eventDefinitionDigest: createdDigest === stored.integrity.value ? 'matches-definition-integrity'
      : 'differs-from-definition-integrity',
  };
}

function daemonCommand(coven) {
  return /\.[cm]?js$/u.test(coven) ? [process.execPath, [coven]] : [coven, []];
}

function daemonEnvironment(home) {
  return {
    HOME: home,
    COVEN_HOME: home,
    PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    NO_COLOR: '1',
  };
}

export function verifyCovenVersion(coven, expectVersion, home) {
  const [command, prefix] = daemonCommand(coven);
  const result = spawnSync(command, [...prefix, '--version'], {
    env: daemonEnvironment(home), encoding: 'utf8', timeout: 30_000,
  });
  const reported = result.stdout?.trim() ?? '';
  if (result.status !== 0 || !reported.startsWith(`coven v${expectVersion} `)) {
    fail(`Expected coven v${expectVersion}, ${coven} reported "${reported || result.stderr?.trim() || result.error?.message}".`);
  }
  return reported;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/** Resolves with the exit, or undefined after `ms`, without holding the event loop open. */
function exitWithin(daemon, ms) {
  let timer;
  return Promise.race([
    daemon.exited,
    new Promise((resolveTimeout) => { timer = setTimeout(resolveTimeout, ms); }),
  ]).finally(() => clearTimeout(timer));
}

function isSocket(path) {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

function startDaemon(coven, home, log) {
  const [command, prefix] = daemonCommand(coven);
  const child = spawn(command, [...prefix, 'daemon', 'serve'], {
    env: daemonEnvironment(home), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
  });
  const capture = (chunk) => {
    if (log.bytes < logLimitBytes) {
      log.chunks.push(chunk);
      log.bytes += chunk.length;
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return { child, exited };
}

async function waitForDaemon(daemon, home, signal) {
  const deadline = Date.now() + readinessTimeoutMs;
  let exit;
  void daemon.exited.then((value) => { exit = value; });
  while (Date.now() < deadline) {
    if (signal?.aborted === true) fail('Interrupted while the daemon was starting.');
    if (exit !== undefined) {
      fail(`coven daemon serve exited before it was ready (${exit.error?.message ?? `code ${exit.code}, signal ${exit.signal}`}).`);
    }
    if (existsSync(resolve(home, 'daemon.json')) && isSocket(resolve(home, 'coven.sock'))) return;
    await delay(100);
  }
  fail(`coven daemon serve was not ready within ${readinessTimeoutMs} ms.`);
}

async function stopDaemon(daemon, home) {
  daemon.child.kill('SIGTERM');
  const exit = await exitWithin(daemon, shutdownTimeoutMs);
  if (exit === undefined) {
    fail(`coven daemon serve did not stop within ${shutdownTimeoutMs} ms of SIGTERM.`);
  }
  if (existsSync(resolve(home, 'daemon.json')) || existsSync(resolve(home, 'coven.sock'))) {
    fail('coven daemon serve stopped without removing daemon.json and coven.sock.');
  }
}

/**
 * Last-resort cleanup after a failure. The npm wrapper forwards SIGTERM but
 * cannot forward SIGKILL, so the native daemon recorded in this private home
 * is killed by its own pid.
 */
async function killDaemon(daemon, home) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(resolve(home, 'daemon.json'), 'utf8')).pid;
  } catch {
    pid = undefined;
  }
  daemon.child.kill('SIGTERM');
  const exit = await exitWithin(daemon, shutdownTimeoutMs);
  if (exit === undefined) {
    daemon.child.kill('SIGKILL');
    await daemon.exited;
  }
  if (Number.isSafeInteger(pid) && pid > 0 && pid !== daemon.child.pid) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * The canary launched this daemon under its own uid in a 0700 home it owns,
 * so it asserts that uid for the connected peer instead of inspecting the
 * socket. Node exposes no peer-credential API; production callers must
 * supply a reviewed provider that does inspect the peer.
 */
export function harnessAssertedSecurity(discovered, home) {
  const uid = process.getuid();
  const socketPath = resolve(home, 'coven.sock');
  const homeStats = lstatSync(home);
  const socketStats = lstatSync(socketPath);
  if (discovered?.endpoint?.kind !== 'unix' || discovered.endpoint.path !== socketPath) {
    fail(`Discovery returned ${describe(discovered?.endpoint)}, expected the canary's socket ${socketPath}.`);
  }
  if (discovered.owner?.uid !== uid || socketStats.uid !== uid || homeStats.uid !== uid) {
    fail('The daemon home, socket, or discovered owner is not owned by the canary user.');
  }
  if (!homeStats.isDirectory() || (homeStats.mode & 0o077) !== 0 || !socketStats.isSocket()) {
    fail('The daemon home must be a private directory holding a Unix socket.');
  }
  return { platform: 'unix', peerIdentity: { inspectConnected: () => Promise.resolve({ uid }) } };
}

async function loadSdk() {
  const entry = resolve(root, 'packages/coven/dist/index.js');
  if (!existsSync(entry)) {
    fail(`${entry} is missing; run corepack pnpm@10.34.0 build first.`);
  }
  return import(pathToFileURL(entry).href);
}

/**
 * Rejects once `signal` aborts. Every step races against it, so an interrupted
 * canary reaches the single cleanup path in `verifyAutomationsDaemon` instead
 * of waiting for an in-flight request or a restart to finish.
 */
function interruption(signal) {
  const interrupted = new Promise((_resolve, reject) => {
    if (signal === undefined) return;
    const abort = () => reject(new Error(`Interrupted by ${String(signal.reason)}.`));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  return (promise) => {
    // The losing step still settles later; nothing may observe it as unhandled.
    promise.catch(() => {});
    return Promise.race([promise, interrupted]);
  };
}

export async function verifyAutomationsDaemon({ coven, expectVersion, signal }) {
  if (process.platform === 'win32') fail('The daemon canary drives the Unix socket transport only.');
  if (!existsSync(coven)) fail(`${coven} does not exist.`);
  const sdk = await loadSdk();
  const temp = createOwnedTempDirectory({ prefix: 'cvn', childSegments: ['h'] });
  const home = temp.path;
  const log = { chunks: [], bytes: 0 };
  const guarded = interruption(signal);
  let daemon;
  try {
    if (Buffer.byteLength(resolve(home, 'coven.sock')) > maxSocketPathBytes) {
      fail(`The socket path under ${home} exceeds ${maxSocketPathBytes} bytes; set TMPDIR to a shorter directory.`);
    }
    verifyCovenVersion(coven, expectVersion, home);
    let starts = 0;
    let previousPid;
    const start = async () => {
      // A restart already under way must not outlive an interruption.
      if (signal?.aborted === true) fail('Interrupted; the daemon was not restarted.');
      daemon = startDaemon(coven, home, log);
      starts += 1;
      await waitForDaemon(daemon, home, signal);
    };
    await guarded(start());
    const connect = async () => {
      const discovered = await sdk.discoverCovenEndpoint({ env: { COVEN_HOME: home } });
      if (discovered.freshness?.daemonPid === previousPid) {
        fail('Discovery after the restart returned the previous daemon instance.');
      }
      previousPid = discovered.freshness?.daemonPid;
      const transport = sdk.createCovenAutomationsUnixTransport(discovered, {
        security: harnessAssertedSecurity(discovered, home),
      });
      return sdk.createCovenAutomationsClient({ transport });
    };
    const restartDaemon = async () => {
      await stopDaemon(daemon, home);
      daemon = undefined;
      await start();
    };
    const result = await guarded(runDaemonScenario({
      sdk, connect, restartDaemon, scheduleHour: quietScheduleHour(),
    }));
    await guarded(stopDaemon(daemon, home));
    daemon = undefined;
    return { ...result, covenVersion: expectVersion, daemonStarts: starts };
  } catch (error) {
    const output = Buffer.concat(log.chunks).toString('utf8').trim();
    if (output.length > 0 && error instanceof Error) {
      error.message += `\n--- coven daemon serve output ---\n${output}`;
    }
    throw error;
  } finally {
    if (daemon !== undefined) await killDaemon(daemon, home);
    cleanupOwnedTempRoot(temp);
  }
}

const exitSignals = { SIGINT: 2, SIGTERM: 15 };

async function main(signal) {
  const result = await verifyAutomationsDaemon({ ...parseDaemonCanaryArguments(process.argv.slice(2)), signal });
  process.stdout.write(
    [
      'Automations v1 daemon verified:',
      `covenVersion=${result.covenVersion}`,
      `daemonStarts=${result.daemonStarts}`,
      `commands=${result.commands}`,
      `replays=${result.replays}`,
      `rejections=${result.rejections}`,
      `events=${result.events}`,
      `subscribePages=${result.subscribePages}`,
      'definitionIntegrity=matches-sdk',
      'adoptionReplayAcrossRestart=passed',
      'checkpointResumeAcrossRestart=passed',
      `eventDefinitionDigest=${result.eventDefinitionDigest}`,
      'peerIdentity=harness-asserted',
    ].join(' ') + '\n',
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Without handlers Node exits on these signals before any cleanup runs.
  const controller = new AbortController();
  for (const name of Object.keys(exitSignals)) {
    process.on(name, () => {
      if (!controller.signal.aborted) controller.abort(name);
    });
  }
  try {
    await main(controller.signal);
  } catch (error) {
    process.stderr.write(
      `Automations v1 daemon canary failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
  if (controller.signal.aborted) {
    // Cleanup is done; do not wait out the interrupted request's own timeout.
    process.exit(128 + exitSignals[controller.signal.reason]);
  }
}
