import type { AIProviderId, Capabilities, HealOutcome, HealRequest, Healer } from '@bruno-capture/shared';
import { PlanValidationError } from '../validate.js';
import { ProviderError, type AIProvider } from '../types.js';
import { validateHeal, type ComposeCatalog } from './validate.js';

export interface AIHealerOptions {
  providers: Partial<Record<AIProviderId, AIProvider>>;
  preferred: AIProviderId;
  fallbackEnabled: boolean;
  catalog: ComposeCatalog;
  log?: (m: string) => void;
}

/**
 * Phase 9 self-healer: one structured call per failed step (plus one same-provider repair when the
 * answer fails local validation), falling back to the other provider on provider errors. Never
 * throws into the run: any unrecoverable problem becomes a "give up" so the executor fails normally.
 */
export class AIHealer implements Healer {
  constructor(private readonly opts: AIHealerOptions) {}

  async heal(req: HealRequest): Promise<HealOutcome> {
    const order: AIProviderId[] = [this.opts.preferred];
    const other: AIProviderId = this.opts.preferred === 'openai' ? 'anthropic' : 'openai';
    if (this.opts.fallbackEnabled && this.opts.providers[other]) order.push(other);
    let last = 'no AI provider is configured';
    for (const id of order) {
      const p = this.opts.providers[id];
      if (!p) continue;
      const base = { heal: req, capabilities: this.opts.catalog.capabilities };
      const first = await this.attempt(p, base, req);
      if (first.kind === 'ok') return first.outcome;
      if (first.kind === 'invalid') {
        const second = await this.attempt(p, { ...base, repair: { previous: first.raw ?? '(unparseable)', issues: first.issues } }, req);
        if (second.kind === 'ok') return second.outcome;
        last = second.kind === 'invalid' ? `the ${id} answer was invalid twice: ${second.issues.join('; ')}` : second.message;
        if (second.kind === 'error' && !second.fallbackWorthy) break;
        continue;
      }
      last = first.message;
      if (!first.fallbackWorthy) break;
    }
    return { giveUp: true, reason: `Self-healing unavailable: ${last}` };
  }

  private async attempt(p: AIProvider, msg: Parameters<AIProvider['healStep']>[0], req: HealRequest):
    Promise<{ kind: 'ok'; outcome: HealOutcome } | { kind: 'invalid'; issues: string[]; raw?: unknown } | { kind: 'error'; message: string; fallbackWorthy: boolean }> {
    const t0 = Date.now();
    let raw: unknown;
    try {
      raw = await p.healStep(msg, req.signal);
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError(p.id, 'provider', String((e as Error).message ?? e), e);
      this.opts.log?.(`heal ${p.id}: ${err.kind} — ${err.message}`);
      if (err.kind === 'malformed') return { kind: 'invalid', issues: [err.message] };
      return { kind: 'error', message: err.message, fallbackWorthy: err.fallbackWorthy };
    }
    try {
      const v = validateHeal(raw, this.opts.catalog, req.remaining.length);
      this.opts.log?.(`heal ${p.id}: ${v.giveUp ? 'give up' : `${v.replacement.length} replacement step(s), drop ${v.dropFollowing}`} in ${Date.now() - t0} ms — ${v.rationale}`);
      return { kind: 'ok', outcome: v.giveUp ? { giveUp: true, reason: v.rationale } : { replacement: v.replacement, dropFollowing: v.dropFollowing, rationale: v.rationale } };
    } catch (e) {
      if (!(e instanceof PlanValidationError)) throw e;
      this.opts.log?.(`heal ${p.id}: invalid answer — ${e.message}`);
      return { kind: 'invalid', issues: e.issues.map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`), raw };
    }
  }
}

export function buildHealer(opts: AIHealerOptions): Healer | undefined {
  if (!Object.values(opts.providers).some(Boolean)) return undefined;
  return new AIHealer(opts);
}
export type { Capabilities };
