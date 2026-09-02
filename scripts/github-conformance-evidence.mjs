import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  aggregateConformanceEvidence,
  assertEvidenceProducerCompatibility,
  parseFrozenConformanceLock,
  parsePlatformEvidence,
  parseReviewedEvidenceIndex,
  serializeCanonicalJson,
  validateFrozenConformanceBindings,
} from './conformance-contract.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import { parseReleaseWorkflowDocument } from './release-readiness.mjs';
import {
  createGitHubCliEnvironment,
} from './release-runtime-integrity.mjs';

const MAX_GITHUB_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ATTESTATION_BUNDLE_BYTES = 16 * 1024 * 1024;
const CHECKOUT_ACTION =
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_ACTION =
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const PNPM_SETUP_ACTION =
  'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86';
const UPLOAD_ARTIFACT_ACTION =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWNLOAD_ARTIFACT_ACTION =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const ATTEST_BUILD_PROVENANCE_ACTION =
  'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8';
const CHAT_ENVIRONMENT_REVIEWER_ID = 68_980_965;
const WINDOWS_SUPERVISOR_ARTIFACT = 'phase1-process-supervisor-win32-x64';
const WINDOWS_SUPERVISOR_JOB_NAME = 'build-windows-supervisor';
const WINDOWS_SUPERVISOR_RUNNER_LABELS = ['macos-latest'];
const REVIEWED_WINDOWS_BOOTSTRAP_SCRIPT_SHA256 =
  '10bff1d53efd639ce113705b48ce9e5b57c8baecb7f4abc8f374cd0c3a3dc75f';
const REVIEWED_WINDOWS_CHILD_BOOTSTRAP_SHA256 =
  '92d3c242dad7fc89ff36ba8df1e9f38c98e8a52bb310e35a811b61885e552e6b';
const REVIEWED_UNIX_PRODUCTION_SCRIPT_SHA256 =
  'dd20ff8eedba857ddf198cb2b8e80a7f5ffcecc4e367f1238be9e40bb2b743d9';
const PLATFORM_STEP_CONTRACT = Object.freeze([
  ['Bootstrap supervised Windows conformance', ['name', 'if', 'shell', 'env', 'run']],
  ['Require protected validator revision', ['name', 'if', 'shell', 'env', 'run']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [SETUP_NODE_ACTION, ['uses', 'if', 'with']],
  ['Read Phase 1 reviewed revisions', ['id', 'name', 'if', 'run']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [CHECKOUT_ACTION, ['uses', 'if', 'with']],
  [PNPM_SETUP_ACTION, ['uses', 'if', 'with']],
  ['Install frozen Linux Secret Service', ['name', 'if', 'shell', 'run']],
  ['Install frozen Unix Rust', ['name', 'if', 'run']],
  ['Require frozen toolchain', ['name', 'if', 'run']],
  ['Prepare trusted Unix supervisor', ['name', 'if', 'shell', 'run']],
  ['Compute reviewed Unix tool path', ['name', 'id', 'if', 'run']],
  ['Run supervised Unix production and handoff', ['name', 'if', 'shell', 'env', 'run']],
  ['Validate broker-owned Unix platform record', ['name', 'if', 'shell', 'run']],
  [UPLOAD_ARTIFACT_ACTION, ['uses', 'with']],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGitHubJson(text, label) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error(`${label} response is not bounded UTF-8 JSON`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} response is not valid JSON`, { cause: error });
  }
}

function githubExecutable(env) {
  const path = env.OPENCOVEN_GH_PATH ?? '/usr/bin/gh';
  if (
    typeof path !== 'string'
    || !/^\/(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+$/u.test(path)
  ) {
    throw new Error('OPENCOVEN_GH_PATH must be an absolute executable path');
  }
  return path;
}

function runGh(execute, args, { cwd = process.cwd(), env = process.env } = {}) {
  return execute(githubExecutable(env), args, {
    cwd,
    encoding: 'utf8',
    env: createGitHubCliEnvironment(env),
    maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
}

function expectedBranch(sourceRef) {
  const prefix = 'refs/heads/';
  if (!sourceRef.startsWith(prefix)) {
    throw new Error('Frozen Chat producer sourceRef must name a branch');
  }
  return sourceRef.slice(prefix.length);
}

function exactToolchainCommand(toolchain) {
  return [
    'node --input-type=module --eval "import { execFileSync }',
    'from \'node:child_process\'; import { resolveExecutableInvocation }',
    'from \'./scripts/executable-resolution.mjs\';',
    'const run = (command, args) => { const invocation =',
    'resolveExecutableInvocation(command, process.env, process.platform, args);',
    'return execFileSync(invocation.executable, invocation.args,',
    '{ encoding: \'utf8\' }).trim(); };',
    `if (process.version !== '${toolchain.nodeVersion}'`,
    `|| 'pnpm@' + run('pnpm', ['--version']) !== '${toolchain.pnpmVersion}'`,
    `|| !run('rustc', ['--version']).startsWith('rustc ${toolchain.rustVersion} '))`,
    'throw new Error(\'Frozen toolchain does not match\');"',
  ].join(' ');
}

function exactUnixRustInstallCommand(toolchain) {
  return [
    'node --input-type=module --eval "import { execFileSync }',
    'from \'node:child_process\'; import { resolveExecutableInvocation }',
    'from \'./scripts/executable-resolution.mjs\';',
    'const command = \'rustup\'; const invocation =',
    'resolveExecutableInvocation(command, process.env, process.platform,',
    `['toolchain', 'install', '${toolchain.rustVersion}', '--profile', 'minimal']);`,
    'execFileSync(invocation.executable, invocation.args,',
    '{ argv0: command, stdio: \'inherit\' });"',
  ].join(' ');
}

function exactUnixToolPathCommand() {
  return [
    'node --input-type=module --eval "import { appendFileSync }',
    'from \'node:fs\'; import { resolveUnixToolPath }',
    'from \'./scripts/executable-resolution.mjs\';',
    'const toolPath = resolveUnixToolPath([\'node\', \'pnpm\', \'rustup\']);',
    'appendFileSync(process.env.GITHUB_OUTPUT,',
    '\'tool_path=\' + toolPath + \'\\n\');"',
  ].join(' ');
}

const REVIEWED_WINDOWS_INVOKE_CHECKED_FUNCTION = [
  'function Invoke-Checked {',
  'param(',
  '[Parameter(Mandatory)][string]$FilePath,',
  '[Parameter(Mandatory)][string[]]$ArgumentList,',
  '[Parameter(Mandatory)][string]$Label',
  ')',
  '$startInfo = [Diagnostics.ProcessStartInfo]::new($FilePath)',
  '$startInfo.UseShellExecute = $false',
  'foreach ($argument in $ArgumentList) {',
  '$startInfo.ArgumentList.Add($argument)',
  '}',
  '$process = [Diagnostics.Process]::new()',
  '$process.StartInfo = $startInfo',
  'try {',
  'if (-not $process.Start()) {',
  'throw "$Label failed to start."',
  '}',
  '$process.WaitForExit()',
  'if ($process.ExitCode -ne 0) {',
  'throw "$Label failed with exit code $($process.ExitCode)."',
  '}',
  '} finally {',
  '$process.Dispose()',
  '}',
  '}',
].join('\n');

function tokenizePowerShell(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '`' && source[index + 1] === '\n') {
      index += 2;
      continue;
    }
    if (character === '\n' || character === ';') {
      tokens.push({ type: 'separator', value: character });
      index += 1;
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
      continue;
    }
    if (character === '#') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline;
      continue;
    }
    if (character === '\'' || character === '"') {
      const quote = character;
      const start = index;
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (quote === '\'' && source[index] === '\'' && source[index + 1] === '\'') {
          index += 2;
          continue;
        }
        if (quote === '"' && source[index] === '`' && index + 1 < source.length) {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        return null;
      }
      tokens.push({
        type: 'string',
        value: source.slice(start, index),
      });
      continue;
    }
    if ('{}()[],.='.includes(character)) {
      tokens.push({ type: 'symbol', value: character });
      index += 1;
      continue;
    }
    if (character === '$' && /[A-Za-z_]/u.test(source[index + 1] ?? '')) {
      const start = index;
      index += 2;
      while (/[A-Za-z0-9_:]/u.test(source[index] ?? '')) {
        index += 1;
      }
      tokens.push({
        type: 'variable',
        value: source.slice(start, index),
      });
      continue;
    }
    const start = index;
    while (
      index < source.length
      && !/[\s#'"`;{}()[\],.=]/u.test(source[index])
    ) {
      index += 1;
    }
    if (start === index) {
      tokens.push({ type: 'symbol', value: character });
      index += 1;
    } else {
      tokens.push({
        type: 'word',
        value: source.slice(start, index),
      });
    }
  }
  return tokens;
}

