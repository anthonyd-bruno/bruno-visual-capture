import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Serve the built web app (`apps/web/dist`) when present; the dev server proxies to us instead. */
export const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export async function registerStatic(app: FastifyInstance): Promise<boolean> {
  if (!existsSync(path.join(WEB_DIST, 'index.html'))) return false;
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false, index: ['index.html'] });
  return true;
}
