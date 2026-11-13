import { describe, expect, it } from 'vitest';
import { STATUS_LABEL } from '../src/shared/types';
import { FACE_STATE } from '../src/renderer/src/robots/faceState';
import { FACES } from '../src/renderer/src/robots/faces';
import { paletteFor, ROSTER } from '../src/renderer/src/robots/roster';

describe('animated faces', () => {
  it('gives every status its own face state', () => {
    const states = new Set(['idle', 'ready', 'thinking', 'speaking', 'approval', 'error', 'done']);
    for (const status of Object.keys(STATUS_LABEL)) {
      expect(states.has(FACE_STATE[status as keyof typeof FACE_STATE]), status).toBe(true);
    }
    expect(new Set(Object.values(FACE_STATE)).size).toBe(Object.keys(STATUS_LABEL).length);
  });

  it('gives every robot a valid colour for its face', () => {
    for (const robot of Object.values(ROSTER)) expect(robot.accent, robot.id).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('robot faces', () => {
  it('has the six faces from the design', () => {
    expect(Object.keys(FACES).sort()).toEqual(['atlas', 'kit', 'nova', 'orin', 'sable', 'vega']);
  });

  it('keeps every pixel run inside its grid and palette', () => {
    for (const [id, art] of Object.entries(FACES)) {
      expect(art.width, id).toBeLessThanOrEqual(18);
      expect(art.height, id).toBeLessThanOrEqual(18);
      for (const [x, y, w, h, c] of art.runs) {
        expect(x + w, id).toBeLessThanOrEqual(art.width);
        expect(y + h, id).toBeLessThanOrEqual(art.height);
        expect(c, id).toBeLessThan(art.palette.length);
      }
    }
  });

  it('gives every roster robot a real face and full palette', () => {
    for (const robot of Object.values(ROSTER)) {
      expect(FACES[robot.face], robot.id).toBeDefined();
      expect(paletteFor(robot).every((c) => /^#[0-9a-f]{6}$/i.test(c)), robot.id).toBe(true);
    }
  });
});