function powerShellFunctionRange(tokens, name) {
  const matches = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].type !== 'word'
      || tokens[index].value.toLowerCase() !== 'function'
      || tokens[index + 1].type !== 'word'
      || tokens[index + 1].value.toLowerCase() !== name.toLowerCase()
      || tokens[index + 2].value !== '{'
    ) {
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === '{') {
        depth += 1;
      } else if (tokens[cursor].value === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end < 0) {
      return null;
    }
    matches.push({ start: index, end });
  }
  return matches.length === 1 ? matches[0] : null;
}

function normalizedPowerShellTokens(tokens) {
  return tokens
    .filter(({ type }) => type !== 'separator')
    .map(({ type, value }) => [type, value]);
}

function singleQuotedPowerShellValue(token) {
  if (
    token?.type !== 'string'
    || !token.value.startsWith('\'')
    || !token.value.endsWith('\'')
  ) {
    return null;
  }
  return token.value.slice(1, -1).replaceAll('\'\'', '\'');
}

function isReviewedWindowsExecutablePath(path) {
  const leaf = path.split(/[\\/]/u).at(-1)?.toLowerCase();
  return (
    typeof leaf === 'string'
    && leaf.endsWith('.exe')
    && leaf !== 'cmd.exe'
    && !leaf.endsWith('.cmd')
    && !leaf.endsWith('.bat')
  );
}

function powerShellVariableName(value) {
  return value.toLowerCase().split(':').at(-1)?.replace(/^\$/u, '');
}

function hasReviewedInvokeCheckedTargets(tokens, functionRange) {
  const invocationIndexes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      (index < functionRange.start || index > functionRange.end)
      && tokens[index].type === 'word'
      && tokens[index].value.toLowerCase() === 'invoke-checked'
    ) {
      invocationIndexes.push(index);
    }
  }
  if (invocationIndexes.length === 0) {
    return false;
  }
  for (const invocationIndex of invocationIndexes) {
    const option = tokens[invocationIndex + 1];
    const target = tokens[invocationIndex + 2];
    if (
      option?.type !== 'word'
      || option.value.toLowerCase() !== '-filepath'
      || target?.type !== 'variable'
    ) {
      return false;
    }
    const targetName = powerShellVariableName(target.value);
    const assignments = [];
    for (let index = 0; index < tokens.length - 4; index += 1) {
      if (
        (index < functionRange.start || index > functionRange.end)
        && tokens[index].type === 'variable'
        && powerShellVariableName(tokens[index].value) === targetName
        && tokens[index + 1].value === '='
      ) {
        assignments.push(index);
      }
    }
    if (assignments.length !== 1) {
      return false;
    }
    const assignmentIndex = assignments[0];
    const path = singleQuotedPowerShellValue(tokens[assignmentIndex + 4]);
    const terminator = tokens[assignmentIndex + 5];
    if (
      tokens[assignmentIndex + 2].type !== 'word'
      || tokens[assignmentIndex + 2].value.toLowerCase() !== 'join-path'
      || tokens[assignmentIndex + 3].type !== 'variable'
      || path === null
      || (terminator !== undefined && terminator.type !== 'separator')
      || !isReviewedWindowsExecutablePath(path)
    ) {
      return false;
    }
  }
  return true;
}

function reviewedWindowsChildBootstrap(source) {
  const lines = source.split('\n');
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "  $childBootstrap = @'") {
      starts.push(index);
    }
  }
  if (starts.length !== 1) {
    return null;
  }
  const end = lines.findIndex(
    (line, index) => index > starts[0] && line === "'@",
  );
  if (end < 0) {
    return null;
  }
  return lines.slice(starts[0] + 1, end).join('\n');
}

function usesReviewedWindowsProcessLauncher(run, launcherScript) {
  if (/\$(?:[A-Za-z_][A-Za-z0-9_]*:)?lastexitcode\b/iu.test(run)) {
    return false;
  }
  const allLauncherReferences = run.match(/\bInvoke-Checked\b/giu) ?? [];
  const parsedLauncherReferences =
    launcherScript.match(/\bInvoke-Checked\b/giu) ?? [];
  if (
    allLauncherReferences.length !== parsedLauncherReferences.length
    || /\$\{/u.test(launcherScript)
    || /\b(?:Clear|New|Remove|Set)-Variable\b/iu.test(launcherScript)
  ) {
    return false;
  }
  const tokens = tokenizePowerShell(launcherScript);
  const reviewedTokens = tokenizePowerShell(
    REVIEWED_WINDOWS_INVOKE_CHECKED_FUNCTION,
  );
  if (tokens === null || reviewedTokens === null) {
    return false;
  }
  const functionRange = powerShellFunctionRange(tokens, 'Invoke-Checked');
  if (functionRange === null) {
    return false;
  }
  const functionTokens = tokens.slice(
    functionRange.start,
    functionRange.end + 1,
  );
  return (
    JSON.stringify(normalizedPowerShellTokens(functionTokens))
      === JSON.stringify(normalizedPowerShellTokens(reviewedTokens))
    && hasReviewedInvokeCheckedTargets(tokens, functionRange)
    && run.includes(
      "$npmCli = Join-Path $nodeRoot 'node_modules\\npm\\bin\\npm-cli.js'",
    )
    && run.includes(
      "$pnpmCli = Join-Path $pnpmRoot 'node_modules\\pnpm\\bin\\pnpm.cjs'",
    )
    && run.includes('(& $node $pnpmCli --version).Trim()')
    && run.includes('(& $node $pnpmCli exec tauri --version).Trim()')
    && /-FilePath \$node(?: `)?\s*-ArgumentList @\(\s*\$npmCli,\s*'install',/u.test(run)
    && /-FilePath \$node(?: `)?\s*-ArgumentList @\(\s*\$pnpmCli,\s*'install',/u.test(run)
  );
}

function tokenizeShellScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '\n') {
      index += 2;
      continue;
    }
    if (character === '\n' || ';|&'.includes(character)) {
      tokens.push({ type: 'separator', raw: character, value: character });
      index += 1;
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
      continue;
    }
    if (character === '#') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline;
      continue;
    }
    const start = index;
    let raw = '';
    let value = '';
    while (index < source.length) {
      const current = source[index];
      if (
        current === '\n'
        || current === ';'
        || current === '|'
        || current === '&'
        || current === ' '
        || current === '\t'
        || current === '\r'
      ) {
        break;
      }
      if (current === '\\' && source[index + 1] === '\n') {
        index += 2;
        continue;
      }
      if (current === '\'' || current === '"') {
        const quote = current;
        const quoteStart = index;
        index += 1;
        let closed = false;
        while (index < source.length) {
          if (quote === '"' && source[index] === '\\' && index + 1 < source.length) {
            index += 2;
            continue;
          }
          if (source[index] === quote) {
            value += source.slice(quoteStart + 1, index);
            index += 1;
            raw += source.slice(quoteStart, index);
            closed = true;
            break;
          }
          index += 1;
        }
        if (!closed) {
          return null;
        }
        continue;
      }
      raw += current;
      value += current;
      index += 1;
    }
    if (start === index) {
      return null;
    }
    tokens.push({ type: 'word', raw, value });
  }
  return tokens;
}

function hasExactReviewedUnixToolPathArgument(run) {
  const tokens = tokenizeShellScript(run);
  if (tokens === null) {
    return false;
  }
  const starts = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].type === 'word'
      && tokens[index].raw === 'sudo'
      && tokens[index + 1].type === 'word'
      && tokens[index + 1].raw === '--non-interactive'
      && tokens[index + 2].type === 'word'
      && tokens[index + 2].raw === 'scripts/unix-producer-supervisor.sh'
    ) {
      starts.push(index);
    }
  }
  if (starts.length !== 1) {
    return false;
  }
  const command = [];
  for (let index = starts[0]; index < tokens.length; index += 1) {
    if (tokens[index].type === 'separator') {
      break;
    }
    command.push(tokens[index]);
  }
  const optionIndexes = [];
  for (let index = 0; index < command.length; index += 1) {
    if (
      command[index].value === '--tool-path'
      || command[index].value.startsWith('--tool-path=')
    ) {
      optionIndexes.push(index);
    }
  }
  if (optionIndexes.length !== 1) {
    return false;
  }
  const optionIndex = optionIndexes[0];
  return (
    command[optionIndex].raw === '--tool-path'
    && command[optionIndex + 1]?.raw
      === '"${{ steps[\'unix-tool-path\'].outputs.tool_path }}"'
  );
}

