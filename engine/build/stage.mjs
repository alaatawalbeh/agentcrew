#!/usr/bin/env node
// Gathers the built engine's runtime files from engine/work/ into engine/stage/, which packaging copies into the app's
// resources: the launcher, each engine package's published files, and the production dependencies the engine can
// reach, nothing else. Run prepare.mjs and build.mjs first.
//   node engine/build/stage.mjs
//
// Left out on purpose:
// - the Claude Agent SDK's bundled Claude Code binaries (~470 MB): the engine always runs your own installed `claude`
// - terminals (node-pty), local voice (sherpa-onnx), esbuild and typescript: Agent Crew never starts them
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const engine = resolve(import.meta.dirname, '..');
const work = join(engine, 'work');
const stage = join(engine, 'stage');

const WORKSPACES = ['server', 'client', 'protocol', 'relay', 'highlight', 'plugin'];
const EXCLUDED = [
  /^@anthropic-ai\/claude-agent-sdk-/,
  /^node-pty$/,
  /^sherpa-onnx/,
  /^esbuild$/,
  /^@esbuild\//,
  /^typescript$/,
  /^react$/,
  /^react-native$/,
];
const excluded = (name) => EXCLUDED.some((re) => re.test(name));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

if (!existsSync(join(work, 'packages', 'server', 'dist'))) {
  throw new Error('engine/work is not built: run engine/build/prepare.mjs and engine/build/build.mjs first');
}

/** Node's lookup: node_modules/<name> in this folder or any parent, up to engine/work. */
function findPackage(name, fromDir) {
  let dir = fromDir;
  while (dir.startsWith(work)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Walk the production dependency graph from the engine packages.
const packages = new Map(); // real path -> { name, links: Set<path in node_modules> }
const missing = new Set();
const skipped = new Set();

function visit(name, linkPath) {
  const real = realpathSync(linkPath);
  const known = packages.get(real);
  if (known) {
    known.links.add(linkPath);
    return;
  }
  packages.set(real, { name, links: new Set([linkPath]) });
  const pkg = readJson(join(real, 'package.json'));
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  const peers = Object.keys(pkg.peerDependencies ?? {});
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...optional, ...peers];
  for (const dep of new Set(deps)) {
    if (excluded(dep)) {
      skipped.add(dep);
      continue;
    }
    // Look up from the link's folder first (how Node resolves a symlinked workspace package), then the real one.
    const found = findPackage(dep, linkPath) ?? findPackage(dep, real);
    if (!found) {
      if (!optional.has(dep) && !peers.includes(dep)) missing.add(`${dep} (needed by ${name})`);
      continue;
    }
    visit(dep, found);
  }
}

for (const ws of WORKSPACES) visit(`@getpaseo/${ws}`, join(work, 'node_modules', '@getpaseo', ws));

if (missing.size) throw new Error(`dependencies not installed in engine/work:\n  ${[...missing].join('\n  ')}`);

// Copy. A workspace package keeps its own folder under packages/ and a symlink in node_modules/@getpaseo, as in
// engine/work, so the launcher and the app load one copy of each.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const noMaps = (src) => !src.endsWith('.map') && !src.endsWith('.tsbuildinfo');
const inside = (path) => relative(work, path);

/** Bytes in a folder, not following symlinks. */
function sizeOf(path) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((total, entry) => total + sizeOf(join(path, entry)), 0);
}

let bytes = 0;
for (const [real, { name, links }] of packages) {
  const rel = inside(real);
  const target = join(stage, rel);
  if (name.startsWith('@getpaseo/')) {
    // Only what the package publishes (its "files"), and only built output.
    const pkg = readJson(join(real, 'package.json'));
    mkdirSync(target, { recursive: true });
    cpSync(join(real, 'package.json'), join(target, 'package.json'));
    for (const entry of ['dist', 'skills']) {
      if (existsSync(join(real, entry))) cpSync(join(real, entry), join(target, entry), { recursive: true, filter: noMaps });
    }
    if (pkg.license && existsSync(join(real, 'LICENSE'))) cpSync(join(real, 'LICENSE'), join(target, 'LICENSE'));
  } else {
    // A dependency's own nested node_modules are staged separately, only the parts the graph reaches.
    cpSync(real, target, {
      recursive: true,
      filter: (src) => noMaps(src) && !relative(real, src).split(sep).includes('node_modules'),
    });
  }
  for (const link of links) {
    const linkRel = inside(link);
    if (linkRel === rel) continue;
    const linkTarget = join(stage, linkRel);
    mkdirSync(dirname(linkTarget), { recursive: true });
    if (!existsSync(linkTarget)) symlinkSync(relative(dirname(linkTarget), target), linkTarget, 'dir');
  }
  bytes += sizeOf(target);
}

cpSync(join(work, 'launcher'), join(stage, 'launcher'), { recursive: true });
cpSync(join(engine, 'vendor', 'paseo', 'LICENSE'), join(stage, 'LICENSE'));
// The launcher is an ES module; the stage root has no package.json of its own, so mark it.
cpSync(join(work, 'package.json'), join(stage, 'package.json'));

console.log(`engine/stage: ${packages.size} packages, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`left out: ${[...skipped].sort().join(', ')}`);
// Sanity check: nothing in the stage points outside it.
for (const [, { links }] of packages) {
  for (const link of links) {
    const staged = join(stage, inside(link));
    if (existsSync(staged) && !realpathSync(staged).startsWith(stage)) throw new Error(`${staged} points outside engine/stage`);
  }
}
