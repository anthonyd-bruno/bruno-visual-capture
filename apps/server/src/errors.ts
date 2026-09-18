import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Zod issues → the field-level error shape the UI renders (PRD §96). */
export function validationError(what: string, issues: z.core.$ZodIssue[]): HttpError {
  return new HttpError(400, 'validation_failed', `${what} failed validation`, issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}

export function registerErrorHandler(app: FastifyInstance, opts: { spaIndex?: boolean } = {}): void {
  app.setErrorHandler((err: FastifyError | HttpError, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: { code: (err as FastifyError).code ?? 'internal_error', message: status >= 500 ? 'Internal error' : err.message } });
  });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback for the web app's client-side routes; the API always 404s as JSON.
    if (opts.spaIndex && req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });
}
