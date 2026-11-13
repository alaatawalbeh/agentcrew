// Derives a robot's status from the engine's agent state and its transcript. Pure, so it is unit-tested.
import type { Status } from '@shared/types';
import type { AgentTranscript } from './normalize';

/** Reply text counts as "speaking" for this long after the last streamed chunk. */
export const SPEAKING_WINDOW_MS = 1500;

export interface StatusInput {
  hasAgent: boolean;
  /** Paseo agent status: initializing | idle | running | error | closed | … */
  agentStatus: string | null;
  transcript: AgentTranscript;
  paused: boolean;
  now: number;
}

export function deriveStatus(input: StatusInput): Status {
  const { hasAgent, agentStatus, transcript, paused, now } = input;
  if (!hasAgent) return 'sleeping';
  if (transcript.pendingApproval) return 'needs-approval';
  if (paused) return 'paused';
  const running = agentStatus === 'running' || agentStatus === 'initializing' || transcript.turn === 'running';
  if (running) {
    const lastItem = transcript.items.at(-1);
    const textFlowing = lastItem?.kind === 'agent' && lastItem.streaming === true && now - transcript.lastTextAt < SPEAKING_WINDOW_MS;
    return textFlowing ? 'speaking' : 'thinking';
  }
  if (agentStatus === 'error' || transcript.turn === 'failed') return 'stuck';
  return 'done';
}
