// Replays a real recorded engine session (engine/build/record.mjs) through Agent Crew's event mapping.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEvent, applyItem, displayPath, emptyTranscript, errorNote, type AgentTranscript } from '../../src/main/crew/normalize';
import { deriveStatus } from '../../src/main/crew/status';

interface Recorded {
  t: number;
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

const events: Recorded[] = readFileSync(join(__dirname, '..', 'fixtures', 'engine-session.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line: string) => JSON.parse(line));
const created = events.find((e) => e.kind === 'created')!.payload;
const ctxAt = (t: number) => ({ cwd: created.cwd as string, home: '<home>', now: t });

function replayLive(stopWhen?: (s: AgentTranscript, e: Recorded) => boolean): AgentTranscript {
  let state = emptyTranscript();
  for (const e of events) {
    if (e.kind !== 'timeline') continue;
    state = applyEvent(state, e.payload.event, ctxAt(e.t));
    if (stopWhen?.(state, e)) break;
  }
  return state;
}

describe('engine event mapping (recorded session)', () => {
  const live = replayLive();

  it('builds one plan card from the todo list, ending all done', () => {
    const plans = live.items.filter((i) => i.kind === 'plan');
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.kind === 'plan' && plan.items.length).toBe(3);
    expect(plan.kind === 'plan' && plan.items.every((step) => step.state === 'done')).toBe(true);
  });

  it('shows real tool calls and hides the engine bookkeeping tools', () => {
    const tools = live.items.filter((i) => i.kind === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.kind === 'tool' && /ToolSearch|TaskCreate|TaskUpdate|TodoWrite/.test(t.tool))).toBe(false);
    const write = tools.find((t) => t.kind === 'tool' && t.tool === 'Write');
    expect(write?.kind === 'tool' && write.target).toBe('notes.txt'); // relative to the worktree
    expect(write?.kind === 'tool' && write.detail).toBe('+1 −0');
    expect(tools.every((t) => t.kind === 'tool' && t.state !== 'running')).toBe(true);
  });

  it('marks the denied command as failed with the reason given', () => {
    const failed = live.items.find((i) => i.kind === 'tool' && i.state === 'error');
    expect(failed?.kind === 'tool' && failed.output).toMatch(/Not this time/);
  });

  it('records every approval decision in order: allow, deny, allow', () => {
    const notes = live.items.filter((i) => i.kind === 'approval');
    expect(notes.map((n) => n.kind === 'approval' && n.decision)).toEqual(['allow', 'deny', 'allow']);
    expect(live.pendingApproval).toBeUndefined();
  });

  it('joins streamed reply chunks into whole messages and stops streaming when the turn ends', () => {
    const replies = live.items.filter((i) => i.kind === 'agent');
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((r) => r.kind === 'agent' && r.text.length > 20)).toBe(true);
    expect(replies.some((r) => r.kind === 'agent' && r.streaming)).toBe(false);
    expect(live.turn).toBe('canceled');
  });

  it('shows Needs approval while a permission is pending', () => {
    const atRequest = replayLive((_, e) => e.payload.event.type === 'permission_requested');
    expect(atRequest.pendingApproval?.tool).toBe('Bash');
    expect(atRequest.pendingApproval?.command).toMatch(/Hello from Agent Crew/);
    expect(deriveStatus({ hasAgent: true, agentStatus: 'running', transcript: atRequest, paused: false, now: 0 })).toBe(
      'needs-approval',
    );
  });

  it('shows Speaking right after reply text and Thinking once it pauses', () => {
    let speakingAt = 0;
    const midReply = replayLive((s, e) => {
      const last = s.items.at(-1);
      if (last?.kind === 'agent' && last.streaming) {
        speakingAt = e.t;
        return true;
      }
      return false;
    });
    const input = { hasAgent: true, agentStatus: 'running', transcript: midReply, paused: false };
    expect(deriveStatus({ ...input, now: speakingAt + 100 })).toBe('speaking');
    expect(deriveStatus({ ...input, now: speakingAt + 5000 })).toBe('thinking');
  });

  it('rebuilds the same kinds of rows from the fetched timeline after a reconnect', () => {
    const fetched = events.find((e) => e.kind === 'timeline_fetch')!.payload;
    let state = emptyTranscript();
    for (const entry of fetched.entries) state = applyItem(state, entry.item, ctxAt(0));
    expect(state.items[0]?.kind).toBe('user');
    expect(state.items.some((i) => i.kind === 'plan')).toBe(true);
    expect(state.items.some((i) => i.kind === 'tool' && i.tool === 'Write')).toBe(true);
  });
});

describe('status and errors', () => {
  const idle = emptyTranscript();
  it('is Sleeping without an agent, Done when idle, Stuck after a failed turn, Paused when paused', () => {
    expect(deriveStatus({ hasAgent: false, agentStatus: null, transcript: idle, paused: false, now: 0 })).toBe('sleeping');
    expect(deriveStatus({ hasAgent: true, agentStatus: 'idle', transcript: idle, paused: false, now: 0 })).toBe('done');
    expect(
      deriveStatus({ hasAgent: true, agentStatus: 'idle', transcript: { ...idle, turn: 'failed' }, paused: false, now: 0 }),
    ).toBe('stuck');
    expect(deriveStatus({ hasAgent: true, agentStatus: 'idle', transcript: idle, paused: true, now: 0 })).toBe('paused');
  });

  it('words usage-limit and sign-in failures for people', () => {
    expect(errorNote('Claude usage limit reached. Your limit resets at 5pm', undefined, 0)).toMatchObject({
      title: 'Usage limit reached',
    });
    expect(errorNote('OAuth token has expired', undefined, 0)).toMatchObject({ title: 'Claude Code needs you to sign in' });
  });

  it('shows paths relative to the worktree and the home folder as ~', () => {
    expect(displayPath('/w/tree/src/a.ts', '/w/tree', '/home/u')).toBe('src/a.ts');
    expect(displayPath('/home/u/notes.md', '/w/tree', '/home/u')).toBe('~/notes.md');
  });
});
