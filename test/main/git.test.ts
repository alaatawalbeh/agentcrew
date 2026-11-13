import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseChanges } from '../../src/renderer/src/components/changes';
import { isWorktreeDirty, removeWorktree, repoInfo, worktreeChanges } from '../../src/main/crew/git';

let dir: string;
let repo: string;
let tree: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-crew-git-'));
  repo = join(dir, 'repo');
  tree = join(dir, 'tree');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  git(repo, 'worktree', 'add', '-q', '-b', 'crew-atlas-test', tree, 'main');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('git helpers', () => {
  it('reads a repo and its branches', async () => {
    expect(await repoInfo(repo)).toMatchObject({ name: 'repo', currentBranch: 'main', branches: ['crew-atlas-test', 'main'] });
    expect(await repoInfo(dir)).toBeNull();
  });

  it("shows a robot's edits, new files as diffs, and only lists links", async () => {
    expect(await worktreeChanges(tree, 'main')).toBe('No changes against main.');
    writeFileSync(join(tree, 'app.ts'), 'export const a = 2;\n');
    writeFileSync(join(tree, 'NOTES.md'), '# Notes\nhello\n');
    symlinkSync('/etc/hostname', join(tree, 'link'));
    expect(await isWorktreeDirty(tree)).toBe(true);

    const text = await worktreeChanges(tree, 'main');
    const { files, notes } = parseChanges(text);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ['app.ts', 'modified', 1, 1],
      ['NOTES.md', 'new', 2, 0],
    ]);
    expect(notes).toEqual(['New files not shown (links, large or binary files):\n  link']);
  });

  it('removes a linked worktree but keeps its branch, and never the main checkout', async () => {
    await expect(removeWorktree(repo, true)).rejects.toThrow('Refusing to remove the main checkout.');
    await removeWorktree(tree, true);
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, 'branch', '--list', 'crew-atlas-test').trim()).toContain('crew-atlas-test');
  });
});
