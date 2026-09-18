import { ActionRegistry } from './registry.js';
import { appSetGeometry, themeSet } from './bruno/app.js';
import { collectionOpen } from './bruno/collection.js';
import { environmentOpenEditor, environmentSelect } from './bruno/environment.js';
import { requestOpen, requestSend } from './bruno/request.js';
import { runnerOpen, runnerRunCollection, runnerWaitComplete } from './bruno/runner.js';
import { workspaceOpen } from './bruno/workspace.js';
import type { CaptureAction } from './types.js';

export * from './types.js';
export * from './regions.js';
export * from './states.js';
export * from './registry.js';

const all = [
  appSetGeometry, themeSet, workspaceOpen, collectionOpen,
  runnerOpen, runnerRunCollection, runnerWaitComplete,
  requestOpen, requestSend,
  environmentSelect, environmentOpenEditor,
] as unknown as Array<CaptureAction<unknown>>;

export function createDefaultActionRegistry(): ActionRegistry {
  return new ActionRegistry().register(...all);
}
