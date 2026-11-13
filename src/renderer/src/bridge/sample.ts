// In-memory crew for phase 1: no engine, no account. It plays short scripts (think, run a tool, stream a reply)
// so the UI can be exercised end to end. Phase 2 replaces it with the Electron bridge behind the same interface.
import type { CrewBridge } from '@shared/bridge';
import { isDefaultCrew, ROSTER_ROBOTS, sessionIdFor, type FolderChoice, type ModelOption, type RepoChoice } from '@shared/crew';
import {
  isRunning,
  type ApprovalDecision,
  type CrewSnapshot,
  type PlanItem,
  type SessionView,
  type Status,
  type TranscriptItem,
} from '@shared/types';
import {
  allowedScript,
  deniedScript,
  replyScript,
  resumeScript,
  retryScript,
  sampleSessions,
  stuckReplyScript,
  wakeScript,
  type Scenario,
  type Step,
} from './sampleData';

export type SampleBridge = CrewBridge & {
  snapshot(): CrewSnapshot;
  onNotice(listener: (message: string) => void): () => void;
};

// What the New session dialog offers in the browser preview. The desktop app asks git and the engine instead.
const SAMPLE_REPOS: Omit<RepoChoice, 'token'>[] = [
  { path: '~/code/notes-app', name: 'notes-app', branches: ['main', 'develop', 'feat/search'], currentBranch: 'main' },
  { path: '~/code/api-server', name: 'api-server', branches: ['main', 'feat/auth-v2'], currentBranch: 'main' },
];
const SAMPLE_FOLDERS = ['~/code/shared-docs', '~/code/design-tokens'];
export const SAMPLE_MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];
const DIFF_SIGN = { add: '+', del: '-', ctx: ' ', hunk: '' } as const;

