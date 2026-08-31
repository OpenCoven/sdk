import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  parseReleaseWorkflowDocument,
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
  'actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d';

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
        /actions\/checkout|actions\/setup-node|\brun\b|\bshell\b|npm|pnpm|\.\/|workflow_call/u,
      );
    }
  });
});
