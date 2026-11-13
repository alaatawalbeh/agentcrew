#!/usr/bin/env node
// Records one real agent session from the engine into a fixture file, for building and testing Agent Crew's event
// mapping. Needs Claude Code installed and signed in; uses a small amount of the user's plan.
//   node engine/build/record.mjs <short-temp-dir> <out.jsonl>
// What it does, in a throwaway git repo:
//   1. creates an agent in its own worktree, in "Always Ask" mode, with a task that edits a file and runs a command
//   2. allows the first permission request and denies the second
//   3. sends a second message and cancels it a few seconds in
// Paths are rewritten (<home>, <tmp>) and anything shaped like an email address is removed.
import { execFileSync, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = resolve(import.meta.dirname, '..');
const work = join(engine, 'work');
const [dirArg, outArg] = process.argv.slice(2);
if (!dirArg || !outArg) throw new Error('usage: record.mjs <temp-dir> <out.jsonl>');
const dir = resolve(dirArg);
const out = resolve(outArg);

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true, mode: 0o700 });
const repo = join(dir, 'repo');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'agent-crew@example.invalid');
git('config', 'user.name', 'Agent Crew test');
writeFileSync(join(repo, 'README.md'), '# Scratch repo\n\nA throwaway repo for Agent Crew event recording.\n');
git('add', '.');
git('commit', '-q', '-m', 'initial');

const { createHostClient } = await import(pathToFileURL(join(work, 'packages/client/dist/node/index.js')).href);
const { createPaseoApi } = await import(pathToFileURL(join(work, 'packages/client/dist/index.js')).href);

const socket = join(dir, 's');
const password = randomBytes(32).toString('base64url');
const log = openSync(join(dir, 'engine.log'), 'w');
const child = fork(join(work, 'launcher', 'agent-crew-engine.mjs'), [], { stdio: ['ignore', log, log, 'ipc'] });

const started = Date.now();
const events = [];
const record = (kind, payload) => events.push({ t: Date.now() - started, kind, payload });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitMsg = (type, ms) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no ${type} within ${ms} ms`)), ms);
    child.on('message', (m) => {
      if (m?.type === type) {
        clearTimeout(timer);
        res(m);
      } else if (m?.type === 'error') {
        clearTimeout(timer);
        rej(new Error(m.message));
      }
    });
  });

let client;
let permissionsSeen = 0;
try {
  child.send({ type: 'start', home: join(dir, 'home'), listen: socket, password });
  await waitMsg('ready', 90_000);
  client = createHostClient(socket, { clientId: 'agent-crew-record', clientType: 'cli', password, reconnect: { enabled: false } });
  await client.connect();
  const api = createPaseoApi(client);
  api.agents.subscribe((update) => record('agent_update', update));
  const listed = await api.agents.list({ subscribe: {} });
  record('agent_list', { count: listed?.entries?.length ?? listed?.agents?.length ?? null });

  // Patch 0002 check: creating an agent in bypass mode must fail (no prompt, so nothing would run anyway).
  try {
    const bypass = await api.agents.create({
      config: { provider: 'claude/claude-haiku-5-5', modeId: 'bypassPermissions' },
      cwd: repo,
    });
    record('bypass_create', { created: true, id: bypass.id });
    console.log('FAIL: an agent was created in bypass mode');
    await bypass.archive().catch(() => {});
  } catch (error) {
    record('bypass_create', { created: false, error: String(error?.message ?? error) });
    console.log(`bypass mode refused: ${String(error?.message ?? error).slice(0, 100)}`);
  }

  const models = await api.providers.listModels('claude');
  record('models', models);
  const ids = (models?.models ?? []).map((m) => m.id);
  const model = ids.find((id) => /haiku/i.test(id)) ?? ids[0];
  console.log(`models: ${ids.join(', ') || '(none listed)'}  → using ${model ?? 'provider default'}`);

  const handle = await api.agents.create({
    config: { provider: model ? `claude/${model}` : 'claude', modeId: 'default' },
    cwd: repo,
    title: 'Event recording',
    labels: { 'crew.robot': 'atlas' },
    worktree: { mode: 'branch-off', newBranch: 'crew/record-1', base: 'main' },
    prompt:
      'First write a short todo list for this task using your todo tool. Then append the line "Hello from Agent Crew." ' +
      'to the end of README.md, run `git status --short`, and create a file named notes.txt containing the word done. ' +
      'Keep the todo list up to date, and finish with one sentence saying what you did.',
  });
  record('created', handle.current());
  console.log(`agent ${handle.id} in ${handle.cwd}`);

  const subscription = handle.timeline.subscribe(async (event) => {
    record('timeline', event);
    const ev = event?.event;
    if (ev?.type === 'permission_requested') {
      permissionsSeen += 1;
      const request = ev.request;
      const allow = permissionsSeen !== 2; // allow, deny, then allow anything after
      console.log(`permission #${permissionsSeen}: ${request?.name} (${request?.kind}) → ${allow ? 'allow' : 'deny'}`);
      await handle.respondToPermission({
        requestId: request.id,
        response: allow
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: 'Not this time: please just summarise what you did instead.' },
      });
      record('responded', { requestId: request.id, allow });
    }
  });
  await subscription.ready;

  // waitForFinish also returns while the agent waits on a permission; the subscription answers those, so keep waiting.
  let first;
  for (let i = 0; i < 12; i++) {
    first = await handle.waitForFinish(240_000);
    record('finished', first);
    console.log(`turn 1 wait ${i + 1}: ${first?.status}`);
    if (first?.status !== 'permission') break;
    await sleep(500);
  }

  await handle.send('Count from 1 to 60, one number per line, with a short comment after each.');
  await sleep(4000);
  await client.cancelAgent(handle.id);
  const second = await handle.waitForFinish(60_000).catch((e) => ({ error: String(e) }));
  record('finished', second);
  console.log(`turn 2 after cancel: ${second?.status ?? JSON.stringify(second).slice(0, 80)}`);

  record('timeline_fetch', await handle.timeline.refetch({ limit: 500 }));
  record('agent_snapshot', handle.current());
  subscription();
} catch (error) {
  record('script_error', String(error?.stack ?? error));
  console.error(`recording failed: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  child.send({ type: 'stop' });
  await Promise.race([waitMsg('stopped', 15_000).catch(() => {}), sleep(15_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const scrub = (text) =>
  text
    .replaceAll(dir, '<tmp>')
    .replaceAll(homedir(), '<home>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
const lines = events.map((e) => scrub(JSON.stringify(e)));
writeFileSync(out, `${lines.join('\n')}\n`);
const counts = {};
for (const e of events) {
  const key = e.kind === 'timeline' ? `timeline:${e.payload?.event?.type}` : e.kind;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log(`wrote ${events.length} events to ${out}`);
console.log(JSON.stringify(counts, null, 1));
console.log(`worktree branch exists: ${git('branch', '--list', 'crew/record-1').trim() || 'no'}`);
