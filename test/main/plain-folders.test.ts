import { describe, expect, it, vi } from 'vitest';

// sessionSetup.ts shows native dialogs; the checks tested here never reach them.
vi.mock('electron', () => ({ dialog: {} }));

const { plainFolderProblem, plainFolderQuestion } = await import('../../src/main/crew/sessionSetup');
const { folderChanges } = await import('../../src/main/crew/folderChanges');
const { parseChanges } = await import('../../src/renderer/src/components/changes');

const HOME = '/home/me';
const DATA = '/home/me/.config/agent-crew';

describe('plain folders', () => {
  it('lets a robot work in a project folder', () => {
    expect(plainFolderProblem('/home/me/sites/my-site', HOME, DATA)).toBeNull();
    expect(plainFolderProblem('/run/media/me/Data/site', HOME, DATA)).toBeNull();
  });

  it('never in the whole disk, the home folder or above it, or the app\'s own data', () => {
    expect(plainFolderProblem('/', HOME, DATA)).toMatch(/whole disk/);
    expect(plainFolderProblem('/home/me', HOME, DATA)).toMatch(/home folder/);
    expect(plainFolderProblem('/home/me/', HOME, DATA)).toMatch(/home folder/);
    expect(plainFolderProblem('/home', HOME, DATA)).toMatch(/home folder/);
    expect(plainFolderProblem('/home/me/.config', HOME, DATA)).toMatch(/Agent Crew's own data/);
    expect(plainFolderProblem('/home/me/.config/agent-crew/worktrees/x', HOME, DATA)).toMatch(/Agent Crew's own data/);
  });

  it('asks first, saying the files change in place and who else works there', () => {
    const q = plainFolderQuestion({ folder: '/srv/site', robotName: 'Kit', sharedWith: ['Atlas', 'Vega'] });
    expect(q.message).toBe('Work directly in site?');
    expect(q.buttons).toEqual(['Work in this folder', 'Cancel']);
    expect(q.detail).toContain("/srv/site isn't a git repository, so Kit can't get its own copy");
    expect(q.detail).toContain('Kit will change your files in place');
    expect(q.detail).toContain('Atlas and Vega already work in this folder');
  });

  it('shows a robot\'s own file edits as its changes', () => {
    const text = folderChanges(
      [
        { kind: 'tool', id: '1', tool: 'Read', target: 'index.html', state: 'ok' },
        {
          kind: 'tool',
          id: '2',
          tool: 'Edit',
          target: 'index.html',
          state: 'ok',
          diff: [
            { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
            { kind: 'ctx', text: '<h1>' },
            { kind: 'del', text: 'Old' },
            { kind: 'add', text: 'New' },
          ],
        },
        { kind: 'tool', id: '3', tool: 'Write', target: 'notes.md', state: 'ok', diff: [{ kind: 'add', text: '# Notes' }] },
        { kind: 'tool', id: '4', tool: 'Edit', target: 'gone.md', state: 'error', diff: [{ kind: 'add', text: 'x' }] },
      ],
      'my-site',
    );
    const parsed = parseChanges(text);
    expect(parsed.files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['index.html', 1, 1],
      ['notes.md', 1, 0],
    ]);
    expect(parsed.notes.join('\n')).toContain("my-site isn't a git repository");
    expect(parseChanges(folderChanges([], 'site')).notes[0]).toMatch(/^No file edits yet\./);
  });
});