/** Like the app's branch names: crew-<robot>-<a few words of the task>. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-') || 'task';

export function scenarioFromSearch(search: string): Scenario {
  return new URLSearchParams(search).get('scenario') === 'design' ? 'design' : 'full';
}

const STREAM_TICK_MS = 45;
const WORDS_PER_TICK = 3;

const firstLine = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
};

export function createSampleBridge(scenario: Scenario = 'full'): SampleBridge {
  let sessions = sampleSessions(scenario);
  const listeners = new Set<(snapshot: CrewSnapshot) => void>();
  const noticeListeners = new Set<(message: string) => void>();
  const tell = (message: string) => {
    for (const listener of noticeListeners) listener(message);
  };
  const repos = new Map<string, Omit<RepoChoice, 'token'>>();
  let repoPicks = 0;
  let folderPicks = 0;
  const timers = new Map<string, Set<ReturnType<typeof setTimeout>>>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  const snapshot = (): CrewSnapshot => ({ sessions });
  const emit = () => {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  };
  const get = (id: string) => sessions.find((s) => s.id === id);
  const update = (id: string, fn: (s: SessionView) => SessionView) => {
    let changed = false;
    sessions = sessions.map((s) => {
      if (s.id !== id) return s;
      changed = true;
      return fn(s);
    });
    if (changed) emit();
  };

  const later = (id: string, ms: number, fn: () => void) => {
    let pending = timers.get(id);
    if (!pending) {
      pending = new Set();
      timers.set(id, pending);
    }
    const timer = setTimeout(() => {
      pending.delete(timer);
      fn();
    }, ms);
    pending.add(timer);
  };
  const cancel = (id: string) => {
    const pending = timers.get(id);
    if (!pending) return;
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
  };

  const push = (id: string, item: TranscriptItem) => update(id, (s) => ({ ...s, items: [...s.items, item] }));
  const patchItem = (id: string, itemId: string, fn: (item: TranscriptItem) => TranscriptItem) =>
    update(id, (s) => ({ ...s, items: s.items.map((item) => (item.id === itemId ? fn(item) : item)) }));
  const setStatus = (id: string, status: Status) => update(id, (s) => ({ ...s, status }));
  const setPlan = (id: string, items: PlanItem[]) =>
    update(id, (s) =>
      s.items.some((item) => item.kind === 'plan')
        ? { ...s, items: s.items.map((item) => (item.kind === 'plan' ? { ...item, items } : item)) }
        : { ...s, items: [...s.items, { kind: 'plan', id: nextId('plan'), items }] },
    );

  const stream = (id: string, text: string, then: () => void) => {
    const itemId = nextId('agent');
    push(id, { kind: 'agent', id: itemId, text: '', streaming: true });
    setStatus(id, 'speaking');
    const parts = text.split(/(\s+)/);
    let shown = 0;
    const tick = () => {
      shown = Math.min(parts.length, shown + WORDS_PER_TICK * 2);
      const partial = parts.slice(0, shown).join('');
      patchItem(id, itemId, (item) => (item.kind === 'agent' ? { ...item, text: partial } : item));
      if (shown < parts.length) {
        later(id, STREAM_TICK_MS, tick);
      } else {
        patchItem(id, itemId, (item) => (item.kind === 'agent' ? { ...item, streaming: false } : item));
        then();
      }
    };
    later(id, STREAM_TICK_MS, tick);
  };

  const run = (id: string, steps: Step[], index = 0): void => {
    const step = steps[index];
    if (!step) {
      setStatus(id, 'done');
      return;
    }
    const next = () => run(id, steps, index + 1);
    switch (step.kind) {
      case 'think':
        setStatus(id, 'thinking');
        later(id, step.ms, next);
        return;
      case 'tool': {
        const itemId = nextId('tool');
        setStatus(id, 'thinking');
        push(id, { kind: 'tool', id: itemId, tool: step.tool, target: step.target, state: 'running' });
        later(id, step.ms, () => {
          patchItem(id, itemId, (item) =>
            item.kind === 'tool'
              ? { ...item, state: step.state ?? 'ok', detail: step.detail, diff: step.diff, output: step.output }
              : item,
          );
          next();
        });
        return;
      }
      case 'say':
        stream(id, step.text, next);
        return;
      case 'plan':
        setPlan(id, step.items);
        next();
        return;
      case 'end':
        setStatus(id, step.status);
        return;
    }
  };

  /** Ends whatever is in flight: timers cleared, a streaming reply cut off, a running tool marked stopped. */
  const stopRunning = (id: string) => {
    cancel(id);
    update(id, (s) => ({
      ...s,
      items: s.items.map((item) => {
        if (item.kind === 'agent' && item.streaming) return { ...item, streaming: false, text: `${item.text} …` };
        if (item.kind === 'tool' && item.state === 'running') return { ...item, state: 'error', detail: 'stopped' };
        return item;
      }),
    }));
  };

  const awake = (s: SessionView) => s.status !== 'sleeping' && s.status !== 'paused';

  return {
    snapshot,

    onNotice(listener) {
      noticeListeners.add(listener);
      return () => {
        noticeListeners.delete(listener);
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    async send(id, text) {
      const s = get(id);
      const message = text.trim();
      if (!s || !message || s.pendingApproval) return;
      if (isRunning(s.status)) stopRunning(id);
      push(id, { kind: 'user', id: nextId('user'), text: message });
      switch (s.status) {
        case 'sleeping':
          update(id, (x) => ({
            ...x,
            task: firstLine(message),
            repo: x.repo ?? 'notes-app',
            branch: x.branch ?? `crew/${x.robotId}-1`,
          }));
          run(id, wakeScript(firstLine(message)));
          return;
        case 'stuck':
          run(id, stuckReplyScript());
          return;
        case 'paused':
          update(id, (x) => ({ ...x, pausedAt: undefined }));
          run(id, replyScript());
          return;
        default:
          run(id, replyScript());
      }
    },

    async broadcast(text) {
      const message = text.trim();
      if (!message) return;
      sessions.filter(awake).forEach((s, i) => {
        // Agents waiting on you get the message in their history but don't act on it until you've answered.
        if (s.pendingApproval || s.status === 'stuck') {
          push(s.id, { kind: 'user', id: nextId('user'), text: message, broadcast: true });
          return;
        }
        if (isRunning(s.status)) stopRunning(s.id);
        push(s.id, { kind: 'user', id: nextId('user'), text: message, broadcast: true });
        setStatus(s.id, 'thinking');
        later(s.id, 250 * i, () => run(s.id, replyScript()));
      });
    },

    async answerApproval(id, approvalId, decision: ApprovalDecision) {
      const s = get(id);
      const pending = s?.pendingApproval;
      if (!s || !pending || pending.id !== approvalId) return;
      update(id, (x) => ({
        ...x,
        pendingApproval: undefined,
        items: [
          ...x.items,
          { kind: 'approval', id: nextId('approval'), tool: pending.tool, command: pending.command, decision },
        ],
      }));
      run(id, decision === 'deny' ? deniedScript() : allowedScript(s.robotId, pending.command));
    },

    async interrupt(id) {
      const s = get(id);
      if (!s || !isRunning(s.status)) return;
      stopRunning(id);
      setStatus(id, 'done');
    },

    async resume(id) {
      const s = get(id);
      if (!s || s.status !== 'paused') return;
      update(id, (x) => ({ ...x, pausedAt: undefined }));
      run(id, resumeScript(s.robotId));
    },

    async retry(id) {
      const s = get(id);
      if (!s || s.status !== 'stuck') return;
      run(id, retryScript(s.robotId));
    },

    async pickRepo() {
      const repo = SAMPLE_REPOS[repoPicks++ % SAMPLE_REPOS.length]!;
      const token = nextId('repo');
      repos.set(token, repo);
      return { ...repo, token };
    },

    async pickFolder(): Promise<FolderChoice> {
      const path = SAMPLE_FOLDERS[folderPicks++ % SAMPLE_FOLDERS.length]!;
      return { token: nextId('folder'), path };
    },

    async listModels() {
      return SAMPLE_MODELS;
    },

    async createSession(request) {
      const robot = ROSTER_ROBOTS.find((r) => r.id === request.robotId);
      if (!robot) throw new Error('Pick a robot.');
      const repo = repos.get(request.repoToken);
      if (!repo) throw new Error('Choose a repo first.');
      const task = request.task.trim();
      if (!task) throw new Error(`Tell ${robot.name} what to work on.`);
      if (!repo.branches.includes(request.baseBranch)) throw new Error('Pick a base branch from the list.');
      const id = sessionIdFor(robot.id);
      const existing = get(id);
      if (existing && existing.status !== 'sleeping') throw new Error(`${robot.name} already has a session.`);
      cancel(id);
      const view: SessionView = {
        id,
        robotId: robot.id,
        task: firstLine(task),
        host: { name: 'this computer', kind: 'local' },
        repo: repo.name,
        branch: `crew-${robot.id}-${slug(firstLine(task))}`,
        status: 'thinking',
        model: request.model,
        items: [{ kind: 'user', id: nextId('user'), text: task }],
      };
      sessions = existing ? sessions.map((s) => (s.id === id ? view : s)) : [...sessions, view];
      emit();
      run(id, wakeScript(firstLine(task)));
      return { started: true };
    },

    async changes(id) {
      const s = get(id);
      if (!s?.repo) return 'This robot has no worktree yet.';
      const edits = s.items.flatMap((item) => (item.kind === 'tool' && item.diff?.length ? [item] : []));
      if (!edits.length) return 'No changes against main.';
      return edits
        .map((edit) =>
          [
            `diff --git a/${edit.target} b/${edit.target}`,
            `--- a/${edit.target}`,
            `+++ b/${edit.target}`,
            ...(edit.diff ?? []).map((line) => `${DIFF_SIGN[line.kind]}${line.text}`),
          ].join('\n'),
        )
        .join('\n');
    },

    async openFolder() {
      tell('Open folder works in the desktop app.');
    },

    async archive(id) {
      const s = get(id);
      if (!s || s.status === 'sleeping') return { archived: false };
      cancel(id);
      if (isDefaultCrew(s.robotId)) {
        update(id, () => ({
          id,
          robotId: s.robotId,
          task: null,
          host: { name: 'this computer', kind: 'local' },
          status: 'sleeping',
          items: [],
          model: s.model,
        }));
      } else {
        sessions = sessions.filter((x) => x.id !== id);
        emit();
      }
      return { archived: true };
    },
  };
}
