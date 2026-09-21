import { ActionRegistry } from './registry.js';
import { appSetGeometry, modalClose, themeSet } from './bruno/app.js';
import { collectionOpen } from './bruno/collection.js';
import { environmentOpenEditor, environmentOpenSelector, environmentSelect } from './bruno/environment.js';
import { fixtureCopyFile } from './bruno/fixture.js';
import { openapiCheckForUpdates, openapiConnectFile, openapiOpen, openapiReviewAndSync } from './bruno/openapi.js';
import { requestSelectTab, responseSelectTab, timelineExpandFirst, timelineOpen } from './bruno/tabs.js';
import { requestOpen, requestSend } from './bruno/request.js';
import { runnerOpen, runnerRunCollection, runnerWaitComplete } from './bruno/runner.js';
import { workspaceOpen } from './bruno/workspace.js';
import { AUTHORING_ACTIONS } from './bruno/authoring.js';
import { AUTHORING_EXTRA_ACTIONS } from './bruno/authoring-extra.js';
import { SETTINGS_ACTIONS } from './bruno/settings.js';
import { UI_ACTIONS } from './bruno/ui.js';
import type { CaptureAction } from './types.js';

export * from './types.js';
export * from './regions.js';
export * from './states.js';
export * from './registry.js';
export * from './catalog.js';
export { UiTargetSchema, describeTarget, resolveUiTarget, type UiTarget } from './bruno/ui.js';

const all = [
  appSetGeometry, themeSet, workspaceOpen, collectionOpen,
  runnerOpen, runnerRunCollection, runnerWaitComplete,
  requestOpen, requestSend, requestSelectTab, responseSelectTab,
  timelineOpen, timelineExpandFirst,
  environmentSelect, environmentOpenSelector, environmentOpenEditor,
  openapiOpen, openapiConnectFile, openapiCheckForUpdates, openapiReviewAndSync,
  fixtureCopyFile, modalClose,
  ...AUTHORING_ACTIONS,
  ...AUTHORING_EXTRA_ACTIONS,
  ...SETTINGS_ACTIONS,
  ...UI_ACTIONS,
] as unknown as Array<CaptureAction<unknown>>;

export function createDefaultActionRegistry(): ActionRegistry {
  return new ActionRegistry().register(...all);
}
