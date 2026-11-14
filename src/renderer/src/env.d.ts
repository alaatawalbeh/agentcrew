/// <reference types="vite/client" />

interface CrewPreloadApi {
  hello(): Promise<{ engine: import('@shared/crew').EngineState; snapshot: import('@shared/types').CrewSnapshot | null }>;
  onSnapshot(callback: (value: unknown) => void): () => void;
  onEngine(callback: (value: unknown) => void): () => void;
  onNotice(callback: (value: unknown) => void): () => void;
  onSelect(callback: (value: unknown) => void): () => void;
  send(sessionId: string, text: string): Promise<void>;
  broadcast(text: string): Promise<void>;
  answerApproval(sessionId: string, approvalId: string, decision: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  retry(sessionId: string): Promise<void>;
  pickRepo(): Promise<unknown>;
  pickFolder(): Promise<unknown>;
  listModels(): Promise<unknown>;
  createSession(request: unknown): Promise<unknown>;
  changes(sessionId: string): Promise<unknown>;
  openFolder(sessionId: string): Promise<unknown>;
  archive(sessionId: string): Promise<unknown>;
  rename(sessionId: string, name: string): Promise<unknown>;
  remove(sessionId: string): Promise<unknown>;
}

interface Window {
  /** Present only inside the Electron app (set by the sandboxed preload). */
  readonly crewApp?: { readonly isElectron: true; readonly platform: string };
  /** The crew actions, inside the Electron app only. */
  readonly crew?: CrewPreloadApi;
}
