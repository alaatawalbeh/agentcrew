// The New session dialog's pure helpers.
import { ALLOW_RULE, ROSTER_ROBOTS } from '@shared/crew';
import type { SessionView } from '@shared/types';

/** Robots without a session: the sleeping default crew and every roster robot that hasn't joined yet. */
export function freeRobotIds(sessions: SessionView[]): string[] {
  return ROSTER_ROBOTS.filter((robot) => {
    const session = sessions.find((s) => s.robotId === robot.id);
    return !session || session.status === 'sleeping';
  }).map((robot) => robot.id);
}

/** The allow rules typed one per line, and the lines that aren't valid rules. */
export function readRules(text: string): { rules: string[]; invalid: string[] } {
  const rules = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { rules, invalid: rules.filter((rule) => !ALLOW_RULE.test(rule)) };
}
