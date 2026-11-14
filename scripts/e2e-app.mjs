#!/usr/bin/env node
// End-to-end check of the real app with real agents (needs `npm run build`, the engine built, and Claude Code signed in).
//   node scripts/e2e-app.mjs <temp-dir>
// Launches the built app with a loopback-only debugging port and development test hooks (no folder dialog, Haiku,
// "Always ask" mode, fixed answers to the archive and delete dialogs), then, in the real UI:
//   1. types a task to sleeping Atlas, clicks "Allow once" on approval cards, waits for it to finish
//   2. opens Atlas's Changes view
//   3. starts Rook from the New session dialog and lets it finish in its own worktree
//   4. archives Rook, removing its worktree but keeping its branch (Rook stays in the crew, asleep)
//   5. renames Atlas from the header, and deletes Rook from the crew
// then restarts the app with a plain folder (not a git repo) instead of the repo, and:
//   6. checks the new name survived the restart
//   7. gives Kit a task there: it works in the folder itself, and the Changes view shows its edits
//   8. deletes Kit: it leaves the crew, and the folder keeps its files
// and checks what the transcript, the dialogs, git and the folder show. Screenshots go to <temp-dir>.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checker, connect, sleep, stopApp } from './lib/cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: e2e-app.mjs <temp-dir>');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// A throwaway repo for the agents.
const repo = join(dir, 'repo');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'agent-crew@example.invalid');
git('config', 'user.name', 'Agent Crew test');
writeFileSync(join(repo, 'README.md'), '# E2E scratch repo\n');
git('add', '.');
git('commit', '-q', '-m', 'initial');
const worktrees = () =>
  git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));

// A plain folder, not under git, for the second run.
const plain = join(dir, 'plain-site');
mkdirSync(plain);
writeFileSync(join(plain, 'index.html'), '<h1>Plain site</h1>\n');

const PORT = 9236;
const logFile = join(dir, 'app.log');
writeFileSync(logFile, '');
const launch = (folder) =>
  spawn(
    join(root, 'node_modules/.bin/electron'),
    ['.', `--user-data-dir=${join(dir, 'userdata')}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${PORT}`],
    {
      cwd: root,
      stdio: ['ignore', openSync(logFile, 'a'), openSync(logFile, 'a')],
      env: {
        ...process.env,
        PATH: `${join(homedir(), '.local/bin')}:${process.env.PATH}`,
        AGENT_CREW_TEST_REPO: folder,
        AGENT_CREW_TEST_MODEL: 'claude-haiku-5-5',
        AGENT_CREW_TEST_MODE: 'default',
        AGENT_CREW_TEST_ARCHIVE: 'remove',
        AGENT_CREW_TEST_DELETE: 'remove',
      },
    },
  );
let app = launch(repo);

const { check, summary } = checker();
let page;

/** Sets a React-controlled textarea or select the way typing or picking would. */
const setValue = (selectorJs, value) => `(() => {
  const el = ${selectorJs};
  if (!el) return null;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return el.value;
})()`;
/** The control under a New session field label. */
const field = (label, tag) =>
  `[...document.querySelectorAll('.ns-field')].find((f) => f.querySelector('.ns-label')?.textContent === ${JSON.stringify(label)})?.querySelector('${tag}')`;

const sessionOf = (robotId) =>
  page.evaluate(`window.crew.hello().then((h) => h.snapshot?.sessions.find((s) => s.robotId === ${JSON.stringify(robotId)}) ?? null)`);

async function waitUntil(fn, ms = 20_000, step = 300) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

