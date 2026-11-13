// The only IPC surface between the page and the main process: one channel per action, each call checked to come
// from the app's own page in the main window, every argument validated before it reaches the crew.
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron';
import { homedir } from 'node:os';
import type { EngineState, ModelOption } from '@shared/crew';
import { ROSTER_ROBOTS, sessionIdFor } from '@shared/crew';
import type { ApprovalDecision } from '@shared/types';
import type { CrewManager } from './crew/CrewManager';
import type { SessionSetup } from './crew/sessionSetup';
import { originOf } from './security';

const SESSION_IDS = new Set(ROSTER_ROBOTS.map((r) => sessionIdFor(r.id)));
const DECISIONS = new Set<ApprovalDecision>(['allow', 'always', 'deny']);
const MAX_MESSAGE = 20_000;

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_IDS.has(value)) throw new Error('Unknown session.');
  return value;
}

function message(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A message must be text.');
  const text = value.trim();
  if (!text || text.length > MAX_MESSAGE) throw new Error('A message must be between 1 and 20,000 characters.');
  return text;
}

function approvalId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w:.-]{1,200}$/.test(value)) throw new Error('Invalid approval id.');
  return value;
}

function decision(value: unknown): ApprovalDecision {
  if (typeof value !== 'string' || !DECISIONS.has(value as ApprovalDecision)) throw new Error('Invalid decision.');
  return value as ApprovalDecision;
}

const tilde = (path: string) => (path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);

export function registerCrewIpc(options: {
  crew: () => CrewManager | null;
  setup: SessionSetup;
  models: () => Promise<ModelOption[]>;
  engineState: () => EngineState;
  window: () => BrowserWindow | null;
  allowedOrigin: () => string;
  /** Development builds only (end-to-end tests): the answer to the archive dialog, 0 remove or 1 keep the worktree. */
  testArchiveChoice?: 0 | 1;
}): void {
  /** Accepts calls only from the main window's top frame, loaded from the app's own origin. */
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) =>
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<R> => {
      const win = options.window();
      const frame = event.senderFrame;
      if (!win || event.sender !== win.webContents || !frame || frame !== win.webContents.mainFrame) {
        throw new Error('Blocked: not from the Agent Crew window.');
      }
      if (originOf(frame.url) !== options.allowedOrigin()) throw new Error('Blocked: unexpected origin.');
      return fn(...(args as A));
    };

  const crew = () => {
    const manager = options.crew();
    if (!manager) throw new Error('The engine is not ready yet.');
    return manager;
  };

  const ask = async (box: MessageBoxOptions) => {
    const win = options.window();
    return (win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)).response;
  };

  ipcMain.handle(
    'crew:hello',
    guard(() => ({ engine: options.engineState(), snapshot: options.crew()?.snapshot() ?? null })),
  );
  ipcMain.handle('crew:send', guard((id: unknown, text: unknown) => crew().send(sessionId(id), message(text))));
  ipcMain.handle('crew:broadcast', guard((text: unknown) => crew().broadcast(message(text))));
  ipcMain.handle(
    'crew:answer-approval',
    guard((id: unknown, approval: unknown, choice: unknown) =>
      crew().answerApproval(sessionId(id), approvalId(approval), decision(choice)),
    ),
  );
  ipcMain.handle('crew:interrupt', guard((id: unknown) => crew().interrupt(sessionId(id))));
  ipcMain.handle('crew:resume', guard((id: unknown) => crew().resume(sessionId(id))));
  ipcMain.handle('crew:retry', guard((id: unknown) => crew().retry(sessionId(id))));

  // ---------- New session ----------
  ipcMain.handle('crew:pick-repo', guard(() => options.setup.pickRepo()));
  ipcMain.handle('crew:pick-folder', guard(() => options.setup.pickFolder()));
  ipcMain.handle('crew:list-models', guard(() => options.models()));
  ipcMain.handle(
    'crew:create-session',
    guard(async (request: unknown) => {
      const manager = crew();
      const plan = await options.setup.plan(request, { freeRobots: manager.freeRobots(), models: await options.models() });
      if (!plan) return { started: false };
      await manager.startSession(plan);
      return { started: true };
    }),
  );

  // ---------- Changes, folder, archive ----------
  ipcMain.handle('crew:changes', guard((id: unknown) => crew().changes(sessionId(id))));
  ipcMain.handle(
    'crew:open-folder',
    guard(async (id: unknown) => {
      const folder = crew().worktreeOf(sessionId(id));
      if (!folder) throw new Error('This robot has no worktree yet.');
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
    }),
  );
  ipcMain.handle(
    'crew:archive',
    guard(async (id: unknown) => {
      const manager = crew();
      const sid = sessionId(id);
      const preview = await manager.archivePreview(sid);
      if (!preview) return { archived: false };
      const where = preview.worktree ? tilde(preview.worktree) : 'no worktree';
      const detail = [
        `${preview.name} stops and goes back to sleep. Its conversation is kept in the engine's records.`,
        preview.worktree ? `Worktree: ${where}` : '',
        preview.branch ? `The branch ${preview.branch} is kept, with any commits on it.` : '',
        preview.dirty ? '\nThe worktree has uncommitted changes. Removing it throws them away.' : '',
      ]
        .filter(Boolean)
        .join('\n');
      const choice = options.testArchiveChoice ?? await ask({
        type: preview.dirty ? 'warning' : 'question',
        buttons: ['Archive and remove the worktree', 'Archive, keep the worktree', 'Cancel'],
        defaultId: preview.dirty ? 1 : 0,
        cancelId: 2,
        noLink: true,
        title: 'Agent Crew',
        message: `Archive ${preview.name}'s session?`,
        detail,
      });
      if (choice === 2) return { archived: false };
      await manager.archive(sid, { removeWorktree: choice === 0, force: preview.dirty });
      return { archived: true };
    }),
  );
}
