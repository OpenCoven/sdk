import {
  CLI_COMMANDS,
  DEV_CLI_VERSION,
  createCliDiagnostics,
  renderCliDiagnostics,
  runCli,
} from '@opencoven/dev-cli';
import { DIAGNOSTICS_SCHEMA } from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

const runtime = { node: 'v24.18.0', platform: 'linux', arch: 'x64' };

describe('opencoven diagnostics', () => {
  test('reports the installed binary, its runtime, and its commands', () => {
    expect(createCliDiagnostics(runtime)).toEqual({
      schema: DIAGNOSTICS_SCHEMA,
      versions: {
        packages: { '@opencoven/dev-cli': DEV_CLI_VERSION },
        runtime,
      },
      capabilities: {
        cli: Object.fromEntries(CLI_COMMANDS.map((command) => [command, true])),
      },
      discovery: [],
      operations: [],
      errors: [],
    });
  });

  test('claims no endpoint, operation, or error, because the CLI configures none', () => {
    const bundle = createCliDiagnostics(runtime);

    expect(bundle.discovery).toEqual([]);
    expect(bundle.operations).toEqual([]);
    expect(bundle.errors).toEqual([]);
  });

  test('renders every section and states what the bundle omits', () => {
    const rendered = renderCliDiagnostics(createCliDiagnostics(runtime));

    expect(rendered).toContain(`OpenCoven diagnostics (${DIAGNOSTICS_SCHEMA})`);
    expect(rendered).toContain(`  @opencoven/dev-cli ${DEV_CLI_VERSION}`);
    expect(rendered).toContain('  node v24.18.0');
    expect(rendered).toContain('  cli.diagnostics: yes');
    expect(rendered).toContain('Discovery: none');
    expect(rendered).toContain('Operations: none');
    expect(rendered).toContain('Errors: none');
    expect(rendered).toContain(
      'This bundle excludes prompts, tokens, attachments, and event payloads.',
    );
  });

  test('renders populated sections as one line per entry', () => {
    const rendered = renderCliDiagnostics({
      schema: DIAGNOSTICS_SCHEMA,
      versions: { packages: {}, runtime: {} },
      capabilities: { cave: { familiars: false } },
      discovery: [
        {
          label: 'cave',
          protocol: 'https',
          host: 'redacted',
          port: null,
          loopback: false,
          credentialsInUrl: true,
          query: false,
        },
        {
          label: 'coven',
          protocol: 'http',
          host: '127.0.0.1',
          port: 7777,
          loopback: true,
          credentialsInUrl: false,
          query: true,
        },
      ],
      operations: [
        {
          system: 'cave',
          operation: 'health',
          started: 1,
          succeeded: 0,
          failed: 1,
          timedOut: 0,
          aborted: 0,
          maxDurationMs: 12,
          codes: ['unavailable'],
        },
      ],
      errors: [
        {
          system: 'cave',
          operation: 'health',
          code: 'unavailable',
          retryable: true,
        },
      ],
    });

    expect(rendered).toContain('Packages: none');
    expect(rendered).toContain('  cave.familiars: no');
    expect(rendered).toContain(
      '  cave: protocol=https host=redacted port=default loopback=no credentials-in-url=yes query=no',
    );
    expect(rendered).toContain(
      '  coven: protocol=http host=127.0.0.1 port=7777 loopback=yes credentials-in-url=no query=yes',
    );
    expect(rendered).toContain(
      '  cave.health: started=1 succeeded=0 failed=1 timedOut=0 aborted=0',
    );
    expect(rendered).toContain('  cave.health: unavailable retryable=yes');
  });

  test('writes the rendered bundle to stdout', async () => {
    const result = await runCli(['diagnostics']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('OpenCoven diagnostics');
    expect(result.stdout).toContain(`  @opencoven/dev-cli ${DEV_CLI_VERSION}`);
  });

  test('emits the bundle itself as JSON, with no prose rendering inside it', async () => {
    const result = await runCli(['--json', 'diagnostics']);
    const payload = JSON.parse(result.stdout) as {
      command: string;
      data: Record<string, unknown>;
      ok: boolean;
      version: string;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.command).toBe('diagnostics');
    expect(payload.ok).toBe(true);
    expect(payload.version).toBe(DEV_CLI_VERSION);
    expect(payload.data.schema).toBe(DIAGNOSTICS_SCHEMA);
    expect(Object.keys(payload)).toEqual(['command', 'data', 'ok', 'version']);
  });
});
