import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { RunConflictError, RunValidationError } from '@bruno-capture/core';
import { CreateRunRequestSchema } from '@bruno-capture/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HttpError, validationError } from '../errors.js';

const MIME: Record<string, string> = { '.png': 'image/png', '.gif': 'image/gif', '.mp4': 'video/mp4', '.json': 'application/json', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.log': 'text/plain', '.jpg': 'image/jpeg' };

async function sendRunFile(reply: FastifyReply, runDir: string, relativePath: string, download: boolean): Promise<FastifyReply> {
  if (relativePath.split('/').some((seg) => seg === '..' || seg === '')) throw new HttpError(400, 'bad_path', 'Invalid path');
  const root = await realpath(runDir).catch(() => undefined);
  const file = await realpath(path.join(runDir, relativePath)).catch(() => undefined);
  if (!root || !file || !file.startsWith(root + path.sep)) throw new HttpError(404, 'file_not_found', 'No such file in this run');
  const info = await stat(file);
  if (!info.isFile()) throw new HttpError(404, 'file_not_found', 'No such file in this run');
  const ext = path.extname(file).toLowerCase();
  reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
  reply.header('content-length', info.size);
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  if (download) reply.header('content-disposition', `attachment; filename="${path.basename(file)}"`);
  return reply.send(createReadStream(file));
}

/** PRD §84 Runs + Artifacts, §66 SSE. */
export function registerRunRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.post('/api/runs', async (req, reply) => {
    const parsed = CreateRunRequestSchema.safeParse(req.body);
    if (!parsed.success) throw validationError('run request', parsed.error.issues);
    try {
      const manifest = await ctx.engine.create(parsed.data);
      return reply.code(202).send({ run: manifest });
    } catch (e) {
      if (e instanceof RunConflictError) throw new HttpError(409, 'run_conflict', 'A capture is already running', { activeRunId: e.activeRunId });
      if (e instanceof RunValidationError) throw new HttpError(400, 'run_invalid', e.message, e.details);
      throw e;
    }
  });

  app.get('/api/runs', async () => ({ runs: ctx.engine.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), activeRunId: ctx.engine.activeRunId ?? null }));

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req) => {
    const rec = ctx.engine.get(req.params.id);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    return { run: rec.manifest, active: ctx.engine.activeRunId === req.params.id, events: rec.bus.events().filter((e) => e.type !== 'preview.frame').length };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req, reply) => {
    const events = ctx.engine.events(req.params.id);
    if (!events) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    raw.write(': connected\n\n');
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), 15_000);
    try {
      for await (const e of ctx.engine.events(req.params.id, ac.signal)!) {
        raw.write(`event: ${e.type}\nid: ${e.at}\ndata: ${JSON.stringify(e)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      raw.end();
    }
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req) => {
    if (!ctx.engine.get(req.params.id)) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    const wasActive = ctx.engine.activeRunId === req.params.id;
    await ctx.engine.cancel(req.params.id);
    return { cancelled: wasActive, status: ctx.engine.get(req.params.id)?.manifest.status };
  });

  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (req) => {
    if (!ctx.engine.get(req.params.id)) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    try { await ctx.engine.delete(req.params.id); } catch (e) {
      if (e instanceof RunConflictError) throw new HttpError(409, 'run_active', 'Cancel the run before deleting it');
      throw e;
    }
    return { deleted: req.params.id };
  });

  const Regenerate = z.strictObject({ mode: z.enum(['exact', 'latest']), cancelActive: z.boolean().default(false), allowRelaunch: z.boolean().default(false) });
  app.post<{ Params: { id: string } }>('/api/runs/:id/regenerate', async (req, reply) => {
    const rec = ctx.engine.get(req.params.id);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    const body = Regenerate.safeParse(req.body ?? {});
    if (!body.success) throw validationError('regenerate', body.error.issues);
    if (body.data.mode === 'exact') throw new HttpError(501, 'not_implemented', 'Regenerate Exact (from the saved workflow snapshot) lands in Phase 7');
    const m = rec.manifest;
    try {
      const manifest = await ctx.engine.create({
        workflowId: m.workflow.id, output: m.capture.output, preset: m.capture.preset, parameters: m.parameters,
        overrides: { theme: m.capture.theme, width: m.capture.width, height: m.capture.height, cursor: m.capture.cursor, framing: m.capture.framing, region: m.capture.region, locator: m.capture.locator, fps: m.capture.fps },
        request: m.request.prompt || m.request.plan ? { prompt: m.request.prompt, plan: m.request.plan, ai: m.ai } : undefined,
        regenerateOf: { runId: m.runId, mode: 'latest' }, cancelActive: body.data.cancelActive, allowRelaunch: body.data.allowRelaunch,
      });
      return reply.code(202).send({ run: manifest });
    } catch (e) {
      if (e instanceof RunConflictError) throw new HttpError(409, 'run_conflict', 'A capture is already running', { activeRunId: e.activeRunId });
      if (e instanceof RunValidationError) throw new HttpError(400, 'run_invalid', e.message, e.details);
      throw e;
    }
  });

  app.get<{ Params: { id: string; '*': string }; Querystring: { download?: string } }>('/api/runs/:id/files/*', async (req, reply) => {
    const rec = ctx.engine.get(req.params.id);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    return sendRunFile(reply, rec.artifacts.runDir, req.params['*'], req.query.download === '1');
  });

  /** PRD §84: artifact ids are `<runId>:<fileName>`. */
  app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (req) => {
    const [runId, fileName] = req.params.id.split(':');
    const a = ctx.engine.get(runId ?? '')?.manifest.artifacts.find((x) => x.fileName === fileName);
    if (!a) throw new HttpError(404, 'artifact_not_found', `No artifact ${req.params.id}`);
    return { artifact: a, runId, url: `/api/runs/${runId}/files/${a.relativePath}` };
  });
  app.get<{ Params: { id: string } }>('/api/artifacts/:id/download', async (req, reply) => {
    const [runId, fileName] = req.params.id.split(':');
    const rec = ctx.engine.get(runId ?? '');
    const a = rec?.manifest.artifacts.find((x) => x.fileName === fileName);
    if (!rec || !a) throw new HttpError(404, 'artifact_not_found', `No artifact ${req.params.id}`);
    return sendRunFile(reply, rec.artifacts.runDir, a.relativePath, true);
  });
}
