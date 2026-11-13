import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleBridge } from '../src/renderer/src/bridge/sample';
import { parseChanges } from '../src/renderer/src/components/changes';
import { freeRobotIds, readRules } from '../src/renderer/src/components/newSession';
import type { SessionView } from '../src/shared/types';

const byId = (sessions: SessionView[], id: string) => sessions.find((x) => x.id === id);

describe('parseChanges', () => {
  const diff = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    'index 1111111..2222222 100644',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -1,3 +1,4 @@',
    ' import x from "x";',
    '-export const a = 1;',
    '+export const a = 2;',
    '+export const b = 3;',
    ' ',
    'diff --git a/docs/new.md b/docs/new.md',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/docs/new.md',
    '@@ -0,0 +1 @@',
    '+# New',
    '\\ No newline at end of file',
    'diff --git a/logo.png b/logo.png',
    'index 4444444..5555555 100644',
    'Binary files a/logo.png and b/logo.png differ',
    '',
    '',
    'New files not yet added to git:',
    '  notes.txt',
  ].join('\n');

  it('splits the diff into files with line counts', () => {
    const { files, notes } = parseChanges(diff);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ['src/auth.ts', 'modified', 2, 1],
      ['docs/new.md', 'new', 1, 0],
      ['logo.png', 'modified', 0, 0],
    ]);
    expect(files[2]?.binary).toBe(true);
    expect(files[0]?.lines.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'add', 'ctx']);
    expect(notes).toEqual(['New files not yet added to git:\n  notes.txt']);
  });

  it('keeps plain messages as notes', () => {
    expect(parseChanges('No changes against main.')).toEqual({ files: [], notes: ['No changes against main.'] });
  });

  it('follows renames', () => {
    const { files } = parseChanges(
      ['diff --git a/old.ts b/new.ts', 'similarity index 90%', 'rename from old.ts', 'rename to new.ts'].join('\n'),
    );
    expect(files[0]).toMatchObject({ path: 'new.ts', status: 'renamed' });
  });
});

describe('New session form', () => {
  it('reads allow rules one per line and flags the bad ones', () => {
    expect(readRules('Bash(npm test *)\n\n  Read(src/**)  \nrm -rf /\nWebFetch(domain:example.com)')).toEqual({
      rules: ['Bash(npm test *)', 'Read(src/**)', 'rm -rf /', 'WebFetch(domain:example.com)'],
      invalid: ['rm -rf /'],
    });
  });

  it('offers the robots without a session', () => {
    const sessions = createSampleBridge('full').snapshot().sessions;
    expect(freeRobotIds(sessions)).toEqual(['sable', 'rook', 'lyra', 'fern', 'ion', 'tess']);
  });
});

describe('sample bridge: sessions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts a roster robot in a repo picked in the dialog, then archives it', async () => {
    const bridge = createSampleBridge('full');
    const repo = await bridge.pickRepo();
    const [model] = await bridge.listModels();
    expect(repo?.branches).toContain('main');
    const { started } = await bridge.createSession({
      robotId: 'rook',
      task: 'Add search to the notes list\nKeep it fast.',
      repoToken: repo!.token,
      baseBranch: 'main',
      model: model!.id,
      modeId: 'auto',
      folderTokens: [],
      allowRules: [],
      trustProjectSettings: false,
    });
    expect(started).toBe(true);
    const rook = byId(bridge.snapshot().sessions, 's-rook');
    expect(rook).toMatchObject({ task: 'Add search to the notes list', repo: 'notes-app', branch: 'crew-rook-add-search-to-the-notes' });
    await vi.runAllTimersAsync();
    expect(byId(bridge.snapshot().sessions, 's-rook')?.status).toBe('done');

    expect(await bridge.archive('s-rook')).toEqual({ archived: true });
    expect(byId(bridge.snapshot().sessions, 's-rook')).toBeUndefined();
  });

  it('refuses a robot that already has a session, or a repo it never offered', async () => {
    const bridge = createSampleBridge('full');
    const repo = await bridge.pickRepo();
    const request = {
      robotId: 'atlas',
      task: 'Anything',
      repoToken: repo!.token,
      baseBranch: 'main',
      model: 'claude-opus-5-5',
      modeId: 'auto',
      folderTokens: [],
      allowRules: [],
      trustProjectSettings: false,
    };
    await expect(bridge.createSession(request)).rejects.toThrow('Atlas already has a session.');
    await expect(bridge.createSession({ ...request, robotId: 'sable', repoToken: 'forged' })).rejects.toThrow('Choose a repo first.');
  });

  it('puts a default robot back to sleep when archived, and shows its changes as a diff', async () => {
    const bridge = createSampleBridge('full');
    const diff = parseChanges(await bridge.changes('s-atlas'));
    expect(diff.files.length).toBeGreaterThan(0);
    expect(diff.files[0]?.added).toBeGreaterThan(0);
    await bridge.archive('s-atlas');
    expect(byId(bridge.snapshot().sessions, 's-atlas')).toMatchObject({ status: 'sleeping', task: null, items: [] });
    expect(await bridge.changes('s-atlas')).toBe('This robot has no worktree yet.');
  });
});
