// Agent Crew's connection to an engine, through the vendored Paseo client library (loaded from engine/work at run
// time so it stays out of the app bundle). Everything Paseo-specific stays behind this file and the bridge.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EngineEndpoint } from './LocalEngine';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The parts of the Paseo client used by Agent Crew. Kept loose: the shapes are pinned by the vendored version. */
export interface EngineApi {
  agents: {
    list(options?: any): Promise<any>;
    ref(agent: string | any): any;
    create(options: any): Promise<any>;
    subscribe(handler: (update: any) => void): () => void;
  };
  providers: {
    listModes(provider: string, options?: any): Promise<any>;
    listModels(provider: string, options?: any): Promise<any>;
  };
  dispose(): Promise<void>;
}

export interface EngineClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  fetchAgents(options?: any): Promise<any>;
  cancelAgent(agentId: string): Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class EngineConnection {
  client: EngineClient | null = null;
  api: EngineApi | null = null;

  constructor(private readonly engineWorkDir: string) {}

  async connect(endpoint: EngineEndpoint): Promise<EngineApi> {
    const nodeEntry = pathToFileURL(join(this.engineWorkDir, 'packages/client/dist/node/index.js')).href;
    const mainEntry = pathToFileURL(join(this.engineWorkDir, 'packages/client/dist/index.js')).href;
    const { createHostClient } = await import(/* @vite-ignore */ nodeEntry);
    const { createPaseoApi } = await import(/* @vite-ignore */ mainEntry);

    const client: EngineClient = createHostClient(endpoint.socketPath, {
      clientId: `agent-crew-${randomBytes(6).toString('hex')}`,
      clientType: 'cli',
      appVersion: 'agent-crew',
      password: endpoint.password,
      reconnect: { enabled: true },
      connectTimeoutMs: 10_000,
    });
    await client.connect();
    this.client = client;
    this.api = createPaseoApi(client) as EngineApi;
    return this.api;
  }

  async close(): Promise<void> {
    await this.api?.dispose().catch(() => {});
    await this.client?.close().catch(() => {});
    this.api = null;
    this.client = null;
  }
}
