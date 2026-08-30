import {
  CAVE_GITHUB_ACTION_KINDS,
  CAVE_TASK_HANDOFF_STATES,
  CAVE_TASK_HANDOFF_TRANSITIONS,
  CaveClient,
  createCaveCapabilityRegistry,
  isCaveClientError,
  parseCaveAttachmentRecord,
  parseCaveAttentionResponseRequest,
  parseCaveTaskHandoffRequest,
  type CaveAttachmentUploadRequest,
  type CaveCapabilityRegistry,
  type CaveGitHubActionRequest,
  type CaveTransport,
} from '@opencoven/cave-client';
import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';

const OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const CONVERSATION_ID = 'conversation.v1';

function unreachableTransport(): CaveTransport {
  return {
    health() {
      throw new Error('health is not expected in this test');
    },
  } satisfies CaveTransport;
}

function spyTransport() {
  const uploadAttachment = vi.fn();
  const downloadAttachment = vi.fn();
  const respondToAttention = vi.fn();
  const requestTaskHandoff = vi.fn();
  const submitGitHubAction = vi.fn();
  const transport = {
    health() {
      throw new Error('health is not expected in this test');
    },
    uploadAttachment,
    downloadAttachment,
    respondToAttention,
    requestTaskHandoff,
    submitGitHubAction,
  } as unknown as CaveTransport;
  return {
    transport,
    uploadAttachment,
    downloadAttachment,
    respondToAttention,
    requestTaskHandoff,
    submitGitHubAction,
  };
}

async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

const ATTACHMENT_CONTENT = new TextEncoder().encode('hello');

function textAttachmentRequest(): CaveAttachmentUploadRequest {
  return {
    operationId: OPERATION_ID,
    confirmed: true,
    conversationId: CONVERSATION_ID,
    uploaderCredentialId: 'credential.v1',
    attachments: [
      {
        filename: 'notes.txt',
        contentType: 'text/plain',
        content: ATTACHMENT_CONTENT,
      },
    ],
  };
}

// The curated GitHub union is uninhabitable, so its request type cannot be
// constructed statically. Runtime probes cross the trust boundary as
// unknown, exactly like a wire payload would.
function submitUnknownAction(
  client: CaveClient,
  request: unknown,
): Promise<void> {
  return client.submitGitHubAction(request as CaveGitHubActionRequest);
}

