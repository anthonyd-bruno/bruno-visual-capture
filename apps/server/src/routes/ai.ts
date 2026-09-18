import { CapturePlanner, Keychain, buildProviders, resolveApiKey } from '@bruno-capture/ai';
import { definitionToYaml } from '@bruno-capture/core';
import { AIProviderIdSchema, BUILT_IN_PRESETS, OutputTypeSchema } from '@bruno-capture/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HttpError, validationError } from '../errors.js';

const PlanBody = z.strictObject({
  prompt: z.string().trim().min(3).max(4000),
  output: z.union([z.literal('auto'), OutputTypeSchema]).default('auto'),
  /** Force the Phase 6 pick-only planner (default follows settings.ai.compose). */
  mode: z.enum(['auto', 'pick', 'compose']).default('auto'),
});
const KeyBody = z.strictObject({ key: z.string().trim().min(8).max(512) });

/** PRD §84 AI routes. Keys are written to Keychain and never read back to the client (§12). */
export function registerAiRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const keychain = new Keychain();

  /**
   * Phase 6 + 9: any prompt → either a registered workflow (kind "reuse") or a newly composed
   * workflow definition (kind "compose"), both validated locally. The composed definition is NOT saved
   * here; POST /api/workflows/generated does that when the user clicks Generate or Save.
   */
  app.post('/api/plan', async (req) => {
    const body = PlanBody.safeParse(req.body);
    if (!body.success) throw validationError('plan request', body.error.issues);
    const settings = ctx.settings.get();
    const { providers } = await buildProviders(settings, keychain);
    const planner = new CapturePlanner({ preferred: settings.ai.preferredProvider, fallbackEnabled: settings.ai.fallbackEnabled, providers, presets: BUILT_IN_PRESETS, log: ctx.log });
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const compose = body.data.mode === 'compose' || (body.data.mode === 'auto' && settings.ai.compose);

    if (!compose) {
      const capabilities = await ctx.capabilities();
      const outcome = await planner.plan(body.data.prompt, capabilities, body.data.output, ac.signal);
      if (!outcome.ok) return { ok: false, error: outcome.error, suggestions: outcome.suggestions, attempts: outcome.attempts };
      const v = outcome.validated;
      return { ok: true, kind: 'reuse', plan: v.plan, band: v.band, workflow: v.workflow, preset: v.preset, parameters: v.parameters, attribution: outcome.attribution, suggestions: v.band === 'low' ? outcome.suggestions : [], attempts: outcome.attempts };
    }

    const catalog = await ctx.composeCatalog();
    const outcome = await planner.compose(body.data.prompt, catalog, body.data.output, ac.signal);
    if (!outcome.ok) return { ok: false, error: outcome.error, suggestions: outcome.suggestions, attempts: outcome.attempts };
    const r = outcome.result;
    if (r.kind === 'reuse') {
      const v = r.validated;
      return { ok: true, kind: 'reuse', plan: v.plan, band: v.band, workflow: v.workflow, preset: v.preset, parameters: v.parameters, attribution: outcome.attribution, suggestions: v.band === 'low' ? outcome.suggestions : [], attempts: outcome.attempts };
    }
    return {
      ok: true, kind: 'compose',
      plan: r.plan, band: r.band, confidence: r.confidence, rationale: r.rationale,
      definition: r.input, yaml: definitionToYaml(r.input), preset: r.preset, output: r.output,
      captureIds: r.definition.steps.flatMap((s) => ('capture' in s ? [s.capture.id] : [])),
      fixture: r.definition.fixture ? (r.definition.fixture.source === 'inline' ? { source: 'inline', collection: r.definition.fixture.collection.name, requests: r.definition.fixture.collection.requests.length, environments: r.definition.fixture.collection.environments.length } : r.definition.fixture) : { source: 'none' },
      stepCount: r.definition.steps.length, debt: r.debt, primitives: r.primitives,
      attribution: outcome.attribution, suggestions: r.band === 'low' ? outcome.suggestions : [], attempts: outcome.attempts,
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
