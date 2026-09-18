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
