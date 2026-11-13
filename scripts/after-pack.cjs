// electron-builder afterPack hook: copies the staged engine (engine/stage, from engine/build/stage.mjs) into the app's
// resources as it is. electron-builder's own extraResources copy leaves out node_modules folders, and the engine
// needs its node_modules and the workspace symlinks in it.
const { cpSync, existsSync, readlinkSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

exports.default = async function afterPack(context) {
  const stage = resolve(__dirname, '..', 'engine', 'stage');
  if (!existsSync(join(stage, 'launcher', 'agent-crew-engine.mjs'))) {
    throw new Error('engine/stage is missing: run node engine/build/stage.mjs first');
  }
  const target = join(context.appOutDir, 'resources', 'engine');
  rmSync(target, { recursive: true, force: true });
  cpSync(stage, target, { recursive: true, verbatimSymlinks: true });
  const link = readlinkSync(join(target, 'node_modules', '@getpaseo', 'server'));
  console.log(`  • copied the engine into ${target} (@getpaseo/server -> ${link})`);
};
