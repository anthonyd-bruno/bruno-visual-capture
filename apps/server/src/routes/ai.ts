import { CapturePlanner, Keychain, buildProviders, resolveApiKey } from '@bruno-capture/ai';
import { RunConflictError, RunValidationError, definitionToYaml } from '@bruno-capture/core';
import { AIAttributionSchema, AIProviderIdSchema, BUILT_IN_PRESETS, CaptureOverridesSchema, OutputTypeSchema, RunIdSchema, SlugSchema } from '@bruno-capture/shared';
import { applyRefinement, resolveRefineCurrent } from '../refine.js';
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
const ComposedOutput = z.enum(['screenshots', 'video', 'gif']);
const RefineBody = z.strictObject({
  feedback: z.string().trim().min(3).max(2000),
  runId: RunIdSchema.optional(),
  workflowId: SlugSchema.optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
  output: ComposedOutput.optional(),
  preset: SlugSchema.optional(),
  overrides: CaptureOverridesSchema.optional(),
});
const ApplyBody = z.strictObject({
  workflowId: SlugSchema,
  definition: z.record(z.string(), z.unknown()),
  output: ComposedOutput,
  preset: SlugSchema,
  overrides: CaptureOverridesSchema.optional(),
  prompt: z.string().optional(),
  feedback: z.array(z.string().min(1)).min(1),
  refinedFrom: RunIdSchema.optional(),
  ai: AIAttributionSchema.optional(),
  cancelActive: z.boolean().default(false),
  allowRelaunch: z.boolean().default(false),
});

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

  /**
   * Phase 10: adjust an existing capture from feedback ("don't obscure the token") without replanning.
   * Starts from a run (its exact snapshot + settings + outcome), a registered workflow, or an unsaved definition.
   */
  app.post('/api/refine', async (req) => {
    const body = RefineBody.safeParse(req.body);
    if (!body.success) throw validationError('refine request', body.error.issues);
    let resolved;
    try { resolved = await resolveRefineCurrent(ctx, body.data as Parameters<typeof resolveRefineCurrent>[1]); }
    catch (e) { if (e instanceof RunValidationError) throw new HttpError(404, 'refine_source_not_found', e.message); throw e; }
    const settings = ctx.settings.get();
    const { providers } = await buildProviders(settings, keychain);
    const planner = new CapturePlanner({ preferred: settings.ai.preferredProvider, fallbackEnabled: settings.ai.fallbackEnabled, providers, presets: BUILT_IN_PRESETS, log: ctx.log });
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const outcome = await planner.refine(body.data.feedback, await ctx.composeCatalog(), resolved.current, ac.signal);
    if (!outcome.ok) return { ok: false, error: outcome.error, attempts: outcome.attempts };
    const r = outcome.result;
    return {
      ok: true, kind: 'refine',
      source: resolved.source,
      definition: r.input, yaml: definitionToYaml(r.input), output: r.output, preset: r.preset, overrides: r.overrides,
      changes: r.changes, settingsChanged: r.settingsChanged, diff: r.diff, rationale: r.rationale, confidence: r.confidence, band: r.band, debt: r.debt,
      captureIds: r.definition.steps.flatMap((s) => ('capture' in s ? [s.capture.id] : [])), stepCount: r.definition.steps.length,
      prompt: resolved.current.prompt, feedback: [...(resolved.current.feedback ?? []), body.data.feedback],
      attribution: outcome.attribution, attempts: outcome.attempts,
    };
  });

  /** Save the refined definition (in place for generated workflows, else as a new generated one) and run it. */
  app.post('/api/refine/apply', async (req, reply) => {
    const body = ApplyBody.safeParse(req.body);
    if (!body.success) throw validationError('apply refinement', body.error.issues);
    try {
      const r = await applyRefinement(ctx, body.data as Parameters<typeof applyRefinement>[1]);
      return reply.code(202).send(r);
    } catch (e) {
      if (e instanceof RunConflictError) throw new HttpError(409, 'run_conflict', 'A capture is already running', { activeRunId: e.activeRunId });
      if (e instanceof RunValidationError) throw new HttpError(400, 'run_invalid', e.message, e.details);
      if ((e as { name?: string }).name === 'ZodError') throw new HttpError(400, 'workflow_invalid', 'The refined definition is invalid', (e as { issues?: unknown }).issues);
      throw e;
    }
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