function workflowError(message) {
  throw new Error(`Frozen Chat workflow ${message}`);
}

function expectExactWorkflowValue(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    workflowError(`does not use the exact reviewed ${label}`);
  }
}

function splitJob(job, label) {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    workflowError(`${label} job is malformed`);
  }
  const { steps, ...configuration } = job;
  return { configuration, steps };
}

function namedStep(steps, name, label) {
  const matches = steps.filter(
    (step) => isRecord(step) && step.name === name,
  );
  if (matches.length !== 1) {
    workflowError(`${label} must contain exactly one "${name}" step`);
  }
  return matches[0];
}

function collectUses(value, uses = []) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUses(entry, uses);
    }
  } else if (isRecord(value)) {
    if (typeof value.uses === 'string') {
      uses.push(value.uses);
    }
    for (const entry of Object.values(value)) {
      collectUses(entry, uses);
    }
  }
  return uses;
}

function verifyProtectedWorkflowGraph(workflow, producer, toolchain) {
  const protectedExpression =
    `\${{ vars.${producer.workflow.validatorRevisionEnvironment} }}`;
  const inputExpression = '${{ inputs.validator_revision }}';
  const matrixExpression = '${{ matrix.platform }}';
  const expectedArtifacts = Object.fromEntries(
    producer.workflow.artifacts.map((artifact) => [
      artifact.platform,
      artifact,
    ]),
  );
  const expectedJobIds = [
    'windows-supervisor',
    producer.workflow.job,
    producer.workflow.validationJob,
    producer.workflow.attestationJob,
    producer.workflow.aggregationJob,
  ];

  expectExactWorkflowValue(
    Object.keys(workflow),
    ['name', 'on', 'permissions', 'jobs'],
    'top-level keys',
  );
  expectExactWorkflowValue(workflow.name, producer.workflow.name, 'workflow name');
  expectExactWorkflowValue(
    workflow.on,
    {
      workflow_dispatch: {
        inputs: {
          validator_revision: {
            required: true,
            type: 'string',
          },
        },
      },
    },
    'workflow dispatch input',
  );
  expectExactWorkflowValue(
    workflow.permissions,
    { contents: 'read' },
    'top-level permissions',
  );
  if (!isRecord(workflow.jobs)) {
    workflowError('jobs are malformed');
  }
  expectExactWorkflowValue(
    Object.keys(workflow.jobs),
    expectedJobIds,
    'five-job graph',
  );

  const windows = splitJob(
    workflow.jobs['windows-supervisor'],
    'Windows supervisor',
  );
  const platform = splitJob(
    workflow.jobs[producer.workflow.job],
    'platform producer',
  );
  const validation = splitJob(
    workflow.jobs[producer.workflow.validationJob],
    'validation',
  );
  const attestation = splitJob(
    workflow.jobs[producer.workflow.attestationJob],
    'attestation',
  );
  const aggregation = splitJob(
    workflow.jobs[producer.workflow.aggregationJob],
    'aggregation',
  );
  if (platform.steps.length !== PLATFORM_STEP_CONTRACT.length) {
    workflowError('does not use the exact reviewed platform step count');
  }
  for (const [index, [identity, keys]] of PLATFORM_STEP_CONTRACT.entries()) {
    const step = platform.steps[index];
    if (!isRecord(step) || (step.name ?? step.uses) !== identity) {
      workflowError(`does not use the reviewed platform step ${index + 1}`);
    }
    expectExactWorkflowValue(
      Object.keys(step),
      keys,
      `platform step ${index + 1} keys`,
    );
  }

  const mainRefCondition = `github.ref == '${producer.workflow.sourceRef}'`;
  expectExactWorkflowValue(
    windows.configuration,
    {
      name: WINDOWS_SUPERVISOR_JOB_NAME,
      if: mainRefCondition,
      'runs-on': WINDOWS_SUPERVISOR_RUNNER_LABELS[0],
      'timeout-minutes': 30,
      permissions: { contents: 'read' },
      outputs: {
        artifact_id: "${{ steps['upload-supervisor'].outputs['artifact-id'] }}",
      },
    },
    'Windows supervisor job configuration',
  );
  expectExactWorkflowValue(
    platform.configuration,
    {
      name: producer.workflow.jobNameTemplate.replace(
        '{platform}',
        matrixExpression,
      ),
      if: mainRefCondition,
      needs: 'windows-supervisor',
      'timeout-minutes': 60,
      strategy: {
        'fail-fast': false,
        matrix: {
          include: Object.entries(producer.workflow.runnerLabels).map(
            ([platformName, labels]) => ({
              platform: platformName,
              runner: labels[0],
            }),
          ),
        },
      },
      'runs-on': '${{ matrix.runner }}',
      environment: producer.workflow.environment,
      permissions: { actions: 'read', contents: 'read' },
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.autocrlf',
        GIT_CONFIG_VALUE_0: 'false',
      },
    },
    'platform producer job configuration',
  );
  const validationOutputs = Object.fromEntries(
    producer.workflow.artifacts.map(({ platform: platformName }) => {
      const output = `${platformName.replaceAll('-', '_')}_sha256`;
      return [output, `\${{ steps.validate.outputs.${output} }}`];
    }),
  );
  expectExactWorkflowValue(
    validation.configuration,
    {
      name: producer.workflow.validationJobName,
      if: mainRefCondition,
      needs: producer.workflow.job,
      'runs-on': producer.workflow.aggregationRunnerLabels[0],
      environment: producer.workflow.environment,
      permissions: { contents: 'read' },
      outputs: validationOutputs,
    },
    'validation job configuration',
  );
  expectExactWorkflowValue(
    attestation.configuration,
    {
      name: producer.workflow.attestationJobName,
      if: mainRefCondition,
      needs: producer.workflow.validationJob,
      'runs-on': producer.workflow.aggregationRunnerLabels[0],
      environment: producer.workflow.environment,
      permissions: {
        attestations: 'write',
        contents: 'read',
        'id-token': 'write',
      },
    },
    'attestation job configuration',
  );
  expectExactWorkflowValue(
    aggregation.configuration,
    {
      name: producer.workflow.aggregationJobName,
      if: mainRefCondition,
      needs: producer.workflow.attestationJob,
      'runs-on': producer.workflow.aggregationRunnerLabels[0],
      permissions: {},
    },
    'aggregation job configuration',
  );
  expectExactWorkflowValue(
    aggregation.steps,
    [
      {
        name: 'Confirm protected evidence matrix',
        run: 'echo "protected evidence matrix completed"',
      },
    ],
    'aggregation steps',
  );

  const expectedUses = new Map([
    [CHECKOUT_ACTION, 8],
    [SETUP_NODE_ACTION, 3],
    [PNPM_SETUP_ACTION, 1],
    [UPLOAD_ARTIFACT_ACTION, 2],
    [producer.workflow.downloadArtifactAction, 6],
    [producer.workflow.attestationAction, 3],
  ]);
  if (
    producer.workflow.downloadArtifactAction !== DOWNLOAD_ARTIFACT_ACTION
    || producer.workflow.attestationAction !== ATTEST_BUILD_PROVENANCE_ACTION
  ) {
    workflowError('metadata does not identify the reviewed action pins');
  }
  const uses = collectUses(workflow);
  if (
    uses.length !== [...expectedUses.values()].reduce((sum, count) => sum + count, 0)
    || uses.some((action) => !expectedUses.has(action))
    || [...expectedUses].some(
      ([action, count]) =>
        uses.filter((candidate) => candidate === action).length !== count,
    )
  ) {
    workflowError('does not use only the exact reviewed action pins');
  }

  const windowsUpload = windows.steps.at(-1);
  if (windows.steps.length !== 5) {
    workflowError('does not isolate the Windows supervisor build');
  }
  expectExactWorkflowValue(
    windows.steps[0],
    {
      uses: CHECKOUT_ACTION,
      with: {
        'fetch-depth': 0,
        'persist-credentials': false,
        ref: '${{ github.sha }}',
      },
    },
    'Windows supervisor checkout',
  );
  expectExactWorkflowValue(
    windows.steps[1],
    {
      uses: SETUP_NODE_ACTION,
      with: {
        'node-version': toolchain.nodeVersion.slice(1),
      },
    },
    'Windows supervisor Node setup',
  );
  expectExactWorkflowValue(
    windows.steps[2],
    {
      name: 'Set up frozen Rust',
      run:
        `rustup toolchain install ${toolchain.rustVersion} `
        + `--profile minimal && rustup default ${toolchain.rustVersion}`,
    },
    'Windows supervisor Rust setup',
  );
  expectExactWorkflowValue(
    windows.steps[3],
    {
      name: 'Build frozen Windows supervisor',
      run: 'bash scripts/phase1-windows-supervisor-build.sh',
    },
    'Windows supervisor build',
  );
  expectExactWorkflowValue(
    windowsUpload,
    {
      id: 'upload-supervisor',
      uses: UPLOAD_ARTIFACT_ACTION,
      with: {
        name: WINDOWS_SUPERVISOR_ARTIFACT,
        path:
          'tools/phase1-process-supervisor/target/'
          + 'x86_64-pc-windows-gnu/release/phase1-process-supervisor.exe',
        'if-no-files-found': 'error',
        'retention-days': 30,
        overwrite: false,
        'include-hidden-files': false,
      },
    },
    'Windows supervisor upload',
  );

  const windowsBootstrap = namedStep(
    platform.steps,
    'Bootstrap supervised Windows conformance',
    'platform producer',
  );
  if (
    windowsBootstrap.if !== "matrix.platform == 'win32-x64'"
    || windowsBootstrap.shell !== 'pwsh'
    || !isRecord(windowsBootstrap.env)
    || windowsBootstrap.env.OPENCOVEN_VALIDATOR_REVISION_INPUT
      !== inputExpression
    || windowsBootstrap.env.OPENCOVEN_PROTECTED_VALIDATOR_REVISION
      !== protectedExpression
    || typeof windowsBootstrap.run !== 'string'
    || !windowsBootstrap.run.includes(
      '$validatorRevision -cne $protectedValidatorRevision',
    )
  ) {
    workflowError('does not bind the Windows producer to the protected validator');
  }
  const windowsChildBootstrap = reviewedWindowsChildBootstrap(
    windowsBootstrap.run,
  );
  if (
    windowsChildBootstrap === null
    || sha256(windowsChildBootstrap)
      !== REVIEWED_WINDOWS_CHILD_BOOTSTRAP_SHA256
  ) {
    workflowError('does not use the exact canonical Windows child bootstrap source');
  }
  if (
    producer.workflow.windowsBootstrapScriptSha256
      !== REVIEWED_WINDOWS_BOOTSTRAP_SCRIPT_SHA256
    || sha256(windowsBootstrap.run)
      !== REVIEWED_WINDOWS_BOOTSTRAP_SCRIPT_SHA256
  ) {
    workflowError('does not use the exact canonical Windows bootstrap source');
  }
  if (
    !usesReviewedWindowsProcessLauncher(
      windowsBootstrap.run,
      windowsChildBootstrap,
    )
  ) {
    workflowError('does not use the reviewed Windows process launcher');
  }
  const validatorGuard = namedStep(
    platform.steps,
    'Require protected validator revision',
    'platform producer',
  );
  if (
    validatorGuard.if !== "matrix.platform != 'win32-x64'"
    || validatorGuard.shell !== 'bash'
    || !isRecord(validatorGuard.env)
    || JSON.stringify(validatorGuard.env)
      !== JSON.stringify({
        OPENCOVEN_VALIDATOR_REVISION_INPUT: inputExpression,
        OPENCOVEN_PROTECTED_VALIDATOR_REVISION: protectedExpression,
      })
    || typeof validatorGuard.run !== 'string'
    || sha256(validatorGuard.run)
      !== producer.workflow.validatorRevisionScriptSha256
  ) {
    workflowError('does not enforce the protected Unix validator revision');
  }

  const producerCheckout = platform.steps.filter(
    (step) =>
      isRecord(step)
      && step.uses === CHECKOUT_ACTION
      && isRecord(step.with)
      && step.with.ref === '${{ github.sha }}',
  );
  if (
    producerCheckout.length !== 1
    || producerCheckout[0].if !== "matrix.platform != 'win32-x64'"
    || producerCheckout[0].with['fetch-depth'] !== 0
    || producerCheckout[0].with['persist-credentials'] !== false
  ) {
    workflowError('does not use the exact full-history Chat checkout');
  }
  const counterpartCheckouts = [
    {
      repository:
        "${{ steps['phase1-revisions'].outputs.sdk_repository }}",
      ref: "${{ steps['phase1-revisions'].outputs.sdk_revision }}",
      path: '.phase1-counterparts/sdk',
    },
    {
      repository:
        "${{ steps['phase1-revisions'].outputs.evidence_repository }}",
      ref: "${{ steps['phase1-revisions'].outputs.evidence_revision }}",
      path: '.phase1-counterparts/sdk-evidence',
    },
    {
      repository: 'OpenCoven/sdk',
      ref: inputExpression,
      path: '.phase1-counterparts/sdk-validator',
    },
    {
      repository:
        "${{ steps['phase1-revisions'].outputs.cave_repository }}",
      ref: "${{ steps['phase1-revisions'].outputs.cave_revision }}",
      path: '.phase1-counterparts/coven-cave',
    },
    {
      repository:
        "${{ steps['phase1-revisions'].outputs.coven_repository }}",
      ref: "${{ steps['phase1-revisions'].outputs.coven_revision }}",
      path: '.phase1-counterparts/coven',
    },
  ];
  for (const checkout of counterpartCheckouts) {
    const matches = platform.steps.filter(
      (step) =>
        isRecord(step)
        && step.uses === CHECKOUT_ACTION
        && isRecord(step.with)
        && step.with.path === checkout.path,
    );
    expectExactWorkflowValue(
      matches,
      [
        {
          uses: CHECKOUT_ACTION,
          if: "matrix.platform != 'win32-x64'",
          with: {
            ...checkout,
            'persist-credentials': false,
          },
        },
      ],
      `${checkout.path} checkout`,
    );
  }
  expectExactWorkflowValue(
    platform.steps[3],
    {
      uses: SETUP_NODE_ACTION,
      if: "matrix.platform != 'win32-x64'",
      with: {
        'node-version': toolchain.nodeVersion.slice(1),
      },
    },
    'platform Node setup',
  );
  const phase1Revisions = namedStep(
    platform.steps,
    'Read Phase 1 reviewed revisions',
    'platform producer',
  );
  if (
    phase1Revisions.id !== 'phase1-revisions'
    || phase1Revisions.if !== "matrix.platform != 'win32-x64'"
    || typeof phase1Revisions.run !== 'string'
    || sha256(phase1Revisions.run)
      !== producer.workflow.phase1RevisionsScriptSha256
  ) {
    workflowError('does not read the exact reviewed Phase 1 revisions');
  }
  expectExactWorkflowValue(
    platform.steps[10],
    {
      uses: PNPM_SETUP_ACTION,
      if: "matrix.platform != 'win32-x64'",
      with: {
        version: toolchain.pnpmVersion.slice('pnpm@'.length),
      },
    },
    'platform pnpm setup',
  );
  const requiredWindowsPins = {
    OPENCOVEN_WINDOWS_IMAGE_OS: 'win25-vs2026',
    OPENCOVEN_WINDOWS_IMAGE_VERSION: '20260824.214.3',
    OPENCOVEN_WINDOWS_BUILD: '26100.33296',
    OPENCOVEN_WINDOWS_KERNEL32_VERSION: '10.0.26100.33296',
    OPENCOVEN_WINDOWS_POWERSHELL_VERSION: '7.6.5',
    OPENCOVEN_WINDOWS_POWERSHELL_PATH:
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    OPENCOVEN_WINDOWS_DOTNET_VERSION: '10.0.11',
    OPENCOVEN_WINDOWS_VS_VERSION: '18.9.12112.369',
    OPENCOVEN_WINDOWS_VS_PATH:
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise',
    OPENCOVEN_WINDOWS_MSVC_VERSION: '14.44.35207',
    OPENCOVEN_WINDOWS_MSVC_PATH:
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207',
    OPENCOVEN_WINDOWS_CL_PATH:
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe',
    OPENCOVEN_WINDOWS_LINK_PATH:
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe',
    OPENCOVEN_WINDOWS_SDK_VERSION: '10.0.26100.0',
    OPENCOVEN_WINDOWS_RC_PATH:
      'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\rc.exe',
  };
  for (const [name, value] of Object.entries(requiredWindowsPins)) {
    if (windowsBootstrap.env[name] !== value) {
      workflowError(`does not pin the reviewed Windows value ${name}`);
    }
  }
  expectExactWorkflowValue(
    windowsBootstrap.env,
    {
      OPENCOVEN_VALIDATOR_REVISION_INPUT: inputExpression,
      OPENCOVEN_PROTECTED_VALIDATOR_REVISION: protectedExpression,
      OPENCOVEN_CHAT_REPOSITORY: '${{ github.repository }}',
      OPENCOVEN_CHAT_SHA: '${{ github.sha }}',
      ...requiredWindowsPins,
      OPENCOVEN_WINDOWS_SUPERVISOR_ARTIFACT_ID:
        "${{ needs['windows-supervisor'].outputs.artifact_id }}",
      OPENCOVEN_WINDOWS_GITHUB_API_URL: '${{ github.api_url }}',
      OPENCOVEN_WINDOWS_GITHUB_REPOSITORY: '${{ github.repository }}',
      OPENCOVEN_WINDOWS_GITHUB_TOKEN: '${{ github.token }}',
    },
    'Windows bootstrap environment',
  );

  const unixRust = namedStep(
    platform.steps,
    'Install frozen Unix Rust',
    'platform producer',
  );
  if (
    unixRust.if !== "matrix.platform != 'win32-x64'"
    || unixRust.run !== exactUnixRustInstallCommand(toolchain)
  ) {
    workflowError('does not install the reviewed Unix Rust toolchain');
  }
  const linuxSecretService = namedStep(
    platform.steps,
    'Install frozen Linux Secret Service',
    'platform producer',
  );
  if (
    linuxSecretService.if
      !== "matrix.platform != 'win32-x64' && matrix.platform == 'linux-x64'"
    || linuxSecretService.shell !== 'bash'
    || typeof linuxSecretService.run !== 'string'
    || sha256(linuxSecretService.run)
      !== producer.workflow.linuxKeyringSetupScriptSha256
    || !linuxSecretService.run.includes('sudo apt-get install')
    || !linuxSecretService.run.includes('dbus-daemon=1.14.10-4ubuntu4.1')
    || !linuxSecretService.run.includes('gnome-keyring=46.1-2ubuntu0.2')
    || !linuxSecretService.run.includes('libsecret-tools=0.21.4-1build3')
  ) {
    workflowError('does not install the reviewed Linux Secret Service packages');
  }
  const toolchainStep = namedStep(
    platform.steps,
    'Require frozen toolchain',
    'platform producer',
  );
  if (
    toolchainStep.if !== "matrix.platform != 'win32-x64'"
    || toolchainStep.run !== exactToolchainCommand(toolchain)
    || toolchainStep.run.includes("run('rustup', ['run'")
  ) {
    workflowError('does not verify the exact proxy-safe frozen toolchain');
  }
  const unixSupervisorPreparation = namedStep(
    platform.steps,
    'Prepare trusted Unix supervisor',
    'platform producer',
  );
  if (
    unixSupervisorPreparation.if !== "matrix.platform != 'win32-x64'"
    || unixSupervisorPreparation.shell !== 'bash'
    || typeof unixSupervisorPreparation.run !== 'string'
    || sha256(unixSupervisorPreparation.run)
      !== producer.workflow.unixSupervisorPreparationScriptSha256
  ) {
    workflowError('does not prepare the exact trusted Unix supervisor');
  }
  const unixToolPath = namedStep(
    platform.steps,
    'Compute reviewed Unix tool path',
    'platform producer',
  );
  if (
    unixToolPath.id !== 'unix-tool-path'
    || unixToolPath.if !== "matrix.platform != 'win32-x64'"
    || unixToolPath.run !== exactUnixToolPathCommand()
    || sha256(unixToolPath.run)
      !== producer.workflow.unixToolPathScriptSha256
  ) {
    workflowError('does not compute the exact reviewed Unix tool path');
  }
  const unixProduction = namedStep(
    platform.steps,
    'Run supervised Unix production and handoff',
    'platform producer',
  );
  if (
    unixProduction.if !== "matrix.platform != 'win32-x64'"
    || unixProduction.shell !== 'bash'
    || !isRecord(unixProduction.env)
    || JSON.stringify(unixProduction.env)
      !== JSON.stringify({
        OPENCOVEN_VALIDATOR_REVISION: protectedExpression,
      })
    || typeof unixProduction.run !== 'string'
  ) {
    workflowError('does not configure supervised Unix evidence production');
  }
  if (
    producer.workflow.unixProductionScriptSha256
      !== REVIEWED_UNIX_PRODUCTION_SCRIPT_SHA256
    || sha256(unixProduction.run)
      !== REVIEWED_UNIX_PRODUCTION_SCRIPT_SHA256
  ) {
    workflowError('does not use the exact canonical Unix production source');
  }
  if (
    !unixProduction.run.includes(
      'sudo --non-interactive scripts/unix-producer-supervisor.sh',
    )
    || !unixProduction.run.includes(
      '--command scripts/unix-producer-command.sh',
    )
    || !hasExactReviewedUnixToolPathArgument(unixProduction.run)
    || !unixProduction.run.includes(
      '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
    )
    || !unixProduction.run.includes(
      '--destination "$GITHUB_WORKSPACE/.artifacts/client-v1-conformance-${{ matrix.platform }}.json"',
    )
  ) {
    workflowError('does not use supervised Unix evidence production');
  }
  const unixValidation = namedStep(
    platform.steps,
    'Validate broker-owned Unix platform record',
    'platform producer',
  );
  if (
    unixValidation.if !== "matrix.platform != 'win32-x64'"
    || unixValidation.shell !== 'bash'
    || typeof unixValidation.run !== 'string'
    || sha256(unixValidation.run)
      !== producer.workflow.unixValidationScriptSha256
    || platform.steps.at(-2) !== unixValidation
  ) {
    workflowError('does not validate broker-owned evidence immediately before upload');
  }
  const platformUpload = platform.steps.at(-1);
  expectExactWorkflowValue(
    platformUpload,
    {
      uses: UPLOAD_ARTIFACT_ACTION,
      with: {
        name: producer.workflow.artifactNameTemplate.replace(
          '{platform}',
          matrixExpression,
        ),
        path: producer.workflow.recordPathTemplate.replace(
          '{platform}',
          matrixExpression,
        ),
        'if-no-files-found': 'error',
        'retention-days': 30,
        overwrite: false,
        'include-hidden-files': true,
      },
    },
    'platform artifact upload',
  );

  if (validation.steps.length !== 7 || attestation.steps.length !== 7) {
    workflowError('does not isolate validation and attestation controls');
  }
  const validationGuard = validation.steps[0];
  if (
    !isRecord(validationGuard)
    || JSON.stringify(Object.keys(validationGuard))
      !== JSON.stringify(['name', 'shell', 'env', 'run'])
    || validationGuard.name !== 'Require protected validator revision'
    || validationGuard.shell !== 'bash'
    || 'if' in validationGuard
    || !isRecord(validationGuard.env)
    || JSON.stringify(validationGuard.env)
      !== JSON.stringify({
        OPENCOVEN_VALIDATOR_REVISION_INPUT: inputExpression,
        OPENCOVEN_PROTECTED_VALIDATOR_REVISION: protectedExpression,
      })
    || typeof validationGuard.run !== 'string'
    || sha256(validationGuard.run)
      !== producer.workflow.validationGuardScriptSha256
    || !validationGuard.run.includes(
      '"$OPENCOVEN_VALIDATOR_REVISION_INPUT" != "$OPENCOVEN_PROTECTED_VALIDATOR_REVISION"',
    )
  ) {
    workflowError('validation does not require the protected validator revision');
  }
  for (const [index, artifact] of producer.workflow.artifacts.entries()) {
    const expectedDownload = {
      uses: producer.workflow.downloadArtifactAction,
      with: { name: artifact.name, path: '.artifacts' },
    };
    expectExactWorkflowValue(
      validation.steps[index + 1],
      expectedDownload,
      `${artifact.platform} validation download`,
    );
    expectExactWorkflowValue(
      attestation.steps[index],
      expectedDownload,
      `${artifact.platform} attestation download`,
    );
  }
  expectExactWorkflowValue(
    validation.steps[4],
    {
      uses: CHECKOUT_ACTION,
      with: {
        repository: 'OpenCoven/sdk',
        ref: protectedExpression,
        path: 'validator',
        'persist-credentials': false,
      },
    },
    'protected validator checkout',
  );
  expectExactWorkflowValue(
    validation.steps[5],
    {
      uses: SETUP_NODE_ACTION,
      with: {
        'node-version': toolchain.nodeVersion.slice(1),
      },
    },
    'validation Node setup',
  );
  const validationStep = validation.steps[6];
  if (
    !isRecord(validationStep)
    || JSON.stringify(Object.keys(validationStep))
      !== JSON.stringify(['name', 'id', 'shell', 'run'])
    || validationStep.name
      !== 'Validate exact SDK schema, parser, and scanner'
    || validationStep.id !== 'validate'
    || validationStep.shell !== 'bash'
    || 'if' in validationStep
    || typeof validationStep.run !== 'string'
    || sha256(validationStep.run)
      !== producer.workflow.validationScriptSha256
    || !validationStep.run.includes('parsePlatformEvidence(')
    || !validationStep.run.includes('scanConformanceEvidence(record)')
    || !validationStep.run.includes('serializeCanonicalJson(record) !== text')
    || !validationStep.run.includes(
      "createHash('sha256').update(bytes).digest('hex')",
    )
  ) {
    workflowError('fresh SDK validation is incomplete or conditional');
  }

  const digestStep = attestation.steps[3];
  if (
    !isRecord(digestStep)
    || JSON.stringify(Object.keys(digestStep))
      !== JSON.stringify(['name', 'shell', 'env', 'run'])
    || digestStep.name !== 'Compare freshly downloaded artifact digests'
    || digestStep.shell !== 'bash'
    || 'if' in digestStep
    || !isRecord(digestStep.env)
    || JSON.stringify(digestStep.env)
      !== JSON.stringify({
        OPENCOVEN_VALIDATOR_REVISION_INPUT: inputExpression,
        OPENCOVEN_PROTECTED_VALIDATOR_REVISION: protectedExpression,
        OPENCOVEN_DARWIN_ARM64_SHA256:
          `\${{ needs['${producer.workflow.validationJob}'].outputs.darwin_arm64_sha256 }}`,
        OPENCOVEN_LINUX_X64_SHA256:
          `\${{ needs['${producer.workflow.validationJob}'].outputs.linux_x64_sha256 }}`,
        OPENCOVEN_WIN32_X64_SHA256:
          `\${{ needs['${producer.workflow.validationJob}'].outputs.win32_x64_sha256 }}`,
      })
    || typeof digestStep.run !== 'string'
    || sha256(digestStep.run)
      !== producer.workflow.attestationScriptSha256
    || !digestStep.run.includes(
      '"$OPENCOVEN_VALIDATOR_REVISION_INPUT" != "$OPENCOVEN_PROTECTED_VALIDATOR_REVISION"',
    )
    || producer.workflow.artifacts.some(
      ({ recordPath }) =>
        !digestStep.run.includes(recordPath)
        || digestStep.run.split(recordPath).length - 1 < 1,
    )
    || digestStep.run.split('sha256sum').length - 1 !== 3
  ) {
    workflowError('attestation does not compare the exact validated digests');
  }
  for (const [index, artifact] of producer.workflow.artifacts.entries()) {
    expectExactWorkflowValue(
      attestation.steps[index + 4],
      {
        uses: producer.workflow.attestationAction,
        with: { 'subject-path': artifact.recordPath },
      },
      `${artifact.platform} provenance attestation`,
    );
    if (expectedArtifacts[artifact.platform] !== artifact) {
      workflowError('artifact metadata is not unique');
    }
  }
}

