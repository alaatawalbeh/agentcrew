// The main-process half of the New session dialog. Folders are only ever chosen in native dialogs shown here; the
// page gets an opaque token and a display path. Every request is checked again here, and anything that gives a
// robot more power than the defaults (allow rules, trusting the repo's own Claude settings, working straight in a
// folder that isn't a git repo) is confirmed in a native dialog the page can't answer for you.
import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import {
  ALLOW_RULE,
  MAX_ALLOW_RULES,
  MAX_EXTRA_FOLDERS,
  MODES,
  ROSTER_ROBOTS,
  type FolderChoice,
  type ModelOption,
  type RepoChoice,
} from '@shared/crew';
import { repoInfo, type RepoInfo } from './git';
import type { SessionPlan } from './CrewManager';

const tilde = (path: string) => {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

/** Where a robot works: a git repo (it gets its own worktree) or a plain folder (`repo` null: it works in place). */
export interface Workspace {
  root: string;
  name: string;
  repo: RepoInfo | null;
}

const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/**
 * Why a robot can't work straight in this folder, or null if it can. Never the whole disk, your home folder or
 * anything above it, or Agent Crew's own data (the engine's records and the robots' worktrees).
 */
export function plainFolderProblem(folder: string, home: string, appData: string): string | null {
  const path = resolve(folder);
  if (path === '/') return 'Pick a project folder, not the whole disk.';
  if (inside(home, path)) return 'Pick a project folder, not your whole home folder.';
  if (inside(path, appData) || inside(appData, path)) return "That folder holds Agent Crew's own data. Pick a project folder.";
  return null;
}

/** The text of the confirmation for working straight in a plain folder. */
export function plainFolderQuestion(options: { folder: string; robotName?: string; sharedWith: string[] }): MessageBoxOptions {
  const who = options.robotName ?? 'The robot';
  const shared = options.sharedWith;
  const lines = [
    `${tilde(options.folder)} isn't a git repository, so ${options.robotName ?? 'the robot'} can't get its own copy to work in.`,
    '',
    `${who} will change your files in place as it works. There's no branch to review first, and nothing to throw away if you don't like the result.`,
  ];
  if (shared.length) {
    const names = shared.length === 1 ? shared[0] : `${shared.slice(0, -1).join(', ')} and ${shared.at(-1)}`;
    lines.push('', `${names} already ${shared.length === 1 ? 'works' : 'work'} in this folder, on the same files.`);
  }
  return {
    type: 'question',
    buttons: ['Work in this folder', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Agent Crew',
    message: `Work directly in ${basename(options.folder) || options.folder}?`,
    detail: lines.join('\n'),
  };
}

const MAX_TASK = 20_000;
const BROAD_RULE = /^(Bash|Edit|Write|Read|WebFetch|NotebookEdit)(\((\*|\*\*|\/\/\*\*)\))?$/;


/** "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-5[1m]" → "Sonnet 5 (1M context)". */
export function modelLabel(id: string): string {
  const long = id.endsWith('[1m]');
  const base = id.replace(/\[1m\]$/, '').replace(/^claude-/, '');
  const [family = base, ...version] = base.split('-');
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim();
  return long ? `${name} (1M context)` : name;
}

export class SessionSetup {
  private repos = new Map<string, Workspace>();
  private folders = new Map<string, string>();

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly options: {
      /** Agent Crew's data folder: never a robot's plain folder. */
      appDataDir: string;
      /** The names of robots already working straight in this folder. */
      robotsWorkingIn: (folder: string) => string[];
      /** Development-only: a folder to use instead of showing the dialog, already confirmed (end-to-end tests). */
      testRepo?: string;
    },
  ) {}

  private async ask(box: MessageBoxOptions): Promise<number> {
    const win = this.window();
    return (win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)).response;
  }

  private async chooseFolder(options: OpenDialogOptions): Promise<string | null> {
    const win = this.window();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  /**
   * Shows the folder picker for a robot's work (unless a test folder is set). See `workspace` for what happens to a
   * folder that isn't a git repo.
   */
  async chooseWorkspace(robotName?: string): Promise<Workspace | null> {
    const folder =
      this.options.testRepo ??
      (await this.chooseFolder({
        title: robotName ? `Choose a project folder for ${robotName}` : 'Choose a project folder for the new session',
        buttonLabel: robotName ? `Give ${robotName} this folder` : 'Choose',
        properties: ['openDirectory'],
      }));
    return folder ? this.workspace(folder, robotName) : null;
  }

  /**
   * A git repo with at least one commit, or else a plain folder the robot works in directly, once you've said yes
   * in a native dialog. Throws for folders a robot may never work in directly. Null if you cancel.
   */
  async workspace(folder: string, robotName?: string): Promise<Workspace | null> {
    const repo = await repoInfo(folder);
    if (repo) return { root: repo.root, name: repo.name, repo };
    const root = await realpath(folder).catch(() => resolve(folder));
    const problem = plainFolderProblem(root, homedir(), this.options.appDataDir);
    if (problem) throw new Error(problem);
    if (!this.options.testRepo) {
      const question = plainFolderQuestion({ folder: root, robotName, sharedWith: this.options.robotsWorkingIn(root) });
      if ((await this.ask(question)) !== 0) return null;
    }
    return { root, name: basename(root) || root, repo: null };
  }

  async pickRepo(): Promise<RepoChoice | null> {
    const ws = await this.chooseWorkspace();
    if (!ws) return null;
    const token = randomUUID();
    this.repos.set(token, ws);
    return {
      token,
      path: tilde(ws.root),
      name: ws.name,
      git: !!ws.repo,
      branches: ws.repo?.branches ?? [],
      currentBranch: ws.repo?.currentBranch ?? '',
    };
  }

  async pickFolder(): Promise<FolderChoice | null> {
    const folder = await this.chooseFolder({ title: 'Give the robot access to a folder', properties: ['openDirectory'] });
    if (!folder) return null;
    const token = randomUUID();
    this.folders.set(token, folder);
    return { token, path: tilde(folder) };
  }

  /**
   * Checks a New session request from the page and turns it into a plan. Returns null if you cancel the
   * confirmation. Throws with a readable message when something doesn't check out.
   */
  async plan(
    request: unknown,
    options: { freeRobots: string[]; models: ModelOption[]; nameOf: (robotId: string) => string },
  ): Promise<SessionPlan | null> {
    if (!request || typeof request !== 'object') throw new Error('Invalid request.');
    const r = request as Record<string, unknown>;

    const robotId = typeof r.robotId === 'string' ? r.robotId : '';
    if (!ROSTER_ROBOTS.some((x) => x.id === robotId)) throw new Error('Unknown robot.');
    const robot = { id: robotId, name: options.nameOf(robotId) };
    if (!options.freeRobots.includes(robotId)) throw new Error(`${robot.name} already has a session.`);

    const task = typeof r.task === 'string' ? r.task.trim() : '';
    if (!task || task.length > MAX_TASK) throw new Error('The task must be between 1 and 20,000 characters.');

    const repo = typeof r.repoToken === 'string' ? this.repos.get(r.repoToken) : undefined;
    if (!repo) throw new Error('Choose the folder again.');
    const baseBranch = repo.repo && typeof r.baseBranch === 'string' ? r.baseBranch : '';
    if (repo.repo && !repo.repo.branches.includes(baseBranch)) {
      throw new Error(`${baseBranch || 'That branch'} isn't a branch of ${repo.name}.`);
    }

    const model = typeof r.model === 'string' ? r.model : '';
    if (!options.models.some((m) => m.id === model)) throw new Error('Unknown model.');
    const modeId = typeof r.modeId === 'string' ? r.modeId : '';
    if (!MODES.some((m) => m.id === modeId)) throw new Error('Unknown permission mode.');

    const folderTokens = Array.isArray(r.folderTokens) ? r.folderTokens : [];
    if (folderTokens.length > MAX_EXTRA_FOLDERS) throw new Error(`At most ${MAX_EXTRA_FOLDERS} extra folders.`);
    const extraFolders = folderTokens.map((token) => {
      const path = typeof token === 'string' ? this.folders.get(token) : undefined;
      if (!path) throw new Error('Choose the extra folders again.');
      return path;
    });

    const rawRules = Array.isArray(r.allowRules) ? r.allowRules : [];
    if (rawRules.length > MAX_ALLOW_RULES) throw new Error(`At most ${MAX_ALLOW_RULES} allow rules.`);
    const allowRules = rawRules.map((rule) => (typeof rule === 'string' ? rule.trim() : '')).filter(Boolean);
    for (const rule of allowRules) {
      if (!ALLOW_RULE.test(rule)) throw new Error(`"${rule}" isn't a permission rule. Use a form like Bash(npm test *).`);
    }
    const trustProjectSettings = r.trustProjectSettings === true;

    // Anything that loosens the defaults needs a yes from you in a dialog the page can't answer.
    if (allowRules.length || trustProjectSettings || extraFolders.length) {
      const lines: string[] = [];
      if (allowRules.length) {
        lines.push('Run without asking:', ...allowRules.map((rule) => `  • ${rule}${BROAD_RULE.test(rule) ? '   ← allows every use of this tool' : ''}`));
      }
      if (extraFolders.length) lines.push('', 'Work in these folders too:', ...extraFolders.map((f) => `  • ${tilde(f)}`));
      if (trustProjectSettings) {
        lines.push('', `Load ${repo.name}'s own Claude settings: its hooks and allow rules will apply to ${robot.name}.`);
      }
      const box: MessageBoxOptions = {
        type: 'warning',
        buttons: [`Start ${robot.name}`, 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Agent Crew',
        message: `Give ${robot.name} these extra powers?`,
        detail: lines.join('\n'),
      };
      const win = this.window();
      const answer = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
      if (answer.response !== 0) return null;
    }

    return {
      robotId,
      task,
      repoRoot: repo.root,
      repoName: repo.name,
      plain: !repo.repo,
      baseBranch,
      model,
      modeId,
      extraFolders,
      allowRules,
      trustProjectSettings,
    };
  }
}
