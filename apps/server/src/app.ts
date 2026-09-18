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