export function verifyProtectedWorkflow(text, producer, toolchain) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error('Frozen Chat workflow response is not bounded UTF-8 text');
  }
  const workflowBytes = Buffer.from(text, 'utf8');
  if (
    workflowBytes.byteLength !== producer.workflow.size
    || sha256(workflowBytes) !== producer.workflow.sha256
  ) {
    throw new Error(
      'Frozen Chat workflow bytes do not match the reviewed workflow digest',
    );
  }
  if (
    !text.endsWith('\n')
    || text.includes('\r')
    || text.includes('\t')
    || /[^\n\x20-\x7e]/u.test(text)
  ) {
    throw new Error(
      'Frozen Chat workflow must use canonical printable ASCII LF YAML',
    );
  }
  if (
    /^[ ]*[A-Za-z0-9_-]+:\s*>[+-]?\s*(?:#.*)?$/mu.test(text)
  ) {
    throw new Error(
      'Frozen Chat workflow must not use folded YAML scalars',
    );
  }
  let workflow;
  try {
    workflow = parseReleaseWorkflowDocument(text);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(
      `Frozen Chat workflow must be valid unambiguous YAML${detail}`,
      { cause: error },
    );
  }
  verifyProtectedWorkflowGraph(workflow, producer, toolchain);
}

function expectSuccessfulRun(value, expected, label) {
  if (
    !isRecord(value)
    || value.id !== Number(expected.runId)
    || value.name !== expected.producer.workflow.name
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.head_branch !== expectedBranch(expected.producer.workflow.sourceRef)
    || value.path !== expected.producer.workflow.path
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !isRecord(value.repository)
    || value.repository.full_name !== expected.producer.repository
    || !isRecord(value.head_repository)
    || value.head_repository.full_name !== expected.producer.repository
  ) {
    throw new Error(`${label} does not match the frozen successful workflow run`);
  }
}

