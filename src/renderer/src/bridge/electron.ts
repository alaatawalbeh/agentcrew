// The real crew, inside the Electron app: everything goes through the preload's fixed functions to the main process,
// which runs the engine. Until the engine is ready, the six robots show as sleeping.
import type { CrewBridge } from '@shared/bridge';
import { CREW, sessionIdFor, type EngineState, type FolderChoice, type ModelOption, type RepoChoice } from '@shared/crew';
import type { CrewSnapshot } from '@shared/types';

export interface ElectronCrewBridge extends CrewBridge {
  onEngine(listener: (state: EngineState) => void): () => void;
  onNotice(listener: (message: string) => void): () => void;
  onSelect(listener: (sessionId: string) => void): () => void;
}

const sleepingCrew = (): CrewSnapshot => ({
  sessions: CREW.map((robot) => ({
    id: sessionIdFor(robot.id),
    robotId: robot.id,
    name: robot.name,
    task: null,
    host: { name: 'this computer', kind: 'local' },
    status: 'sleeping',
    items: [],
    model: 'claude-opus-5-5',
  })),
});

/** Main's error text without Electron's "Error invoking remote method …" wrapper. */
export const cleanError = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function createElectronBridge(api: CrewPreloadApi): ElectronCrewBridge {
  const noticeListeners = new Set<(message: string) => void>();
  const tell = (message: string) => {
    for (const listener of noticeListeners) listener(message);
  };
  /** Runs an action; a refusal from main (engine not ready, bad input) becomes a notice instead of a silent failure. */
  const act = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      tell(cleanError(error));
    }
  };
  /** For the dialog and panels: errors are passed on, cleaned up, so they can be shown in place. */
  const call = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      throw new Error(cleanError(error));
    }
  };

  return {
    subscribe(listener) {
      listener(sleepingCrew());
      const off = api.onSnapshot((value) => listener(value as CrewSnapshot));
      void api.hello().then((hello) => {
        if (hello.snapshot) listener(hello.snapshot);
      });
      return off;
    },
    onEngine(listener) {
      const off = api.onEngine((value) => listener(value as EngineState));
      void api.hello().then((hello) => listener(hello.engine));
      return off;
    },
    onNotice(listener) {
      noticeListeners.add(listener);
      const off = api.onNotice((value) => listener(String(value)));
      return () => {
        noticeListeners.delete(listener);
        off();
      };
    },
    onSelect(listener) {
      return api.onSelect((value) => listener(String(value)));
    },
    send: (sessionId, text) => act(() => api.send(sessionId, text)),
    broadcast: (text) => act(() => api.broadcast(text)),
    answerApproval: (sessionId, approvalId, decision) => act(() => api.answerApproval(sessionId, approvalId, decision)),
    interrupt: (sessionId) => act(() => api.interrupt(sessionId)),
    resume: (sessionId) => act(() => api.resume(sessionId)),
    retry: (sessionId) => act(() => api.retry(sessionId)),
    pickRepo: () => call(() => api.pickRepo() as Promise<RepoChoice | null>),
    pickFolder: () => call(() => api.pickFolder() as Promise<FolderChoice | null>),
    listModels: () => call(() => api.listModels() as Promise<ModelOption[]>),
    createSession: (request) => call(() => api.createSession(request) as Promise<{ started: boolean }>),
    changes: (sessionId) => call(() => api.changes(sessionId) as Promise<string>),
    openFolder: (sessionId) => act(() => api.openFolder(sessionId) as Promise<void>),
    // The confirmation is a native dialog in main; a failure (say, a worktree git won't remove) becomes a notice.
    archive: async (sessionId) => {
      try {
        return (await api.archive(sessionId)) as { archived: boolean };
      } catch (error) {
        tell(cleanError(error));
        return { archived: false };
      }
    },
    rename: (sessionId, name) => call(() => api.rename(sessionId, name) as Promise<void>),
    remove: async (sessionId) => {
      try {
        return (await api.remove(sessionId)) as { removed: boolean };
      } catch (error) {
        tell(cleanError(error));
        return { removed: false };
      }
    },
  };
}
