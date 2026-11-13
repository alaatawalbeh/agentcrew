// Turns engine agents into Agent Crew's robots: one agent per robot (tied by the crew.robot label), its transcript
// built by normalize.ts and its status by status.ts. The renderer only ever gets the resulting SessionView snapshot.
import { homedir } from 'node:os';
import {
  BASE_LABEL,
  BRANCH_LABEL,
  isDefaultCrew,
  isRosterRobot,
  REPO_LABEL,
  ROBOT_LABEL,
  ROSTER_ROBOTS,
  robotIdFor,
  sessionIdFor,
} from '@shared/crew';
import type { ApprovalDecision, CrewSnapshot, SessionView } from '@shared/types';
import type { EngineService } from '../engine/EngineService';
import { isWorktreeDirty, removeWorktree, repoInfo, worktreeChanges } from './git';
import { applyEvent, applyItem, emptyTranscript, type AgentTranscript } from './normalize';
import { deriveStatus, SPEAKING_WINDOW_MS } from './status';

/** Model for new agents unless the New session dialog picks another. */
export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Never readable by an agent, whatever auto mode decides: keys, Claude credentials, other tools' logins, env files. */
export const SECRET_DENY_RULES = [
  'Read(~/.ssh/**)',
  'Read(~/.gnupg/**)',
  'Read(~/.aws/**)',
  'Read(~/.claude/**)',
  'Read(~/.claude.json)',
  'Read(~/.local/share/keyrings/**)',
  'Read(~/.gg/**)',
  'Read(**/.env)',
  'Read(**/.env.*)',
];

/**
 * The deny rules for one agent: the fixed list plus the engine's own private folder (its records and logs). Absolute
 * paths take a leading `//` in Claude Code rules. Only that folder is denied, not the app's whole data folder, because
 * the agents' worktrees live next to it.
 */
export function denyRulesFor(engineDataDir: string): string[] {
  return [...SECRET_DENY_RULES, `Read(/${engineDataDir.replace(/\/+$/, '')}/**)`];
}

/** A fully checked request to start a robot's session (folders already resolved by main from dialog tokens). */
export interface SessionPlan {
  robotId: string;
  task: string;
  repoRoot: string;
  repoName: string;
  baseBranch: string;
  model: string;
  modeId: string;
  extraFolders: string[];
  allowRules: string[];
  trustProjectSettings: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RobotRecord {
  robotId: string;
  agentId: string;
  handle: any;
  cwd: string | null;
  repo?: string;
  branch?: string;
  base?: string;
  task: string | null;
  model: string;
  agentStatus: string | null;
  transcript: AgentTranscript;
  paused: boolean;
  unsubscribe?: () => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const firstLine = (text: string, max = 80) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export const branchSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '') || 'task';

export class CrewManager {
  private records = new Map<string, RobotRecord>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentsUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly engine: EngineService,
    private readonly publish: (snapshot: CrewSnapshot) => void,
    /** Shows a native folder picker; returns the chosen folder or null. */
    private readonly pickRepo: (robotName: string) => Promise<string | null>,
    private readonly notify: (message: string) => void,
    /** Model and permission mode for quick sessions (development builds may override them for tests). */
    private readonly agentDefaults: { model: string; modeId: string; engineDataDir: string },
  ) {}

  /** Loads agents that already belong to robots and starts following them. Call once the engine is ready. */
  async attach(): Promise<void> {
    const api = this.engine.api;
    if (!api) return;
    this.agentsUnsubscribe?.();
    this.agentsUnsubscribe = api.agents.subscribe((update: any) => this.onAgentUpdate(update));
    const listed: any = await api.agents.list({ subscribe: {} });
    const agents: any[] = listed?.entries ?? listed?.agents ?? [];
    // Newest agent per robot wins; archived ones are ignored.
    const newest = new Map<string, any>();
    for (const entry of agents) {
      const agent = entry?.agent ?? entry;
      const robotId = agent?.labels?.[ROBOT_LABEL];
      if (!robotId || agent.archivedAt || !isRosterRobot(robotId)) continue;
      const prev = newest.get(robotId);
      if (!prev || String(agent.updatedAt ?? '') > String(prev.updatedAt ?? '')) newest.set(robotId, agent);
    }
    for (const [robotId, agent] of newest) await this.adopt(robotId, api.agents.ref(agent), agent, { loadHistory: true });
    this.scheduleEmit();
  }