describe('privileged capability gating (client level)', () => {
  test('every privileged mutation reports unsupported_operation with zero transport dispatch under the pinned contract', async () => {
    const { transport, uploadAttachment, downloadAttachment, respondToAttention, requestTaskHandoff, submitGitHubAction } =
      spyTransport();
    const client = new CaveClient({ transport });

    const upload = await errorOf(() =>
      client.uploadAttachment(textAttachmentRequest()),
    );
    const download = await errorOf(() =>
      client.downloadAttachment({
        operationId: OPERATION_ID,
        confirmed: true,
        conversationId: CONVERSATION_ID,
        attachmentId: 'attachment-1',
      }),
    );
    const attention = await errorOf(() =>
      client.respondToAttention({
        operationId: OPERATION_ID,
        confirmed: true,
        conversationId: CONVERSATION_ID,
        attentionId: 'attention-1',
        response: 'acknowledge',
      }),
    );
    const handoff = await errorOf(() =>
      client.requestTaskHandoff({
        operationId: OPERATION_ID,
        confirmed: true,
        conversationId: CONVERSATION_ID,
        handoffId: 'handoff-1',
        from: 'proposed',
        to: 'pending',
      }),
    );

    for (const [name, error] of [
      ['upload', upload],
      ['download', download],
      ['attention', attention],
      ['handoff', handoff],
    ] as const) {
      expect(isCaveClientError(error), name).toBe(true);
      expect((error as Error & { code: string }).code).toBe(
        'unsupported_operation',
      );
      expect((error as Error & { operationId?: string }).operationId).toBe(
        OPERATION_ID,
      );
    }

    // The capability gate fires before any transport dispatch: the bound
    // privileged methods are never called, even though they exist.
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(downloadAttachment).not.toHaveBeenCalled();
    expect(respondToAttention).not.toHaveBeenCalled();
    expect(requestTaskHandoff).not.toHaveBeenCalled();
    expect(submitGitHubAction).not.toHaveBeenCalled();
  });

  test('validation failure performs zero domain mutation and raises a configuration error', async () => {
    const { transport, uploadAttachment, respondToAttention, requestTaskHandoff, downloadAttachment, submitGitHubAction } =
      spyTransport();
    const client = new CaveClient({ transport });

    const unconfirmed = await errorOf(() =>
      client.uploadAttachment({
        ...textAttachmentRequest(),
        confirmed: false,
      } as unknown as CaveAttachmentUploadRequest),
    );
    expect(unconfirmed).toBeInstanceOf(TypeError);
    expect(isCaveClientError(unconfirmed)).toBe(false);

    const malformedId = await errorOf(() =>
      client.respondToAttention({
        operationId: 'not-a-uuid',
        confirmed: true,
        conversationId: CONVERSATION_ID,
        attentionId: 'attention-1',
        response: 'acknowledge',
      }),
    );
    expect(malformedId).toBeInstanceOf(TypeError);
    expect((malformedId as Error).message).not.toContain('not-a-uuid');

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(respondToAttention).not.toHaveBeenCalled();
    expect(submitGitHubAction).not.toHaveBeenCalled();
    expect(requestTaskHandoff).not.toHaveBeenCalled();
    expect(downloadAttachment).not.toHaveBeenCalled();
  });

  test('a declared capability lets a bound transport carry the validated request', async () => {
    // Synthetic test contract only: proves the gate is registry-driven. No
    // upstream contract is implied by this shape.
    const registry = createCaveCapabilityRegistry({
      capabilities: ['attachments'],
      operations: [
        {
          id: 'attachments.upload',
          families: ['attachments'],
          ingress: 'authenticated',
          method: 'POST',
          path: '/api/client/v1/conversations/:id/attachments',
          scope: 'attachments:write',
        },
      ],
    });
    const upload = vi.fn((request: CaveAttachmentUploadRequest) =>
      Promise.resolve({
        attachmentId: 'attachment-1',
        conversationId: request.conversationId,
        uploaderCredentialId: request.uploaderCredentialId,
        filename: request.attachments[0]?.filename ?? 'notes.txt',
        contentType: request.attachments[0]?.contentType ?? 'text/plain',
        sizeBytes: request.attachments[0]?.content.length ?? 0,
        digestSha256: createHash('sha256').update('hello').digest('hex'),
      }),
    );
    const transportWithoutDownload = {
      health() {
        throw new Error('health is not expected in this test');
      },
      uploadAttachment: upload,
      downloadAttachment: undefined,
    } as unknown as CaveTransport;
    const client = new CaveClient({
      transport: transportWithoutDownload,
      capabilities: registry,
    });

    const record = await client.uploadAttachment(textAttachmentRequest());

    expect(record.attachmentId).toBe('attachment-1');
    expect(parseCaveAttachmentRecord(record)).toEqual(record);
    expect(upload).toHaveBeenCalledTimes(1);
    const sent = upload.mock.calls[0]![0];
    expect(sent.operationId).toBe(OPERATION_ID);
    expect(sent.confirmed).toBe(true);
    expect(sent.attachments[0]?.content).toBe(ATTACHMENT_CONTENT);

    // With no download binding on the transport, the declared attachment
    // capability passes the gate and the missing method itself reports
    // unsupported_operation.
    const download = await errorOf(() =>
      client.downloadAttachment({
        operationId: OPERATION_ID,
        confirmed: true,
        conversationId: CONVERSATION_ID,
        attachmentId: 'attachment-1',
      }),
    );
    expect((download as Error & { code: string }).code).toBe(
      'unsupported_operation',
    );
  });

  test('a registry without a resolve function is refused at construction', () => {
    expect(
      () =>
        new CaveClient({
          transport: unreachableTransport(),
          capabilities: {} as unknown as CaveCapabilityRegistry,
        }),
    ).toThrowError(/CaveCapabilityRegistry/u);
  });
});

describe('attention responses', () => {
  test('the response union is closed and the note is bounded', () => {
    const valid = parseCaveAttentionResponseRequest({
      operationId: OPERATION_ID,
      confirmed: true,
      conversationId: CONVERSATION_ID,
      attentionId: 'attention-1',
      response: 'acknowledge',
      note: 'on it',
    });
    expect(valid.response).toBe('acknowledge');
    expect(valid.note).toBe('on it');

    for (const malformed of [
      { response: 'snooze' },
      { response: 'ACKNOWLEDGE' },
      { response: 1 },
      { response: undefined },
      { note: '' },
      { note: 'x'.repeat(257) },
      { attentionId: '' },
      { extra: true },
    ]) {
      expect(() =>
        parseCaveAttentionResponseRequest({
          operationId: OPERATION_ID,
          confirmed: true,
          conversationId: CONVERSATION_ID,
          attentionId: 'attention-1',
          response: 'acknowledge',
          ...malformed,
        }),
      ).toThrowError(Error);
    }
  });
});

