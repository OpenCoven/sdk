import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('repository governance', () => {
  test('assigns ownership for the repository and release-sensitive paths', () => {
    const codeowners = read('.github/CODEOWNERS');

    expect(codeowners).toContain('* @BunsDev');
    expect(codeowners).toContain('/.github/workflows/ @BunsDev');
    expect(codeowners).toContain('/release.config.json @BunsDev');
    expect(codeowners).toContain('/scripts/*release* @BunsDev');
  });

  test('documents the contribution and validation workflow', () => {
    const contributing = read('CONTRIBUTING.md');

    expect(contributing).toContain('corepack pnpm@10.34.0 verify');
    expect(contributing).toContain('Changeset');
    expect(contributing).toContain('Do not commit credentials');
    expect(contributing).toContain('pull request');
  });

  test('provides structured pull request and issue intake', () => {
    const pullRequestTemplate = read('.github/pull_request_template.md');
    const bugTemplate = read('.github/ISSUE_TEMPLATE/bug_report.yml');
    const featureTemplate = read('.github/ISSUE_TEMPLATE/feature_request.yml');
    const issueConfig = read('.github/ISSUE_TEMPLATE/config.yml');

    expect(pullRequestTemplate).toContain('## Validation');
    expect(pullRequestTemplate).toContain('Changeset');
    expect(bugTemplate).toContain('type: textarea');
    expect(bugTemplate).toContain('Reproduction');
    expect(featureTemplate).toContain('Problem');
    expect(featureTemplate).toContain('Proposed outcome');
    expect(issueConfig).toContain('blank_issues_enabled: false');
    expect(issueConfig).toContain('/security/advisories/new');
  });

  test('normalizes source text while preserving platform scripts and binary assets', () => {
    const attributes = read('.gitattributes');

    expect(attributes).toContain('* text=auto eol=lf');
    expect(attributes).toContain('*.bat text eol=crlf');
    expect(attributes).toContain('*.cmd text eol=crlf');
    expect(attributes).toContain('*.png binary');
  });
});
