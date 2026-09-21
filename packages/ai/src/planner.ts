import type { AIAttribution, AIProviderId, Capabilities, CapturePreset, OutputType, WorkflowSummary } from '@bruno-capture/shared';
import { PlanValidationError, suggestWorkflows, validatePlan, type PlanIssue, type ValidatedPlan } from './validate.js';
import { validateComposedPlan, type ComposeCatalog, type ValidatedComposedPlan } from './compose/validate.js';
import { validateRefinement, type RefineCurrent, type RefineRequest, type ValidatedRefinement } from './compose/refine.js';
import { ProviderError, type AIProvider, type CapturePlanningRequest, type ComposeRequest } from './types.js';

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
/** Phase 9: the compose planner's success carries either a reuse plan or a composed definition. */
export interface ComposeOutcome {
  ok: true;
  result: ValidatedComposedPlan;
  attribution: AIAttribution;
  suggestions: WorkflowSummary[];
  attempts: AttemptRecord[];
}
/** Phase 10 */
export interface RefineOutcome { ok: true; result: ValidatedRefinement; attribution: AIAttribution; suggestions: WorkflowSummary[]; attempts: AttemptRecord[] }
export interface AttemptRecord { provider: AIProviderId; model: string; stage: 'initial' | 'repair'; result: 'ok' | 'invalid' | 'error'; detail?: string; latencyMs: number }

export interface PlannerOptions {
  preferred: AIProviderId;
  fallbackEnabled: boolean;
  providers: Partial<Record<AIProviderId, AIProvider>>;
  presets?: readonly CapturePreset[];
  log?: (m: string) => void;
}

type Attempt<V> = { kind: 'ok'; validated: V } | { kind: 'invalid'; issues: PlanIssue[]; raw?: unknown } | { kind: 'error'; error: ProviderError };

/**
 * PRD §11: preferred provider → (invalid? one repair on the same provider) → fallback provider →
 * (one repair). Provider errors go straight to fallback; auth/not-configured errors do not bounce.
 * The same contract drives both the pick-a-workflow planner and the Phase 9 composer.
 */
export class CapturePlanner {
  constructor(private readonly opts: PlannerOptions) {}

  async plan(prompt: string, capabilities: Capabilities, preferredOutput: OutputType | 'auto' = 'auto', signal?: AbortSignal): Promise<PlanOutcome | PlanFailure> {
    const r = await this.drive<ValidatedPlan, CapturePlanningRequest>(
      prompt, capabilities,
      (repair) => ({ prompt, capabilities, preferredOutput, repair }),
      (p, req, s) => p.planCapture(req, s),
      (raw) => validatePlan(raw, capabilities, this.opts.presets),
      signal,
    );
    if (!r.ok) return r;
    return { ok: true, validated: r.validated, attribution: r.attribution, suggestions: r.suggestions, attempts: r.attempts };
  }

  /** Phase 9: any prompt → reuse a registered workflow or compose one from the action catalog. */
  async compose(prompt: string, catalog: ComposeCatalog, preferredOutput: OutputType | 'auto' = 'auto', signal?: AbortSignal): Promise<ComposeOutcome | PlanFailure> {
    const r = await this.drive<ValidatedComposedPlan, ComposeRequest>(
      prompt, catalog.capabilities,
      (repair) => ({ prompt, capabilities: catalog.capabilities, preferredOutput, repair: repair as ComposeRequest['repair'] }),
      (p, req, s) => p.composeWorkflow(req, s),
      (raw) => validateComposedPlan(raw, { ...catalog, presets: catalog.presets ?? this.opts.presets }),
      signal,
    );
    if (!r.ok) return r;
    return { ok: true, result: r.validated, attribution: r.attribution, suggestions: r.suggestions, attempts: r.attempts };
  }

