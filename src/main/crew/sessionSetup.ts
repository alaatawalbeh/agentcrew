// The main-process half of the New session dialog. Folders are only ever chosen in native dialogs shown here; the
// page gets an opaque token and a display path. Every request is checked again here, and anything that gives a
// robot more power than the defaults (allow rules, trusting the repo's own Claude settings) is confirmed in a native
// dialog the page can't answer for you.
import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
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

const MAX_TASK = 20_000;
const BROAD_RULE = /^(Bash|Edit|Write|Read|WebFetch|NotebookEdit)(\((\*|\*\*|\/\/\*\*)\))?$/;

const tilde = (path: string) => {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

/** "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-5[1m]" → "Sonnet 5 (1M context)". */
export function modelLabel(id: string): string {
  const long = id.endsWith('[1m]');
  const base = id.replace(/\[1m\]$/, '').replace(/^claude-/, '');
  const [family = base, ...version] = base.split('-');
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim();
  return long ? `${name} (1M context)` : name;
}

export class SessionSetup {
  private repos = new Map<string, RepoInfo>();
  private folders = new Map<string, string>();

  constructor(
    private readonly window: () => BrowserWindow | null,
    /** Development-only: a repo to use instead of showing the dialog (end-to-end tests). */
    private readonly testRepo?: string,
  ) {}

  private async chooseFolder(options: OpenDialogOptions): Promise<string | null> {
    const win = this.window();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async pickRepo(): Promise<RepoChoice | null> {
    const folder =
      this.testRepo ??
      (await this.chooseFolder({ title: 'Choose a repo for the new session', properties: ['openDirectory'] }));
    if (!folder) return null;
    const info = await repoInfo(folder);
    if (!info) throw new Error(`${tilde(folder)} isn't a git repository with at least one commit.`);
    const token = randomUUID();
    this.repos.set(token, info);
    return { token, path: tilde(info.root), name: info.name, branches: info.branches, currentBranch: info.currentBranch };
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
  async plan(request: unknown, options: { freeRobots: string[]; models: ModelOption[] }): Promise<SessionPlan | null> {
    if (!request || typeof request !== 'object') throw new Error('Invalid request.');
    const r = request as Record<string, unknown>;

    const robotId = typeof r.robotId === 'string' ? r.robotId : '';
    const robot = ROSTER_ROBOTS.find((x) => x.id === robotId);
    if (!robot) throw new Error('Unknown robot.');
    if (!options.freeRobots.includes(robotId)) throw new Error(`${robot.name} already has a session.`);

    const task = typeof r.task === 'string' ? r.task.trim() : '';
    if (!task || task.length > MAX_TASK) throw new Error('The task must be between 1 and 20,000 characters.');

    const repo = typeof r.repoToken === 'string' ? this.repos.get(r.repoToken) : undefined;
    if (!repo) throw new Error('Choose the repo again.');
    const baseBranch = typeof r.baseBranch === 'string' ? r.baseBranch : '';
    if (!repo.branches.includes(baseBranch)) throw new Error(`${baseBranch || 'That branch'} isn't a branch of ${repo.name}.`);

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
      baseBranch,
      model,
      modeId,
      extraFolders,
      allowRules,
      trustProjectSettings,
    };
  }
}