  /** The default crew, plus any other roster robot that has a session, in roster order. */
  snapshot(): CrewSnapshot {
    const now = Date.now();
    const shown = ROSTER_ROBOTS.filter((r) => isDefaultCrew(r.id) || this.records.has(r.id));
    const sessions: SessionView[] = shown.map(({ id: robotId }) => {
      const record = this.records.get(robotId);
      if (!record) {
        return {
          id: sessionIdFor(robotId),
          robotId,
          task: null,
          host: { name: 'this computer', kind: 'local' },
          status: 'sleeping',
          items: [],
          model: DEFAULT_MODEL,
        };
      }
      return {
        id: sessionIdFor(robotId),
        robotId,
        task: record.task,
        host: { name: 'this computer', kind: 'local' },
        repo: record.repo,
        branch: record.branch,
        status: deriveStatus({
          hasAgent: true,
          agentStatus: record.agentStatus,
          transcript: record.transcript,
          paused: record.paused,
          now,
        }),
        items: record.transcript.items,
        pendingApproval: record.transcript.pendingApproval,
        model: record.model,
      };
    });
    return { sessions };
  }

  /** Robots without a session right now: the ones the New session dialog can offer. */
  freeRobots(): string[] {
    return ROSTER_ROBOTS.map((r) => r.id).filter((id) => !this.records.has(id));
  }

  hasSession(robotId: string): boolean {
    return this.records.has(robotId);
  }

  /** The robot's worktree folder, for Open folder. */
  worktreeOf(sessionId: string): string | null {
    return this.records.get(robotIdFor(sessionId))?.cwd ?? null;
  }

  // ---------- actions from the UI ----------

  async send(sessionId: string, text: string): Promise<void> {
    const robotId = robotIdFor(sessionId);
    const record = this.records.get(robotId);
    if (record) {
      if (record.transcript.pendingApproval) return;
      record.paused = false;
      await record.handle.send(text);
      return;
    }
    await this.quickSession(robotId, text);
  }

  async broadcast(text: string): Promise<void> {
    await Promise.all(
      [...this.records.values()]
        .filter((r) => !r.transcript.pendingApproval && !r.paused)
        .map((r) => r.handle.send(text).catch((error: unknown) => this.notify(`${r.robotId}: ${String(error)}`))),
    );
  }

