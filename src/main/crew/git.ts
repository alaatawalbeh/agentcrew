// The few git operations Agent Crew runs itself (the engine creates worktrees). Always execFile with an argument
// list, never a shell.
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = async (cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024) =>
  (await run('git', ['-C', cwd, ...args], { maxBuffer })).stdout;

export interface RepoInfo {
  root: string;
  name: string;
  branches: string[];
  currentBranch: string;
}

/** The repo containing `folder`, if it is a git repo with at least one commit. */
export async function repoInfo(folder: string): Promise<RepoInfo | null> {
  try {
    const root = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
    await git(root, ['rev-parse', '--verify', 'HEAD']);
    const currentBranch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const branches = (await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
    return { root, name: root.split('/').pop() ?? root, branches, currentBranch };
  } catch {
    return null;
  }
}

const MAX_DIFF_BYTES = 400 * 1024;
const MAX_NEW_FILES_SHOWN = 50;
const MAX_NEW_FILE_BYTES = 200 * 1024;

/**
 * A new, untracked file as a diff against nothing. Symlinks and anything that isn't a plain file are only listed, so
 * the view never follows a link out of the worktree. (`git diff --no-index` exits 1 when there is a difference.)
 */
async function newFileDiff(worktree: string, file: string): Promise<string | null> {
  const st = await lstat(join(worktree, file)).catch(() => null);
  if (!st?.isFile() || st.size > MAX_NEW_FILE_BYTES) return null;
  try {
    return await git(worktree, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', file]);
  } catch (error) {
    const out = (error as { stdout?: unknown }).stdout;
    return typeof out === 'string' && out.startsWith('diff --git') ? out : null;
  }
}

/** What a robot changed in its worktree: the diff against its base branch (committed or not) and its new files. */
export async function worktreeChanges(worktree: string, base: string | null): Promise<string> {
  const against = base && /^[\w./-]+$/.test(base) ? base : 'HEAD';
  const [diff, untracked] = await Promise.all([
    git(worktree, ['diff', '--no-color', '--no-ext-diff', against, '--'], MAX_DIFF_BYTES * 2).catch(() => ''),
    git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => ''),
  ]);
  const newFiles = untracked.split('\0').filter(Boolean);
  const shown = await Promise.all(newFiles.slice(0, MAX_NEW_FILES_SHOWN).map((f) => newFileDiff(worktree, f)));
  const listed = newFiles.filter((_, i) => !shown[i]);

  let text = [diff.trim() ? diff : '', ...shown.filter((d): d is string => !!d)].join('');
  if (text.length > MAX_DIFF_BYTES) text = `${text.slice(0, MAX_DIFF_BYTES)}\n… (diff cut at 400 KB)`;
  const parts = [];
  if (text.trim()) parts.push(text.trimEnd());
  if (listed.length) parts.push(`New files not shown (links, large or binary files):\n${listed.map((f) => `  ${f}`).join('\n')}`);
  return parts.join('\n\n') || `No changes against ${against}.`;
}

/** Whether a worktree has uncommitted changes or untracked files. */
export async function isWorktreeDirty(worktree: string): Promise<boolean> {
  const status = await git(worktree, ['status', '--porcelain']).catch(() => '');
  return status.trim().length > 0;
}

/** Removes a linked worktree (never the main checkout). Its branch is kept: it may hold the robot's commits. */
export async function removeWorktree(worktree: string, force: boolean): Promise<void> {
  const commonDir = (await git(worktree, ['rev-parse', '--git-common-dir'])).trim();
  const absoluteCommon = isAbsolute(commonDir) ? commonDir : resolve(worktree, commonDir);
  const mainRoot = dirname(absoluteCommon);
  const top = (await git(worktree, ['rev-parse', '--show-toplevel'])).trim();
  if (top === mainRoot) throw new Error('Refusing to remove the main checkout.');
  await git(mainRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), worktree]);
}
