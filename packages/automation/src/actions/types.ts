import type { Locator, Page } from 'playwright';
import type { z } from 'zod';
import type { BrunoSession } from '../launcher.js';

/** D11 locator ladder rung used by an action — surfaced as debt in the registry. */
export type LocatorRung = 1 | 2 | 3 | 4 | 5 | 6;
export type ParamValues = Record<string, string | number | boolean>;

export interface ActionContext {
  session: BrunoSession;
  page: Page;
  log(message: string): void;
  signal?: AbortSignal;
  /** Resolved workflow parameters (already templated into action params by the executor). */
  parameters: ParamValues;
  /** The run's temp workspace (bundled fixture copy) or the user fixture path. */
  workspacePath?: string;
  /** Default postcondition timeout. */
  timeoutMs: number;
}

/** PRD §36 contract, plus what the runner needs to schedule and report it. */
export interface CaptureAction<P = Record<string, never>> {
  id: string;
  description: string;
  /** PRD §42: only safe, idempotent UI actions retry once on transient failure. */
  retryable: boolean;
  rung: LocatorRung;
  params: z.ZodType<P>;
  execute(ctx: ActionContext, params: P): Promise<void>;
}

export function defineAction<P>(def: CaptureAction<P>): CaptureAction<P> {
  return def;
}

/** Answers PRD §94's three questions; the executor adds workflow/step/Bruno-version context. */
export class ActionError extends Error {
  readonly code = 'action_failed';
  constructor(public readonly actionId: string, message: string, public readonly hint?: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ActionError';
  }
}

export const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0]!;

/** Wrap a Playwright wait so its timeout becomes a §94-style message. */
export async function expectVisible(actionId: string, what: string, locator: Locator, timeoutMs: number, hint?: string): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (e) {
    throw new ActionError(actionId, `${what} did not become visible within ${Math.round(timeoutMs / 1000)} s`, hint, e);
  }
}
