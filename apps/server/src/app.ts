import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerContext } from './context.js';
import { registerErrorHandler } from './errors.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerLocalOnlyGuard } from './security.js';
import { registerStatic } from './static.js';

export interface BuildAppOptions { logger?: boolean; serveWeb?: boolean }

export async function buildApp(ctx: ServerContext, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: false });
  // Tolerate `content-type: application/json` with no body (DELETEs from fetch/curl clients that always set the header);
  // Fastify's default parser answers 400 "Body cannot be empty" instead.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (typeof body !== 'string' || body.trim() === '') { done(null, undefined); return; }
    try { done(null, JSON.parse(body)); }
    catch (e) { const err = e as Error & { statusCode?: number; code?: string }; err.statusCode = 400; err.code = 'invalid_json'; err.message = `Request body is not valid JSON: ${err.message}`; done(err, undefined); }
  });
  let port = 0;
  app.decorate('setBoundPort', (p: number) => { port = p; });
  registerLocalOnlyGuard(app, () => port);
  const hasWeb = opts.serveWeb === false ? false : await registerStatic(app);
  registerErrorHandler(app, { spaIndex: hasWeb });
  registerSystemRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerWorkflowRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerAiRoutes(app, ctx);
  app.addHook('onClose', async () => { await ctx.shutdown(); });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance { setBoundPort(port: number): void }
}
