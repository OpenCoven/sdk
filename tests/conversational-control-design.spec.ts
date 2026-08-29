import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const design = readFileSync(
  resolve(
    workspaceRoot,
    'docs/superpowers/specs/2026-08-28-sdk-conversational-control-design.md',
  ),
  'utf8',
);

describe('conversational control design contract', () => {
  test('represents durable pre-dispatch claims in the public operation state', () => {
    expect(design).toContain('| "pending"');
    expect(design).toMatch(
      /Safe pre-dispatch claim[\s\S]*Return the recorded `pending` operation[\s\S]*never start another owner/u,
    );
  });

  test('uses canonical operation identifiers consistently in kinds and request hashes', () => {
    expect(design).toContain(
      'kind: "conversations.create" | "messages.send";',
    );
    expect(design).toContain(
      'operationKind: "<Client v1 operation identifier>"',
    );
    expect(design).toContain(
      'The operation UUID is not part of the hash because it is the record key.',
    );
    expect(design).not.toContain(
      'kind: "conversation.create" | "message.send" | "message.retry";',
    );
  });

  test('authorizes operation reads with the stored originating scope', () => {
    expect(design).toContain('originatingScope: "chat:write" | "conversations:write";');
    expect(design).toContain(
      '`operations.read` and `operations.events` are authorized by the stored originating scope.',
    );
  });

  test('defines the complete cursor mismatch and replay-gap matrix', () => {
    const matrix = design.match(
      /### 10\.3 Cursor decision matrix(?<body>[\s\S]*?)### 10\.4/u,
    )?.groups?.body;
    expect(matrix).toBeDefined();
    expect(matrix).toContain('No cursor; replay floor is `1`');
    expect(matrix).toContain('No cursor; replay floor is greater than `1`');
    expect(matrix).toContain('Cursor names another operation');
    expect(matrix).toContain('Cursor event ID is greater than the latest event ID');
    expect(matrix).toContain('Cursor equals the terminal event ID');
  });

  test('returns terminal completion metadata even when a terminal-cursor page is empty', () => {
    expect(design).toContain('complete: boolean;');
    expect(design).toMatch(
      /Cursor equals the terminal event ID[\s\S]*empty event page with `complete: true`/u,
    );
    expect(design).toMatch(
      /terminates when `complete` is true, including when the page contains no events/u,
    );
  });

  test('waits for terminal state before the final canonical message reload', () => {
    const operationRead = design.indexOf('reads `operations.read`');
    const terminalWait = design.indexOf('waits until the operation is terminal');
    const conversationReload = design.indexOf('reloads `getConversation`');
    const messagesReload = design.indexOf(
      'reloads `listConversationMessages` from the first',
    );
    expect(operationRead).toBeGreaterThan(-1);
    expect(terminalWait).toBeGreaterThan(operationRead);
    expect(conversationReload).toBeGreaterThan(terminalWait);
    expect(messagesReload).toBeGreaterThan(conversationReload);
  });
});
