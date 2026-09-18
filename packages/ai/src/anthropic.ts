import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { RawPlanSchema } from './schema.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { COMPOSE_SYSTEM_PROMPT, HEAL_SYSTEM_PROMPT, buildComposeMessage, buildHealMessage, type ComposeRequest, type HealPromptRequest } from './compose/prompt.js';
import { RawComposedPlanSchema, RawHealSchema, type RawComposedPlan, type RawHeal } from './compose/schema.js';
import { ProviderError, type AIProvider, type CapturePlanningRequest, type ProviderStatus, type RawPlan } from './types.js';

function classify(e: unknown): ProviderError {
  const err = e as { status?: number; name?: string; message?: string; code?: string };
  const msg = String(err.message ?? e).split('\n')[0]!;
  if (err.status === 401 || err.status === 403) return new ProviderError('anthropic', 'auth', `Anthropic rejected the API key (${err.status})`, e);
  if (err.status === 429) return new ProviderError('anthropic', 'quota', 'Anthropic rate limit or quota exceeded', e);
  if (err.status && err.status >= 500) return new ProviderError('anthropic', 'provider', `Anthropic error ${err.status}: ${msg}`, e);
  if (err.name === 'APIConnectionTimeoutError' || err.code === 'ETIMEDOUT' || /timeout/i.test(msg)) return new ProviderError('anthropic', 'timeout', `Anthropic request timed out: ${msg}`, e);
  if (err.name === 'APIConnectionError' || /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) return new ProviderError('anthropic', 'network', `Could not reach Anthropic: ${msg}`, e);
  if (err.status && err.status >= 400) return new ProviderError('anthropic', 'provider', `Anthropic error ${err.status}: ${msg}`, e);
  return new ProviderError('anthropic', 'provider', msg, e);
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, public readonly model: string, opts: { timeoutMs?: number; baseURL?: string } = {}) {
    this.client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 120_000, maxRetries: 1, baseURL: opts.baseURL });
  }

  /** One structured-output call; `effort` trades latency for reasoning (composition gets more than picking). */
  private async structured<T>(schema: z.ZodType<T>, system: string, user: string, effort: 'low' | 'medium' | 'high', maxTokens: number, signal?: AbortSignal): Promise<T> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: zodOutputFormat(schema), effort },
      }, { signal });
      if (response.stop_reason === 'refusal') throw new ProviderError('anthropic', 'provider', 'Anthropic declined the request');
      if (response.parsed_output) return response.parsed_output as T;
      const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new ProviderError('anthropic', 'malformed', 'Anthropic returned output that does not match the schema');
      return parsed.data;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof SyntaxError) throw new ProviderError('anthropic', 'malformed', 'Anthropic returned non-JSON output', e);
      throw classify(e);
    }
  }

  planCapture(request: CapturePlanningRequest, signal?: AbortSignal): Promise<RawPlan> {
    return this.structured(RawPlanSchema, SYSTEM_PROMPT, buildUserMessage(request), 'low', 4096, signal);
  }
  composeWorkflow(request: ComposeRequest, signal?: AbortSignal): Promise<RawComposedPlan> {
    return this.structured(RawComposedPlanSchema, COMPOSE_SYSTEM_PROMPT, buildComposeMessage(request), 'medium', 16_000, signal);
  }
  healStep(request: HealPromptRequest, signal?: AbortSignal): Promise<RawHeal> {
    return this.structured(RawHealSchema, HEAL_SYSTEM_PROMPT, buildHealMessage(request), 'medium', 6000, signal);
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderStatus> {
    const t0 = Date.now();
    try {
      await this.client.messages.create({ model: this.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }, { signal });
      return { ok: true, provider: 'anthropic', model: this.model, message: 'Connected', latencyMs: Date.now() - t0 };
    } catch (e) {
      const err = classify(e);
      return { ok: false, provider: 'anthropic', model: this.model, message: err.message, latencyMs: Date.now() - t0 };
    }
  }
}
