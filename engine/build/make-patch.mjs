#!/usr/bin/env node
// Writes engine/patches/<name>.patch from the differences between the pristine vendor tree and engine/work for the
// given files (paths relative to the Paseo root). A comment block from --why <file> goes at the top.
//   node engine/build/make-patch.mjs 0001-daemon-auth --why notes.txt packages/server/src/server/auth.ts ...
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const engine = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const name = args.shift();
let why = '';
if (args[0] === '--why') {
  args.shift();
  why = readFileSync(args.shift(), 'utf8');
}
if (!name || !args.length) {
  console.error('usage: make-patch.mjs <name> [--why notes.txt] <file>...');
  process.exit(1);
}

let body = '';
for (const file of args) {
  const res = spawnSync(
    'git',
    ['diff', '--no-index', '--no-color', '--', `vendor/paseo/${file}`, `work/${file}`],
    { cwd: engine, encoding: 'utf8' },
  );
  if (res.status !== 0 && res.status !== 1) throw new Error(res.stderr);
  if (!res.stdout) {
    console.warn(`no changes in ${file}`);
    continue;
  }
  body += res.stdout
    .replaceAll(`a/vendor/paseo/${file}`, `a/${file}`)
    .replaceAll(`b/work/${file}`, `b/${file}`);
}
if (!body) throw new Error('nothing to write: no differences');

const header = why
  .trim()
  .split('\n')
  .map((line) => `# ${line}`.trimEnd())
  .join('\n');
const out = join(engine, 'patches', `${name}.patch`);
writeFileSync(out, `${header ? `${header}\n\n` : ''}${body}`);
console.log(`wrote ${out}`);