/** Lets the selected robot work, clicking "Allow once" on each approval card, until it's done or stuck. */
async function driveUntilDone(robotId, label) {
  let approvals = 0;
  let sawCard = false;
  let sawWork = false;
  let session;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(800);
    session = await sessionOf(robotId);
    if (!session) continue;
    if (session.status === 'thinking' || session.status === 'speaking') sawWork = true;
    if (session.pendingApproval) {
      const card = await page.evaluate(`document.querySelector('.approval')?.innerText ?? null`);
      if (card) {
        sawCard = true;
        if (approvals === 0) await page.screenshot(`${label}-approval.png`);
        approvals++;
        await page.evaluate(`document.querySelector('.approval .btn-primary').click()`);
        await sleep(600);
      }
      continue;
    }
    if (session.status === 'done' && session.items.some((i) => i.kind === 'agent' && !i.streaming)) break;
    if (session.status === 'stuck') break;
  }
  return { session, approvals, sawCard, sawWork };
}

const transcript = () =>
  page.evaluate(`(() => ({
    header: document.querySelector('.header-name')?.textContent,
    task: document.querySelector('.header-task')?.textContent,
    where: document.querySelector('.header-where')?.textContent,
    pill: document.querySelector('.header .pill')?.textContent,
    plan: document.querySelectorAll('.plan .plan-item').length,
    planHead: document.querySelector('.plan-head span:last-child')?.textContent,
    tools: [...document.querySelectorAll('.tool .tool-name')].map((n) => n.textContent + ' ' + n.nextElementSibling?.textContent),
    approvals: document.querySelectorAll('.approval-note').length,
    reply: [...document.querySelectorAll('.agent-text')].pop()?.textContent,
  }))()`);