function expectedJobUrl(expected) {
  return (
    `https://github.com/${expected.producer.repository}/actions/runs/`
    + `${expected.runId}/job/${expected.jobId}`
  );
}

function expectSuccessfulJob(value, expected, label) {
  const expectedName = expected.producer.workflow.jobNameTemplate.replace(
    '{platform}',
    expected.platform,
  );
  const expectedLabels =
    expected.producer.workflow.runnerLabels[expected.platform];
  if (
    !isRecord(value)
    || value.id !== Number(expected.jobId)
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url !== expectedJobUrl(expected)
    || value.name !== expectedName
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(expectedLabels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the frozen successful GitHub job id`);
  }
  return value;
}

function expectSuccessfulAggregationJob(value, expected, label) {
  const labels = expected.producer.workflow.aggregationRunnerLabels;
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.id)
    || value.id <= 0
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url
      !== (
        `https://github.com/${expected.producer.repository}/actions/runs/`
        + `${expected.runId}/job/${value.id}`
      )
    || value.name !== expected.producer.workflow.aggregationJobName
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(labels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the frozen successful aggregation job`);
  }
  return value;
}

function expectSuccessfulWorkflowJob(
  value,
  expected,
  { name, labels },
  label,
) {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.id)
    || value.id <= 0
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url
      !== (
        `https://github.com/${expected.producer.repository}/actions/runs/`
        + `${expected.runId}/job/${value.id}`
      )
    || value.name !== name
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(labels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the exact frozen successful job`);
  }
  return value;
}

function expectSuccessfulWindowsSupervisorJob(value, expected, label) {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.id)
    || value.id <= 0
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url
      !== (
        `https://github.com/${expected.producer.repository}/actions/runs/`
        + `${expected.runId}/job/${value.id}`
      )
    || value.name !== WINDOWS_SUPERVISOR_JOB_NAME
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels)
      !== JSON.stringify(WINDOWS_SUPERVISOR_RUNNER_LABELS)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the exact frozen Windows supervisor job`);
  }
  return value;
}

function expectAttemptJobGraph(value, expectedByPlatform, label) {
  if (
    !isRecord(value)
    || value.total_count !== expectedByPlatform.length + 4
    || !Array.isArray(value.jobs)
    || value.jobs.length !== expectedByPlatform.length + 4
  ) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const jobsById = new Map();
  for (const job of value.jobs) {
    if (!isRecord(job) || !Number.isSafeInteger(job.id) || jobsById.has(job.id)) {
      throw new Error(`${label} does not match the exact frozen workflow job graph`);
    }
    jobsById.set(job.id, job);
  }
  const protectedJobs = expectedByPlatform.map((expected) => {
    const job = jobsById.get(Number(expected.jobId));
    if (job === undefined) {
      throw new Error(
        `${label} does not contain the reviewed GitHub job id in the exact frozen workflow job graph`,
      );
    }
    return expectSuccessfulJob(
      job,
      expected,
      `${expected.platform} GitHub job`,
    );
  });
  const protectedIds = new Set(
    expectedByPlatform.map(({ jobId }) => Number(jobId)),
  );
  const supportJobs = value.jobs.filter(
    (job) => isRecord(job) && !protectedIds.has(job.id),
  );
  const windowsSupervisorJobs = supportJobs.filter(
    (job) => job.name === WINDOWS_SUPERVISOR_JOB_NAME,
  );
  if (windowsSupervisorJobs.length !== 1) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const windowsSupervisorJob = expectSuccessfulWindowsSupervisorJob(
    windowsSupervisorJobs[0],
    expectedByPlatform[0],
    `${label} Windows supervisor job`,
  );
  const validationJobs = supportJobs.filter(
    (job) =>
      job.name === expectedByPlatform[0].producer.workflow.validationJobName,
  );
  if (validationJobs.length !== 1) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const validationJob = expectSuccessfulWorkflowJob(
    validationJobs[0],
    expectedByPlatform[0],
    {
      name: expectedByPlatform[0].producer.workflow.validationJobName,
      labels: expectedByPlatform[0].producer.workflow.aggregationRunnerLabels,
    },
    `${label} validation job`,
  );
  const attestationJobs = supportJobs.filter(
    (job) =>
      job.name === expectedByPlatform[0].producer.workflow.attestationJobName,
  );
  if (attestationJobs.length !== 1) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const attestationJob = expectSuccessfulWorkflowJob(
    attestationJobs[0],
    expectedByPlatform[0],
    {
      name: expectedByPlatform[0].producer.workflow.attestationJobName,
      labels: expectedByPlatform[0].producer.workflow.aggregationRunnerLabels,
    },
    `${label} attestation job`,
  );
  const aggregationJobs = supportJobs.filter(
    (job) => job.name === expectedByPlatform[0].producer.workflow.aggregationJobName,
  );
  if (aggregationJobs.length !== 1) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const aggregationJob = expectSuccessfulAggregationJob(
    aggregationJobs[0],
    expectedByPlatform[0],
    `${label} aggregation job`,
  );
  return {
    protectedJobs,
    windowsSupervisorJob,
    validationJob,
    attestationJob,
    aggregationJob,
  };
}

function expectProtectedEnvironment(value, producer) {
  const protectionRules =
    isRecord(value) && Array.isArray(value.protection_rules)
      ? value.protection_rules
      : [];
  const requiredReviewerRules = protectionRules.filter(
    (rule) => isRecord(rule) && rule.type === 'required_reviewers',
  );
  const branchRules = protectionRules.filter(
    (rule) => isRecord(rule) && rule.type === 'branch_policy',
  );
  const requiredReviewers = requiredReviewerRules[0];
  const reviewer =
    isRecord(requiredReviewers)
    && Array.isArray(requiredReviewers.reviewers)
    && requiredReviewers.reviewers.length === 1
      ? requiredReviewers.reviewers[0]
      : undefined;
  if (
    !isRecord(value)
    || value.id !== Number(producer.workflow.environmentId)
    || value.name !== producer.workflow.environment
    || value.can_admins_bypass !== false
    || protectionRules.length !== 2
    || requiredReviewerRules.length !== 1
    || branchRules.length !== 1
    || !isRecord(requiredReviewers)
    || requiredReviewers.prevent_self_review !== false
    || !isRecord(reviewer)
    || reviewer.type !== 'User'
    || !isRecord(reviewer.reviewer)
    || reviewer.reviewer.id !== CHAT_ENVIRONMENT_REVIEWER_ID
    || reviewer.reviewer.type !== 'User'
    || !isRecord(value.deployment_branch_policy)
    || value.deployment_branch_policy.protected_branches !== true
    || value.deployment_branch_policy.custom_branch_policies !== false
  ) {
    throw new Error(
      'Frozen Chat evidence environment must retain the exact protected environment policy',
    );
  }
  return value;
}

function expectJobDeployment(value, expected, label) {
  const deploymentId = Number(expected.deploymentId);
  if (
    !isRecord(value)
    || value.id !== deploymentId
    || value.sha !== expected.producer.commit
    || value.ref !== expectedBranch(expected.producer.workflow.sourceRef)
    || value.task !== 'deploy'
    || value.environment !== expected.producer.workflow.environment
    || value.transient_environment !== false
    || value.statuses_url
      !== (
        `https://api.github.com/repos/${expected.producer.repository}/`
        + `deployments/${deploymentId}/statuses`
      )
    || value.repository_url
      !== `https://api.github.com/repos/${expected.producer.repository}`
    || !isRecord(value.performed_via_github_app)
    || value.performed_via_github_app.slug !== 'github-actions'
  ) {
    throw new Error(`${label} does not match the exact protected deployment`);
  }
  return value;
}

