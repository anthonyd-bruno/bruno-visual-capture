import type { Page } from 'playwright';

type StateCheck = { locator: string; visible: boolean } | { predicate: (page: Page) => Promise<boolean>; describe: string };

/** Semantic states for `waitFor: { state }` (PRD §40). Owned here, next to the actions that produce them. */
export const STATES: Readonly<Record<string, StateCheck>> = {
  'collection.open': { locator: '[data-testid="collection-header"]', visible: true },
  'runner.open': { locator: '[data-testid="runner-run-button"]', visible: true },
  'runner.running': { locator: '[data-testid="runner-cancel-button"]', visible: true },
  'runner.complete': { locator: '[data-testid="runner-run-again-button"]', visible: true },
  'request.open': { locator: '[data-testid="request-pane"]', visible: true },
  'response.received': { locator: '[data-testid="response-status-code"]', visible: true },
  'environment.editorOpen': { locator: '[data-testid="save-env"], [data-testid="env-var-name-input"]', visible: true },
  'environment.selectorOpen': { locator: '[data-testid="env-list-item"], [data-testid="env-no-environment-item"]', visible: true },
  'timeline.open': { locator: '[data-testid="timeline-container"]', visible: true },
  'openapi.connectVisible': { describe: 'the OpenAPI connect screen is shown', predicate: async (page) => /Connect to OpenAPI Spec/.test(await page.evaluate(() => document.body.innerText)) },
  'openapi.connected': { describe: 'a spec is linked to the collection', predicate: async (page) => /Linked Collection/.test(await page.evaluate(() => document.body.innerText)) },
  'openapi.updatesPending': { describe: 'spec updates are pending', predicate: async (page) => /[1-9]\d* Spec Updates Pending/.test(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))) },
  'openapi.synced': { describe: 'collection is in sync with the spec', predicate: async (page) => /No updates from the spec|not been updated since the last sync/.test(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))) },
  'mockServer.running': {
    describe: 'mock server status text says running',
    predicate: async (page) => /running/i.test((await page.locator('[data-testid="mock-server-status-text"]').first().innerText().catch(() => '')) ?? ''),
  },
};

export class UnknownStateError extends Error {
  readonly code = 'unknown_state';
  constructor(public readonly state: string) {
    super(`Unknown semantic state "${state}". Known states: ${Object.keys(STATES).join(', ')}`);
    this.name = 'UnknownStateError';
  }
}

export class StateTimeoutError extends Error {
  readonly code = 'state_timeout';
  constructor(public readonly state: string, timeoutMs: number) {
    super(`State "${state}" was not reached within ${Math.round(timeoutMs / 1000)} s`);
    this.name = 'StateTimeoutError';
  }
}

export async function waitForState(page: Page, state: string, timeoutMs: number): Promise<void> {
  const check = STATES[state];
  if (!check) throw new UnknownStateError(state);
  if ('locator' in check) {
    try {
      await page.locator(check.locator).first().waitFor({ state: check.visible ? 'visible' : 'hidden', timeout: timeoutMs });
    } catch {
      throw new StateTimeoutError(state, timeoutMs);
    }
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check.predicate(page)) return;
    await page.waitForTimeout(150);
  }
  throw new StateTimeoutError(state, timeoutMs);
}
