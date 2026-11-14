// Who is in your crew and what you've called them, kept in crew.json in the app's data folder (owner-only). A new
// install starts with the six robots from the design. A robot joins when you give it a session and leaves when you
// delete it; deleting also forgets the name you gave it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CREW,
  defaultNameOf,
  isRosterRobot,
  MAX_ROBOT_NAME,
  ROBOT_NAME,
  ROSTER_ROBOTS,
  tidyName,
} from '@shared/crew';

interface CrewFile {
  version: 1;
  members: string[];
  names: Record<string, string>;
}

const fresh = (): CrewFile => ({ version: 1, members: CREW.map((r) => r.id), names: {} });

/** Reads crew.json, keeping only what checks out (known robots, valid names). Anything unreadable starts fresh. */
export function parseCrewFile(text: string | null): CrewFile {
  if (text === null) return fresh();
  try {
    const raw = JSON.parse(text) as Partial<CrewFile>;
    const members = Array.isArray(raw.members)
      ? [...new Set(raw.members.filter((id): id is string => typeof id === 'string' && isRosterRobot(id)))]
      : fresh().members;
    const names: Record<string, string> = {};
    if (raw.names && typeof raw.names === 'object') {
      for (const [id, name] of Object.entries(raw.names)) {
        if (isRosterRobot(id) && typeof name === 'string' && ROBOT_NAME.test(name)) names[id] = name;
      }
    }
    return { version: 1, members, names };
  } catch {
    return fresh();
  }
}

export class CrewStore {
  private data: CrewFile;
  private readonly listeners = new Set<() => void>();

  /** `file` null keeps everything in memory (tests). */
  constructor(private readonly file: string | null) {
    let text: string | null = null;
    if (file) {
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        text = null;
      }
    }
    this.data = parseCrewFile(text);
  }

  /** Called after every change. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isMember(robotId: string): boolean {
    return this.data.members.includes(robotId);
  }

  /** Your crew, in roster order. */
  members(): string[] {
    return ROSTER_ROBOTS.map((r) => r.id).filter((id) => this.isMember(id));
  }

  nameOf(robotId: string): string {
    return this.data.names[robotId] ?? defaultNameOf(robotId);
  }

  add(robotId: string): void {
    if (!isRosterRobot(robotId) || this.isMember(robotId)) return;
    this.data = { ...this.data, members: [...this.data.members, robotId] };
    this.save();
  }

  /** The robot leaves the crew and its name goes back to the roster's. */
  remove(robotId: string): void {
    if (!this.isMember(robotId) && !(robotId in this.data.names)) return;
    const names = { ...this.data.names };
    delete names[robotId];
    this.data = { ...this.data, members: this.data.members.filter((id) => id !== robotId), names };
    this.save();
  }

  /** Renames a robot in the crew. An empty name, or its roster name, gives it back its roster name. */
  rename(robotId: string, name: string): void {
    if (!isRosterRobot(robotId)) throw new Error('Unknown robot.');
    const wanted = tidyName(name);
    const names = { ...this.data.names };
    if (!wanted || wanted === defaultNameOf(robotId)) {
      delete names[robotId];
    } else {
      if (wanted.length > MAX_ROBOT_NAME) throw new Error(`A name can be at most ${MAX_ROBOT_NAME} characters.`);
      if (!ROBOT_NAME.test(wanted)) {
        throw new Error('Use letters, numbers, spaces and - _ . \' in a name, starting with a letter or number.');
      }
      const same = (other: string) => other.toLowerCase() === wanted.toLowerCase();
      const taken = this.members().find((id) => id !== robotId && same(this.nameOf(id)));
      if (taken) throw new Error(`Another robot is already called ${this.nameOf(taken)}.`);
      // Roster names stay free, so a robot that joins later never shares a name.
      const rosterName = ROSTER_ROBOTS.find((r) => r.id !== robotId && same(r.name));
      if (rosterName) throw new Error(`${rosterName.name} is another robot's name.`);
      names[robotId] = wanted;
    }
    this.data = { ...this.data, names };
    this.save();
  }

  private save(): void {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.file);
    }
    for (const listener of this.listeners) listener();
  }
}
