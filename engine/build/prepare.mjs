#!/usr/bin/env node
// Builds engine/work/ from the pristine vendored Paseo tree: trimmed workspace, React-free plugin package, and every
// patch in engine/patches/ applied in order. Installed node_modules folders are kept between runs.
//   node engine/build/prepare.mjs [--keep-going]
// --keep-going tries every patch and lists the ones that fail, instead of stopping at the first.
// AGENT_CREW_ENGINE_VENDOR and AGENT_CREW_ENGINE_WORK point it at another copy (check-updates.mjs uses this to try a
// newer Paseo release in engine/candidate/ without touching the real one).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const engine = resolve(import.meta.dirname, '..');
const vendor = resolve(process.env.AGENT_CREW_ENGINE_VENDOR || join(engine, 'vendor', 'paseo'));
const work = resolve(process.env.AGENT_CREW_ENGINE_WORK || join(engine, 'work'));
const keepGoing = process.argv.includes('--keep-going');
const patchDir = join(engine, 'patches');

export const WORKSPACES = [
  'packages/protocol',
  'packages/relay',
  'packages/highlight',
  'packages/plugin',
  'packages/client',
  'packages/server',
];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Removes everything in work/ except installed node_modules folders. */
function cleanWork() {
  if (!existsSync(work)) return;
  for (const entry of readdirSync(work)) {
    if (entry === 'node_modules') continue;
    if (entry === 'packages') {
      for (const pkg of readdirSync(join(work, 'packages'))) {
        for (const item of readdirSync(join(work, 'packages', pkg))) {
          if (item !== 'node_modules') rmSync(join(work, 'packages', pkg, item), { recursive: true, force: true });
        }
      }
      continue;
    }
    rmSync(join(work, entry), { recursive: true, force: true });
  }
}

function trimWorkspace() {
  const upstream = readJson(join(work, 'package.json'));
  writeJson(join(work, 'package.json'), {
    name: 'agent-crew-engine',
    version: upstream.version,
    private: true,
    license: upstream.license,
    description: 'Paseo engine packages vendored into Agent Crew (see engine/VENDORED.md).',
    workspaces: WORKSPACES,
    devDependencies: {
      typescript: upstream.devDependencies.typescript,
      ws: upstream.devDependencies.ws,
      '@types/ws': upstream.devDependencies['@types/ws'],
    },
    overrides: {
      '@codemirror/language': upstream.overrides['@codemirror/language'],
      '@codemirror/view': upstream.overrides['@codemirror/view'],
    },
  });

  // The server only uses @getpaseo/plugin's non-UI entry points, so React and React Native stay out.
  const pluginFile = join(work, 'packages', 'plugin', 'package.json');
  const plugin = readJson(pluginFile);
  for (const dep of ['react', 'react-native', '@types/react']) delete plugin.devDependencies?.[dep];
  plugin.peerDependenciesMeta = {
    ...plugin.peerDependenciesMeta,
    react: { optional: true },
    'react-native': { optional: true },
  };
  writeJson(pluginFile, plugin);
}

/**
 * engine/work sits inside Agent Crew's git repo, where `git apply` would resolve paths from the repo root and silently
 * skip files outside the current directory. Stopping repo discovery at engine/ makes it work on plain paths.
 */
export const gitApplyEnv = { ...process.env, GIT_CEILING_DIRECTORIES: engine };

function applyPatches() {
  if (!existsSync(patchDir)) return [];
  const patches = readdirSync(patchDir)
    .filter((f) => f.endsWith('.patch'))
    .sort();
  const failed = [];
  for (const patch of patches) {
    try {
      execFileSync('git', ['apply', '--verbose', '--whitespace=nowarn', join(patchDir, patch)], {
        cwd: work,
        stdio: 'inherit',
        env: gitApplyEnv,
      });
    } catch (error) {
      if (!keepGoing) throw error;
      failed.push(patch);
    }
  }
  return { applied: patches.filter((p) => !failed.includes(p)), failed };
}

/** The server never loads @getpaseo/plugin's React UI entry points, so they aren't compiled. */
function writePluginBuildConfig() {
  writeJson(join(work, 'packages', 'plugin', 'tsconfig.engine.json'), {
    extends: './tsconfig.json',
    exclude: ['node_modules', 'dist', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/client/**'],
  });
}

mkdirSync(work, { recursive: true });
cleanWork();
cpSync(vendor, work, { recursive: true, force: true });
trimWorkspace();
writePluginBuildConfig();
cpSync(join(engine, 'launcher'), join(work, 'launcher'), { recursive: true });
const { applied, failed } = applyPatches();
const where = work.replace(`${engine}/`, 'engine/');
console.log(`${where} ready from Paseo ${readJson(join(work, 'package.json')).version}`);
console.log(applied.length ? `patches applied:\n  ${applied.join('\n  ')}` : 'no patches applied');
if (failed.length) {
  console.error(`patches that no longer apply:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
