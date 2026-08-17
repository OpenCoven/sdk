import type { CaveClient, CaveHealth } from '@opencoven/cave-client';
import type { CovenClient, CovenHealth } from '@opencoven/coven-client';

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
}

export function createOpenCovenSdk(options: OpenCovenSdkOptions): OpenCovenSdk {
  return new OpenCovenSdk(options);
}