describe('task handoff states', () => {
  test('exactly the five declared states exist and stay distinct', () => {
    expect([...CAVE_TASK_HANDOFF_STATES]).toEqual([
      'proposed',
      'pending',
      'completed',
      'rejected',
      'failed',
    ]);
    expect(new Set(CAVE_TASK_HANDOFF_STATES).size).toBe(5);
  });

  test('the transition map keeps terminal states terminal', () => {
    expect([...CAVE_TASK_HANDOFF_TRANSITIONS.proposed]).toEqual(['pending']);
    expect([...CAVE_TASK_HANDOFF_TRANSITIONS.pending]).toEqual([
      'completed',
      'rejected',
      'failed',
    ]);
    expect(CAVE_TASK_HANDOFF_TRANSITIONS.completed).toEqual([]);
    expect(CAVE_TASK_HANDOFF_TRANSITIONS.rejected).toEqual([]);
    expect(CAVE_TASK_HANDOFF_TRANSITIONS.failed).toEqual([]);
  });

  test('parses legal transitions and rejects skipped or unknown ones', () => {
    const legal = parseCaveTaskHandoffRequest({
      operationId: OPERATION_ID,
      confirmed: true,
      conversationId: CONVERSATION_ID,
      handoffId: 'handoff-1',
      from: 'pending',
      to: 'completed',
    });
    expect(legal.from).toBe('pending');
    expect(legal.to).toBe('completed');

    for (const [from, to] of [
      ['proposed', 'completed'],
      ['proposed', 'failed'],
      ['pending', 'proposed'],
      ['pending', 'pending'],
      ['completed', 'pending'],
      ['rejected', 'pending'],
      ['failed', 'pending'],
      ['unknown', 'pending'],
      ['proposed', 'unknown'],
    ] as const) {
      expect(() =>
        parseCaveTaskHandoffRequest({
          operationId: OPERATION_ID,
          confirmed: true,
          conversationId: CONVERSATION_ID,
          handoffId: 'handoff-1',
          from,
          to,
        }),
      ).toThrowError(Error);
    }
  });
});

describe('confirmed GitHub actions', () => {
  test('the curated union is empty and frozen pending the upstream contract', () => {
    expect(Object.isFrozen(CAVE_GITHUB_ACTION_KINDS)).toBe(true);
    expect(CAVE_GITHUB_ACTION_KINDS).toEqual([]);
  });

  test('every request is rejected with the precise upstream gap and zero transport dispatch', async () => {
    const { transport, submitGitHubAction } = spyTransport();
    const client = new CaveClient({ transport });

    for (const action of [
      'create_issue',
      'comment',
      'merge_pull_request',
      'workflow_dispatch',
      '',
    ]) {
      const error = await errorOf(() =>
        submitUnknownAction(client, {
          operationId: OPERATION_ID,
          confirmed: true,
          conversationId: CONVERSATION_ID,
          action,
          input: { repository: 'OpenCoven/sdk' },
        }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain('curated union');
      // The untrusted action kind is never echoed.
      if (action.length > 0) {
        expect((error as Error).message).not.toContain(action);
      }
    }

    // Missing or soft confirmation rejects before the kind check.
    const unconfirmed = await errorOf(() =>
      submitUnknownAction(client, {
        operationId: OPERATION_ID,
        confirmed: false,
        conversationId: CONVERSATION_ID,
        action: 'create_issue',
        input: {},
      }),
    );
    expect(unconfirmed).toBeInstanceOf(TypeError);

    // Oversized input bounds reject before the kind check.
    const oversized = await errorOf(() =>
      submitUnknownAction(client, {
        operationId: OPERATION_ID,
        confirmed: true,
        conversationId: CONVERSATION_ID,
        action: 'create_issue',
        input: { key: 'x'.repeat(257) },
      }),
    );
    expect(oversized).toBeInstanceOf(TypeError);

    expect(submitGitHubAction).not.toHaveBeenCalled();
  });
});
