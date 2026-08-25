// Entrypoint: .
// Declaration: dist/index.d.ts
import { CaveHealth, CaveClientError, CaveClient } from '@opencoven/cave-client';
import { CovenHealth, CovenClientError, CovenClient } from '@opencoven/coven-client';
import { OperationOptions } from '@opencoven/sdk-core';

interface OpenCovenSdkOptions {
    cave?: CaveClient;
    coven?: CovenClient;
}
interface ClientAvailability {
    cave: boolean;
    coven: boolean;
}
interface OpenCovenHealth {
    cave?: CaveHealth;
    coven?: CovenHealth;
}
interface OpenCovenHealthOptions extends OperationOptions {
    cave?: Pick<OperationOptions, 'signal' | 'timeoutMs'>;
    coven?: Pick<OperationOptions, 'signal' | 'timeoutMs'>;
}
type ClientHealthResult<THealth, TError extends Error> = {
    status: 'not_configured';
} | {
    status: 'healthy';
    health: THealth;
} | {
    status: 'unhealthy';
    error: TError;
};
interface OpenCovenHealthReport {
    cave: ClientHealthResult<CaveHealth, CaveClientError>;
    coven: ClientHealthResult<CovenHealth, CovenClientError>;
}
declare class OpenCovenSdkError extends Error {
    readonly client: 'cave' | 'coven';
    constructor(client: 'cave' | 'coven');
}
declare class OpenCovenSdk {
    readonly cave: CaveClient | undefined;
    readonly coven: CovenClient | undefined;
    constructor(options: OpenCovenSdkOptions);
    availability(): ClientAvailability;
    requireCave(): CaveClient;
    requireCoven(): CovenClient;
    health(options?: OpenCovenHealthOptions): Promise<OpenCovenHealth>;
    healthReport(options?: OpenCovenHealthOptions): Promise<OpenCovenHealthReport>;
}
declare function createOpenCovenSdk(options: OpenCovenSdkOptions): OpenCovenSdk;

export { type ClientAvailability, type ClientHealthResult, type OpenCovenHealth, type OpenCovenHealthOptions, type OpenCovenHealthReport, OpenCovenSdk, OpenCovenSdkError, type OpenCovenSdkOptions, createOpenCovenSdk };
