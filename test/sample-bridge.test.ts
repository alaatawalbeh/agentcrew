import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEEDS_YOU, type SessionView } from '../src/shared/types';
import { createSampleBridge, scenarioFromSearch } from '../src/renderer/src/bridge/sample';

const byId = (sessions: SessionView[], id: string) => {
  const s = sessions.find((x) => x.id === id);
  if (!s) throw new Error(`no session ${id}`);
  return s;
};

describe('sample bridge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('matches the design: six agents, two need you', () => {
    const bridge = createSampleBridge('design');
    const { sessions } = bridge.snapshot();
    expect(sessions.map((s) => s.robotId)).toEqual(['atlas', 'vega', 'orin', 'nova', 'kit', 'sable']);
    expect(sessions.filter((s) => NEEDS_YOU.includes(s.status))).toHaveLength(2);
    expect(sessions.map((s) => s.status)).toEqual(['speaking', 'needs-approval', 'thinking', 'stuck', 'done', 'sleeping']);
  });

  it('adds a paused agent and remote hosts in the full scenario', () => {
    const { sessions } = createSampleBridge('full').snapshot();
    expect(byId(sessions, 's-juno').status).toBe('paused');
    expect(byId(sessions, 's-orin').host.kind).toBe('linux');
    expect(byId(sessions, 's-kit').host.kind).toBe('windows');
  });

  it('reads the scenario from the URL', () => {
    expect(scenarioFromSearch('?scenario=design')).toBe('design');
    expect(scenarioFromSearch('')).toBe('full');
  });

  it('ignores an answer to an approval that is not pending', async () => {
    const bridge = createSampleBridge('full');
    await bridge.answerApproval('s-vega', 'wrong-id', 'allow');
    expect(byId(bridge.snapshot().sessions, 's-vega').pendingApproval).toBeDefined();
  });

  it('runs the command after Allow once and records the decision', async () => {
    const bridge = createSampleBridge('full');
    await bridge.answerApproval('s-vega', 'vega-p1', 'allow');
    let vega = byId(bridge.snapshot().sessions, 's-vega');
    expect(vega.pendingApproval).toBeUndefined();
    expect(vega.items.some((i) => i.kind === 'approval' && i.decision === 'allow')).toBe(true);
    await vi.runAllTimersAsync();
    vega = byId(bridge.snapshot().sessions, 's-vega');
    expect(vega.status).toBe('done');
    const plan = vega.items.find((i) => i.kind === 'plan');
    expect(plan?.kind === 'plan' && plan.items.every((step) => step.state === 'done')).toBe(true);
  });

  it('does not run the command after Deny', async () => {
    const bridge = createSampleBridge('full');
    const toolsBefore = byId(bridge.snapshot().sessions, 's-vega').items.filter((i) => i.kind === 'tool').length;
    await bridge.answerApproval('s-vega', 'vega-p1', 'deny');
    await vi.runAllTimersAsync();
    const vega = byId(bridge.snapshot().sessions, 's-vega');
    expect(vega.items.filter((i) => i.kind === 'tool')).toHaveLength(toolsBefore);
    expect(vega.status).toBe('done');
  });

  it('wakes a sleeping agent with its first message as the task', async () => {
    const bridge = createSampleBridge('full');
    await bridge.send('s-sable', 'Add dark mode to the settings page');
    let sable = byId(bridge.snapshot().sessions, 's-sable');
    expect(sable.task).toBe('Add dark mode to the settings page');
    expect(sable.status).toBe('thinking');
    await vi.runAllTimersAsync();
    sable = byId(bridge.snapshot().sessions, 's-sable');
    expect(sable.status).toBe('done');
  });

  it('stops a streaming reply on interrupt', async () => {
    const bridge = createSampleBridge('full');
    await bridge.send('s-kit', 'Also add a changelog page');
    await vi.advanceTimersByTimeAsync(900); // past the thinking step, into streaming
    expect(byId(bridge.snapshot().sessions, 's-kit').status).toBe('speaking');
    await bridge.interrupt('s-kit');
    const kit = byId(bridge.snapshot().sessions, 's-kit');
    expect(kit.status).toBe('done');
    expect(kit.items.some((i) => i.kind === 'agent' && i.streaming)).toBe(false);
    await vi.runAllTimersAsync();
    expect(byId(bridge.snapshot().sessions, 's-kit').status).toBe('done');
  });

  it('resumes a paused agent', async () => {
    const bridge = createSampleBridge('full');
    await bridge.resume('s-juno');
    expect(byId(bridge.snapshot().sessions, 's-juno').status).toBe('thinking');
    await vi.runAllTimersAsync();
    const juno = byId(bridge.snapshot().sessions, 's-juno');
    expect(juno.status).toBe('done');
    expect(juno.pausedAt).toBeUndefined();
  });

  it('broadcasts to awake agents only, and leaves waiting agents waiting', async () => {
    const bridge = createSampleBridge('full');
    await bridge.broadcast('Wrap up and summarise');
    const sessions = bridge.snapshot().sessions;
    const got = (id: string) =>
      byId(sessions, id).items.some((i) => i.kind === 'user' && i.broadcast && i.text === 'Wrap up and summarise');
    expect(got('s-atlas')).toBe(true);
    expect(got('s-vega')).toBe(true);
    expect(got('s-sable')).toBe(false);
    expect(got('s-juno')).toBe(false);
    expect(byId(sessions, 's-vega').status).toBe('needs-approval');
  });
});
