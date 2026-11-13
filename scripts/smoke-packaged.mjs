#!/usr/bin/env node
// Checks a packaged build starts and works: the window opens sandboxed, the bundled engine starts and finds Claude
// Code, and the crew shows. It uses its own profile folder and never starts an agent.
//   node scripts/smoke-packaged.mjs <temp-dir> [path to the AppImage or release/linux-unpacked/agent-crew]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checker, connect, sleep, stopApp } from './lib/cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: smoke-packaged.mjs <temp-dir> [app]');
const binary = resolve(process.argv[3] ?? join(root, 'release', 'linux-unpacked', 'agent-crew'));
if (!existsSync(binary)) throw new Error(`${binary} not found: run npm run package first`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const PORT = 9237;
const logFile = join(dir, 'app.log');
const app = spawn(binary, [`--user-data-dir=${join(dir, 'userdata')}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', openSync(logFile, 'w'), openSync(logFile, 'a')],
  env: { ...process.env, PATH: `${join(homedir(), '.local/bin')}:${process.env.PATH}` },
});
const { check, summary } = checker();

/** This app's renderer processes, from /proc: whether each runs under a seccomp filter in its own PID namespace. */
function renderers() {
  const mine = `--user-data-dir=${join(dir, 'userdata')}`;
  const found = [];
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      // Chromium rewrites its child processes' command lines into one space-separated string.
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (!cmd.includes(' --type=renderer ') || !cmd.includes(mine)) continue;
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      found.push({
        pid,
        seccomp: /^Seccomp:\s+2$/m.test(status),
        ownPidNamespace: readlinkSync(`/proc/${pid}/ns/pid`) !== readlinkSync('/proc/self/ns/pid'),
        noSandboxFlag: / --no-sandbox( |$)/.test(cmd),
      });
    } catch {}
  }
  return found;
}
let page;
try {
  page = await connect(PORT, dir);
  const engine = await page.waitForEngine(90_000);
  check('bundled engine started', engine?.state === 'ready', JSON.stringify(engine));
  check('Claude Code found', engine?.claude === 'available', engine?.claudeDetail ?? '');
  await sleep(1000);
  const dom = await page.evaluate(`(() => ({
    rows: [...document.querySelectorAll('.row-name')].map((n) => n.textContent),
    engineNote: document.querySelector('.crew-engine')?.textContent ?? null,
    title: document.title,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
    nodeVisible: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
    preloadKeys: Object.keys(window.crew ?? {}).length,
  }))()`);
  check('the crew shows', dom.rows.length >= 6, dom.rows.join(', '));
  check('no engine warning in the sidebar', dom.engineNote === null, dom.engineNote ?? '');
  check('production CSP (no inline scripts or styles)', /script-src 'self';/.test(dom.csp) && !dom.csp.includes('unsafe-inline'));
  check('no Node in the page; only the crew functions', !dom.nodeVisible && dom.preloadKeys > 10, `${dom.preloadKeys} functions`);
  const procs = renderers();
  check(
    'renderer sandboxed: seccomp filter, own PID namespace',
    procs.length > 0 && procs.every((r) => r.seccomp && r.ownPidNamespace && !r.noSandboxFlag),
    JSON.stringify(procs),
  );
  await page.screenshot('packaged.png');
} catch (error) {
  check('packaged app run', false, error.message);
} finally {
  page?.close();
  await stopApp(app);
}
const log = readFileSync(logFile, 'utf8');
check('no sandbox errors in the log', !/sandbox.*(not configured|failed|error)/i.test(log), log.match(/.*sandbox.*/i)?.[0] ?? '');
check('engine stopped cleanly on quit', /"state":"stopped"/.test(log) || !/engine.*crash/i.test(log));
console.log(`log and screenshot: ${dir}`);
process.exit(summary() ? 1 : 0);