  /** Phase 10: apply natural-language feedback to an existing workflow + capture settings. */
  async refine(feedback: string, catalog: ComposeCatalog, current: RefineCurrent, signal?: AbortSignal): Promise<RefineOutcome | PlanFailure> {
    const r = await this.drive<ValidatedRefinement, RefineRequest>(
      `${current.prompt ?? current.definition.name} ${feedback}`, catalog.capabilities,
      (repair) => ({ feedback, current, capabilities: catalog.capabilities, repair }),
      (p, req, s) => p.refineWorkflow(req, s),
      (raw) => validateRefinement(raw, { ...catalog, presets: catalog.presets ?? this.opts.presets }, current),
      signal,
    );
    if (!r.ok) return r;
    return { ok: true, result: r.validated, attribution: r.attribution, suggestions: r.suggestions, attempts: r.attempts };
  }

  private async drive<V, R>(
    prompt: string, capabilities: Capabilities,
    request: (repair?: { previous: unknown; issues: string[] }) => R,
    call: (p: AIProvider, req: R, signal?: AbortSignal) => Promise<unknown>,
    validate: (raw: unknown) => V,
    signal?: AbortSignal,
  ): Promise<{ ok: true; validated: V; attribution: AIAttribution; suggestions: WorkflowSummary[]; attempts: AttemptRecord[] } | PlanFailure> {
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
      const outcome = (validated: V, repaired: boolean) => ({ ok: true as const, validated, attribution: { provider: id, model: provider.model, fallbackOccurred: i > 0, fallbackFrom: i > 0 ? order[0]! : undefined, repaired }, suggestions, attempts });
      const res = await this.attempt(provider, request(), 'initial', attempts, call, validate, signal);
      if (res.kind === 'ok') return outcome(res.validated, false);
      if (res.kind === 'invalid') {
        const repaired = await this.attempt(provider, request({ previous: res.raw ?? '(unparseable)', issues: res.issues.map((x) => `${x.path ? x.path + ': ' : ''}${x.message}`) }), 'repair', attempts, call, validate, signal);
        if (repaired.kind === 'ok') return outcome(repaired.validated, true);
        lastError = { code: 'plan_invalid', message: `The ${id} plan was invalid even after one repair attempt`, hint: repaired.kind === 'invalid' ? repaired.issues.slice(0, 3).map((x) => x.message).join('; ') : 'Pick a workflow manually below.' };
        if (repaired.kind === 'error' && !repaired.error.fallbackWorthy) break;
        continue; // PRD §11.4: the other provider may be attempted
      }
      lastError = { code: `provider_${res.error.kind}`, message: res.error.message, hint: res.error.kind === 'auth' ? `Check the ${id} API key in Settings › AI.` : undefined };
      if (!res.error.fallbackWorthy) break;
    }
    return { ok: false, error: lastError ?? { code: 'no_provider', message: 'No AI provider is configured', hint: 'Add an API key in Settings › AI, or choose a workflow manually.' }, suggestions, attempts };
  }

  private async attempt<V, R>(provider: AIProvider, req: R, stage: 'initial' | 'repair', attempts: AttemptRecord[], call: (p: AIProvider, req: R, signal?: AbortSignal) => Promise<unknown>, validate: (raw: unknown) => V, signal?: AbortSignal): Promise<Attempt<V>> {
    const t0 = Date.now();
    let raw: unknown;
    try {
      raw = await call(provider, req, signal);
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError(provider.id, 'provider', String((e as Error).message ?? e), e);
      attempts.push({ provider: provider.id, model: provider.model, stage, result: 'error', detail: `${err.kind}: ${err.message}`, latencyMs: Date.now() - t0 });
      this.opts.log?.(`ai ${provider.id} ${stage}: ${err.kind} — ${err.message}`);
      // A malformed response is treated like an invalid plan: worth one repair on the same provider.
      if (err.kind === 'malformed') return { kind: 'invalid', issues: [{ path: '', message: err.message }] };
      return { kind: 'error', error: err };
    }
    try {
      const validated = validate(raw);
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