function expectJobDeploymentStatuses(value, expected, label) {
  const jobUrl = expectedJobUrl(expected);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} does not belong to the exact protected job`);
  }
  const states = new Set();
  for (const status of value) {
    if (
      !isRecord(status)
      || status.environment !== expected.producer.workflow.environment
      || status.log_url !== jobUrl
      || status.target_url !== jobUrl
      || typeof status.state !== 'string'
    ) {
      throw new Error(`${label} does not belong to the exact protected job`);
    }
    states.add(status.state);
  }
  if (
    (!states.has('waiting') && !states.has('pending'))
    || !states.has('success')
  ) {
    throw new Error(
      `${label} does not prove protected environment approval and success`,
    );
  }
}

function expectArtifact(value, expected, label) {
  if (
    !isRecord(value)
    || value.total_count !== 1
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== 1
  ) {
    throw new Error(`${label} must resolve exactly one GitHub Actions artifact`);
  }
  const artifact = value.artifacts[0];
  if (
    !isRecord(artifact)
    || !Number.isSafeInteger(artifact.id)
    || artifact.id <= 0
    || artifact.name !== expected.artifactName
    || artifact.expired !== false
    || !isRecord(artifact.workflow_run)
    || artifact.workflow_run.id !== Number(expected.runId)
    || artifact.workflow_run.head_sha !== expected.producer.commit
  ) {
    throw new Error(`${label} is not bound to the frozen workflow run`);
  }
  return artifact;
}

function readSingleArtifactFile(directory, label) {
  const entries = readdirSync(directory);
  if (entries.length !== 1) {
    throw new Error(`${label} must contain exactly one primary record file`);
  }
  const path = resolve(directory, entries[0]);
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size === 0
    || stats.size > 1_048_576
  ) {
    throw new Error(`${label} primary record must be a bounded regular file`);
  }
  return {
    name: entries[0],
    path,
    bytes: readFileSync(path),
  };
}

function readDownloadedBundle(directory, recordName, label) {
  const entries = readdirSync(directory).filter(
    (entry) => entry !== recordName,
  );
  if (entries.length !== 1 || !entries[0].endsWith('.jsonl')) {
    throw new Error(`${label} must produce exactly one JSONL bundle`);
  }
  const path = resolve(directory, entries[0]);
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size === 0
    || stats.size > MAX_ATTESTATION_BUNDLE_BYTES
  ) {
    throw new Error(`${label} bundle must be a bounded regular file`);
  }
  return {
    path,
    bytes: readFileSync(path),
  };
}

function verifyAttestationOutput(text, expected, label) {
  const results = parseGitHubJson(text, label);
  const invocation =
    `https://github.com/${expected.producer.repository}/actions/runs/`
    + `${expected.runId}/attempts/${expected.runAttempt}`;
  if (
    !Array.isArray(results)
    || !results.some((entry) => {
      const verification = isRecord(entry)
        ? entry.verificationResult
        : null;
      const signature = isRecord(verification)
        ? verification.signature
        : null;
      const certificate = isRecord(signature)
        ? signature.certificate
        : null;
      const statement = isRecord(verification)
        ? verification.statement
        : null;
      const subjects = isRecord(statement) && Array.isArray(statement.subject)
        ? statement.subject
        : [];
      return (
        isRecord(certificate)
        && certificate.runInvocationURI === invocation
        && certificate.runnerEnvironment === 'github-hosted'
        && certificate.sourceRepositoryURI
          === `https://github.com/${expected.producer.repository}`
        && certificate.sourceRepositoryDigest === expected.producer.commit
        && certificate.sourceRepositoryRef
          === expected.producer.workflow.sourceRef
        && certificate.buildSignerDigest === expected.producer.commit
        && statement.predicateType === expected.producer.workflow.predicateType
        && subjects.some(
          (subject) =>
            isRecord(subject)
            && isRecord(subject.digest)
            && subject.digest.sha256 === expected.recordSha256,
        )
      );
    })
  ) {
    throw new Error(
      `${label} does not cryptographically bind the downloaded record to the frozen run`,
    );
  }
}

