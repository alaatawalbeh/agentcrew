#!/usr/bin/env node
// Installs the engine's pinned dependencies and compiles the six engine packages inside engine/work/.
// Run prepare.mjs first. AGENT_CREW_ENGINE_WORK builds another copy (see prepare.mjs).
//   node engine/build/build.mjs [--skip-install]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const engine = resolve(import.meta.dirname, '..');
const work = resolve(process.env.AGENT_CREW_ENGINE_WORK || join(engine, 'work'));
const tsc = join(work, 'node_modules', '.bin', 'tsc');

const run = (cmd, args, cwd = work) => {
  console.log(`$ ${[cmd, ...args].join(' ')}   (in ${cwd.replace(`${engine}/`, 'engine/')})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
};

if (!existsSync(join(work, 'package.json'))) throw new Error(`${work} is missing: run engine/build/prepare.mjs first`);

if (!process.argv.includes('--skip-install')) {
  // Versions come from upstream's lockfile. No dependency install scripts run.
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts']);
}

// Upstream's one engine-related dependency patch (patch-package format: a git diff with node_modules/ paths). npm may
// install the package at the root or nested under packages/server, so the patch is applied with a directory prefix.
// GIT_CEILING_DIRECTORIES keeps git from treating paths as relative to Agent Crew's own repo.
const gitEnv = { ...process.env, GIT_CEILING_DIRECTORIES: engine };
const opencodePatchName = readdirSync(join(work, 'patches')).find((f) => /^@opencode-ai\+sdk\+[\d.]+\.patch$/.test(f));
if (!opencodePatchName) throw new Error('upstream patch for @opencode-ai/sdk not found in patches/');
const opencodePatch = join(work, 'patches', opencodePatchName);
const opencodePrefix = ['packages/server', '.'].find((dir) =>
  existsSync(join(work, dir, 'node_modules', '@opencode-ai', 'sdk', 'package.json')),
);
if (!opencodePrefix) throw new Error('@opencode-ai/sdk is not installed');
const applyArgs = ['apply', '--whitespace=nowarn', ...(opencodePrefix === '.' ? [] : [`--directory=${opencodePrefix}`])];
const alreadyApplied = (() => {
  try {
    execFileSync('git', [...applyArgs, '--check', '--reverse', opencodePatch], { cwd: work, stdio: 'ignore', env: gitEnv });
    return true;
  } catch {
    return false;
  }
})();
if (alreadyApplied) {
  console.log('opencode sdk patch already applied');
} else {
  console.log(`$ git ${applyArgs.join(' ')} ${opencodePatch}`);
  execFileSync('git', [...applyArgs, opencodePatch], { cwd: work, stdio: 'inherit', env: gitEnv });
}

const pkg = (name) => join(work, 'packages', name);

run('node', ['scripts/generate-validation-aot.mjs'], pkg('protocol'));
// client before plugin: plugin's server code imports client types.
for (const [name, config] of [
  ['protocol', 'tsconfig.json'],
  ['relay', 'tsconfig.json'],
  ['highlight', 'tsconfig.json'],
  ['client', 'tsconfig.json'],
  ['plugin', 'tsconfig.engine.json'],
]) {
  rmSync(join(pkg(name), 'dist'), { recursive: true, force: true });
  run(tsc, ['-p', config, '--incremental', 'false'], pkg(name));
}

// Server: the library plus the OpenCode bridge bundle, which the daemon checks for at startup. The terminal worker,
// voice assets, built-in plugins and supervisor scripts are left out on purpose.
rmSync(join(pkg('server'), 'dist'), { recursive: true, force: true });
run(tsc, ['-p', 'tsconfig.server.json', '--incremental', 'false'], pkg('server'));
run('node', ['scripts/build-opencode-bridge-plugin.mjs'], pkg('server'));
cpSync(join(work, 'skills'), join(pkg('server'), 'dist', 'server', 'skills'), { recursive: true });

console.log('engine built');
