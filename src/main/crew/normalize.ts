// Turns the engine's timeline (Paseo protocol: timeline items and stream events) into Agent Crew's transcript items.
// Pure and synchronous, so it is tested against recorded sessions (test/fixtures/engine-session.jsonl).
import type { DiffLine, PendingApproval, PlanItem, TranscriptItem } from '@shared/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type EngineEvent = { type: string; [key: string]: any };
type EngineItem = { type: string; [key: string]: any };
/* eslint-enable @typescript-eslint/no-explicit-any */

export type TurnState = 'none' | 'running' | 'completed' | 'canceled' | 'failed';

export interface AgentTranscript {
  items: TranscriptItem[];
  pendingApproval?: PendingApproval;
  turn: TurnState;
  /** ms timestamp of the last streamed reply text, for Speaking vs Thinking. */
  lastTextAt: number;
  /** Requests whose decision Agent Crew sent, so the history note can say "always" where it was. */
  decisions: Record<string, 'allow' | 'always' | 'deny'>;
  /** Requests' tool, command and the engine's "always allow" suggestions, kept for the history note and the answer. */
  requests: Record<string, { tool: string; command: string; suggestions?: unknown[] }>;
}

export function emptyTranscript(): AgentTranscript {
  return { items: [], turn: 'none', lastTextAt: 0, decisions: {}, requests: {} };
}

/** Engine-internal tools that would only add noise to the transcript (the todo tools drive the plan card). */
const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

const PLAN_STATE: Record<string, PlanItem['state']> = {
  completed: 'done',
  in_progress: 'active',
  pending: 'pending',
};

const countLines = (text: string | undefined): number => (text ? text.replace(/\n$/, '').split('\n').length : 0);
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Shows paths relative to the agent's worktree, and the rest with the home folder as ~. */
export function displayPath(path: string, cwd: string | null, home: string | null): string {
  if (cwd && (path === cwd || path.startsWith(`${cwd}/`))) return path.slice(cwd.length + 1) || '.';
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

function parseUnifiedDiff(diff: string): { lines: DiffLine[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('@@')) lines.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+')) {
      added++;
      lines.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      removed++;
      lines.push({ kind: 'del', text: line.slice(1) });
    } else if (line.length) lines.push({ kind: 'ctx', text: line.replace(/^ /, '') });
  }
  return { lines, added, removed };
}

const MAX_DIFF_LINES = 400;
const MAX_OUTPUT_CHARS = 20_000;

interface ToolView {
  tool: string;
  target: string;
  detail?: string;
  diff?: DiffLine[];
  output?: string;
}

function toolView(item: EngineItem, cwd: string | null, home: string | null): ToolView {
  const d = item.detail ?? {};
  const path = (p: string) => displayPath(String(p ?? ''), cwd, home);
  switch (d.type) {
    case 'shell':
      return {
        tool: item.name || 'Bash',
        target: String(d.command ?? ''),
        detail: typeof d.exitCode === 'number' ? `exit ${d.exitCode}` : undefined,
        output: typeof d.output === 'string' ? d.output.slice(0, MAX_OUTPUT_CHARS) : undefined,
      };
    case 'read': {
      const n = countLines(d.content);
      return { tool: item.name || 'Read', target: path(d.filePath), detail: d.content !== undefined ? plural(n, 'line') : undefined };
    }
    case 'edit': {
      if (typeof d.unifiedDiff === 'string' && d.unifiedDiff) {
        const parsed = parseUnifiedDiff(d.unifiedDiff);
        return {
          tool: item.name || 'Edit',
          target: path(d.filePath),
          detail: `+${parsed.added} −${parsed.removed}`,
          diff: parsed.lines.slice(0, MAX_DIFF_LINES),
        };
      }
      const oldLines = typeof d.oldString === 'string' ? d.oldString.split('\n') : [];
      const newLines = typeof d.newString === 'string' ? d.newString.split('\n') : [];
      const hasStrings = typeof d.oldString === 'string' || typeof d.newString === 'string';
      return {
        tool: item.name || 'Edit',
        target: path(d.filePath),
        detail: hasStrings ? `+${newLines.length} −${oldLines.length}` : undefined,
        diff: hasStrings
          ? [
              ...oldLines.map((text: string): DiffLine => ({ kind: 'del', text })),
              ...newLines.map((text: string): DiffLine => ({ kind: 'add', text })),
            ].slice(0, MAX_DIFF_LINES)
          : undefined,
      };
    }
    case 'write': {
      const content = typeof d.content === 'string' ? d.content : undefined;
      const lines: string[] = content === undefined ? [] : content.replace(/\n$/, '').split('\n');
      return {
        tool: item.name || 'Write',
        target: path(d.filePath),
        detail: content === undefined ? undefined : `+${lines.length} −0`,
        diff: content === undefined ? undefined : lines.slice(0, MAX_DIFF_LINES).map((text): DiffLine => ({ kind: 'add', text })),
      };
    }
    case 'search':
      return {
        tool: item.name || 'Search',
        target: String(d.query ?? ''),
        detail:
          typeof d.numMatches === 'number'
            ? plural(d.numMatches, 'match')
            : typeof d.numFiles === 'number'
              ? plural(d.numFiles, 'file')
              : undefined,
        output: typeof d.content === 'string' ? d.content.slice(0, MAX_OUTPUT_CHARS) : undefined,
      };
    case 'fetch':
      return {
        tool: item.name || 'Fetch',
        target: String(d.url ?? ''),
        detail: typeof d.code === 'number' ? `${d.code}` : undefined,
      };
    case 'sub_agent':
      return { tool: 'Agent', target: String(d.description ?? d.subAgentType ?? 'sub-agent') };
    default: {
      const input = d.input && typeof d.input === 'object' ? JSON.stringify(d.input) : '';
      return { tool: item.name || 'Tool', target: input.length > 200 ? `${input.slice(0, 197)}…` : input };
    }
  }
}

