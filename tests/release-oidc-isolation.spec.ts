import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  parseReleaseWorkflowDocument,
  readReleaseConfig,
  validateReleaseWorkflow,
} from '../scripts/release-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const workflowText = readFileSync(
  resolve(root, '.github/workflows/release.yml'),
  'utf8',
);

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  name?: string;
  environment?: string;
  permissions?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  steps?: WorkflowStep[];
  uses?: string;
}

const workflow = parseReleaseWorkflowDocument(workflowText) as {
  jobs: Record<string, WorkflowJob>;
};

const DOWNLOAD_ARTIFACT =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const UPLOAD_ARTIFACT =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const ATTEST =
  'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';
const NPM_PACKAGES = ['sdk-core', 'cave-client', 'coven-client', 'sdk'];
const NPM_PREDICATE = `{
  "buildDefinition": {
    "buildType": "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
    "externalParameters": {
      "workflow": {
        "ref": \${{ toJSON(github.ref) }},
        "repository": \${{ toJSON(format('{0}/{1}', github.server_url, github.repository)) }},
        "path": ".github/workflows/release.yml"
      }
    },
    "internalParameters": {
      "github": {
        "event_name": \${{ toJSON(github.event_name) }},
        "repository_id": \${{ toJSON(github.repository_id) }},
        "repository_owner_id": \${{ toJSON(github.repository_owner_id) }}
      }
    },
    "resolvedDependencies": [{
      "uri": \${{ toJSON(format('git+{0}/{1}@{2}', github.server_url, github.repository, github.ref)) }},
      "digest": { "gitCommit": \${{ toJSON(github.sha) }} }
    }]
  },
  "runDetails": {
    "builder": {
      "id": \${{ toJSON(format('{0}/actions/runner/{1}', github.server_url, runner.environment)) }}
    },
    "metadata": {
      "invocationId": \${{ toJSON(format('{0}/{1}/actions/runs/{2}/attempts/{3}', github.server_url, github.repository, github.run_id, github.run_attempt)) }}
    }
  }
}
`;

