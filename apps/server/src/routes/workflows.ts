import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { BUILT_IN_PRESETS } from '@bruno-capture/shared';
import { summarize } from '@bruno-capture/core';
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
    const lw = ctx.registry.list().find((l) => l.importId === id);
    return { importId: id, file, valid: Boolean(lw?.definition), issues: lw?.issues ?? [] };
  });

  app.delete<{ Params: { id: string } }>('/api/workflows/import/:id', async (req) => {
    await ctx.sources.removeImportedFile(req.params.id);
    await ctx.registry.refresh();
    return { removed: req.params.id };
  });

  app.post('/api/workflows/directories', async (req) => {
    const body = PathBody.safeParse(req.body);
    if (!body.success) throw validationError('directory', body.error.issues);
    const dir = path.resolve(body.data.path.replace(/^~(?=\/|$)/, process.env.HOME ?? ''));
    if (!(await stat(dir).then((s) => s.isDirectory()).catch(() => false))) throw new HttpError(404, 'dir_not_found', `Directory not found: ${dir}`);
    await ctx.sources.addDirectory(dir);
    await ctx.registry.refresh();
    return { directories: ctx.sources.get().customDirectories };
  });

  app.delete('/api/workflows/directories', async (req) => {
    const body = PathBody.safeParse(req.body);
    if (!body.success) throw validationError('directory', body.error.issues);
    await ctx.sources.removeDirectory(body.data.path);
    await ctx.registry.refresh();
    return { directories: ctx.sources.get().customDirectories };
  });

  app.get('/api/workflow-sources', async () => ctx.sources.get());

  /** PRD §84 GET /api/capabilities — also exactly what the AI planner is told (§13). */
  app.get('/api/capabilities', async () => ctx.registry.capabilities(BUILT_IN_PRESETS));
}
