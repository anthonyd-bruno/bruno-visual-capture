import { CapturePlanner, Keychain, buildProviders, resolveApiKey } from '@bruno-capture/ai';
import { AIProviderIdSchema, BUILT_IN_PRESETS, OutputTypeSchema } from '@bruno-capture/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HttpError, validationError } from '../errors.js';

const PlanBody = z.strictObject({
  prompt: z.string().trim().min(3).max(2000),
  output: z.union([z.literal('auto'), OutputTypeSchema]).default('auto'),
});
const KeyBody = z.strictObject({ key: z.string().trim().min(8).max(512) });

/** PRD §84 AI routes. Keys are written to Keychain and never read back to the client (§12). */
export function registerAiRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const keychain = new Keychain();

  app.post('/api/plan', async (req) => {
    const body = PlanBody.safeParse(req.body);
    if (!body.success) throw validationError('plan request', body.error.issues);
    const settings = ctx.settings.get();
    const { providers } = await buildProviders(settings, keychain);
    const planner = new CapturePlanner({ preferred: settings.ai.preferredProvider, fallbackEnabled: settings.ai.fallbackEnabled, providers, presets: BUILT_IN_PRESETS, log: ctx.log });
    const capabilities = ctx.registry.capabilities(BUILT_IN_PRESETS);
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const outcome = await planner.plan(body.data.prompt, capabilities, body.data.output, ac.signal);
    if (!outcome.ok) return { ok: false, error: outcome.error, suggestions: outcome.suggestions, attempts: outcome.attempts };
    const v = outcome.validated;
    return {
      ok: true,
      plan: v.plan,
      band: v.band,
      workflow: v.workflow,
      preset: v.preset,
      parameters: v.parameters,
      attribution: outcome.attribution,
      suggestions: v.band === 'low' ? outcome.suggestions : [],
      attempts: outcome.attempts,
    };
  });

  app.post<{ Params: { provider: string } }>('/api/ai/:provider/test', async (req) => {
    const provider = AIProviderIdSchema.safeParse(req.params.provider);
    if (!provider.success) throw new HttpError(404, 'unknown_provider', `Unknown provider ${req.params.provider}`);
    const { providers } = await buildProviders(ctx.settings.get(), keychain);
    const p = providers[provider.data];
    if (!p) return { ok: false, provider: provider.data, model: ctx.settings.get().ai[provider.data].model, message: 'Not configured: add an API key and a model first.' };
    return p.testConnection();
  });

  app.put<{ Params: { provider: string } }>('/api/ai/:provider/key', async (req) => {
    const provider = AIProviderIdSchema.safeParse(req.params.provider);
    if (!provider.success) throw new HttpError(404, 'unknown_provider', `Unknown provider ${req.params.provider}`);
    const body = KeyBody.safeParse(req.body);
    if (!body.success) throw validationError('API key', body.error.issues);
    await keychain.set(provider.data, body.data.key);
    ctx.log(`stored ${provider.data} API key in Keychain`);
    return { provider: provider.data, keyPresent: true, source: 'keychain' };
  });

  app.delete<{ Params: { provider: string } }>('/api/ai/:provider/key', async (req) => {
    const provider = AIProviderIdSchema.safeParse(req.params.provider);
    if (!provider.success) throw new HttpError(404, 'unknown_provider', `Unknown provider ${req.params.provider}`);
    const removed = await keychain.delete(provider.data);
    const still = await resolveApiKey(provider.data, keychain);
    return { provider: provider.data, removed, keyPresent: Boolean(still.key), source: still.source ?? null };
  });
}