function validateWorkflowText(text: string): void {
  const fixture = mkdtempSync(resolve(tmpdir(), 'sdk-oidc-workflow-'));
  try {
    mkdirSync(resolve(fixture, '.github/workflows'), { recursive: true });
    writeFileSync(resolve(fixture, '.github/workflows/release.yml'), text);
    validateReleaseWorkflow(fixture, readReleaseConfig(root));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function job(name: string): WorkflowJob {
  const value = workflow.jobs[name];
  expect(value, `release workflow job ${name}`).toBeDefined();
  return value!;
}

function steps(name: string): WorkflowStep[] {
  const value = job(name).steps;
  expect(value, `release workflow steps for ${name}`).toBeDefined();
  return value!;
}

describe('release OIDC isolation', () => {
  test.skipIf(process.platform !== 'linux')(
    'models same-UID recovery of env -i-hidden OIDC variables through /proc ancestors',
    () => {
      const requestToken = 'ancestor-oidc-request-token';
      const requestUrl =
        'https://vstoken.actions.githubusercontent.com/ancestor-request';
      const childProgram = [
        "const { readFileSync } = require('node:fs');",
        "const environment = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');",
        "process.stdout.write(environment.replaceAll('\\0', '\\n'));",
      ].join('');
      const parentProgram = [
        "const { spawnSync } = require('node:child_process');",
        'const result = spawnSync(',
        "  '/usr/bin/env',",
        `  ['-i', 'PATH=/usr/bin:/bin', ${JSON.stringify(process.execPath)}, '--input-type=commonjs', '--eval', ${JSON.stringify(childProgram)}],`,
        "  { encoding: 'utf8' },",
        ');',
        "process.stdout.write(result.stdout ?? '');",
        "process.stderr.write(result.stderr ?? '');",
        'process.exit(result.status ?? 1);',
      ].join('');
      const result = spawnSync(
        process.execPath,
        ['--input-type=commonjs', '--eval', parentProgram],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
            ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        `ACTIONS_ID_TOKEN_REQUEST_TOKEN=${requestToken}`,
      );
      expect(result.stdout).toContain(
        `ACTIONS_ID_TOKEN_REQUEST_URL=${requestUrl}`,
      );
    },
  );

  test('keeps candidate-controlled build code outside every OIDC boundary', () => {
    const candidate = job('publication-candidate');

    expect(candidate.permissions).toEqual({
      actions: 'read',
      attestations: 'read',
      contents: 'read',
      deployments: 'read',
      issues: 'read',
    });
    expect(candidate.outputs).toEqual({
      'artifact-id': '${{ steps.upload.outputs.artifact-id }}',
      'artifact-digest': '${{ steps.upload.outputs.artifact-digest }}',
      ...Object.fromEntries(NPM_PACKAGES.map((_, index) => [
        `npm-sha512-${index}`,
        `\${{ steps.create.outputs.npm-sha512-${index} }}`,
      ])),
    });
    expect(JSON.stringify(candidate)).not.toMatch(
      /id-token|ACTIONS_ID_TOKEN_REQUEST_/u,
    );
  });

  test('isolates every evidence attestation in an official-action-only job', () => {
    const expectedSteps: Record<string, string[]> = {
      'publication-candidate-attestation': [
        DOWNLOAD_ARTIFACT,
        ATTEST,
        UPLOAD_ARTIFACT,
        ...NPM_PACKAGES.flatMap(() => [ATTEST, UPLOAD_ARTIFACT]),
      ],
      'approval-witness-attestation': [
        DOWNLOAD_ARTIFACT,
        ATTEST,
      ],
      'approval-evidence-attestation': [
        DOWNLOAD_ARTIFACT,
        ATTEST,
      ],
    };

    for (const [jobName, expectedActions] of Object.entries(expectedSteps)) {
      const attestationJob = job(jobName);
      const attestationSteps = steps(jobName);

      expect(attestationJob.permissions).toEqual({
        actions: 'read',
        attestations: 'write',
        contents: 'read',
        'id-token': 'write',
      });
      expect(attestationJob.environment).toBeUndefined();
      expect(attestationJob.uses).toBeUndefined();
      expect(attestationSteps.map((step) => step.uses)).toEqual(
        expectedActions,
      );
      expect(
        attestationSteps.every(
          (step) =>
            step.run === undefined
            && step.shell === undefined
            && step.env === undefined
            && typeof step.uses === 'string'
            && !step.uses.startsWith('./'),
        ),
      ).toBe(true);
    }
  });

  test('exports the producer SHA-512 digests through the explicit clean-environment CLI output', () => {
    const create = steps('publication-candidate').find((step) => step.id === 'create');
    expect(create?.name).toBe('Create immutable publication candidate');
    expect(create?.run).toContain('/usr/bin/env -i \\\n');
    expect(create?.run).toContain('GITHUB_OUTPUT="$GITHUB_OUTPUT" \\');
    expect(create?.run).toContain('--github-output "$GITHUB_OUTPUT"');
  });

  test('preserves the original six-subject attestation and uploaded bundle exactly', () => {
    expect(steps('publication-candidate-attestation').slice(1, 3)).toEqual([
      {
        id: 'attest',
        uses: ATTEST,
        with: {
          'subject-path': [
            '${{ runner.temp }}/opencoven-publication-candidate/release-manifest.json',
            '${{ runner.temp }}/opencoven-publication-candidate/publication-source-manifest.json',
            '${{ runner.temp }}/opencoven-publication-candidate/tarballs/**/*.tgz',
            '',
          ].join('\n'),
          'show-summary': false,
        },
      },
      {
        id: 'upload-bundle',
        uses: UPLOAD_ARTIFACT,
        with: {
          name: 'opencoven-sdk-publication-attestation-${{ github.sha }}-${{ inputs.version }}',
          path: '${{ steps.attest.outputs.bundle-path }}',
          'if-no-files-found': 'error',
          'retention-days': 30,
        },
      },
    ]);
  });

  test('attests and separately uploads four exact npm singleton bundles with trusted workflow facts', () => {
    const expectedOutputs: Record<string, string> = {
      'bundle-artifact-id': '${{ steps.upload-bundle.outputs.artifact-id }}',
      'bundle-artifact-digest': '${{ steps.upload-bundle.outputs.artifact-digest }}',
    };
    NPM_PACKAGES.forEach((name, index) => {
      const attestId = `attest-npm-${index}`;
      const uploadId = `upload-npm-provenance-${index}`;
      expect(steps('publication-candidate-attestation').slice(3 + index * 2, 5 + index * 2))
        .toEqual([
          {
            id: attestId,
            uses: ATTEST,
            with: {
              'subject-name': `pkg:npm/%40opencoven/${name}@\${{ inputs.version }}`,
              'subject-digest': `sha512:\${{ needs.publication-candidate.outputs.npm-sha512-${index} }}`,
              'predicate-type': 'https://slsa.dev/provenance/v1',
              predicate: NPM_PREDICATE,
              'push-to-registry': false,
              'show-summary': false,
            },
          },
          {
            id: uploadId,
            uses: UPLOAD_ARTIFACT,
            with: {
              name: `opencoven-sdk-npm-provenance-${index}-\${{ github.sha }}-\${{ inputs.version }}`,
              path: `\${{ steps.${attestId}.outputs.bundle-path }}`,
              'if-no-files-found': 'error',
              'retention-days': 30,
            },
          },
        ]);
      for (const output of ['artifact-id', 'artifact-digest']) {
        expectedOutputs[`npm-provenance-${index}-${output}`] =
          `\${{ steps.${uploadId}.outputs.${output} }}`;
      }
    });
    expect(job('publication-candidate-attestation').outputs).toEqual(expectedOutputs);
    expect(() => validateWorkflowText(workflowText)).not.toThrow();
  });

  test.each([
    ['unencoded scope', 'pkg:npm/%40opencoven/sdk-core@', 'pkg:npm/@opencoven/sdk-core@'],
    ['wrong package', 'pkg:npm/%40opencoven/cave-client@', 'pkg:npm/%40opencoven/cave-clients@'],
    ['wrong version', 'pkg:npm/%40opencoven/sdk@${{ inputs.version }}', 'pkg:npm/%40opencoven/sdk@0.0.1'],
    ['SHA-256 digest', 'subject-digest: sha512:', 'subject-digest: sha256:'],
    ['wrong digest slot', 'subject-digest: sha512:${{ needs.publication-candidate.outputs.npm-sha512-2 }}', 'subject-digest: sha512:${{ needs.publication-candidate.outputs.npm-sha512-3 }}'],
    ['wrong predicate type', 'predicate-type: https://slsa.dev/provenance/v1', 'predicate-type: https://slsa.dev/provenance/v0.2'],
    [
      'producer predicate',
      `predicate: |\n${NPM_PREDICATE.trimEnd().split('\n').map((line) => `            ${line}`).join('\n')}\n`,
      'predicate: ${{ needs.publication-candidate.outputs.predicate }}\n',
    ],
    ['producer workflow ref', 'toJSON(github.ref)', 'toJSON(needs.publication-candidate.outputs.ref)'],
    ['incorrect workflow repository', "toJSON(format('{0}/{1}', github.server_url, github.repository))", 'toJSON(github.repository)'],
    ['incorrect workflow path', '"path": ".github/workflows/release.yml"', '"path": ".github/workflows/build.yml"'],
    ['incorrect event', 'toJSON(github.event_name)', "toJSON('push')"],
    ['incorrect repository ID', 'toJSON(github.repository_id)', 'toJSON(github.repository)'],
    ['incorrect owner ID', 'toJSON(github.repository_owner_id)', 'toJSON(github.repository_owner)'],
    ['incorrect source URI', "git+{0}/{1}@{2}", "git+{0}/{1}/tree/{2}"],
    ['incorrect source commit', 'toJSON(github.sha)', 'toJSON(github.workflow_sha)'],
    ['incorrect runner', 'github.server_url, runner.environment', "github.server_url, 'self-hosted'"],
    ['incorrect invocation', 'github.run_id, github.run_attempt', "github.run_id, '1'"],
    ['incorrect build type', 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1', 'https://github.com/npm/cli/gha/v2'],
    ['missing JSON escaping', 'toJSON(github.event_name)', 'github.event_name'],
    ['OCI publication', 'push-to-registry: false', 'push-to-registry: true'],
    ['artifact collision', 'name: opencoven-sdk-npm-provenance-1-', 'name: opencoven-sdk-npm-provenance-0-'],
    ['wrong upload path', 'path: ${{ steps.attest-npm-2.outputs.bundle-path }}', 'path: ${{ steps.attest-npm-1.outputs.bundle-path }}'],
    ['wrong artifact ID mapping', 'npm-provenance-3-artifact-id: ${{ steps.upload-npm-provenance-3.outputs.artifact-id }}', 'npm-provenance-3-artifact-id: ${{ steps.upload-npm-provenance-2.outputs.artifact-id }}'],
    ['wrong artifact digest mapping', 'npm-provenance-0-artifact-digest: ${{ steps.upload-npm-provenance-0.outputs.artifact-digest }}', 'npm-provenance-0-artifact-digest: ${{ steps.upload-npm-provenance-1.outputs.artifact-digest }}'],
    ['shell escalation', '- id: attest-npm-0', '- run: echo unsafe\n        id: attest-npm-0'],
    ['checkout escalation', '- id: attest-npm-0\n        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6', '- id: attest-npm-0\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ])('rejects npm provenance %s', (_name, before, after) => {
    expect(workflowText).toContain(before);
    expect(() => validateWorkflowText(workflowText.replace(before, after))).toThrow(
      /Release workflow (?:npm provenance|publication-candidate-attestation)/u,
    );
  });

  test.each(NPM_PACKAGES.flatMap((_, index) => [
    `attest-npm-${index}`,
    `upload-npm-provenance-${index}`,
  ]))('rejects omitted singleton step %s', (id) => {
    const pattern = new RegExp(`      - id: ${id}\\n[\\s\\S]*?(?=      - |\\n  [a-z]|$)`, 'u');
    expect(workflowText).toMatch(pattern);
    expect(() => validateWorkflowText(workflowText.replace(pattern, ''))).toThrow();
  });

  test.each(NPM_PACKAGES.flatMap((_, index) =>
    ['artifact-id', 'artifact-digest'].map((output) =>
      `npm-provenance-${index}-${output}`),
  ))('rejects omitted immutable artifact output %s', (output) => {
    const pattern = new RegExp(`      ${output}: [^\\n]+\\n`, 'u');
    expect(workflowText).toMatch(pattern);
    expect(() => validateWorkflowText(workflowText.replace(pattern, ''))).toThrow(
      'Release workflow npm provenance outputs must expose the exact separate immutable artifact IDs and digests',
    );
  });

  test('reserves candidate-code OIDC and the npm environment for final publish', () => {
    const oidcJobs = Object.entries(workflow.jobs)
      .filter(([, value]) => value.permissions?.['id-token'] === 'write')
      .map(([name]) => name);

    expect(oidcJobs).toEqual([
      'publication-candidate-attestation',
      'approval-witness-attestation',
      'approval-evidence-attestation',
      'publish',
    ]);
    expect(job('publish').environment).toBe('npm-publish');
    expect(job('publish').needs).toEqual([
      'preflight',
      'repository-verification',
      'approval-witness',
      'approval-witness-attestation',
      'approval-evidence',
      'approval-evidence-attestation',
    ]);

    for (const jobName of oidcJobs.filter((name) => name !== 'publish')) {
      expect(JSON.stringify(job(jobName))).not.toMatch(
        /actions\/checkout|actions\/setup-node|"run":|"shell":|\bpnpm\b|workflow_call|GH_TOKEN|secrets\./u,
      );
    }
  });
});
