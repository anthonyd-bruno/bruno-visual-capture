import type { Locator, Page } from 'playwright';

/** Named semantic regions (PRD §47) → the locators that back them. Only place these selectors live. */
export const REGIONS: Readonly<Record<string, string>> = {
  'app.shell': '#root',
  'app.sidebar': '[data-testid="sidebar"]',
  'runner.panel': '[data-testid="runner-config-panel"]',
  'runner.results': ':is(div, section):has(> [data-testid="runner-result-item"])',
  'request.editor': '[data-testid="request-pane"]',
  'request.urlBar': '[data-testid="url-bar-container"]',
  'response.body': '[data-testid="response-pane"]',
  'environment.selector': '[data-testid="environment-selector-trigger"]',
  'timeline.panel': '[data-testid="timeline-container"]',
  'mock.dashboard': '[data-testid="mock-server-dashboard"]',
  'collection.header': '[data-testid="collection-header"]',
};

export class UnknownRegionError extends Error {
  readonly code = 'unknown_region';
  constructor(public readonly region: string) {
    super(`Unknown region "${region}". Known regions: ${Object.keys(REGIONS).join(', ')}`);
    this.name = 'UnknownRegionError';
  }
}

export function regionLocator(page: Page, region: string): Locator {
  const css = REGIONS[region];
  if (!css) throw new UnknownRegionError(region);
  return page.locator(css).first();
}

export interface TargetRef { region?: string; locator?: string }

/** Region or raw locator → Playwright Locator (raw locators are the §38 escape hatch). */
export function resolveTarget(page: Page, target: TargetRef): Locator {
  if (target.region) return regionLocator(page, target.region);
  if (target.locator) return page.locator(target.locator).first();
  throw new Error('target needs a region or a locator');
}
