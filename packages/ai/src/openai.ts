import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { RawPlanSchema } from './schema.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { COMPOSE_SYSTEM_PROMPT, HEAL_SYSTEM_PROMPT, buildComposeMessage, buildHealMessage, type ComposeRequest, type HealPromptRequest } from './compose/prompt.js';
import { RawComposedPlanSchema, RawHealSchema, type RawComposedPlan, type RawHeal } from './compose/schema.js';
import { ProviderError, type AIProvider, type CapturePlanningRequest, type ProviderStatus, type RawPlan } from './types.js';

function classify(e: unknown): ProviderError {
  const err = e as { status?: number; name?: string; message?: string; code?: string };
  const msg = String(err.message ?? e).split('\n')[0]!;
  if (err.status === 401 || err.status === 403) return new ProviderError('openai', 'auth', `OpenAI rejected the API key (${err.status})`, e);
  if (err.status === 429) return new ProviderError('openai', 'quota', 'OpenAI rate limit or quota exceeded', e);
  if (err.status && err.status >= 500) return new ProviderError('openai', 'provider', `OpenAI error ${err.status}: ${msg}`, e);
  if (err.name === 'APIConnectionTimeoutError' || /timeout/i.test(msg)) return new ProviderError('openai', 'timeout', `OpenAI request timed out: ${msg}`, e);
  if (err.name === 'APIConnectionError' || /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) return new ProviderError('openai', 'network', `Could not reach OpenAI: ${msg}`, e);
  if (err.status && err.status >= 400) return new ProviderError('openai', 'provider', `OpenAI error ${err.status}: ${msg}`, e);
  return new ProviderError('openai', 'provider', msg, e);
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAI;

  constructor(apiKey: string, public readonly model: string, opts: { timeoutMs?: number; baseURL?: string } = {}) {
    this.client = new OpenAI({ apiKey, timeout: opts.timeoutMs ?? 120_000, maxRetries: 1, baseURL: opts.baseURL });
  }

  private async structured<T>(schema: z.ZodType<T>, name: string, instructions: string, input: string, signal?: AbortSignal): Promise<T> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions,
        input,
        text: { format: zodTextFormat(schema, name) },
      }, { signal });
      const text = response.output_text;
      if (!text) throw new ProviderError('openai', 'malformed', 'OpenAI returned no text output');
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new ProviderError('openai', 'malformed', 'OpenAI returned output that does not match the schema');
      return parsed.data;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof SyntaxError) throw new ProviderError('openai', 'malformed', 'OpenAI returned non-JSON output', e);
      throw classify(e);
    }
  }

  planCapture(request: CapturePlanningRequest, signal?: AbortSignal): Promise<RawPlan> {
    return this.structured(RawPlanSchema, 'capture_plan', SYSTEM_PROMPT, buildUserMessage(request), signal);
  }
  composeWorkflow(request: ComposeRequest, signal?: AbortSignal): Promise<RawComposedPlan> {
    return this.structured(RawComposedPlanSchema, 'composed_plan', COMPOSE_SYSTEM_PROMPT, buildComposeMessage(request), signal);
  }
  healStep(request: HealPromptRequest, signal?: AbortSignal): Promise<RawHeal> {
    return this.structured(RawHealSchema, 'heal', HEAL_SYSTEM_PROMPT, buildHealMessage(request), signal);
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderStatus> {
    const t0 = Date.now();
    try {
      await this.client.responses.create({ model: this.model, input: 'Reply with OK.', max_output_tokens: 16 }, { signal });
      return { ok: true, provider: 'openai', model: this.model, message: 'Connected', latencyMs: Date.now() - t0 };
    } catch (e) {
      const err = classify(e);
      return { ok: false, provider: 'openai', model: this.model, message: err.message, latencyMs: Date.now() - t0 };
    }
  }
}
