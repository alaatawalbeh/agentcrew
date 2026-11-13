import { ROSTER_ROBOTS } from '@shared/crew';
import { FACES, type FaceId } from './faces';

export interface Robot {
  id: string;
  name: string;
  /** The design's static pixel face (no longer drawn; kept from the SVG for reference). */
  face: FaceId;
  /** The robot's colour: its animated face and its name above messages. */
  accent: string;
}

const STATIC_FACE: Readonly<Record<string, FaceId>> = {
  atlas: 'atlas',
  vega: 'vega',
  orin: 'orin',
  nova: 'nova',
  kit: 'kit',
  sable: 'sable',
};

export const ROSTER: Readonly<Record<string, Robot>> = Object.fromEntries(
  ROSTER_ROBOTS.map((r) => [r.id, { id: r.id, name: r.name, accent: r.hue, face: STATIC_FACE[r.id] ?? 'sable' }]),
);

const FALLBACK: Robot = { id: 'unknown', name: 'Agent', face: 'sable', accent: '#a39684' };

export function robotFor(id: string): Robot {
  return ROSTER[id] ?? FALLBACK;
}

/** The static face's palette. */
export function paletteFor(robot: Robot): string[] {
  return [...FACES[robot.face].palette];
}
