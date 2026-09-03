export interface CaveCanonicalFamiliar {
  id: string;
  displayName: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  lastSeenAt?: string;
  activeSessions?: number;
}

export interface CaveProject {
  id: string;
  name: string;
  root: string;
  color?: string;
  repoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaveConversation {
  id: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: string;
  status?: string;
  exitCode?: number | null;
  pending?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface CaveConversationMessage {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: string;
  text: string;
  createdAt: string;
  attachmentCount: number;
  toolCount: number;
  isError?: boolean;
  cancelled?: boolean;
}

export interface CaveHealth {
  status: 'ok';
  apiVersion: string;
  minimumClientVersion: string;
  capabilities: readonly string[];
  operations: readonly string[];
  instanceId: string;
  pairingRequired: boolean;
  releaseVersion: string;
}

export interface CaveHealthData {
  instanceId: string;
  pairingRequired: boolean;
  releaseVersion: string;
}

export interface CaveHealthResponse {
  apiVersion: string;
  minimumClientVersion: string;
  requestId?: string;
  capabilities: readonly string[];
  operations: readonly string[];
  data: CaveHealthData;
}

export const CAVE_PAIRING_SCOPES = [
  'chat:read',
  'chat:write',
  'conversations:write',
  'attachments:write',
  'tasks:write',
  'github:write',
] as const;

export type CavePairingScope = (typeof CAVE_PAIRING_SCOPES)[number];

export const CAVE_PAIRING_STATUSES = [
  'pending',
  'approved',
  'denied',
  'expired',
] as const;

export type CavePairingState = (typeof CAVE_PAIRING_STATUSES)[number];

export interface CavePairingRequest {
  appName: string;
  installationId: string;
  scopes: CavePairingScope[];
}

export interface CavePairingCreated {
  requestId: string;
  secret: string;
  expiresAt: number;
}

export interface CavePairingStatus {
  id: string;
  status: CavePairingState;
  expiresAt: number;
}

export interface CaveCredentialMetadata {
  id: string;
  appName: string;
  installationId: string;
  scopes: CavePairingScope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
}

export interface CavePairingExchange {
  bearer: string;
  credential: CaveCredentialMetadata;
}

/**
 * The non-secret metadata a managed native bridge may return after creating a
 * pairing request. Native code retains the pairing secret.
 */
export interface CaveManagedPairingCreated {
  requestId: string;
  expiresAt: number;
}

/**
 * The non-secret metadata a managed native bridge may return after consuming
 * an exchange. Native code retains and persists the bearer.
 */
export interface CaveManagedPairingExchange {
  credential: CaveCredentialMetadata;
}

export interface CaveAuthorityBinding {
  version: 1;
  instanceId: string;
  endpoint: {
    kind: 'http';
    url: string;
  };
  record: {
    identity: string;
    device: number;
    inode: number;
  };
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
}

export interface CaveAuthorityBoundPairingExchange extends CavePairingExchange {
  authorityBinding: CaveAuthorityBinding;
}

export type CaveCredentialAccess =
  | 'chat:read'
  | 'scope_denied'
  | 'service_unavailable'
  | 'rate_limited';

export type CaveCredentialDisconnectedReason =
  | 'credential_update_in_progress'
  | 'reconcile_required';

export type CaveCredentialStatus =
  | { status: 'missing' }
  | { status: 'disconnected'; reason: CaveCredentialDisconnectedReason }
  | { status: 'revoked'; health: CaveHealth }
  | { status: 'valid'; access: CaveCredentialAccess; health: CaveHealth };

/**
 * Native bridges return this raw, non-secret status shape. `health` remains
 * untrusted until the SDK validates it with the authoritative health parser.
 */
export type CaveManagedCredentialStatusResult =
  | { status: 'missing' }
  | { status: 'disconnected'; reason: CaveCredentialDisconnectedReason }
  | { status: 'revoked'; health: unknown }
  | { status: 'valid'; access: CaveCredentialAccess; health: unknown };

/**
 * Native credential deletion must distinguish confirmed absence from a
 * replacement race so JavaScript never reports a newer credential as removed.
 */
export type CaveManagedForgetCredentialResult =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'credential_update_in_progress' };

/**
 * Familiars.
 *
 * These mirror what Cave already serves, rather than proposing a shape it does
 * not have: `GET /api/familiars` for the roster, `/[id]/contract` for the
 * Familiar Contract report, and `/[id]/execution-analytics` for run history.
 * Field-for-field, so a change on either side is a type error rather than a
 * value that silently arrives as undefined.
 *
 * The wire uses snake_case on the roster and camelCase everywhere else. The
 * `*Wire` types below keep the wire spelling exactly, because that is what has
 * to be validated; the exported types are camelCase, because that is what the
 * rest of a TypeScript program expects. The client is the one place the two
 * meet, and it is a better place for the seam than every call site.
 */

/** A familiar as the roster lists it. */
export interface CaveFamiliar {
  id: string;
  displayName: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  lastSeen?: string;
  activeSessions?: number;
  memoryFreshness?: string;
}

/** The roster entry as it arrives. */
export interface CaveFamiliarWire {
  id: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
}

export interface CaveFamiliarsResponse {
  ok: boolean;
  familiars?: CaveFamiliarWire[];
  error?: string;
  reason?: string;
}

/**
 * The five normative properties of the Familiar Contract, in the spec's order.
 *
 * Duplicated from Cave rather than imported because the SDK does not depend on
 * Cave's source. The contract report carries its own `specVersion`, so a client
 * that finds a property it does not know about can say which version it was
 * built against instead of guessing.
 */
export const CAVE_FAMILIAR_PROPERTIES = [
  'Named Identity',
  'Defined Purpose',
  'Bounded Authority',
  'Persistent Memory',
  'Human Belonging',
] as const;

export type CaveFamiliarProperty = (typeof CAVE_FAMILIAR_PROPERTIES)[number];

export type CaveContractFile = 'SOUL.md' | 'IDENTITY.md' | 'ward.toml' | 'MEMORY.md' | 'cross-file';

export interface CaveContractViolation {
  file: CaveContractFile;
  field: string;
  message: string;
}

export interface CavePropertyCoverage {
  property: string;
  pass: boolean;
}

/**
 * `pass` is true when there are zero hard violations. Warnings do not fail a
 * contract -- a familiar that keeps no memory is a real answer to a real
 * question, not a malformed one.
 */
export interface CaveContractReport {
  specVersion: string;
  pass: boolean;
  properties: CavePropertyCoverage[];
  violations: CaveContractViolation[];
  warnings: CaveContractViolation[];
}

/** Which of the four contract files the familiar has authored. */
export interface CaveFamiliarContractPresence {
  soul: boolean;
  identity: boolean;
  ward: boolean;
  memory: boolean;
}

/** IDENTITY.md-derived fields. Served only when the file exists. */
export interface CaveFamiliarIdentity {
  name?: string;
  creature?: string;
  person?: string;
}

/**
 * The ward parsed from `ward.toml`, served only when the file exists.
 *
 * `approvalTiers.auto` is what the familiar may do without asking and
 * `approvalTiers.humanReview` what a person must approve -- the action lists
 * the ward names, whichever spelling its author used. A client matches a
 * draft against `humanReview` to warn before it crosses the must-ask tier.
 */
export interface CaveFamiliarWard {
  version?: string;
  familiar?: string;
  person?: string;
  protectedFiles: string[];
  invariants: string[];
  editablePaths: string[];
  approvalTiers: {
    auto: string[];
    humanReview: string[];
  };
}

/**
 * `present` is per file, never a single boolean: a familiar with a SOUL.md and
 * no ward.toml is a real, common state, and the report names what is missing.
 * `identity` and `ward` are absent exactly when their file is. `workspace` is
 * served by the Studio's private route only; the canonical client-v1 read
 * withholds it.
 */
export interface CaveFamiliarContract {
  id: string;
  workspace?: string;
  present: CaveFamiliarContractPresence;
  identity?: CaveFamiliarIdentity;
  ward?: CaveFamiliarWard;
  report: CaveContractReport;
}

export interface CaveFamiliarContractResponse {
  ok: boolean;
  /** Present on a refusal. The client surfaces it as the error code. */
  reason?: string;
  id?: string;
  workspace?: string;
  present?: CaveFamiliarContractPresence;
  identity?: CaveFamiliarIdentity;
  ward?: CaveFamiliarWard;
  report?: CaveContractReport;
  error?: string;
}

/** The windows Cave aggregates over. */
export const CAVE_ANALYTICS_WINDOWS = ['7d', '14d', '8w', 'all'] as const;

export type CaveAnalyticsWindowKey = (typeof CAVE_ANALYTICS_WINDOWS)[number];

export interface CaveExecutionSlice {
  key: string;
  label?: string;
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianDurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
}

export interface CaveExecutionCoverage {
  known: number;
  total: number;
  ratio: number;
}

/**
 * One UTC calendar day of a window's runs-per-day series. The three counts are
 * kept apart: folding cancellations into failures would report an operator's
 * own interruptions as the familiar's mistakes.
 */
export interface CaveExecutionDay {
  /** `YYYY-MM-DD`, in UTC. */
  date: string;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface CaveExecutionWindow {
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Null when there were no attempts: a rate over nothing is not zero. */
  successRate: number | null;
  medianDurationMs?: number;
  p95DurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  models: CaveExecutionSlice[];
  harnesses: CaveExecutionSlice[];
  coverage: Record<string, CaveExecutionCoverage>;
  /**
   * Runs per UTC day, oldest first, on the day-shaped windows (`7d`, `14d`):
   * exactly 7 or 14 entries ending on the day `generatedAt` falls in. Absent
   * on `8w` and `all`.
   */
  days?: CaveExecutionDay[];
}

export interface CaveExecutionAttempt {
  id: string;
  sessionId?: string;
  turnId?: string;
  executionKind: string;
  occurredAt: string;
  harnessId: string;
  harnessVersion?: string;
  requestedModel?: string;
  forwardedModel?: string;
  confirmedModel?: string;
  status: 'completed' | 'failed' | 'cancelled';
  durationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
}

/**
 * Whether the history behind these numbers is complete.
 *
 * Reported rather than hidden, because a success rate drawn from a partial
 * import is a different claim from one drawn from all of it, and a reader who
 * cannot tell them apart will believe the wrong one.
 */
export interface CaveExecutionBackfill {
  state: 'complete' | 'partial' | 'not-started';
  imported: number;
  remaining?: number;
}

export interface CaveFamiliarAnalytics {
  generatedAt: string;
  windows: Partial<Record<CaveAnalyticsWindowKey, CaveExecutionWindow>>;
  recentAttempts: CaveExecutionAttempt[];
  backfill: CaveExecutionBackfill;
}

export interface CaveFamiliarAnalyticsResponse {
  ok: boolean;
  /** Present on a refusal. The client surfaces it as the error code. */
  reason?: string;
  analytics?: CaveFamiliarAnalytics;
  error?: string;
}
