#!/usr/bin/env node
// Adds Agent Crew to this computer's app menu, so the desktop shows its icon in the dock, the app grid and Alt-Tab.
// GNOME on Wayland takes a window's icon only from an installed .desktop entry named after the app's id
// (agent-crew), so the AppImage on its own shows a generic icon. Everything goes under ~/.local/share; nothing
// needs root.
//   node scripts/install-desktop.mjs [path to the AppImage]   (npm run install-desktop; default: the one in release/)
//   node scripts/install-desktop.mjs --remove
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ID = 'agent-crew';
const root = resolve(import.meta.dirname, '..');
const data = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const entry = join(data, 'applications', `${ID}.desktop`);
const sizes = readdirSync(join(root, 'resources', 'icons'))
  .map((name) => /^(\d+)x\1\.png$/.exec(name)?.[1])
  .filter(Boolean);
const iconPath = (size) => join(data, 'icons', 'hicolor', `${size}x${size}`, 'apps', `${ID}.png`);

function refresh() {
  // Optional: desktops pick up the change on their own, this only makes it immediate where available. No icon cache
  // is written for ~/.local/share/icons: a cache there goes stale when other apps add icons without refreshing it.
  spawnSync('update-desktop-database', [join(data, 'applications')], { stdio: 'ignore' });
}

if (process.argv[2] === '--remove') {
  rmSync(entry, { force: true });
  for (const size of sizes) rmSync(iconPath(size), { force: true });
  refresh();
  console.log(`removed ${entry} and its icons`);
  process.exit(0);
}

const appImage = resolve(
  process.argv[2] ??
    join(root, 'release', readdirSync(join(root, 'release')).find((f) => /^Agent-Crew-.*\.AppImage$/.test(f)) ?? 'missing'),
);
if (!existsSync(appImage) || !statSync(appImage).isFile()) {
  throw new Error(`${appImage} not found: run npm run package first, or pass the AppImage's path`);
}
// The Exec line quotes the path; these characters would need escaping there, so refuse them instead.
if (/["`$\\\n%]/.test(appImage)) throw new Error(`can't use a path with " \` $ \\ % or a newline in it: ${appImage}`);

for (const size of sizes) {
  mkdirSync(join(iconPath(size), '..'), { recursive: true });
  copyFileSync(join(root, 'resources', 'icons', `${size}x${size}.png`), iconPath(size));
}
mkdirSync(join(entry, '..'), { recursive: true });
writeFileSync(
  entry,
  [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Agent Crew',
    'Comment=A control room for a crew of Claude Code agents',
    `Exec="${appImage}"`,
    `Icon=${ID}`,
    'Terminal=false',
    'Categories=Development;',
    `StartupWMClass=${ID}`,
    '',
  ].join('\n'),
);
refresh();
console.log(`added ${entry} (runs ${appImage}) and icons at ${sizes.join(', ')} px`);
