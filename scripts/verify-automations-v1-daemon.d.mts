export interface DaemonCanaryArguments {
  coven: string;
  expectVersion: string;
}

export interface DaemonCanaryCommandContext {
  adoptionKey: string;
  intent: string;
  principalId: string;
}

export interface DaemonCanaryEventStream {
  kind: 'automation' | 'occurrence' | 'run';
  id: string;
}

export type DaemonCanaryEventQuery =
  | { stream: DaemonCanaryEventStream; after?: number }
  | { stream: DaemonCanaryEventStream; checkpoint: string };

/** The slice of `CovenAutomationsClient` the scenario drives. */
export interface DaemonCanaryClient {
  capabilities(): Promise<unknown>;
  createDraft(definition: Record<string, unknown>, context: DaemonCanaryCommandContext): Promise<unknown>;
  revise(
    automationId: string,
    expectedRevision: number,
    definition: Record<string, unknown>,
    context: DaemonCanaryCommandContext,
  ): Promise<unknown>;
  activate(automationId: string, expectedRevision: number, context: DaemonCanaryCommandContext): Promise<unknown>;
  pause(automationId: string, expectedRevision: number, context: DaemonCanaryCommandContext): Promise<unknown>;
  disable(automationId: string, expectedRevision: number, context: DaemonCanaryCommandContext): Promise<unknown>;
  get(automationId: string): Promise<unknown>;
  list(): Promise<unknown>;
  events(query: DaemonCanaryEventQuery): Promise<unknown>;
  subscribe(query: DaemonCanaryEventQuery): AsyncIterable<unknown>;
  occurrenceHistory(automationId: string, query: { limit: number }): Promise<unknown>;
  runHistory(automationId: string, query: { limit: number }): Promise<unknown>;
}

export interface DaemonCanarySummary {
  commands: number;
  replays: number;
  rejections: number;
  events: number;
  subscribePages: number;
  eventDefinitionDigest: 'matches-definition-integrity' | 'differs-from-definition-integrity';
}

export function parseDaemonCanaryArguments(argv: string[]): DaemonCanaryArguments;
export function quietScheduleHour(now?: Date): number;
export function canaryDefinition(scheduleHour: number): Record<string, unknown>;
export function runDaemonScenario(options: {
  sdk: { computeDefinitionDigest(definition: unknown): unknown };
  connect: () => Promise<DaemonCanaryClient>;
  restartDaemon: () => Promise<void>;
  scheduleHour: number;
}): Promise<DaemonCanarySummary>;
export function verifyCovenVersion(coven: string, expectVersion: string, home: string): string;
export function harnessAssertedSecurity(
  discovered: unknown,
  home: string,
): { platform: 'unix'; peerIdentity: { inspectConnected(socket: unknown): Promise<{ uid: number }> } };
export function verifyAutomationsDaemon(
  options: DaemonCanaryArguments,
): Promise<DaemonCanarySummary & { covenVersion: string; daemonStarts: number }>;
