import {
  CaveClientError,
  isCaveClientError,
  normalizeCaveError,
  type CaveClient,
  type CaveHealth,
} from '@opencoven/cave-client';
import {
  CovenClientError,
  isCovenClientError,
  normalizeCovenError,
  type CovenClient,
  type CovenHealth,
} from '@opencoven/coven-client';
import {
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  type OperationObserver,
  type OperationOptions,
  type OperationScope,
} from '@opencoven/sdk-core';

export interface OpenCovenSdkOptions {
  cave?: CaveClient;
  coven?: CovenClient;
}

export interface ClientAvailability {
  cave: boolean;
  coven: boolean;
}

export interface OpenCovenHealth {
  cave?: CaveHealth;
  coven?: CovenHealth;
}

export interface OpenCovenHealthOptions extends OperationOptions {
  cave?: Pick<OperationOptions, 'signal' | 'timeoutMs'>;
  coven?: Pick<OperationOptions, 'signal' | 'timeoutMs'>;
}

export type ClientHealthResult<THealth, TError extends Error> =
  | { status: 'not_configured' }
  | { status: 'healthy'; health: THealth }
  | { status: 'unhealthy'; error: TError };

export interface OpenCovenHealthReport {
  cave: ClientHealthResult<CaveHealth, CaveClientError>;
  coven: ClientHealthResult<CovenHealth, CovenClientError>;
}

async function reportCaveHealth(
  client: CaveClient | undefined,
  operation: ClientOperation | undefined,
): Promise<ClientHealthResult<CaveHealth, CaveClientError>> {
  if (client === undefined) {
    return { status: 'not_configured' };
  }

  try {
    return {
      status: 'healthy',
      health:
        operation === undefined
          ? await client.health()
          : await executeCaveHealth(client, operation),
    };
  } catch (error) {
    if (isCaveClientError(error)) {
      return {
        status: 'unhealthy',
        error,
      };
    }

    throw error;
  }
}

async function reportCovenHealth(
  client: CovenClient | undefined,
  operation: ClientOperation | undefined,
): Promise<ClientHealthResult<CovenHealth, CovenClientError>> {
  if (client === undefined) {
    return { status: 'not_configured' };
  }

  try {
    return {
      status: 'healthy',
      health:
        operation === undefined
          ? await client.health()
          : await executeCovenHealth(client, operation),
    };
  } catch (error) {
    if (isCovenClientError(error)) {
      return {
        status: 'unhealthy',
        error,
      };
    }

    throw error;
  }
}

interface ClientOperation {
  scope: OperationScope;
  options: OperationOptions;
}

function createClientOperation(
  system: 'cave' | 'coven',
  globalSignal: AbortSignal,
  constraints: Pick<OperationOptions, 'signal' | 'timeoutMs'> | undefined,
  observer: OperationObserver | undefined,
): ClientOperation {
  const signals = [
    globalSignal,
    ...(constraints?.signal === undefined ? [] : [constraints.signal]),
  ];
  const scope = createOperationScope(
    {
      system,
      operation: 'health',
    },
    {
      signals,
      ...(constraints?.timeoutMs === undefined
        ? {}
        : { timeoutMs: constraints.timeoutMs }),
    },
  );
  const timeoutMs = constraints?.timeoutMs;

  return {
    scope,
    options: {
      signal: scope.context.signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(observer === undefined ? {} : { observer }),
    },
  };
}

async function executeCaveHealth(
  client: CaveClient,
  operation: ClientOperation,
): Promise<CaveHealth> {
  try {
    return await Promise.race([
      client.health(operation.options),
      operation.scope.termination,
    ]);
  } catch (error) {
    if (isCaveClientError(error)) {
      throw error;
    }
    if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
      throw new CaveClientError(normalizeCaveError(error, 'health'), undefined, {
        cause: error,
      });
    }
    throw error;
  }
}

async function executeCovenHealth(
  client: CovenClient,
  operation: ClientOperation,
): Promise<CovenHealth> {
  try {
    return await Promise.race([
      client.health(operation.options),
      operation.scope.termination,
    ]);
  } catch (error) {
    if (isCovenClientError(error)) {
      throw error;
    }
    if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
      throw new CovenClientError(normalizeCovenError(error, 'health'), {
        cause: error,
      });
    }
    throw error;
  }
}

export class OpenCovenSdkError extends Error {
  readonly client: 'cave' | 'coven';

  constructor(client: 'cave' | 'coven') {
    super(`${client} client is not configured`);
    this.name = 'OpenCovenSdkError';
    this.client = client;
  }
}

export class OpenCovenSdk {
  readonly cave: CaveClient | undefined;
  readonly coven: CovenClient | undefined;

  constructor(options: OpenCovenSdkOptions) {
    this.cave = options.cave;
    this.coven = options.coven;
  }

  availability(): ClientAvailability {
    return {
      cave: this.cave !== undefined,
      coven: this.coven !== undefined,
    };
  }

  requireCave(): CaveClient {
    if (this.cave === undefined) {
      throw new OpenCovenSdkError('cave');
    }

    return this.cave;
  }

  requireCoven(): CovenClient {
    if (this.coven === undefined) {
      throw new OpenCovenSdkError('coven');
    }

    return this.coven;
  }

  async health(options: OpenCovenHealthOptions = {}): Promise<OpenCovenHealth> {
    const health: OpenCovenHealth = {};
    const coordinator = new AbortController();
    const globalScope = createOperationScope(
      {
        system: 'sdk',
        operation: 'health',
      },
      {
        signals: [
          coordinator.signal,
          ...(options.signal === undefined ? [] : [options.signal]),
        ],
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    );

    try {
      if (this.cave !== undefined) {
        const cave = createClientOperation(
          'cave',
          globalScope.context.signal,
          options.cave,
          options.observer,
        );
        try {
          health.cave = await executeCaveHealth(this.cave, cave);
        } finally {
          cave.scope.dispose();
        }
      }

      if (this.coven !== undefined) {
        const coven = createClientOperation(
          'coven',
          globalScope.context.signal,
          options.coven,
          options.observer,
        );
        try {
          health.coven = await executeCovenHealth(this.coven, coven);
        } finally {
          coven.scope.dispose();
        }
      }

      return health;
    } finally {
      globalScope.dispose();
    }
  }

  async healthReport(options: OpenCovenHealthOptions = {}): Promise<OpenCovenHealthReport> {
    const coordinator = new AbortController();
    const globalScope = createOperationScope(
      {
        system: 'sdk',
        operation: 'healthReport',
      },
      {
        signals: [
          coordinator.signal,
          ...(options.signal === undefined ? [] : [options.signal]),
        ],
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    );
    const cave =
      this.cave === undefined
        ? undefined
        : createClientOperation(
            'cave',
            globalScope.context.signal,
            options.cave,
            options.observer,
          );
    const coven =
      this.coven === undefined
        ? undefined
        : createClientOperation(
            'coven',
            globalScope.context.signal,
            options.coven,
            options.observer,
          );

    try {
      const [caveResult, covenResult] = await Promise.all([
        reportCaveHealth(this.cave, cave),
        reportCovenHealth(this.coven, coven),
      ]);

      return { cave: caveResult, coven: covenResult };
    } catch (error) {
      coordinator.abort(error);
      throw error;
    } finally {
      cave?.scope.dispose();
      coven?.scope.dispose();
      globalScope.dispose();
    }
  }
}

export function createOpenCovenSdk(options: OpenCovenSdkOptions): OpenCovenSdk {
  return new OpenCovenSdk(options);
}