  async answerApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    const record = this.records.get(robotIdFor(sessionId));
    if (!record || record.transcript.pendingApproval?.id !== approvalId) return;
    const request = record.transcript.requests[approvalId];
    record.transcript = { ...record.transcript, decisions: { ...record.transcript.decisions, [approvalId]: decision } };
    const response =
      decision === 'deny'
        ? { behavior: 'deny', message: 'The user denied this in Agent Crew.' }
        : {
            behavior: 'allow',
            ...(decision === 'always' && request?.suggestions ? { updatedPermissions: request.suggestions } : {}),
          };
    await record.handle.respondToPermission({ requestId: approvalId, response });
  }

  async interrupt(sessionId: string): Promise<void> {
    const record = this.records.get(robotIdFor(sessionId));
    if (record) await this.engine.client?.cancelAgent(record.agentId);
  }

  async resume(sessionId: string): Promise<void> {
    const record = this.records.get(robotIdFor(sessionId));
    if (!record) return;
    record.paused = false;
    await record.handle.send('Please continue where you left off.');
  }

  async retry(sessionId: string): Promise<void> {
    const record = this.records.get(robotIdFor(sessionId));
    if (record) await record.handle.send('Please try again.');
  }

  /** The robot's changes against its base branch. */
  async changes(sessionId: string): Promise<string> {
    const record = this.records.get(robotIdFor(sessionId));
    if (!record?.cwd) return 'This robot has no worktree yet.';
    return worktreeChanges(record.cwd, record.base ?? null);
  }

  /** What archiving would leave behind, for the confirmation dialog. */
  async archivePreview(sessionId: string): Promise<{ name: string; worktree: string | null; branch?: string; dirty: boolean } | null> {
    const record = this.records.get(robotIdFor(sessionId));
    if (!record) return null;
    const name = ROSTER_ROBOTS.find((r) => r.id === record.robotId)?.name ?? record.robotId;
    const dirty = record.cwd ? await isWorktreeDirty(record.cwd) : false;
    return { name, worktree: record.cwd, branch: record.branch, dirty };
  }

  /** Archives the robot's agent and removes its worktree (the branch stays). The robot goes back to sleep. */
  async archive(sessionId: string, options: { removeWorktree: boolean; force: boolean }): Promise<void> {
    const robotId = robotIdFor(sessionId);
    const record = this.records.get(robotId);
    if (!record) return;
    if (record.transcript.pendingApproval || deriveStatus({ hasAgent: true, agentStatus: record.agentStatus, transcript: record.transcript, paused: false, now: Date.now() }) === 'thinking') {
      await this.engine.client?.cancelAgent(record.agentId).catch(() => {});
    }
    await record.handle.archive();
    record.unsubscribe?.();
    this.records.delete(robotId);
    this.scheduleEmit();
    if (options.removeWorktree && record.cwd) {
      try {
        await removeWorktree(record.cwd, options.force);
      } catch (error) {
        this.notify(`The session is archived, but its worktree was left in place: ${String(error instanceof Error ? error.message : error)}`);
      }
    }
  }

  dispose(): void {
    this.agentsUnsubscribe?.();
    for (const record of this.records.values()) record.unsubscribe?.();
    this.records.clear();
  }

  /** Starts a robot's session from a fully checked plan (the New session dialog, or a quick task). */
  async startSession(plan: SessionPlan): Promise<void> {
    const api = this.engine.api;
    if (!api) throw new Error('The engine is not running.');
    if (this.records.has(plan.robotId)) throw new Error('That robot already has a session.');
    const task = firstLine(plan.task);
    const branch = `crew-${plan.robotId}-${branchSlug(task)}`;
    const options: Record<string, unknown> = {
      settings: {
        permissions: {
          deny: denyRulesFor(this.agentDefaults.engineDataDir),
          ...(plan.allowRules.length ? { allow: plan.allowRules } : {}),
        },
      },
      ...(plan.extraFolders.length ? { additionalDirectories: plan.extraFolders } : {}),
      ...(plan.trustProjectSettings ? { trustProjectSettings: true } : {}),
    };
    const handle = await api.agents.create({
      config: { provider: `claude/${plan.model}`, modeId: plan.modeId, options },
      cwd: plan.repoRoot,
      title: task,
      labels: {
        [ROBOT_LABEL]: plan.robotId,
        [BASE_LABEL]: plan.baseBranch,
        [BRANCH_LABEL]: branch,
        [REPO_LABEL]: plan.repoName,
      },
      worktree: { mode: 'branch-off', newBranch: branch, base: plan.baseBranch },
      prompt: plan.task,
    });
    await this.adopt(plan.robotId, handle, handle.current?.() ?? null, {
      loadHistory: true,
      repo: plan.repoName,
      branch,
      base: plan.baseBranch,
    });
  }

  // ---------- internals ----------

  /** A task typed straight to a sleeping robot: pick a repo, everything else default. */
  private async quickSession(robotId: string, text: string): Promise<void> {
    const robot = ROSTER_ROBOTS.find((r) => r.id === robotId);
    if (!robot) throw new Error(`Unknown robot ${robotId}`);
    const folder = await this.pickRepo(robot.name);
    if (!folder) return;
    const repo = await repoInfo(folder);
    if (!repo) {
      this.notify(`${folder} isn't a git repository with at least one commit, so ${robot.name} can't get its own worktree there.`);
      return;
    }
    await this.startSession({
      robotId,
      task: text,
      repoRoot: repo.root,
      repoName: repo.name,
      baseBranch: repo.currentBranch && repo.currentBranch !== 'HEAD' ? repo.currentBranch : (repo.branches[0] ?? 'HEAD'),
      model: this.agentDefaults.model,
      modeId: this.agentDefaults.modeId,
      extraFolders: [],
      allowRules: [],
      trustProjectSettings: false,
    });
  }

  private async adopt(
    robotId: string,
    handle: any,
    agent: any,
    options: { loadHistory: boolean; repo?: string; branch?: string; base?: string },
  ): Promise<void> {
    this.records.get(robotId)?.unsubscribe?.();
    const labels = agent?.labels ?? {};
    const cwd: string | null = handle.cwd ?? agent?.cwd ?? null;
    const record: RobotRecord = {
      robotId,
      agentId: handle.id,
      handle,
      cwd,
      repo: options.repo ?? labels[REPO_LABEL] ?? undefined,
      branch: options.branch ?? labels[BRANCH_LABEL] ?? undefined,
      base: options.base ?? labels[BASE_LABEL] ?? undefined,
      task: agent?.title ?? null,
      model: agent?.model ?? DEFAULT_MODEL,
      agentStatus: agent?.status ?? null,
      transcript: emptyTranscript(),
      paused: false,
    };
    this.records.set(robotId, record);

    const ctx = () => ({ cwd: record.cwd, home: homedir(), now: Date.now() });
    if (options.loadHistory) {
      try {
        const page: any = await handle.timeline.refetch({ limit: 500 });
        let transcript = emptyTranscript();
        for (const entry of page?.entries ?? []) transcript = applyItem(transcript, entry.item ?? {}, ctx());
        // Fetched history is complete messages: nothing is streaming.
        transcript = {
          ...transcript,
          items: transcript.items.map((i) => (i.kind === 'agent' ? { ...i, streaming: false } : i)),
        };
        for (const pending of page?.agent?.pendingPermissions ?? agent?.pendingPermissions ?? []) {
          transcript = applyEvent(transcript, { type: 'permission_requested', request: pending }, ctx());
        }
        record.transcript = transcript;
      } catch (error) {
        this.notify(`Couldn't load ${robotId}'s history: ${String(error)}`);
      }
    }

    const subscription = handle.timeline.subscribe((event: any) => {
      const ev = event?.event;
      if (!ev) return;
      if (ev.type === 'replacement' || ev.type === 'subscription_restored') {
        void this.reload(robotId);
        return;
      }
      record.transcript = applyEvent(record.transcript, ev, ctx());
      if (ev.type === 'timeline' && ev.item?.type === 'assistant_message') this.scheduleSpeakingEnd(robotId);
      this.scheduleEmit();
    });
    record.unsubscribe = () => subscription?.();
    this.scheduleEmit();
  }

  private async reload(robotId: string): Promise<void> {
    const record = this.records.get(robotId);
    if (!record) return;
    await this.adopt(robotId, record.handle, record.handle.current?.() ?? null, {
      loadHistory: true,
      repo: record.repo,
      branch: record.branch,
      base: record.base,
    });
  }

  private onAgentUpdate(update: any): void {
    const agent = update?.agent;
    if (!agent?.id) return;
    for (const record of this.records.values()) {
      if (record.agentId !== agent.id) continue;
      record.agentStatus = agent.status ?? record.agentStatus;
      record.task = agent.title ?? record.task;
      record.cwd = agent.cwd ?? record.cwd;
      this.scheduleEmit();
    }
  }

  /** Re-publishes once Speaking should turn back into Thinking. */
  private scheduleSpeakingEnd(robotId: string): void {
    clearTimeout(this.speakingTimers.get(robotId));
    this.speakingTimers.set(
      robotId,
      setTimeout(() => this.scheduleEmit(), SPEAKING_WINDOW_MS + 50),
    );
  }

  /** At most ~20 snapshots a second while text streams. */
  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.publish(this.snapshot());
    }, 50);
  }
}

