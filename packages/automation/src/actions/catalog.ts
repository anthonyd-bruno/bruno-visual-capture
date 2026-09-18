import { z } from 'zod';
import type { ActionSummary } from '@bruno-capture/shared';
import type { ActionRegistry } from './registry.js';
import { REGIONS } from './regions.js';
import { STATES } from './states.js';

/** Phase 9: the action registry as the planner sees it (PRD §13 — ids, purpose, params; never selectors). */
export function describeActions(registry: ActionRegistry): ActionSummary[] {
  return registry.list().map((a) => {
    let params: Record<string, unknown>;
    try {
      params = z.toJSONSchema(a.params as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
      delete params['$schema'];
    } catch {
      params = { type: 'object' };
    }
    return { id: a.id, description: a.description, params, retryable: a.retryable, rung: a.rung };
  }).sort((x, y) => x.id.localeCompare(y.id));
}

export const REGION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'app.shell': 'the whole app content area',
  'app.sidebar': 'the left sidebar (collections tree)',
  'runner.panel': 'the Runner configuration panel',
  'runner.results': 'the Runner results list',
  'request.editor': 'the request editor pane (URL bar + tabs)',
  'request.urlBar': 'the URL bar of the open request',
  'response.body': 'the response pane',
  'environment.selector': 'the environment selector button (top right of a collection)',
  'timeline.panel': 'the Timeline panel in the response pane',
  'mock.dashboard': 'the mock server dashboard',
  'collection.header': 'the collection header (name + actions)',
};

export const STATE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'collection.open': 'a collection is open (header visible)',
  'runner.open': 'the Runner is open',
  'runner.running': 'the Runner is executing requests',
  'runner.complete': 'the Runner finished ("Run Again" visible)',
  'request.open': 'a request is open in the editor',
  'response.received': 'a response status code is shown',
  'environment.editorOpen': 'the environment editor is open',
  'environment.selectorOpen': 'the environment dropdown is open',
  'timeline.open': 'the Timeline is visible',
  'openapi.connectVisible': 'the OpenAPI "Connect to OpenAPI Spec" screen is shown',
  'openapi.connected': 'a spec is linked to the collection',
  'openapi.updatesPending': 'the OpenAPI tab reports pending spec updates',
  'openapi.synced': 'the collection is in sync with the spec',
  'mockServer.running': 'the mock server reports running',
  'modal.open': 'a modal dialog is open',
  'modal.closed': 'no modal dialog is open',
  'settings.open': 'a collection settings tab is open',
};

export function describeRegions(): Array<{ id: string; description: string }> {
  return Object.keys(REGIONS).map((id) => ({ id, description: REGION_DESCRIPTIONS[id] ?? id }));
}
export function describeStates(): Array<{ id: string; description: string }> {
  return Object.keys(STATES).map((id) => ({ id, description: STATE_DESCRIPTIONS[id] ?? id }));
}
