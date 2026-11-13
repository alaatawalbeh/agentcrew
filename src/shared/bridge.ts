import type { FolderChoice, ModelOption, NewSessionRequest, RepoChoice } from './crew';
import type { ApprovalDecision, CrewSnapshot } from './types';

/**
 * Everything the UI can ask of the crew. The browser preview uses the in-memory sample bridge; the Electron app uses
 * the preload → main → engine bridge behind the same interface.
 */
export interface CrewBridge {
  /** Called right away with the current snapshot, then on every change. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: CrewSnapshot) => void): () => void;
  /** A message to one agent. To a sleeping robot it becomes its task (a repo is asked for). */
  send(sessionId: string, text: string): Promise<void>;
  /** The same message to every agent that's awake. */
  broadcast(text: string): Promise<void>;
  answerApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  /** Stops the current turn. */
  interrupt(sessionId: string): Promise<void>;
  /** Continues a paused agent where it left off. */
  resume(sessionId: string): Promise<void>;
  /** Tries again after an error. */
  retry(sessionId: string): Promise<void>;

  // New session dialog. Folders are picked in native dialogs; the page only ever holds their tokens.
  pickRepo(): Promise<RepoChoice | null>;
  pickFolder(): Promise<FolderChoice | null>;
  listModels(): Promise<ModelOption[]>;
  createSession(request: NewSessionRequest): Promise<{ started: boolean }>;

  /** The robot's changes against its base branch, as a unified diff. */
  changes(sessionId: string): Promise<string>;
  openFolder(sessionId: string): Promise<void>;
  /** Archives the session after a confirmation shown by the app; the robot goes back to sleep. */
  archive(sessionId: string): Promise<{ archived: boolean }>;
}
