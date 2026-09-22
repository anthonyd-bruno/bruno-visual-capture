import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { RunConflictError, RunNotFoundError, RunValidationError } from '@bruno-capture/core';
import { ZipFile } from 'yazl';
import { CreateRunRequestSchema } from '@bruno-capture/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HttpError, validationError } from '../errors.js';

const MIME: Record<string, string> = { '.png': 'image/png', '.gif': 'image/gif', '.mp4': 'video/mp4', '.json': 'application/json', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.log': 'text/plain', '.jpg': 'image/jpeg' };

/** `Range: bytes=a-b` → [a, b] inclusive, or `undefined` when absent/unparseable; `null` when unsatisfiable (RFC 9110 §14). */
function parseRange(header: string | undefined, size: number): [number, number] | null | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return undefined;
  if (size === 0) return null;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]); // `-N` = last N bytes
  const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start >= size || start > end ? null : [start, end];
}

/**
 * Streams one file from the run directory. Honours `Range` so the browser can play and seek MP4s (Safari refuses to
 * play a `<video>` at all from a server that does not answer 206) and so the GIF player can stream frames.
 */
async function sendRunFile(reply: FastifyReply, runDir: string, relativePath: string, download: boolean, range?: string): Promise<FastifyReply> {
  if (relativePath.split('/').some((seg) => seg === '..' || seg === '')) throw new HttpError(400, 'bad_path', 'Invalid path');
  const root = await realpath(runDir).catch(() => undefined);
  const file = await realpath(path.join(runDir, relativePath)).catch(() => undefined);
  if (!root || !file || !file.startsWith(root + path.sep)) throw new HttpError(404, 'file_not_found', 'No such file in this run');
  const info = await stat(file);
  if (!info.isFile()) throw new HttpError(404, 'file_not_found', 'No such file in this run');
  const ext = path.extname(file).toLowerCase();
  reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  if (download) reply.header('content-disposition', `attachment; filename="${path.basename(file)}"`);
  const r = parseRange(range, info.size);
  if (r === null) { reply.header('content-range', `bytes */${info.size}`); return reply.code(416).send(); }
  if (r) {
    const [start, end] = r;
    reply.code(206).header('content-range', `bytes ${start}-${end}/${info.size}`).header('content-length', end - start + 1);
    return reply.send(createReadStream(file, { start, end }));
  }
  reply.header('content-length', info.size);
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
    const body = Regenerate.safeParse(req.body ?? {});
    if (!body.success) throw validationError('regenerate', body.error.issues);
    try {
      const r = await ctx.engine.regenerate(req.params.id, body.data.mode, body.data);
      if (r.kind === 'review') return reply.code(200).send({ review: r });
      return reply.code(202).send({ run: r.manifest });
    } catch (e) {
      if (e instanceof RunNotFoundError) throw new HttpError(404, 'run_not_found', e.message);
      if (e instanceof RunConflictError) throw new HttpError(409, 'run_conflict', 'A capture is already running', { activeRunId: e.activeRunId });
      if (e instanceof RunValidationError) throw new HttpError(400, 'run_invalid', e.message, e.details);
      throw e;
    }
  });

  /** PRD §74: ZIP on demand — all artifacts, or `files` (comma-separated relative paths) for a selection. */
  const archive = async (runId: string, files: string[] | undefined, reply: FastifyReply): Promise<FastifyReply> => {
    const rec = ctx.engine.get(runId);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${runId}`);
    const wanted = files?.length ? rec.manifest.artifacts.filter((a) => files.includes(a.relativePath)) : rec.manifest.artifacts;
    if (files?.length && wanted.length !== new Set(files).size) throw new HttpError(400, 'bad_selection', 'Selection contains unknown files');
    if (!wanted.length) throw new HttpError(404, 'no_artifacts', 'No matching artifacts');
    const zip = new ZipFile();
    for (const a of wanted) zip.addFile(path.join(rec.artifacts.runDir, a.relativePath), a.relativePath, { compress: a.kind === 'screenshot' });
    zip.addBuffer(Buffer.from(JSON.stringify(rec.manifest, null, 2)), 'manifest.json');
    zip.end();
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${rec.manifest.workflow.id}-${runId}.zip"`);
    return reply.send(zip.outputStream);
  };
  app.get<{ Params: { id: string }; Querystring: { files?: string } }>('/api/runs/:id/archive', async (req, reply) => archive(req.params.id, req.query.files?.split(',').filter(Boolean), reply));
  app.post<{ Params: { id: string } }>('/api/runs/:id/archive', async (req, reply) => {
    const body = z.strictObject({ files: z.array(z.string().min(1)).optional() }).safeParse(req.body ?? {});
    if (!body.success) throw validationError('archive', body.error.issues);
    return archive(req.params.id, body.data.files, reply);
  });

  /** PRD §78 Reveal in Finder / Open File — local app, so `open` is the right tool. Paths stay inside the run dir. */
  const runFile = async (runId: string, rel: string | undefined) => {
    const rec = ctx.engine.get(runId);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${runId}`);
    if (rel === undefined) return rec.artifacts.runDir;
    if (rel.split('/').some((s) => s === '..' || s === '')) throw new HttpError(400, 'bad_path', 'Invalid path');
    const root = await realpath(rec.artifacts.runDir);
    const file = await realpath(path.join(rec.artifacts.runDir, rel)).catch(() => undefined);
    if (!file || !file.startsWith(root + path.sep)) throw new HttpError(404, 'file_not_found', 'No such file in this run');
    return file;
  };
  const RelBody = z.strictObject({ path: z.string().min(1).optional() });
  app.post<{ Params: { id: string } }>('/api/runs/:id/reveal', async (req) => {
    const body = RelBody.safeParse(req.body ?? {});
    if (!body.success) throw validationError('reveal', body.error.issues);
    const target = await runFile(req.params.id, body.data.path);
    await new Promise<void>((res, rej) => execFile('/usr/bin/open', ['-R', target], (e) => (e ? rej(e) : res())));
    return { revealed: target };
  });
  app.post<{ Params: { id: string } }>('/api/runs/:id/open', async (req) => {
    const body = RelBody.safeParse(req.body ?? {});
    if (!body.success || !body.data.path) throw new HttpError(400, 'bad_path', 'path is required');
    const target = await runFile(req.params.id, body.data.path);
    await new Promise<void>((res, rej) => execFile('/usr/bin/open', [target], (e) => (e ? rej(e) : res())));
    return { opened: target };
  });

  app.get<{ Params: { id: string; '*': string }; Querystring: { download?: string } }>('/api/runs/:id/files/*', async (req, reply) => {
    const rec = ctx.engine.get(req.params.id);
    if (!rec) throw new HttpError(404, 'run_not_found', `No run ${req.params.id}`);
    return sendRunFile(reply, rec.artifacts.runDir, req.params['*'], req.query.download === '1', req.headers.range);
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
