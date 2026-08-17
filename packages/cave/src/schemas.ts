export interface CaveHealth {
  status: 'ok';
}

export interface CaveHealthResponse {
  apiVersion?: string;
  minimumClientVersion?: string;
  requestId?: string;
  data: CaveHealth;
}
