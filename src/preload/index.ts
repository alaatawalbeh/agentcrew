// Sandboxed preload: it can only use `electron`. It exposes one function per crew action and a few listeners, and
// never raw ipcRenderer or the IPC event object.
import { contextBridge, ipcRenderer } from 'electron';

const listen = (channel: string) => (callback: (value: unknown) => void) => {
  const handler = (_event: unknown, value: unknown) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

contextBridge.exposeInMainWorld(
  'crewApp',
  Object.freeze({
    isElectron: true as const,
    platform: process.platform,
  }),
);

contextBridge.exposeInMainWorld(
  'crew',
  Object.freeze({
    hello: () => ipcRenderer.invoke('crew:hello'),
    onSnapshot: listen('crew:snapshot'),
    onEngine: listen('crew:engine'),
    onNotice: listen('crew:notice'),
    onSelect: listen('crew:select'),
    send: (sessionId: string, text: string) => ipcRenderer.invoke('crew:send', sessionId, text),
    broadcast: (text: string) => ipcRenderer.invoke('crew:broadcast', text),
    answerApproval: (sessionId: string, approvalId: string, decision: string) =>
      ipcRenderer.invoke('crew:answer-approval', sessionId, approvalId, decision),
    interrupt: (sessionId: string) => ipcRenderer.invoke('crew:interrupt', sessionId),
    resume: (sessionId: string) => ipcRenderer.invoke('crew:resume', sessionId),
    retry: (sessionId: string) => ipcRenderer.invoke('crew:retry', sessionId),
    pickRepo: () => ipcRenderer.invoke('crew:pick-repo'),
    pickFolder: () => ipcRenderer.invoke('crew:pick-folder'),
    listModels: () => ipcRenderer.invoke('crew:list-models'),
    createSession: (request: unknown) => ipcRenderer.invoke('crew:create-session', request),
    changes: (sessionId: string) => ipcRenderer.invoke('crew:changes', sessionId),
    openFolder: (sessionId: string) => ipcRenderer.invoke('crew:open-folder', sessionId),
    archive: (sessionId: string) => ipcRenderer.invoke('crew:archive', sessionId),
  }),
);
