// What the renderer knows about the crew. It never sees engine objects, connections or passwords: the main
// process (phase 2) or the sample bridge (phase 1) turns everything into these plain views.

export type Status = 'sleeping' | 'paused' | 'thinking' | 'speaking' | 'needs-approval' | 'stuck' | 'done';

export const STATUS_LABEL: Record<Status, string> = {
  sleeping: 'Sleeping',
  paused: 'Paused',
  thinking: 'Thinking',
  speaking: 'Speaking',
  'needs-approval': 'Needs approval',
  stuck: 'Stuck',
  done: 'Done',
};

/** Statuses that count towards "N need you". */
export const NEEDS_YOU: readonly Status[] = ['needs-approval', 'stuck'];

/** A turn is in progress: Esc stops it. */
export const isRunning = (status: Status): boolean => status === 'thinking' || status === 'speaking';

export type HostKind = 'local' | 'linux' | 'macos' | 'windows';

export interface HostRef {
  name: string;
  kind: HostKind;
}

export type PlanState = 'done' | 'active' | 'pending';

export interface PlanItem {
  text: string;
  state: PlanState;
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
}

export type ApprovalDecision = 'allow' | 'always' | 'deny';

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string; broadcast?: boolean }
  | { kind: 'agent'; id: string; text: string; streaming?: boolean }
  | { kind: 'plan'; id: string; items: PlanItem[] }
  | {
      kind: 'tool';
      id: string;
      tool: string;
      target: string;
      detail?: string;
      state: 'running' | 'ok' | 'error';
      diff?: DiffLine[];
      output?: string;
    }
  | { kind: 'approval'; id: string; tool: string; command: string; decision: ApprovalDecision }
  | { kind: 'error'; id: string; title: string; detail?: string; retryable?: boolean };

export interface PendingApproval {
  id: string;
  tool: string;
  /** Shown in full, never truncated. */
  command: string;
  reason?: string;
  cwd?: string;
}

export interface SessionView {
  id: string;
  robotId: string;
  /** The robot's name: its roster name, or the one you gave it. */
  name: string;
  task: string | null;
  host: HostRef;
  repo?: string;
  branch?: string;
  /** "folder": the robot works straight in a folder that isn't a git repo, with no worktree or branch. */
  workspace?: 'worktree' | 'folder';
  status: Status;
  items: TranscriptItem[];
  pendingApproval?: PendingApproval;
  /** When a paused agent stopped, e.g. "22:14". */
  pausedAt?: string;
  model: string;
}

export interface CrewSnapshot {
  sessions: SessionView[];
}
