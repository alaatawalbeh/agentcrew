// Drives the app's window over the Chrome DevTools Protocol, for the end-to-end scripts. The app is started with a
// loopback-only debugging port; this finds its app://crew page and evaluates code in it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function checker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    return !!ok;
  };
  const summary = () => {
    const failed = results.filter((ok) => !ok).length;
    console.log(failed ? `${failed} check(s) failed` : `all ${results.length} checks passed`);
    return failed;
  };
  return { check, summary };
}

export async function connect(port, screenshotDir) {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.startsWith('app://crew'));
    } catch {}
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('the app window never appeared');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('could not attach to the app window')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    const entry = msg.id && pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result);
  });
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation failed');
    return r.result?.value;
  };
  const screenshot = async (name) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = join(screenshotDir, name);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  };
  /** Polls the engine state the window sees until it settles (the page may still be loading at first). */
  const waitForEngine = async (ms = 60_000) => {
    let engine;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      engine = await evaluate(
        `location.href.startsWith('app://crew') && document.readyState === 'complete' && window.crew
          ? window.crew.hello().then((h) => h.engine)
          : null`,
      ).catch(() => null);
      if (engine?.state === 'ready' || engine?.state === 'unavailable') break;
      await sleep(500);
    }
    return engine;
  };
  return { cdp, evaluate, screenshot, waitForEngine, close: () => ws.close() };
}

/** Stops the app the way quitting does, then makes sure it's gone. */
export async function stopApp(app) {
  if (app.exitCode !== null || app.signalCode !== null) return;
  app.kill('SIGTERM');
  await Promise.race([new Promise((r) => app.once('exit', r)), sleep(15_000)]);
  if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
}
