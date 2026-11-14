import { describe, expect, it } from 'vitest';
import { STATUS_LABEL } from '../src/shared/types';
import { FACE_STATE } from '../src/renderer/src/robots/faceState';
import { FACES } from '../src/renderer/src/robots/faces';
import { PERSONALITIES, personalityFor } from '../src/renderer/src/robots/personality';
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

describe('robot personalities', () => {
  it('gives every roster robot its own personality', () => {
    for (const id of Object.keys(ROSTER)) expect(PERSONALITIES[id], id).toBeDefined();
    expect(personalityFor('nobody')).toEqual(personalityFor(null));
  });

  it('makes the six robots from the design differ in every way they show it', () => {
    const six = ['atlas', 'vega', 'orin', 'nova', 'kit', 'sable'].map((id) => PERSONALITIES[id]!);
    const distinct = (key: keyof (typeof six)[number]) => new Set(six.map((p) => JSON.stringify(p[key]))).size;
    expect(distinct('accessory')).toBe(6);
    expect(distinct('eyes')).toBe(6);
    expect(distinct('think')).toBeGreaterThanOrEqual(5);
    expect(distinct('done')).toBeGreaterThanOrEqual(4);
    expect(distinct('alert')).toBeGreaterThanOrEqual(4);
    expect(distinct('sleep')).toBeGreaterThanOrEqual(4);
    expect(distinct('tempo')).toBeGreaterThanOrEqual(5);
  });

  it('keeps every robot in sensible ranges', () => {
    for (const [id, p] of Object.entries(PERSONALITIES)) {
      expect(p.shape, id).toBeGreaterThanOrEqual(1.5);
      expect(p.shape, id).toBeLessThanOrEqual(4);
      expect(p.tempo, id).toBeGreaterThan(0.5);
      expect(p.tempo, id).toBeLessThan(1.5);
      expect(p.blinkEvery[0], id).toBeLessThan(p.blinkEvery[1]);
      expect(p.fidgetEvery[0], id).toBeLessThan(p.fidgetEvery[1]);
      expect(p.fidgets.length, id).toBeGreaterThan(0);
    }
  });
});