function sameIdentity(left, right) {
  return (
    left?.repository === right?.repository
    && left?.commit === right?.commit
    && left?.tree === right?.tree
  );
}

export function verifyGitHubConformanceEvidence({
  frozenLockText,
  assertionRegistryText,
  schemaText,
  aggregatePath,
  aggregateText,
  indexText,
  caveEngine,
  execute = execFileSync,
  env = process.env,
} = {}) {
  const lockValue = parseFrozenConformanceLock(
    frozenLockText,
    'committed frozen conformance lock',
  );
  const bindings = validateFrozenConformanceBindings(
    lockValue,
    schemaText,
    assertionRegistryText,
  );
  const lock = bindings.lock;
  const producer = assertEvidenceProducerCompatibility(lock);
  const index = parseReviewedEvidenceIndex(
    indexText,
    'release conformance evidence index',
    {
      frozenLock: lock,
      aggregatePath,
      aggregateText,
    },
  );
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-github-conformance-evidence',
  });

  try {
    const workflowText = runGh(
      execute,
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '--header',
        'Accept: application/vnd.github.raw+json',
        `repos/${producer.repository}/contents/${producer.workflow.path}?ref=${producer.commit}`,
      ],
      { cwd: owned.rootPath, env },
    );
    verifyProtectedWorkflow(workflowText, producer, lock.toolchain);
    const environment = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/environments/${encodeURIComponent(producer.workflow.environment)}`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub protected evidence environment',
    );
    expectProtectedEnvironment(environment, producer);
    const expectedByPlatform = index.platforms.map((indexedPlatform) => ({
      platform: indexedPlatform.platform,
      producer,
      runId: indexedPlatform.protectedJob.runId,
      runAttempt: indexedPlatform.protectedJob.runAttempt,
      jobId: indexedPlatform.protectedJob.jobId,
      deploymentId: indexedPlatform.protectedJob.deploymentId,
      artifactName: indexedPlatform.protectedJob.artifactName,
    }));
    const firstExpected = expectedByPlatform[0];
    if (
      firstExpected === undefined
      || expectedByPlatform.some(
        ({ runId, runAttempt }) =>
          runId !== firstExpected.runId
          || runAttempt !== firstExpected.runAttempt,
      )
    ) {
      throw new Error(
        'Reviewed evidence index must name one exact workflow run attempt',
      );
    }
    const run = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/actions/runs/${firstExpected.runId}`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub evidence workflow run',
    );
    expectSuccessfulRun(run, firstExpected, 'GitHub evidence workflow run');
    const jobsResponse = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/actions/runs/${firstExpected.runId}/attempts/${firstExpected.runAttempt}/jobs?per_page=100`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub evidence workflow jobs',
    );
    const jobGraph = expectAttemptJobGraph(
      jobsResponse,
      expectedByPlatform,
      'GitHub evidence workflow jobs',
    );
    const records = [];
    const receiptPlatforms = [];
    for (const [platformIndex, indexedPlatform] of index.platforms.entries()) {
      const platform = indexedPlatform.platform;
      const protectedJob = indexedPlatform.protectedJob;
      const expected = expectedByPlatform[platformIndex];
      const job = jobGraph.protectedJobs[platformIndex];
      if (expected === undefined || job === undefined) {
        throw new Error(
          'GitHub evidence workflow jobs do not match the frozen platform order',
        );
      }
      const deployment = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/deployments/${protectedJob.deploymentId}`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub deployment`,
      );
      expectJobDeployment(
        deployment,
        expected,
        `${platform} GitHub deployment`,
      );
      const deploymentStatuses = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/deployments/${protectedJob.deploymentId}/statuses?per_page=100`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub deployment statuses`,
      );
      expectJobDeploymentStatuses(
        deploymentStatuses,
        expected,
        `${platform} GitHub deployment`,
      );

      const artifactResponse = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/actions/runs/${protectedJob.runId}/artifacts?name=${encodeURIComponent(protectedJob.artifactName)}&per_page=100`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub artifact`,
      );
      const artifact = expectArtifact(
        artifactResponse,
        expected,
        `${platform} GitHub artifact`,
      );

      const platformRoot = resolve(owned.rootPath, platform);
      mkdirSync(platformRoot, { mode: 0o700 });
      runGh(
        execute,
        [
          'run',
          'download',
          protectedJob.runId,
          '--repo',
          `github.com/${producer.repository}`,
          '--name',
          protectedJob.artifactName,
          '--dir',
          platformRoot,
        ],
        { cwd: owned.rootPath, env },
      );
      const artifactFile = readSingleArtifactFile(
        platformRoot,
        `${platform} downloaded artifact`,
      );
      const recordText = artifactFile.bytes.toString('utf8');
      const recordSha256 = sha256(artifactFile.bytes);
      if (
        artifactFile.bytes.byteLength !== indexedPlatform.record.size
        || recordSha256 !== indexedPlatform.record.sha256
        || recordSha256 !== protectedJob.artifactSha256
      ) {
        throw new Error(
          `${platform} downloaded artifact digest does not match the reviewed index`,
        );
      }
      const record = parsePlatformEvidence(
        recordText,
        `${platform} downloaded platform record`,
        bindings.schema,
      );
      if (
        record.platform !== platform
        || serializeCanonicalJson(record) !== recordText
        || !sameIdentity(record.harness, producer)
        || !sameIdentity(record.provenance.validator, index.validator)
      ) {
        throw new Error(
          `${platform} downloaded platform record does not match the frozen identities`,
        );
      }

      runGh(
        execute,
        [
          'attestation',
          'download',
          artifactFile.path,
          '--repo',
          producer.repository,
          '--predicate-type',
          producer.workflow.predicateType,
          '--limit',
          '30',
          '--hostname',
          'github.com',
        ],
        { cwd: platformRoot, env },
      );
      const bundle = readDownloadedBundle(
        platformRoot,
        artifactFile.name,
        `${platform} attestation download`,
      );
      if (sha256(bundle.bytes) !== protectedJob.attestationBundleSha256) {
        throw new Error(
          `${platform} downloaded attestation bundle digest does not match the reviewed index`,
        );
      }
      const attestationOutput = runGh(
        execute,
        [
          'attestation',
          'verify',
          artifactFile.path,
          '--repo',
          producer.repository,
          '--signer-workflow',
          producer.workflow.signerWorkflow,
          '--signer-digest',
          producer.workflow.signerDigest,
          '--source-digest',
          producer.workflow.sourceDigest,
          '--source-ref',
          producer.workflow.sourceRef,
          '--predicate-type',
          producer.workflow.predicateType,
          '--deny-self-hosted-runners',
          '--bundle',
          bundle.path,
          '--format',
          'json',
          '--hostname',
          'github.com',
        ],
        { cwd: platformRoot, env },
      );
      verifyAttestationOutput(
        attestationOutput,
        {
          ...expected,
          recordSha256,
        },
        `${platform} GitHub attestation verification`,
      );

      records.push(record);
      receiptPlatforms.push({
        platform,
        record: {
          file: artifactFile.name,
          size: artifactFile.bytes.byteLength,
          sha256: recordSha256,
        },
        run: {
          id: protectedJob.runId,
          attempt: protectedJob.runAttempt,
          workflow: producer.workflow.path,
          sourceRef: producer.workflow.sourceRef,
          commit: producer.commit,
        },
        job: {
          id: protectedJob.jobId,
          name: job.name,
          runnerLabels: [...job.labels],
          environment: producer.workflow.environment,
          environmentId: producer.workflow.environmentId,
          deploymentId: protectedJob.deploymentId,
        },
        artifact: {
          id: String(artifact.id),
          name: artifact.name,
        },
        attestation: {
          subjectSha256: recordSha256,
          bundleSha256: sha256(bundle.bytes),
          verificationOutputSha256: sha256(attestationOutput),
        },
      });
    }

    const aggregate = aggregateConformanceEvidence({
      caveEngine,
      caveEngineSha256: lock.sources.cave.files[0].sha256,
      assertionRegistrySha256: sha256(assertionRegistryText),
      frozenLockSha256: sha256(frozenLockText),
      frozenLockSize: Buffer.byteLength(frozenLockText, 'utf8'),
      frozenLock: lock,
      canonicalPlatforms: lock.platformMatrix,
      registry: bindings.registry,
      platformRecords: records,
    });
    const generatedAggregateText = serializeCanonicalJson(aggregate);
    if (generatedAggregateText !== aggregateText) {
      throw new Error(
        'Committed aggregate was not generated from the downloaded platform artifact bytes',
      );
    }
    if (!sameIdentity(aggregate.validator, index.validator)) {
      throw new Error(
        'Reviewed evidence index validator does not match the downloaded records',
      );
    }

    return {
      aggregate,
      index,
      receipt: {
        schemaVersion: 1,
        issue: 'OpenCoven/sdk#38',
        kind: 'client-v1-github-evidence-verification',
        producer: {
          repository: producer.repository,
          commit: producer.commit,
          tree: producer.tree,
          workflow: producer.workflow,
          workflowSha256: sha256(workflowText),
        },
        aggregate: {
          path: aggregatePath,
          size: Buffer.byteLength(aggregateText, 'utf8'),
          sha256: sha256(aggregateText),
        },
        platforms: receiptPlatforms,
      },
    };
  } finally {
    cleanupOwnedTempRoot(owned);
  }
}