/** What an approval card shows: the full command, or the file and input for other tools. Never truncated. */
function requestCommand(request: EngineItem, cwd: string | null, home: string | null): string {
  const d = request.detail ?? {};
  if (d.type === 'shell' && d.command) return String(d.command);
  if (d.filePath) return displayPath(String(d.filePath), cwd, home);
  if (d.url) return String(d.url);
  const input = request.input;
  if (input && typeof input === 'object') {
    if (typeof input.command === 'string') return input.command;
    return JSON.stringify(input, null, 2);
  }
  return request.title ?? request.name ?? 'an action';
}

/** A tool's failure reason: `{ message }`, or a tool result `{ content }` (a string or text blocks), or a string. */
function toolErrorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return null;
  const e = error as { message?: unknown; content?: unknown };
  if (typeof e.message === 'string' && e.message) return e.message;
  if (typeof e.content === 'string' && e.content) return e.content;
  if (Array.isArray(e.content)) {
    const text = e.content
      .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  return null;
}

const markStreamingDone = (items: TranscriptItem[]): TranscriptItem[] =>
  items.some((i) => i.kind === 'agent' && i.streaming)
    ? items.map((i) => (i.kind === 'agent' && i.streaming ? { ...i, streaming: false } : i))
    : items;

function upsertById(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((i) => i.id === item.id);
  if (index === -1) return [...items, item];
  const copy = items.slice();
  copy[index] = item;
  return copy;
}

export interface NormalizeContext {
  cwd: string | null;
  home: string | null;
  now: number;
}

/** Applies one timeline item (from a live `timeline` event or a fetched entry). */
export function applyItem(state: AgentTranscript, item: EngineItem, ctx: NormalizeContext): AgentTranscript {
  switch (item.type) {
    case 'user_message': {
      const id = `user:${item.messageId ?? item.clientMessageId ?? state.items.length}`;
      return { ...state, items: upsertById(markStreamingDone(state.items), { kind: 'user', id, text: String(item.text ?? '') }) };
    }
    case 'assistant_message': {
      const id = `agent:${item.messageId ?? 'current'}`;
      const existing = state.items.find((i) => i.id === id);
      const text = String(item.text ?? '');
      const merged =
        existing && existing.kind === 'agent'
          ? { ...existing, text: existing.text + text, streaming: true }
          : { kind: 'agent' as const, id, text, streaming: true };
      return { ...state, items: upsertById(state.items, merged), lastTextAt: ctx.now };
    }
    case 'todo': {
      const plan: PlanItem[] = (item.items ?? []).map((todo: EngineItem) => ({
        text: String(todo.text ?? todo.content ?? ''),
        state: PLAN_STATE[todo.status] ?? (todo.completed ? 'done' : 'pending'),
      }));
      const existing = state.items.find((i) => i.kind === 'plan');
      const planItem: TranscriptItem = { kind: 'plan', id: existing?.id ?? 'plan', items: plan };
      return { ...state, items: upsertById(state.items, planItem) };
    }
    case 'tool_call': {
      if (HIDDEN_TOOLS.has(item.name)) return state;
      const view = toolView(item, ctx.cwd, ctx.home);
      const failed = item.status === 'failed' || item.status === 'canceled';
      const errorText = toolErrorText(item.error) ?? (item.status === 'canceled' ? 'stopped' : 'failed');
      const tool: TranscriptItem = {
        kind: 'tool',
        id: `tool:${item.callId}`,
        tool: view.tool,
        target: view.target,
        state: item.status === 'running' ? 'running' : failed ? 'error' : 'ok',
        detail: failed ? (errorText.length > 60 ? `${errorText.slice(0, 57)}…` : errorText) : view.detail,
        diff: view.diff,
        output: failed && !view.output ? errorText : view.output,
      };
      return { ...state, items: upsertById(markStreamingDone(state.items), tool) };
    }
    case 'error':
      return {
        ...state,
        items: [...state.items, { kind: 'error', id: `error:${state.items.length}`, title: 'Something went wrong', detail: String(item.message ?? item.error ?? '') }],
      };
    default:
      return state;
  }
}

