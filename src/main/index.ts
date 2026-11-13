import { app, dialog, Menu, Notification, session, type BrowserWindow } from 'electron';
import { ROSTER_ROBOTS, type EngineState, type ModelOption } from '@shared/crew';
import type { CrewSnapshot, Status } from '@shared/types';
import { CrewManager, DEFAULT_MODEL } from './crew/CrewManager';
import { modelLabel, SessionSetup } from './crew/sessionSetup';
import { engineDataDir, EngineService } from './engine/EngineService';
import { registerCrewIpc } from './ipc';
import { APP_ORIGIN, registerAppScheme, serveAppScheme } from './protocol';
import { denyAllPermissions, hardenWebContents, originOf } from './security';
import { createMainWindow, rendererDevUrl } from './window';

// Every renderer is sandboxed, whatever its own webPreferences say.
app.enableSandbox();
registerAppScheme();

const rendererOrigin = (): string => {
  const dev = rendererDevUrl();
  return (dev && originOf(dev)) || APP_ORIGIN;
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let crew: CrewManager | null = null;
  let engineState: EngineState = { state: 'starting' };
  const engine = new EngineService();

  const sendToWindow = (channel: string, value: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
  };
  const notify = (message: string) => {
    console.warn(`[crew] ${message}`);
    sendToWindow('crew:notice', message);
  };

  // Development builds only: end-to-end tests skip the native folder dialog and may pick a cheaper model or the
  // "Always ask" mode. A packaged app ignores these.
  const testHooks = app.isPackaged
    ? {}
    : {
        repo: process.env.AGENT_CREW_TEST_REPO,
        model: process.env.AGENT_CREW_TEST_MODEL,
        modeId: process.env.AGENT_CREW_TEST_MODE,
        archiveChoice: ({ remove: 0, keep: 1 } as const)[process.env.AGENT_CREW_TEST_ARCHIVE as 'remove' | 'keep'],
      };

  // The repo for a new agent is always chosen in a native dialog shown by main, never passed in by the page.
  const pickRepo = async (robotName: string): Promise<string | null> => {
    if (testHooks.repo) return testHooks.repo;
    const options = {
      title: `Choose a repo for ${robotName}`,
      buttonLabel: `Give ${robotName} this repo`,
      properties: ['openDirectory' as const],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };

  const setup = new SessionSetup(() => mainWindow, testHooks.repo);

  /** The engine's Claude models, newest first as the engine lists them, with the default first. */
  let modelCache: ModelOption[] | null = null;
  const models = async (): Promise<ModelOption[]> => {
    if (modelCache) return modelCache;
    const api = engine.api;
    if (!api) throw new Error('The engine is not ready yet.');
    const listed = (await api.providers.listModels('claude')) as { models?: { id: string }[] };
    const ids = (listed?.models ?? []).map((m) => m.id).filter((id) => /^claude-[a-z0-9.-]+(\[1m\])?$/.test(id));
    const ordered = [DEFAULT_MODEL, ...ids.filter((id) => id !== DEFAULT_MODEL)].filter((id) => ids.includes(id) || id === DEFAULT_MODEL);
    modelCache = ordered.map((id) => ({ id, label: modelLabel(id) }));
    return modelCache;
  };

  // A desktop notification when a robot starts needing you while the window isn't in front.
  const lastStatus = new Map<string, Status>();
  const NEEDS_YOU = new Set<Status>(['needs-approval', 'stuck']);
  const announce = (snapshot: CrewSnapshot) => {
    for (const s of snapshot.sessions) {
      const before = lastStatus.get(s.id);
      lastStatus.set(s.id, s.status);
      if (!NEEDS_YOU.has(s.status) || before === s.status || before === undefined) continue;
      const name = ROSTER_ROBOTS.find((r) => r.id === s.robotId)?.name ?? 'A robot';
      if (mainWindow?.isFocused() || !Notification.isSupported()) {
        console.log(`[notify] ${name} ${s.status}: not shown (${mainWindow?.isFocused() ? 'window in front' : 'unsupported'})`);
        continue;
      }
      console.log(`[notify] ${name} ${s.status}: shown`);
      const body =
        s.status === 'needs-approval'
          ? `${s.pendingApproval?.tool ?? 'Approval'}: ${(s.pendingApproval?.command ?? '').slice(0, 140)}`
          : 'It stopped with an error.';
      const note = new Notification({ title: `${name} needs you`, body, silent: false });
      note.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        sendToWindow('crew:select', s.id);
      });
      note.show();
    }
  };

  engine.onStatus((status) => {
    console.log(`[engine] ${JSON.stringify(status)}`);
    engineState = status;
    sendToWindow('crew:engine', status);
    if (status.state === 'ready' && !crew) {
      crew = new CrewManager(
        engine,
        (snapshot) => {
          announce(snapshot);
          sendToWindow('crew:snapshot', snapshot);
        },
        pickRepo,
        notify,
        {
          model: testHooks.model || DEFAULT_MODEL,
          modeId: testHooks.modeId || 'auto',
          engineDataDir: engineDataDir(),
        },
      );
      crew.attach().catch((error) => notify(`Couldn't load the crew: ${String(error)}`));
    } else if (status.state !== 'ready' && crew) {
      crew.dispose();
      crew = null;
      modelCache = null;
    }
  });

  registerCrewIpc({
    crew: () => crew,
    setup,
    models,
    engineState: () => engineState,
    window: () => mainWindow,
    allowedOrigin: rendererOrigin,
    testArchiveChoice: 'archiveChoice' in testHooks ? testHooks.archiveChoice : undefined,
  });

  // Stop the local engine before quitting, so local agents pause cleanly instead of being killed mid-write.
  let engineStopped = false;
  app.on('before-quit', (event) => {
    if (engineStopped) return;
    event.preventDefault();
    crew?.dispose();
    void engine.stop().finally(() => {
      engineStopped = true;
      app.quit();
    });
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, rendererOrigin));

  void app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    denyAllPermissions(session.defaultSession);
    serveAppScheme();
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    void engine.start();
  });

  app.on('window-all-closed', () => app.quit());
}
