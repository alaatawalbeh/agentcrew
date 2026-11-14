// The robot roster, shared by the main process and the UI. The first six are the crew from the design and always show
// in the sidebar; the others join it when you give them a session.

export interface RobotInfo {
  id: string;
  name: string;
  /** The robot's colour: its animated face and its name above messages. */
  hue: string;
}

export const ROSTER_ROBOTS: readonly RobotInfo[] = [
  { id: 'atlas', name: 'Atlas', hue: '#f0a64a' },
  { id: 'vega', name: 'Vega', hue: '#f3b946' },
  { id: 'orin', name: 'Orin', hue: '#5fb3a1' },
  { id: 'nova', name: 'Nova', hue: '#ee8c79' },
  { id: 'kit', name: 'Kit', hue: '#9cbf6b' },
  { id: 'sable', name: 'Sable', hue: '#8a9bb0' },
  { id: 'juno', name: 'Juno', hue: '#b79be6' },
  { id: 'rook', name: 'Rook', hue: '#6fb7e0' },
  { id: 'lyra', name: 'Lyra', hue: '#e58fc8' },
  { id: 'fern', name: 'Fern', hue: '#6fcf97' },
  { id: 'ion', name: 'Ion', hue: '#8b93ff' },
  { id: 'tess', name: 'Tess', hue: '#d6c38f' },
];

const DEFAULT_CREW_IDS = new Set(['atlas', 'vega', 'orin', 'nova', 'kit', 'sable']);

/** The default crew: the six robots from the design, always shown. */
export const CREW: readonly RobotInfo[] = ROSTER_ROBOTS.filter((r) => DEFAULT_CREW_IDS.has(r.id));

export const isRosterRobot = (id: string) => ROSTER_ROBOTS.some((r) => r.id === id);
export const isDefaultCrew = (id: string) => DEFAULT_CREW_IDS.has(id);
/** The robot's own name from the roster (before you rename it). */
export const defaultNameOf = (id: string) => ROSTER_ROBOTS.find((r) => r.id === id)?.name ?? id;

/** A name you give a robot: 1–24 characters, starting with a letter or digit. */
export const MAX_ROBOT_NAME = 24;
export const ROBOT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '._-]{0,23}$/u;
/** Trims a typed name and squeezes runs of spaces. */
export const tidyName = (text: string) => text.trim().replace(/\s+/g, ' ');

export const sessionIdFor = (robotId: string) => `s-${robotId}`;
export const robotIdFor = (sessionId: string) => sessionId.replace(/^s-/, '');

/** Engine labels Agent Crew puts on its agents. */
export const ROBOT_LABEL = 'crew.robot';
export const BASE_LABEL = 'crew.base';
export const BRANCH_LABEL = 'crew.branch';
export const REPO_LABEL = 'crew.repo';
/** "folder" when the robot works straight in a folder that isn't a git repo (no worktree, no branch). */
export const WORKSPACE_LABEL = 'crew.workspace';

/** What the renderer is told about the engine. */
export type EngineState =
  | { state: 'starting' }
  | { state: 'ready'; claude: 'available' | 'missing' | 'unknown'; claudeDetail?: string }
  | { state: 'unavailable'; detail: string }
  | { state: 'stopped' }
  | { state: 'sample' };

/** Permission modes offered in the New session dialog (the engine's Claude modes; never bypass). */
export const MODES: readonly { id: string; label: string; detail: string }[] = [
  { id: 'auto', label: 'Auto', detail: 'Claude Code reviews each action and asks you when it holds one back.' },
  { id: 'default', label: 'Always ask', detail: 'Asks the first time each tool is used.' },
  { id: 'acceptEdits', label: 'Accept edits', detail: 'File edits run freely; commands ask.' },
  { id: 'plan', label: 'Plan only', detail: 'Reads and plans, changes nothing.' },
];

/** A folder chosen in a native dialog run by the main process. The page only ever holds its token. */
export interface FolderChoice {
  token: string;
  /** For display only, with ~ for the home folder. */
  path: string;
}

/** The folder a robot works in: a git repo (it gets its own worktree) or a plain folder (it works in place). */
export interface RepoChoice extends FolderChoice {
  name: string;
  git: boolean;
  /** Empty for a plain folder. */
  branches: string[];
  currentBranch: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

/** A Claude Code permission rule: a tool name, optionally with a specifier in parentheses, e.g. Bash(npm test *). */
export const ALLOW_RULE = /^[A-Z][A-Za-z0-9_]{0,40}(\([^()\n]{1,300}\))?$/;
export const MAX_EXTRA_FOLDERS = 8;
export const MAX_ALLOW_RULES = 20;

export interface NewSessionRequest {
  robotId: string;
  task: string;
  repoToken: string;
  /** Empty for a plain folder. */
  baseBranch: string;
  model: string;
  modeId: string;
  folderTokens: string[];
  allowRules: string[];
  trustProjectSettings: boolean;
}