try {
  page = await connect(PORT, dir);
  const engine = await page.waitForEngine(60_000);
  check('engine ready inside the app', engine?.state === 'ready', JSON.stringify(engine));
  check('Claude Code available', engine?.claude === 'available', engine?.claudeDetail ?? '');
  await sleep(800);
  await page.screenshot('1-start.png');

  // ---------- 1. a task typed to a sleeping robot ----------
  await page.evaluate(`document.querySelector('.row-hit').click()`);
  await sleep(300);
  const atlasTask =
    'Use your todo tool to keep a short todo list. Create a file CREW.md containing the line "Atlas was here.", then run `git status --short` and say in one sentence what changed.';
  await page.evaluate(setValue(`document.querySelector('.composer textarea')`, atlasTask));
  await page.evaluate(`document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);

  const atlasRun = await driveUntilDone('atlas', '2-atlas');
  await sleep(1200);
  await page.screenshot('3-atlas-done.png');
  const atlasDom = await transcript();
  console.log(JSON.stringify(atlasDom, null, 1));
  check('Atlas started working', atlasRun.sawWork);
  check('approval card shown and answered from the UI', atlasRun.sawCard, `${atlasRun.approvals} approval(s)`);
  check('Atlas finished', atlasRun.session?.status === 'done', atlasRun.session?.status);
  check('header shows the task and its branch', !!atlasDom.task && /crew-atlas-/.test(atlasDom.where ?? ''), `${atlasDom.task} | ${atlasDom.where}`);
  check('plan card rendered from the todo list', atlasDom.plan > 0, `${atlasDom.planHead ?? ''} (${atlasDom.plan} items)`);
  check('tool rows rendered', atlasDom.tools.length > 0, atlasDom.tools.join('; ').slice(0, 160));
  check('approval decisions noted in the transcript', atlasDom.approvals === atlasRun.approvals);
  check('Atlas replied', (atlasDom.reply ?? '').length > 10, (atlasDom.reply ?? '').slice(0, 100));
  const atlasTree = worktrees().find((w) => /crew-atlas-/.test(w));
  check('Atlas worked in its own worktree', !!atlasTree && existsSync(join(atlasTree, 'CREW.md')), atlasTree?.replace(dir, '<tmp>') ?? '');

  // ---------- 2. the Changes view ----------
  await page.evaluate(`document.querySelector('[aria-label="Atlas\\'s changes"]').click()`);
  const changes = await waitUntil(() =>
    page.evaluate(`(() => {
      const body = document.querySelector('dialog.changes[open] .changes-body');
      if (!body || body.textContent.includes('Reading the changes')) return null;
      return {
        files: [...body.querySelectorAll('.change-path')].map((p) => p.textContent),
        notes: [...body.querySelectorAll('.changes-note')].map((n) => n.textContent).join('\\n'),
        where: document.querySelector('.changes-where')?.textContent,
      };
    })()`),
  );
  await page.screenshot('4-changes.png');
  check(
    'Changes view lists what Atlas made',
    !!changes && (changes.files.includes('CREW.md') || changes.notes.includes('CREW.md')),
    changes ? `files: ${changes.files.join(', ') || 'none'}; notes: ${changes.notes.replace(/\s+/g, ' ').slice(0, 80)}` : 'never loaded',
  );
  await page.evaluate(`document.querySelector('dialog.changes .modal-close').click()`);
  check('Changes view closes', !!(await waitUntil(() => page.evaluate(`!document.querySelector('dialog[open]')`), 3000)));

  // ---------- 3. a robot started from the New session dialog ----------
  await page.evaluate(`document.querySelector('.new-session').click()`);
  const dialog = await waitUntil(() => page.evaluate(`document.querySelector('dialog.ns[open]') ? [...document.querySelectorAll('.ns-robot span')].map((s) => s.textContent) : null`));
  check('New session dialog opens with the free robots', !!dialog && dialog.includes('Rook') && !dialog.includes('Atlas'), dialog?.join(', ') ?? '');
  await page.evaluate(`[...document.querySelectorAll('.ns-robot')].find((b) => b.textContent === 'Rook').click()`);
  const rookTask = 'Create a file ROOK.md containing the line "Rook was here." Then say in one sentence what you did.';
  await page.evaluate(setValue(`document.querySelector('#ns-task')`, rookTask));
  await page.evaluate(`document.querySelector('.ns-repo').click()`);
  const base = await waitUntil(() => page.evaluate(`(() => { const s = ${field('Base branch', 'select')}; return s && !s.disabled ? s.value : null; })()`));
  check('repo chosen and its branch offered', base === 'main', String(base));
  const models = await waitUntil(() => page.evaluate(`[...(${field('Model', 'select')})?.options ?? []].map((o) => o.value).filter(Boolean)`).then((m) => (m.length ? m : null)));
  check('models listed by the engine', !!models?.length, models?.join(', ') ?? '');
  if (models?.includes('claude-haiku-5-5')) await page.evaluate(setValue(field('Model', 'select'), 'claude-haiku-5-5'));
  await page.evaluate(setValue(field('Permissions', 'select'), 'default'));
  await sleep(300);
  await page.screenshot('5-new-session.png');
  const startLabel = await page.evaluate(`document.querySelector('.modal-foot .btn-primary').textContent`);
  await page.evaluate(`document.querySelector('.modal-foot .btn-primary').click()`);
  const started = await waitUntil(
    () => page.evaluate(`!document.querySelector('dialog[open]') && document.querySelector('.header-name')?.textContent === 'Rook'`),
    30_000,
  );
  const dialogError = await page.evaluate(`document.querySelector('.ns-error')?.textContent || null`);
  check('Rook starts from the dialog and is selected', !!started, dialogError ?? startLabel);

  const rookRun = await driveUntilDone('rook', '6-rook');
  await sleep(1200);
  await page.screenshot('7-rook-done.png');
  const rookDom = await transcript();
  check('Rook finished', rookRun.session?.status === 'done', rookRun.session?.status);
  check('Rook used the chosen model', rookRun.session?.model === (models?.includes('claude-haiku-5-5') ? 'claude-haiku-5-5' : models?.[0]), rookRun.session?.model);
  check('Rook asked before writing (Always ask)', rookRun.sawCard, `${rookRun.approvals} approval(s)`);
  const rookTree = worktrees().find((w) => /crew-rook-/.test(w));
  check(
    'Rook has its own worktree, apart from Atlas',
    !!rookTree && rookTree !== atlasTree && existsSync(join(rookTree, 'ROOK.md')) && !existsSync(join(rookTree, 'CREW.md')),
    `${rookDom.where} | ${rookTree?.replace(dir, '<tmp>')}`,
  );

  // ---------- 4. archive Rook, removing its worktree ----------
  await page.evaluate(`document.querySelector('[aria-label="Archive Rook\\'s session"]').click()`);
  const asleep = await waitUntil(async () => (await sessionOf('rook'))?.status === 'sleeping', 30_000);
  await sleep(500);
  await page.screenshot('8-archived.png');
  check('archived Rook goes back to sleep and stays in the crew', !!asleep);
  check('its worktree is removed', !!rookTree && !existsSync(rookTree) && !worktrees().some((w) => /crew-rook-/.test(w)));
  const rookBranches = git('branch', '--list', 'crew-rook-*').trim();
  check('its branch is kept', rookBranches.length > 0, rookBranches);
  check('Atlas is untouched', (await sessionOf('atlas'))?.status === 'done' && existsSync(join(atlasTree ?? '', 'CREW.md')));

  // ---------- 5. rename Atlas from the header, delete Rook ----------
  await page.evaluate(`[...document.querySelectorAll('.row-hit')].find((b) => b.getAttribute('aria-label').startsWith('Atlas:')).click()`);
  await sleep(300);
  await page.evaluate(`document.querySelector('.rename-btn').click()`);
  await waitUntil(() => page.evaluate(`!!document.querySelector('.rename-input')`), 3000);
  await page.evaluate(setValue(`document.querySelector('.rename-input')`, 'Captain'));
  await page.evaluate(`document.querySelector('.rename-input').form.requestSubmit()`);
  const renamed = await waitUntil(() =>
    page.evaluate(`document.querySelector('.header-name')?.textContent === 'Captain' && [...document.querySelectorAll('.row-name')].some((n) => n.textContent === 'Captain')`),
  );
  await page.screenshot('9-renamed.png');
  check('Atlas renamed from the header, in the header and the sidebar', !!renamed);
  const crewFile = JSON.parse(readFileSync(join(dir, 'userdata', 'crew.json'), 'utf8'));
  check('the name is saved in crew.json', crewFile.names?.atlas === 'Captain', JSON.stringify(crewFile.names));
  // A name another robot has is refused, in place.
  await page.evaluate(`document.querySelector('.rename-btn').click()`);
  await waitUntil(() => page.evaluate(`!!document.querySelector('.rename-input')`), 3000);
  await page.evaluate(setValue(`document.querySelector('.rename-input')`, 'vega'));
  await page.evaluate(`document.querySelector('.rename-input').form.requestSubmit()`);
  const refused = await waitUntil(() => page.evaluate(`document.querySelector('.rename-error')?.textContent ?? null`), 3000);
  check('a taken name is refused in place', /Vega/.test(refused ?? ''), refused ?? 'no error shown');
  await page.evaluate(`document.querySelector('.rename-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc cancels the rename', !!(await waitUntil(() => page.evaluate(`document.querySelector('.header-name')?.textContent === 'Captain'`), 3000)));

  await page.evaluate(`[...document.querySelectorAll('.row-hit')].find((b) => b.getAttribute('aria-label').startsWith('Rook:')).click()`);
  await sleep(300);
  await page.evaluate(`document.querySelector('[aria-label="Delete Rook"]').click()`);
  const rookGone = await waitUntil(() => page.evaluate(`![...document.querySelectorAll('.row-name')].some((n) => n.textContent === 'Rook')`), 30_000);
  await page.screenshot('10-rook-deleted.png');
  check('deleted Rook leaves the sidebar', !!rookGone);
  check('Rook is free again in the roster', (await sessionOf('rook')) === null);
} catch (error) {
  check('e2e run', false, error.message);
} finally {
  page?.close();
  await stopApp(app);
}

// ---------- second run: a plain folder ----------
app = launch(plain);
try {
  page = await connect(PORT, dir);
  const engine = await page.waitForEngine(60_000);
  check('the app starts again', engine?.state === 'ready', JSON.stringify(engine));
  await sleep(800);
  const names = await page.evaluate(`window.crew.hello().then((h) => h.snapshot.sessions.map((s) => s.name))`);
  check('the new name survived the restart, and Rook stayed deleted', names.includes('Captain') && !names.includes('Rook'), names.join(', '));

  // ---------- 7. Kit works straight in the plain folder ----------
  await page.evaluate(`[...document.querySelectorAll('.row-hit')].find((b) => b.getAttribute('aria-label').startsWith('Kit:')).click()`);
  await sleep(300);
  const kitTask = 'Create a file KIT.md containing the line "Kit was here." Then say in one sentence what you did.';
  await page.evaluate(setValue(`document.querySelector('.composer textarea')`, kitTask));
  await page.evaluate(`document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  const kitRun = await driveUntilDone('kit', '11-kit');
  await sleep(1200);
  await page.screenshot('12-kit-done.png');
  const kitDom = await transcript();
  check('Kit finished', kitRun.session?.status === 'done', kitRun.session?.status);
  check('Kit works in the folder itself, with no branch', kitRun.session?.workspace === 'folder' && !kitRun.session?.branch && kitDom.where === 'plain-site · in place', kitDom.where);
  check('its file is in the folder', existsSync(join(plain, 'KIT.md')), existsSync(join(plain, 'KIT.md')) ? readFileSync(join(plain, 'KIT.md'), 'utf8').trim() : 'missing');
  check('no git repo was made there', !existsSync(join(plain, '.git')));

  await page.evaluate(`document.querySelector('[aria-label="Kit\\'s changes"]').click()`);
  const kitChanges = await waitUntil(() =>
    page.evaluate(`(() => {
      const body = document.querySelector('dialog.changes[open] .changes-body');
      if (!body || body.textContent.includes('Reading the changes')) return null;
      return {
        files: [...body.querySelectorAll('.change-path')].map((p) => p.textContent),
        notes: [...body.querySelectorAll('.changes-note')].map((n) => n.textContent).join('\\n'),
      };
    })()`),
  );
  await page.screenshot('13-kit-changes.png');
  check(
    'Changes view lists Kit\'s edits and says why',
    !!kitChanges && kitChanges.files.includes('KIT.md') && kitChanges.notes.includes("isn't a git repository"),
    kitChanges ? `files: ${kitChanges.files.join(', ') || 'none'}` : 'never loaded',
  );
  await page.evaluate(`document.querySelector('dialog.changes .modal-close').click()`);
  await waitUntil(() => page.evaluate(`!document.querySelector('dialog[open]')`), 3000);

  // ---------- 8. delete Kit: the folder keeps its files ----------
  await page.evaluate(`document.querySelector('[aria-label="Delete Kit"]').click()`);
  const kitGone = await waitUntil(() => page.evaluate(`![...document.querySelectorAll('.row-name')].some((n) => n.textContent === 'Kit')`), 30_000);
  await page.screenshot('14-kit-deleted.png');
  check('deleted Kit leaves the sidebar', !!kitGone);
  check('the folder keeps its files', existsSync(join(plain, 'KIT.md')) && existsSync(join(plain, 'index.html')));
} catch (error) {
  check('e2e run (plain folder)', false, error.message);
} finally {
  page?.close();
  await stopApp(app);
}

const log = readFileSync(logFile, 'utf8');
const notices = log.split('\n').filter((l) => l.startsWith('[notify]'));
console.log(`notifications: ${notices.length ? `\n  ${notices.join('\n  ')}` : 'none logged'}`);
check('engine stopped on quit, both times', log.split('[engine] {"state":"stopped"}').length - 1 >= 4);
console.log(`screenshots and log: ${dir}`);
process.exit(summary() ? 1 : 0);
