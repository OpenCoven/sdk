export const COVEN_DAEMON_PROTOCOL = 'coven.daemon.v1' as const;

export interface CovenHealthResponse {
  ok: true;
  apiVersion: typeof COVEN_DAEMON_PROTOCOL;
  covenVersion: string;
  capabilities: {
    sessions: boolean;
    events: boolean;
    eventCursor?: string;
    structuredErrors: boolean;
  };
}

export interface CovenHealth {
  status: 'ok';
}
