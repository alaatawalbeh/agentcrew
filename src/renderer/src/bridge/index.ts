import type { CrewBridge } from '@shared/bridge';
import type { EngineState } from '@shared/crew';
import { createElectronBridge, type ElectronCrewBridge } from './electron';
import { createSampleBridge, scenarioFromSearch, type SampleBridge } from './sample';

/** Inside Electron: the real crew through the preload. In a plain browser (npm run dev:web): the sample crew. */
const electron: ElectronCrewBridge | null = window.crew ? createElectronBridge(window.crew) : null;
const sample: SampleBridge | null = electron ? null : createSampleBridge(scenarioFromSearch(window.location.search));

export const bridge: CrewBridge = (electron ?? sample)!;

export function onEngineState(listener: (state: EngineState) => void): () => void {
  if (electron) return electron.onEngine(listener);
  listener({ state: 'sample' });
  return () => {};
}

/** Actions that couldn't run, a folder that isn't a git repo, and so on. */
export function onNotice(listener: (message: string) => void): () => void {
  return (electron ?? sample)!.onNotice(listener);
}

/** A desktop notification was clicked: show that robot. */
export function onSelect(listener: (sessionId: string) => void): () => void {
  return electron ? electron.onSelect(listener) : () => {};
}
