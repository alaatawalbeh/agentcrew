import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { APP_ORIGIN } from './protocol';

/** The Vite dev server URL in development, or null when running the built app. */
export function rendererDevUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && url ? url : null;
}

/**
 * The window's own icon (resources/icon.png, drawn by scripts/make-icon.mjs). X11 and KDE show it; GNOME on Wayland
 * takes the icon from the installed agent-crew.desktop entry instead (scripts/install-desktop.mjs).
 */
function windowIcon(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png');
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Agent Crew',
    icon: windowIcon(),
    backgroundColor: '#14110e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL(rendererDevUrl() ?? `${APP_ORIGIN}/index.html`);
  return win;
}
