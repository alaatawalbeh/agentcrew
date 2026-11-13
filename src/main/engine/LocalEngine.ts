// Runs the vendored engine on this machine as an Electron utility process, for as long as Agent Crew is open.
// Its password is generated here, kept only in memory, and handed over by message: never via env, argv or disk.
import { utilityProcess, type UtilityProcess } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface EngineEndpoint {
  socketPath: string;
  password: string;
}

export interface LocalEngineOptions {
  /** engine/work/launcher/agent-crew-engine.mjs */
  launcherPath: string;
  /** Private folder for the engine's home and log (e.g. <userData>/engine). Agents are denied access to it. */
  dataDir: string;
  /** Where agents' worktrees go (e.g. <userData>/worktrees): outside dataDir, so agents can work in them. */
  worktreesRoot: string;
  onExit?: (code: number) => void;
}

/**
 * The engine's socket goes in the per-user runtime folder (XDG_RUNTIME_DIR, 0700, cleared at logout) where there is
 * one, which also keeps its path well under the ~100-character limit for Unix sockets. One socket per data folder.
 */
function socketPathFor(dataDir: string): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime && runtime.startsWith('/') && existsSync(runtime)) {
    const dir = join(runtime, 'agent-crew');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const id = createHash('sha256').update(dataDir).digest('hex').slice(0, 12);
    return join(dir, `engine-${id}.sock`);
  }
  return join(dataDir, 'engine.sock');
}

const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 8_000;

/** Keys that would switch agents to API billing or another endpoint, or change the engine itself. */
const STRIPPED_ENV = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|PASEO_.*|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/;

function engineEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIPPED_ENV.test(key)) env[key] = value;
  }
  // Claude Code's native installer puts `claude` in ~/.local/bin, which a desktop-launched app may not have on PATH.
  const localBin = join(homedir(), '.local', 'bin');
  const path = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (!path.includes(localBin)) env.PATH = [...path, localBin].join(delimiter);
  return env;
}

const privateDir = (dir: string) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
};

export class LocalEngine {
  private child: UtilityProcess | null = null;
  private ready: Promise<EngineEndpoint> | null = null;
  private log: WriteStream | null = null;
  private readonly password = randomBytes(32).toString('base64url');

  constructor(private readonly options: LocalEngineOptions) {}

  start(): Promise<EngineEndpoint> {
    if (this.ready) return this.ready;
    const root = privateDir(this.options.dataDir);
    const home = privateDir(join(root, 'home'));
    const worktreesRoot = privateDir(this.options.worktreesRoot);
    const socketPath = socketPathFor(root);
    this.log = createWriteStream(join(root, 'engine.log'), { flags: 'a', mode: 0o600 });

    const child = utilityProcess.fork(this.options.launcherPath, [], {
      serviceName: 'Agent Crew engine',
      stdio: 'pipe',
      env: engineEnv(),
    });
    this.child = child;
    child.stdout?.pipe(this.log, { end: false });
    child.stderr?.pipe(this.log, { end: false });

    this.ready = new Promise<EngineEndpoint>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The engine did not start within 60 seconds.')), START_TIMEOUT_MS);
      child.on('message', (message: { type?: string; message?: string }) => {
        if (message?.type === 'ready') {
          clearTimeout(timer);
          resolve({ socketPath, password: this.password });
        } else if (message?.type === 'error') {
          clearTimeout(timer);
          reject(new Error(`The engine failed to start: ${message.message ?? 'unknown error'}`));
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`The engine exited (code ${code}) before it was ready.`));
        this.child = null;
        this.ready = null;
        this.options.onExit?.(code);
      });
      child.once('spawn', () => {
        child.postMessage({ type: 'start', home, listen: socketPath, password: this.password, worktreesRoot });
      });
    });
    return this.ready;
  }

  /** Asks the engine to stop its agents and exit; kills it if it hasn't after a few seconds. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.postMessage({ type: 'stop' });
    });
    this.child = null;
    this.ready = null;
    this.log?.end();
  }
}
