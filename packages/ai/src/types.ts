import type { AIProviderId, Capabilities, OutputType } from '@bruno-capture/shared';
import type { HealPromptRequest, ComposeRequest } from './compose/prompt.js';
import type { RawComposedPlan, RawHeal } from './compose/schema.js';

export type ProviderErrorKind = 'auth' | 'network' | 'timeout' | 'quota' | 'provider' | 'malformed' | 'not-configured';

/** Classified provider failure (PRD §11 decides fallback from `kind`). Never carries the key. */
export class ProviderError extends Error {
  constructor(public readonly provider: AIProviderId, public readonly kind: ProviderErrorKind, message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
  /** Network/timeout/quota/provider errors → try the other provider; auth/not-configured → don't bother. */
  get fallbackWorthy(): boolean { return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'quota' || this.kind === 'provider'; }
}

/** What the model returns for the original pick-a-workflow planner — flat and fully required. */
export interface RawPlan {
  type: 'capture' | 'workflow';
  workflowId: string;
  output: OutputType;
  preset: string;
  parameters: Array<{ name: string; value: string }>;
  confidence: number;
  rationale: string;
}

export interface RepairContext {
  previous: unknown;
  issues: string[];
}

/** PRD §13: the model sees only this. */
export interface CapturePlanningRequest {
  prompt: string;
  capabilities: Capabilities;
  /** `auto` lets the planner choose (PRD §7.2). */
  preferredOutput: OutputType | 'auto';
  repair?: RepairContext;
}

export interface ProviderStatus {
  ok: boolean;
  provider: AIProviderId;
  model: string;
  message: string;
  latencyMs?: number;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly model: string;
  /** Phase 6: pick a registered workflow. */
  planCapture(request: CapturePlanningRequest, signal?: AbortSignal): Promise<RawPlan>;
  /** Phase 9: reuse or compose a workflow from the action catalog. */
  composeWorkflow(request: ComposeRequest, signal?: AbortSignal): Promise<RawComposedPlan>;
  /** Phase 9: replacement steps for a failed step, from a live UI observation. */
  healStep(request: HealPromptRequest, signal?: AbortSignal): Promise<RawHeal>;
  testConnection(signal?: AbortSignal): Promise<ProviderStatus>;
}
export type { ComposeRequest, HealPromptRequest, RawComposedPlan, RawHeal };
