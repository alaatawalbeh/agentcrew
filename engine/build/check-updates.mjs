#!/usr/bin/env node
// Checks for Paseo releases newer than the vendored one, and tries one out beside the real engine without touching it.
//
//   node engine/build/check-updates.mjs                  list releases newer than the vendored one
//   node engine/build/check-updates.mjs --try [vX.Y.Z]   fetch a release (default: the newest) into engine/candidate/,
//                                                        re-apply Agent Crew's patches, build it, run the engine tests
//   node engine/build/check-updates.mjs --try vX.Y.Z --no-build   only check that the patches still apply
//   node engine/build/check-updates.mjs --adopt          make the tried release the vendored one; the old copy is
//                                                        kept in engine/candidate/previous/
//
// Nothing here runs code from the fetched release: dependencies install with --ignore-scripts, as in build.mjs, and
// only the build steps Agent Crew already runs for the vendored copy are run.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const UPSTREAM = 'https://github.com/getpaseo/paseo';
const engine = resolve(import.meta.dirname, '..');
const root = resolve(engine, '..');
const vendor = join(engine, 'vendor', 'paseo');
const patchDir = join(engine, 'patches');
const candidate = join(engine, 'candidate');
const cSource = join(candidate, 'source');
const cVendor = join(candidate, 'vendor');
const cWork = join(candidate, 'work');
const resultFile = join(candidate, 'result.json');

/** The same set of paths VENDORED.md lists. */
const VENDORED_PATHS = [
  'packages/server',
  'packages/protocol',
  'packages/client',
  'packages/plugin',
  'packages/relay',
  'packages/highlight',
  'skills',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'LICENSE',
];
const OPENCODE_PATCH = /^@opencode-ai\+sdk\+[\d.]+\.patch$/;

// Git never prompts, and never treats paths as relative to Agent Crew's own repo.
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: engine };
const git = (args, cwd = engine) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const rel = (path) => path.replace(`${root}/`, '');

const parseVersion = (tag) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? m.slice(1).map(Number) : null;
};
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function vendoredVersion() {
  return readJson(join(vendor, 'package.json')).version;
}

/** Release tags upstream, oldest first. Pre-releases (v1.2.3-beta.1) are left out. */
function releases() {
  const out = git(['ls-remote', '--tags', '--refs', UPSTREAM]);
  return out
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith('refs/tags/'))
    .map((ref) => ref.slice('refs/tags/'.length))
    .map((tag) => ({ tag, version: parseVersion(tag) }))
    .filter((r) => r.version)
    .sort((a, b) => compare(a.version, b.version));
}

function newerReleases() {
  const current = parseVersion(vendoredVersion());
  return releases().filter((r) => compare(r.version, current) > 0);
}

/** Files Agent Crew's patches change, as paths inside the vendored tree. */
function patchedFiles() {
  const files = new Set();
  for (const patch of readdirSync(patchDir).filter((f) => f.endsWith('.patch'))) {
    for (const line of readFileSync(join(patchDir, patch), 'utf8').split('\n')) {
      const m = /^\+\+\+ b\/(.+)$/.exec(line);
      if (m) files.add(m[1]);
    }
  }
  return [...files].sort();
}

const sameFile = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

/** Only the vendored paths are downloaded: a shallow, sparse, blob-less clone of one tag. */
function fetchRelease(tag) {
  rmSync(cSource, { recursive: true, force: true });
  mkdirSync(candidate, { recursive: true });
  console.log(`fetching ${tag} from ${UPSTREAM} (vendored paths only)…`);
  git(['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', '--no-tags', '--branch', tag, UPSTREAM, cSource]);
  git(['sparse-checkout', 'set', '--no-cone', ...VENDORED_PATHS.map((p) => `/${p}`), '/patches/'], cSource);
  return {
    tag,
    commit: git(['rev-parse', 'HEAD'], cSource),
    date: git(['log', '-1', '--format=%cs'], cSource),
    subject: git(['log', '-1', '--format=%s'], cSource),
  };
}

function buildCandidateVendor() {
  rmSync(cVendor, { recursive: true, force: true });
  for (const path of VENDORED_PATHS) {
    const from = join(cSource, path);
    if (!existsSync(from)) throw new Error(`${path} is missing from the release: the vendored path set needs updating`);
    cpSync(from, join(cVendor, path), { recursive: true });
  }
  const upstreamPatches = existsSync(join(cSource, 'patches')) ? readdirSync(join(cSource, 'patches')) : [];
  const opencode = upstreamPatches.filter((f) => OPENCODE_PATCH.test(f));
  if (opencode.length !== 1) throw new Error(`expected one @opencode-ai/sdk patch upstream, found ${opencode.length}`);
  mkdirSync(join(cVendor, 'patches'), { recursive: true });
  cpSync(join(cSource, 'patches', opencode[0]), join(cVendor, 'patches', opencode[0]));
  const others = upstreamPatches.filter((f) => !OPENCODE_PATCH.test(f));
  return { opencodePatch: opencode[0], otherUpstreamPatches: others };
}