/** Applies one live stream event (`timeline`, `permission_*`, `turn_*`). */
export function applyEvent(state: AgentTranscript, event: EngineEvent, ctx: NormalizeContext): AgentTranscript {
  switch (event.type) {
    case 'timeline':
      return applyItem(state, event.item ?? {}, ctx);
    case 'turn_started':
      return { ...state, turn: 'running' };
    case 'turn_completed':
      return { ...state, turn: 'completed', items: markStreamingDone(state.items) };
    case 'turn_canceled':
      return {
        ...state,
        turn: 'canceled',
        items: markStreamingDone(state.items).map((i) =>
          i.kind === 'tool' && i.state === 'running' ? { ...i, state: 'error', detail: 'stopped' } : i,
        ),
      };
    case 'turn_failed': {
      const message = String(event.error ?? event.diagnostic ?? 'The turn failed.');
      return {
        ...state,
        turn: 'failed',
        items: [...markStreamingDone(state.items), errorNote(message, event.code, state.items.length)],
      };
    }
    case 'permission_requested': {
      const request = event.request ?? {};
      const command = requestCommand(request, ctx.cwd, ctx.home);
      return {
        ...state,
        items: markStreamingDone(state.items),
        pendingApproval: {
          id: String(request.id),
          tool: String(request.name ?? 'Tool'),
          command,
          reason: request.description ?? request.title ?? undefined,
          cwd: ctx.cwd ? displayPath(ctx.cwd, null, ctx.home) : undefined,
        },
        requests: {
          ...state.requests,
          [request.id]: {
            tool: String(request.name ?? 'Tool'),
            command,
            ...(Array.isArray(request.suggestions) && request.suggestions.length ? { suggestions: request.suggestions } : {}),
          },
        },
      };
    }
    case 'permission_resolved': {
      const id = String(event.requestId);
      const behavior = event.resolution?.behavior === 'allow' ? 'allow' : 'deny';
      const decision = state.decisions[id] ?? behavior;
      const request = state.requests[id] ?? (state.pendingApproval?.id === id ? state.pendingApproval : undefined);
      const items = request
        ? [...state.items, { kind: 'approval' as const, id: `approval:${id}`, tool: request.tool, command: request.command, decision }]
        : state.items;
      return { ...state, items, pendingApproval: state.pendingApproval?.id === id ? undefined : state.pendingApproval };
    }
    default:
      return state;
  }
}

/** Usage-limit and sign-in failures get their own wording; anything else shows the engine's message. */
export function errorNote(message: string, code: unknown, n: number): TranscriptItem {
  const text = message.trim();
  if (code === 'rate_limit' || /usage limit|rate limit|limit reached|resets at/i.test(text)) {
    return { kind: 'error', id: `error:${n}`, title: 'Usage limit reached', detail: text, retryable: true };
  }
  if (code === 'auth' || /log ?in|sign ?in|authenticat|unauthori[sz]ed|oauth|expired/i.test(text)) {
    return {
      kind: 'error',
      id: `error:${n}`,
      title: 'Claude Code needs you to sign in',
      detail: `${text}\nRun \`claude auth login\` in a terminal, then try again.`,
      retryable: true,
    };
  }
  return { kind: 'error', id: `error:${n}`, title: 'The agent stopped with an error', detail: text, retryable: true };
}
