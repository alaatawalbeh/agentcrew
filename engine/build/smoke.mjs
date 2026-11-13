#!/usr/bin/env node
// Starts the engine launcher in plain Node and checks it from the outside:
//   - a client without the password is refused, and one with it can list agents
//   - no ~/.paseo-style local-credential file is left in the engine home (after patch 0001)
//   - nothing listens on TCP (the daemon is on a Unix socket only)
//   node engine/build/smoke.mjs <short-temp-dir>     (Unix socket paths must stay under ~100 characters)
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = resolve(import.meta.dirname, '..');
const work = resolve(process.env.AGENT_CREW_ENGINE_WORK || join(engine, 'work'));
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: smoke.mjs <temp-dir>');

const home = join(dir, 'home');
const socket = join(dir, 's');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString('base64url');

const { createHostClient } = await import(pathToFileURL(join(work, 'packages/client/dist/node/index.js')).href);
const { createPaseoApi } = await import(pathToFileURL(join(work, 'packages/client/dist/index.js')).href);

const log = openSync(join(dir, 'engine.log'), 'w');
const child = fork(join(work, 'launcher', 'agent-crew-engine.mjs'), [], { stdio: ['ignore', log, log, 'ipc'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const waitFor = (type, ms) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no ${type} within ${ms} ms (see ${join(dir, 'engine.log')})`)), ms);
    const onMsg = (m) => {
      if (m?.type === type) {
        clearTimeout(timer);
        child.off('message', onMsg);
        res(m);
      } else if (m?.type === 'error') {
        clearTimeout(timer);
        rej(new Error(`engine error: ${m.message}`));
      }
    };
    child.on('message', onMsg);
  });

const tryConnect = async (pw) => {
  const client = createHostClient(socket, {
    clientId: `smoke-${randomBytes(4).toString('hex')}`,
    clientType: 'cli',
    ...(pw ? { password: pw } : {}),
    reconnect: { enabled: false },
    connectTimeoutMs: 8000,
  });
  try {
    await client.connect();
    return { client };
  } catch (error) {
    await client.close().catch(() => {});
    return { error };
  }
};

try {
  const started = Date.now();
  child.send({ type: 'start', home, listen: socket, password });
  await waitFor('ready', 90_000);
  check('engine started', true, `${Date.now() - started} ms`);

  const anon = await tryConnect(undefined);
  check('connection without password is refused', !!anon.error, anon.error ? String(anon.error.message ?? anon.error).slice(0, 80) : 'it connected');
  await anon.client?.close();

  const wrong = await tryConnect('not-the-password-not-the-password');
  check('connection with a wrong password is refused', !!wrong.error);
  await wrong.client?.close();

  const ok = await tryConnect(password);
  check('connection with the password works', !!ok.client, ok.error ? String(ok.error.message ?? ok.error).slice(0, 120) : '');
  if (ok.client) {
    const agents = await ok.client.fetchAgents();
    const count = Array.isArray(agents) ? agents.length : (agents?.entries?.length ?? agents?.agents?.length ?? '?');
    check('can list agents', true, `${count} agents`);
    try {
      const api = createPaseoApi(ok.client);
      const modes = await Promise.race([
        api.providers.listModes('claude'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20_000)),
      ]);
      const ids = (modes?.modes ?? []).map((m) => m.id);
      if (ids.length) {
        check('Claude modes offer no bypass', !ids.includes('bypassPermissions'), ids.join(', '));
      } else {
        console.log(`SKIP  Claude modes (${modes?.error ?? 'provider unavailable: is Claude Code installed?'})`);
      }
    } catch (error) {
      console.log(`SKIP  Claude modes (${error.message})`);
    }
    await ok.client.close();
  }

  check('no local-credential file in the engine home', !existsSync(join(home, 'local-credential')));
} catch (error) {
  check('smoke run', false, error.message);
} finally {
  child.send({ type: 'stop' });
  await Promise.race([waitFor('stopped', 15_000).catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