const step = (label, cmd, args, env = {}) => {
  console.log(`\n== ${label}\n$ ${[cmd, ...args].join(' ')}`);
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    return true;
  } catch {
    return false;
  }
};

function tryRelease(requested, { build }) {
  const newer = newerReleases();
  const tag = requested ?? newer.at(-1)?.tag;
  if (!tag) {
    console.log(`Paseo ${vendoredVersion()} is the newest release. Nothing to try (name a tag to re-check one).`);
    return;
  }
  const info = fetchRelease(tag);
  const { opencodePatch, otherUpstreamPatches } = buildCandidateVendor();
  const version = readJson(join(cVendor, 'package.json')).version;

  const touched = patchedFiles();
  const changedUnderPatches = touched.filter((f) => !sameFile(join(vendor, f), join(cVendor, f)));

  const env = { AGENT_CREW_ENGINE_VENDOR: cVendor, AGENT_CREW_ENGINE_WORK: cWork };
  const result = { ...info, version, opencodePatch, checkedAt: new Date().toISOString(), patches: false, build: null, tests: null };
  result.patches = step('re-applying Agent Crew patches', 'node', [join(engine, 'build', 'prepare.mjs'), '--keep-going'], env);
  if (result.patches && build) {
    result.build = step('building the candidate engine', 'node', [join(engine, 'build', 'build.mjs')], env);
    if (result.build) {
      result.tests = step('engine tests against the candidate', 'npx', ['vitest', 'run', '--config', 'vitest.engine.config.mts'], env);
    }
  }
  result.ok = result.patches && (!build || (result.build && result.tests));
  writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);

  const mark = (v) => (v === null ? 'skipped' : v ? 'ok' : 'FAILED');
  console.log(`\nPaseo ${tag} (${info.commit.slice(0, 12)}, ${info.date}) against vendored ${vendoredVersion()}`);
  console.log(`  patched files changed upstream: ${changedUnderPatches.length ? `\n    ${changedUnderPatches.join('\n    ')}` : 'none'}`);
  if (otherUpstreamPatches.length) console.log(`  other upstream dependency patches (not used): ${otherUpstreamPatches.join(', ')}`);
  console.log(`  patches: ${mark(result.patches)}   build: ${mark(result.build)}   engine tests: ${mark(result.tests)}`);
  if (!result.patches) {
    console.log('\nFix the failing patches against engine/candidate/work and regenerate them with make-patch.mjs.');
  } else if (result.ok && build) {
    console.log('\nTo switch to it: node engine/build/check-updates.mjs --adopt');
  }
  process.exitCode = result.ok ? 0 : 1;
}

function updateVendoredNotes(result) {
  const notes = join(engine, 'VENDORED.md');
  let text = readFileSync(notes, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  text = text
    .replace(/^\| Release \|.*$/m, `| Release | ${result.tag} |`)
    .replace(/^\| Commit \|.*$/m, `| Commit | \`${result.commit}\` (${result.date}, "${result.subject.replace(/\|/g, '/')}") |`)
    .replace(/^\| Vendored \|.*$/m, `| Vendored | ${today} |`)
    .replace(/patches\/@opencode-ai\+sdk\+[\d.]+\.patch/g, `patches/${result.opencodePatch}`);
  writeFileSync(notes, text);
}

function adopt({ force }) {
  if (!existsSync(resultFile) || !existsSync(cVendor)) throw new Error('nothing tried yet: run --try first');
  const result = readJson(resultFile);
  if (!result.ok || result.build !== true) {
    if (!force) throw new Error(`${result.tag} hasn't passed a full --try (patches, build and tests). --force to adopt anyway.`);
  }
  const previous = join(candidate, 'previous', `paseo-${vendoredVersion()}`);
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(dirname(previous), { recursive: true });
  renameSync(vendor, previous);
  cpSync(cVendor, vendor, { recursive: true });
  updateVendoredNotes(result);
  console.log(`engine/vendor/paseo is now Paseo ${result.tag}. The previous copy is in ${rel(previous)}.`);
  console.log('Next: npm run engine:prepare && npm run engine:build && npm run test:engine, then the end-to-end test.');
}

const args = process.argv.slice(2);
const tagArg = args.find((a) => parseVersion(a));
if (args.includes('--adopt')) {
  adopt({ force: args.includes('--force') });
} else if (args.includes('--try')) {
  tryRelease(tagArg ? (tagArg.startsWith('v') ? tagArg : `v${tagArg}`) : undefined, { build: !args.includes('--no-build') });
} else {
  const current = vendoredVersion();
  const newer = newerReleases();
  if (!newer.length) {
    console.log(`Paseo ${current} is vendored, and it is the newest release.`);
  } else {
    console.log(`Paseo ${current} is vendored. ${newer.length} newer release${newer.length === 1 ? '' : 's'}:`);
    for (const r of newer) console.log(`  ${r.tag}`);
    console.log(`\nTry the newest: node engine/build/check-updates.mjs --try ${newer.at(-1).tag}`);
  }
  console.log(`Patched files to watch: ${patchedFiles().length} (${UPSTREAM}/compare/v${current}...main)`);
}
