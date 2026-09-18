import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { WorkflowDefinitionSchema, type WorkflowDefinitionInput } from '@bruno-capture/shared';
import { parse as parseYaml } from 'yaml';
import { definitionToYaml, summarize } from '@bruno-capture/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HttpError, validationError } from '../errors.js';

const PathBody = z.strictObject({ path: z.string().min(1) });

/** PRD §80/§84. Invalid files stay listed with their issues (§96); imports are references only (§28). */
export function registerWorkflowRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const view = () => ctx.registry.list().map((lw) => ({
    id: lw.id, file: lw.file, source: lw.source, sourcePath: lw.sourcePath, importId: lw.importId, valid: Boolean(lw.definition),
    issues: lw.issues, summary: summarize(lw), loadedAt: lw.loadedAt,
  }));

  app.get('/api/workflows', async () => ({ workflows: view(), refreshedAt: ctx.registry.snapshot().refreshedAt }));

  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req) => {
    const lw = ctx.registry.get(req.params.id) ?? ctx.registry.list().find((l) => l.id === req.params.id);
    if (!lw) throw new HttpError(404, 'workflow_not_found', `No workflow "${req.params.id}"`);
    return { ...view().find((v) => v.file === lw.file)!, definition: lw.definition, rawText: lw.rawText };
  });

  app.post('/api/workflows/refresh', async () => { const s = await ctx.registry.refresh(); return { total: s.total, invalid: s.invalid, refreshedAt: s.refreshedAt }; });

  app.post('/api/workflows/import', async (req) => {
    const body = PathBody.safeParse(req.body);
    if (!body.success) throw validationError('import', body.error.issues);
    const file = path.resolve(body.data.path.replace(/^~(?=\/|$)/, process.env.HOME ?? ''));
    if (!/\.ya?ml$/i.test(file)) throw new HttpError(400, 'not_yaml', 'Imported workflows must be .yaml or .yml files');
    if (!(await stat(file).then((s) => s.isFile()).catch(() => false))) throw new HttpError(404, 'file_not_found', `Workflow file not found: ${file}`);
    const id = randomUUID();
    await ctx.sources.addImportedFile(id, file);
    await ctx.registry.refresh();
    await ctx.watcher?.restart();
    const lw = ctx.registry.list().find((l) => l.importId === id);
    return { importId: id, file, valid: Boolean(lw?.definition), issues: lw?.issues ?? [] };
  });

  app.delete<{ Params: { id: string } }>('/api/workflows/import/:id', async (req) => {
    await ctx.sources.removeImportedFile(req.params.id);
    await ctx.registry.refresh();
    await ctx.watcher?.restart();
    return { removed: req.params.id };
  });

  app.post('/api/workflows/directories', async (req) => {
    const body = PathBody.safeParse(req.body);
    if (!body.success) throw validationError('directory', body.error.issues);
    const dir = path.resolve(body.data.path.replace(/^~(?=\/|$)/, process.env.HOME ?? ''));
    if (!(await stat(dir).then((s) => s.isDirectory()).catch(() => false))) throw new HttpError(404, 'dir_not_found', `Directory not found: ${dir}`);
    await ctx.sources.addDirectory(dir);
    await ctx.registry.refresh();
    await ctx.watcher?.restart();
    return { directories: ctx.sources.get().customDirectories };
  });

  app.delete('/api/workflows/directories', async (req) => {
    const body = PathBody.safeParse(req.body);
    if (!body.success) throw validationError('directory', body.error.issues);
    await ctx.sources.removeDirectory(body.data.path);
    await ctx.registry.refresh();
    await ctx.watcher?.restart();
    return { directories: ctx.sources.get().customDirectories };
  });

  app.get('/api/workflow-sources', async () => ctx.sources.get());

  /** PRD §84 GET /api/capabilities — also exactly what the AI planner is told (§13), plus the Phase 9 vocabulary. */
  app.get('/api/capabilities', async () => ctx.capabilities());

  /** Phase 9: validate a definition (object or YAML text) against the schema AND the action registry, without saving. */
  const validateDefinition = (raw: unknown): { ok: true; definition: WorkflowDefinitionInput } | { ok: false; issues: Array<{ path: string; message: string }> } => {
    const parsed = WorkflowDefinitionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) };
    const issues: Array<{ path: string; message: string }> = [];
    parsed.data.steps.forEach((step, i) => {
      if (!('action' in step)) return;
      if (!ctx.actions.has(step.action)) { issues.push({ path: `steps.${i}.action`, message: `unknown action "${step.action}"` }); return; }
      const hasTemplate = JSON.stringify(step.params).includes('{{');
      if (hasTemplate) return; // parameters are templated at run time
      const r = ctx.actions.get(step.action).params.safeParse(step.params);
      if (!r.success) issues.push(...r.error.issues.map((x) => ({ path: `steps.${i}.params.${x.path.map(String).join('.')}`, message: x.message })));
    });
    if (parsed.data.fixture?.source === 'bundled') {
      const fx = parsed.data.fixture.path;
      if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(fx)) issues.push({ path: 'fixture.path', message: 'invalid fixture path' });
    }
    return issues.length ? { ok: false, issues } : { ok: true, definition: raw as WorkflowDefinitionInput };
  };
  const DefinitionBody = z.union([z.strictObject({ definition: z.record(z.string(), z.unknown()), prompt: z.string().optional(), provider: z.string().optional(), model: z.string().optional() }), z.strictObject({ yaml: z.string().min(1).max(200_000), prompt: z.string().optional(), provider: z.string().optional(), model: z.string().optional() })]);
  const parseBody = (body: unknown): { raw: unknown; meta: { prompt?: string; provider?: string; model?: string } } => {
    const b = DefinitionBody.safeParse(body);
    if (!b.success) throw validationError('workflow definition', b.error.issues);
    if ('yaml' in b.data) {
      try { return { raw: parseYaml(b.data.yaml, { strict: true, uniqueKeys: true }), meta: b.data }; }
      catch (e) { throw new HttpError(400, 'invalid_yaml', `Invalid YAML: ${String((e as Error).message).split('\n')[0]}`); }
    }
    return { raw: b.data.definition, meta: b.data };
  };

  app.post('/api/workflows/validate', async (req) => {
    const { raw } = parseBody(req.body);
    const v = validateDefinition(raw);
    if (!v.ok) return { valid: false, issues: v.issues };
    const def = WorkflowDefinitionSchema.parse(raw);
    return { valid: true, issues: [], captureIds: def.steps.flatMap((s) => ('capture' in s ? [s.capture.id] : [])), stepCount: def.steps.length, yaml: definitionToYaml(raw as WorkflowDefinitionInput) };
  });

  /** Save a composed definition as a generated workflow (gets a unique id) and register it. */
  app.post('/api/workflows/generated', async (req, reply) => {
    const { raw, meta } = parseBody(req.body);
    const v = validateDefinition(raw);
    if (!v.ok) throw new HttpError(400, 'workflow_invalid', 'The workflow definition is invalid', v.issues);
    const saved = await ctx.generated.save(v.definition, { prompt: meta.prompt, provider: meta.provider, model: meta.model });
    await ctx.registry.refresh();
    ctx.log(`generated workflow ${saved.id} saved to ${saved.file}`);
    const lw = ctx.registry.get(saved.id);
    return reply.code(201).send({ id: saved.id, file: saved.file, valid: Boolean(lw?.definition), issues: lw?.issues ?? [], summary: lw ? summarize(lw) : undefined });
  });

  /** Replace a generated workflow's file (UI edits). Keeps the id. */
  app.put<{ Params: { id: string } }>('/api/workflows/generated/:id', async (req) => {
    const lw = ctx.registry.list().find((l) => l.id === req.params.id && l.source === 'generated');
    if (!lw) throw new HttpError(404, 'workflow_not_found', `No generated workflow "${req.params.id}"`);
    const { raw } = parseBody(req.body);
    if ((raw as { id?: unknown })?.id !== req.params.id) throw new HttpError(400, 'id_mismatch', 'The definition id must stay the same');
    const v = validateDefinition(raw);
    if (!v.ok) throw new HttpError(400, 'workflow_invalid', 'The workflow definition is invalid', v.issues);
    await ctx.generated.update(lw.file, WorkflowDefinitionSchema.parse(raw));
    await ctx.registry.refresh();
    const after = ctx.registry.get(req.params.id);
    return { id: req.params.id, file: lw.file, valid: Boolean(after?.definition), issues: after?.issues ?? [] };
  });

  app.delete<{ Params: { id: string } }>('/api/workflows/generated/:id', async (req) => {
    const lw = ctx.registry.list().find((l) => l.id === req.params.id && l.source === 'generated');
    if (!lw) throw new HttpError(404, 'workflow_not_found', `No generated workflow "${req.params.id}"`);
    if (ctx.engine.list().some((m) => m.workflow.id === req.params.id && ctx.engine.activeRunId === m.runId)) throw new HttpError(409, 'workflow_active', 'Cancel the run using this workflow first');
    const removed = await ctx.generated.delete(req.params.id);
    await ctx.registry.refresh();
    return { removed: removed ? req.params.id : null };
  });
}
