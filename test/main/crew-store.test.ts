import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrewStore, parseCrewFile } from '../../src/main/crew/crewStore';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-crew-store-'));
  file = join(dir, 'crew.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('crew store', () => {
  it('starts with the six robots from the design', () => {
    const store = new CrewStore(file);
    expect(store.members()).toEqual(['atlas', 'vega', 'orin', 'nova', 'kit', 'sable']);
    expect(store.nameOf('atlas')).toBe('Atlas');
  });

  it('keeps who joined, who left and their names across restarts, in an owner-only file', () => {
    const store = new CrewStore(file);
    store.add('rook');
    store.remove('vega');
    store.rename('atlas', 'Captain');
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = new CrewStore(file);
    expect(again.members()).toEqual(['atlas', 'orin', 'nova', 'kit', 'sable', 'rook']);
    expect(again.nameOf('atlas')).toBe('Captain');
  });

  it('forgets a robot\'s name when it leaves', () => {
    const store = new CrewStore(null);
    store.rename('kit', 'Sparky');
    store.remove('kit');
    expect(store.isMember('kit')).toBe(false);
    expect(store.nameOf('kit')).toBe('Kit');
  });

  it('refuses names that are taken, belong to another robot, or have odd characters', () => {
    const store = new CrewStore(null);
    store.rename('atlas', 'Captain');
    expect(() => store.rename('vega', 'captain')).toThrow('Another robot is already called Captain.');
    expect(() => store.rename('vega', 'Rook')).toThrow("Rook is another robot's name.");
    expect(() => store.rename('vega', '<img src=x>')).toThrow('Use letters, numbers');
    expect(() => store.rename('vega', 'x'.repeat(25))).toThrow('at most 24 characters');
    expect(() => store.rename('nobody', 'Hi')).toThrow('Unknown robot.');
    // An empty name, or its own roster name, gives back the roster name.
    store.rename('atlas', '   ');
    expect(store.nameOf('atlas')).toBe('Atlas');
  });

  it('tells listeners about every change', () => {
    const store = new CrewStore(null);
    let changes = 0;
    store.onChange(() => changes++);
    store.add('lyra');
    store.rename('lyra', 'Lyra Two');
    store.remove('lyra');
    expect(changes).toBe(3);
  });

  it('keeps only valid entries from a damaged or hand-edited file', () => {
    expect(parseCrewFile('not json').members).toHaveLength(6);
    const parsed = parseCrewFile(
      JSON.stringify({ members: ['atlas', 'atlas', 'ghost', 7], names: { atlas: 'Ok name', vega: '<script>', ghost: 'Boo' } }),
    );
    expect(parsed).toEqual({ version: 1, members: ['atlas'], names: { atlas: 'Ok name' } });
    writeFileSync(file, '{"members": []}');
    expect(new CrewStore(file).members()).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('{"members": []}');
  });
});
