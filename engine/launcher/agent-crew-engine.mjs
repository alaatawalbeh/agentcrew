// Agent Crew's engine launcher: starts the vendored Paseo daemon with a locked-down configuration.
//
// Agent Crew's main process starts this file (an Electron utilityProcess, or child_process.fork in tests) and talks
// to it by message:
//   → { type: 'start', home, listen, password }      ← { type: 'ready', listen }  or  { type: 'error', message }
//   → { type: 'stop' }                                ← { type: 'stopped' }
// The password only ever arrives by message and is hashed in memory: it is never read from the environment or disk.
// prepare.mjs copies this file to engine/work/launcher/ so the engine packages resolve.
import { chmodSync, mkdirSync } from 'node:fs';
import { createPaseoDaemon, createRootLogger, hashDaemonPassword, loadConfig } from '@getpaseo/server';
import { BuiltinPluginLoader } from '../packages/server/dist/server/server/plugins/builtin/index.js';

const parentPort = process.parentPort; // set inside an Electron utilityProcess
const send = (message) => (parentPort ? parentPort.postMessage(message) : process.send?.(message));
const onMessage = (handler) =>
  parentPort ? parentPort.on('message', (event) => handler(event.data)) : process.on('message', handler);

// Paseo settings from the user's shell (PASEO_LISTEN, PASEO_PASSWORD, PASEO_RELAY_…) must not change this daemon.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('PASEO_')) delete process.env[key];
}
// Agents inherit this: Claude Code's todo/task tools are off by default on current models, and the plan card in Agent
// Crew is built from them (the engine maps TodoWrite and TaskCreate/TaskUpdate to todo items).
process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '1';

let daemon = null;
let stopping = false;

async function start({ home, listen, password, worktreesRoot }) {
  if (typeof home !== 'string' || !home.startsWith('/')) throw new Error('home must be an absolute path');
  if (worktreesRoot !== undefined && (typeof worktreesRoot !== 'string' || !worktreesRoot.startsWith('/'))) {
    throw new Error('worktreesRoot must be an absolute path');
  }
  if (typeof listen !== 'string' || !listen) throw new Error('listen is required');
  if (typeof password !== 'string' || password.length < 32) throw new Error('a strong password is required');

  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);

  const env = { ...process.env, PASEO_DICTATION_ENABLED: 'false' };
  const base = loadConfig(home, { env });
  const config = {
    ...base,
    listen,
    auth: { password: hashDaemonPassword(password) },
    // Agents' worktrees live outside the engine's private home, which agents are denied access to.
    ...(worktreesRoot ? { worktreesRoot } : {}),
    // Nothing outside this machine: no relay, no hosted web app origin, no push, no web UI.
    corsAllowedOrigins: [],
    relayEnabled: false,
    relayEnabledMutable: false,
    pushNotificationSender: { send: async () => {} },
    webUi: { enabled: false, distDir: null },
    // No plugins, no usage polling (which reads Claude credentials), no agent-facing MCP, no browser tools.
    pluginsEnabled: false,
    plugins: {},
    usageEnabled: false,
    mcpEnabled: false,
    mcpInjectIntoAgents: false,
    browserToolsEnabled: false,
    enableTerminalAgentHooks: false,
    // No hidden agents (workspace naming), and Agent Crew decides when agents resume.
    metadataGeneration: { providers: [] },
    resumeOnStartup: false,
    // Agent Crew owns the lifecycle: clients can't ask this daemon to shut down or restart.
    onLifecycleIntent: () => {},
    configReload: undefined,
  };

  const logger = createRootLogger({ log: base.log }, { paseoHome: home, file: false });
  daemon = await createPaseoDaemon(config, logger, { builtinPlugins: new BuiltinPluginLoader(undefined, []) });
  await daemon.start();
  send({ type: 'ready', listen });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    await daemon?.stop({ keepTerminals: false });
  } finally {
    send({ type: 'stopped' });
    setTimeout(() => process.exit(code), 50);
  }
}

onMessage((message) => {
  if (message?.type === 'start' && !daemon) {
    start(message).catch((error) => {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      void stop(1);
    });
  } else if (message?.type === 'stop') {
    void stop(0);
  }
});

// Started with child_process.fork: stop when the parent goes away.
process.on('disconnect', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
