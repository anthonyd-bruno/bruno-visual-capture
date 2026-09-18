import type { FastifyInstance } from 'fastify';
import type { ServerContext } from '../context.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/system/status', async () => ctx.systemStatus());
  app.get('/api/health', async () => ({ ok: true }));
}
