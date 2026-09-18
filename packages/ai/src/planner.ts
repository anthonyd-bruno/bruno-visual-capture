import type { AIAttribution, AIProviderId, Capabilities, CapturePreset, OutputType, WorkflowSummary } from '@bruno-capture/shared';
import { PlanValidationError, suggestWorkflows, validatePlan, type PlanIssue, type ValidatedPlan } from './validate.js';
import { ProviderError, type AIProvider, type CapturePlanningRequest, type RawPlan } from './types.js';

export interface PlanOutcome {
  ok: true;
  validated: ValidatedPlan;
  attribution: AIAttribution;
  /** PRD §16 <0.5: also offer manual candidates. */
  suggestions: WorkflowSummary[];
  attempts: AttemptRecord[];
}
export interface PlanFailure {
  ok: false;
  error: { code: string; message: string; hint?: string };
  suggestions: WorkflowSummary[];
  attempts: AttemptRecord[];
}
export interface AttemptRecord { provider: AIProviderId; model: string; stage: 'initial' | 'repair'; result: 'ok' | 'invalid' | 'error'; detail?: string; latencyMs: number }

export interface PlannerOptions {
  preferred: AIProviderId;
  fallbackEnabled: boolean;
  providers: Partial<Record<AIProviderId, AIProvider>>;
  presets?: readonly CapturePreset[];
  log?: (m: string) => void;
}

/**
 * PRD §11: preferred provider → (invalid? one repair on the same provider) → fallback provider →
 * (one repair). Provider errors go straight to fallback; auth/not-configured errors do not bounce.
 */
export class CapturePlanner {
  constructor(private readonly opts: PlannerOptions) {}

  async plan(prompt: string, capabilities: Capabilities, preferredOutput: OutputType | 'auto' = 'auto', signal?: AbortSignal): Promise<PlanOutcome | PlanFailure> {
    const attempts: AttemptRecord[] = [];
    const order: AIProviderId[] = [this.opts.preferred];
    const other: AIProviderId = this.opts.preferred === 'openai' ? 'anthropic' : 'openai';
    if (this.opts.fallbackEnabled && this.opts.providers[other]) order.push(other);
    const suggestions = suggestWorkflows(prompt, capabilities);
    let lastError: { code: string; message: string; hint?: string } | undefined;

    for (const [i, id] of order.entries()) {
      const provider = this.opts.providers[id];
      if (!provider) {
        lastError = { code: 'provider_not_configured', message: `${id} is not configured`, hint: `Add an API key and model for ${id} in Settings › AI.` };
        continue;
      }
      const base: CapturePlanningRequest = { prompt, capabilities, preferredOutput };
      const res = await this.attempt(provider, base, 'initial', attempts, capabilities, signal);
      if (res.kind === 'ok') return this.outcome(res.validated, id, i > 0 ? order[0]! : undefined, false, suggestions, attempts);
      if (res.kind === 'invalid') {
        const repaired = await this.attempt(provider, { ...base, repair: { previous: res.raw ?? '(unparseable)', issues: res.issues.map((x) => `${x.path ? x.path + ': ' : ''}${x.message}`) } }, 'repair', attempts, capabilities, signal);
        if (repaired.kind === 'ok') return this.outcome(repaired.validated, id, i > 0 ? order[0]! : undefined, true, suggestions, attempts);
        lastError = { code: 'plan_invalid', message: `The ${id} plan was invalid even after one repair attempt`, hint: 'Pick a workflow manually below.' };
        if (repaired.kind === 'error' && !repaired.error.fallbackWorthy) break;
        continue; // PRD §11.4: the other provider may be attempted
      }
      lastError = { code: `provider_${res.error.kind}`, message: res.error.message, hint: res.error.kind === 'auth' ? `Check the ${id} API key in Settings › AI.` : undefined };
      if (!res.error.fallbackWorthy) break;
    }
    return { ok: false, error: lastError ?? { code: 'no_provider', message: 'No AI provider is configured', hint: 'Add an API key in Settings › AI, or choose a workflow manually.' }, suggestions, attempts };
  }

  private outcome(validated: ValidatedPlan, provider: AIProviderId, fallbackFrom: AIProviderId | undefined, repaired: boolean, suggestions: WorkflowSummary[], attempts: AttemptRecord[]): PlanOutcome {
    const p = this.opts.providers[provider]!;
    return { ok: true, validated, attribution: { provider, model: p.model, fallbackOccurred: Boolean(fallbackFrom), fallbackFrom, repaired }, suggestions, attempts };
  }

  private async attempt(provider: AIProvider, req: CapturePlanningRequest, stage: 'initial' | 'repair', attempts: AttemptRecord[], caps: Capabilities, signal?: AbortSignal):
    Promise<{ kind: 'ok'; validated: ValidatedPlan } | { kind: 'invalid'; issues: PlanIssue[]; raw?: RawPlan } | { kind: 'error'; error: ProviderError }> {
    const t0 = Date.now();
    let raw: RawPlan;
    try {
      raw = await provider.planCapture(req, signal);
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError(provider.id, 'provider', String((e as Error).message ?? e), e);
      attempts.push({ provider: provider.id, model: provider.model, stage, result: 'error', detail: `${err.kind}: ${err.message}`, latencyMs: Date.now() - t0 });
      this.opts.log?.(`ai ${provider.id} ${stage}: ${err.kind} — ${err.message}`);
      // A malformed response is treated like an invalid plan: worth one repair on the same provider.
      if (err.kind === 'malformed') return { kind: 'invalid', issues: [{ path: '', message: err.message }] };
      return { kind: 'error', error: err };
    }
    try {
      const validated = validatePlan(raw, caps, this.opts.presets);
      attempts.push({ provider: provider.id, model: provider.model, stage, result: 'ok', latencyMs: Date.now() - t0 });
      return { kind: 'ok', validated };
    } catch (e) {
      if (!(e instanceof PlanValidationError)) throw e;
      attempts.push({ provider: provider.id, model: provider.model, stage, result: 'invalid', detail: e.issues.map((i) => i.message).join('; ').slice(0, 300), latencyMs: Date.now() - t0 });
      this.opts.log?.(`ai ${provider.id} ${stage}: invalid plan — ${e.message}`);
      return { kind: 'invalid', issues: e.issues, raw };
    }
  }
}
