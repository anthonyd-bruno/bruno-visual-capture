import type { PageObservation } from './observation.js';
import type { RunError } from './run.js';
import type { Step, WorkflowDefinition } from './workflow.js';

/** Phase 9: what the executor hands the self-healer when a step fails. Never includes secrets or source. */
export interface HealRequest {
  /** The user's original prompt when the run came from one; otherwise the workflow description. */
  goal: string;
  definition: WorkflowDefinition;
  /** Steps that already ran (after earlier heals), the failed step, and what was still to come. */
  executed: Step[];
  failed: Step;
  failedIndex: number;
  error: RunError;
  remaining: Step[];
  observation: PageObservation;
  attempt: number;
  maxAttempts: number;
  signal?: AbortSignal;
}

export interface HealResponse {
  /** Steps to run in place of the failed one (may be empty to simply skip it). */
  replacement: Step[];
  /** How many of the following steps to drop as well (they were made redundant or wrong). */
  dropFollowing: number;
  rationale: string;
}
export type HealOutcome = HealResponse | { giveUp: true; reason: string };

export interface Healer {
  heal(req: HealRequest): Promise<HealOutcome>;
}
