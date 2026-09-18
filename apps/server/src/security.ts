import type { FastifyInstance } from 'fastify';

/**
 * PRD §20: bind to loopback and treat the local API as privileged. Every request must carry a Host
 * of this server (blocks DNS rebinding) and, when a browser sends Origin, it must be this server's
 * own origin (blocks cross-site calls from other tabs). No CORS headers are ever emitted.
 */
export function registerLocalOnlyGuard(app: FastifyInstance, getPort: () => number): void {
  const allowedHosts = () => new Set([`127.0.0.1:${getPort()}`, `localhost:${getPort()}`, `[::1]:${getPort()}`]);
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts().has(host)) {
      return reply.code(403).send({ error: { code: 'forbidden_host', message: `Host ${host} is not this server` } });
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let ok = false;
      try { const u = new URL(origin); ok = u.protocol === 'http:' && allowedHosts().has(u.host); } catch { ok = false; }
      if (!ok) return reply.code(403).send({ error: { code: 'forbidden_origin', message: `Origin ${origin} is not allowed` } });
    }
    const remote = req.socket.remoteAddress ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return reply.code(403).send({ error: { code: 'forbidden_remote', message: 'Only loopback clients are allowed' } });
    }
  });
}
