// Owns the local engine for the app's lifetime: starts it, connects, reports status, and stops it before quit
// (which pauses local agents; their work and history stay saved).
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EngineConnection, type EngineApi, type EngineClient } from './EngineConnection';
import { LocalEngine } from './LocalEngine';

export type ClaudeAvailability = 'available' | 'missing' | 'unknown';

export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; claude: ClaudeAvailability; claudeDetail?: string }
  | { state: 'unavailable'; detail: string }
  | { state: 'stopped' };

/**
 * The built engine: engine/work inside the project during development; in the packaged app, the staged copy that
 * packaging puts in the app's resources (engine/build/stage.mjs), outside the asar archive so it can run.
 */
export function engineWorkDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'engine') : join(app.getAppPath(), 'engine', 'work');
}

/** The engine's private folder (its home, agent records, logs). Agents get a deny rule for it. */
export function engineDataDir(): string {
  return join(app.getPath('userData'), 'engine');
}

export class EngineService {
  status: EngineStatus = { state: 'stopped' };
  private local: LocalEngine | null = null;
  private readonly connection = new EngineConnection(engineWorkDir());
  private readonly listeners = new Set<(status: EngineStatus) => void>();
  private stopping = false;

  get api(): EngineApi | null {
    return this.connection.api;
  }

  get client(): EngineClient | null {
    return this.connection.client;
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  async start(): Promise<void> {
    const launcherPath = join(engineWorkDir(), 'launcher', 'agent-crew-engine.mjs');
    if (!existsSync(launcherPath)) {
      this.setStatus({
        state: 'unavailable',
        detail: app.isPackaged
          ? 'The engine is missing from this build of Agent Crew.'
          : 'The engine is not built yet. Run: npm run engine:prepare && npm run engine:build',
      });
      return;
    }
    this.setStatus({ state: 'starting' });
    this.local = new LocalEngine({
      launcherPath,
      dataDir: engineDataDir(),
      worktreesRoot: join(app.getPath('userData'), 'worktrees'),
      onExit: (code) => {
        if (!this.stopping) this.setStatus({ state: 'unavailable', detail: `The engine stopped unexpectedly (code ${code}).` });
      },
    });
    try {
      const endpoint = await this.local.start();
      const api = await this.connection.connect(endpoint);
      const claude = await checkClaude(api);
      this.setStatus({ state: 'ready', ...claude });
    } catch (error) {
      this.setStatus({ state: 'unavailable', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.connection.close();
    await this.local?.stop();
    this.local = null;
    this.setStatus({ state: 'stopped' });
  }
}

/** Asks the engine whether it can run Claude Code here (installed, and offering its modes). */
async function checkClaude(api: EngineApi): Promise<{ claude: ClaudeAvailability; claudeDetail?: string }> {
  try {
    const result = await Promise.race([
      api.providers.listModes('claude'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 20_000)),
    ]);
    const modes = (result as { modes?: { id: string }[]; error?: string }) ?? {};
    if (modes.modes?.length) return { claude: 'available' };
    return { claude: 'missing', claudeDetail: modes.error ?? 'Claude Code was not found' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { claude: /not available|not found|ENOENT/i.test(detail) ? 'missing' : 'unknown', claudeDetail: detail };
  }
}
