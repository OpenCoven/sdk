import {
  CaveClientError,
  type CaveClient,
  type CaveHealth,
} from '@opencoven/cave-client';
import {
  CovenClientError,
  type CovenClient,
  type CovenHealth,
} from '@opencoven/coven-client';

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
): Promise<ClientHealthResult<CaveHealth, CaveClientError>> {
  if (client === undefined) {
    return { status: 'not_configured' };
  }

  try {
    return {
      status: 'healthy',
      health: await client.health(),
    };
  } catch (error) {
    if (error instanceof CaveClientError) {
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
): Promise<ClientHealthResult<CovenHealth, CovenClientError>> {
  if (client === undefined) {
    return { status: 'not_configured' };
  }

  try {
    return {
      status: 'healthy',
      health: await client.health(),
    };
  } catch (error) {
    if (error instanceof CovenClientError) {
      return {
        status: 'unhealthy',
        error,
      };
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

  async health(): Promise<OpenCovenHealth> {
    const health: OpenCovenHealth = {};

    if (this.cave !== undefined) {
      health.cave = await this.cave.health();
    }

    if (this.coven !== undefined) {
      health.coven = await this.coven.health();
    }

    return health;
  }

  async healthReport(): Promise<OpenCovenHealthReport> {
    const [cave, coven] = await Promise.all([
      reportCaveHealth(this.cave),
      reportCovenHealth(this.coven),
    ]);

    return { cave, coven };
  }
}

export function createOpenCovenSdk(options: OpenCovenSdkOptions): OpenCovenSdk {
  return new OpenCovenSdk(options);
}
