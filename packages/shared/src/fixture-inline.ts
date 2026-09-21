import { z } from 'zod';
import { IdentifierSchema } from './common.js';

/**
 * Phase 9: a collection the planner describes declaratively; the run stages it as Bruno YAML
 * (opencollection 1.0.0, the format measured in S10 on Bruno 4.1.0). Deliberately small: the
 * request features documentation screenshots actually show.
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Bruno 4.1.0's Assert tab operators (measured S12). */
export const AssertionOperatorSchema = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'notContains', 'length', 'matches', 'notMatches', 'startsWith', 'endsWith', 'between', 'isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy', 'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray']);

export const InlineAuthSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('inherit') }),
  z.strictObject({ type: z.literal('bearer'), token: z.string() }),
  z.strictObject({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.strictObject({ type: z.literal('apikey'), key: z.string(), value: z.string(), placement: z.enum(['header', 'queryparams']).default('header') }),
]);

export const InlineRequestSchema = z.strictObject({
  name: z.string().min(1).max(80).regex(/^[^/\\:*?"<>|]+$/, 'request names become file names: no / \\ : * ? " < > |'),
  method: HttpMethodSchema.default('GET'),
  /** May use `{{variables}}` from the environments below. */
  url: z.string().min(1),
  headers: z.array(z.strictObject({ name: z.string().min(1), value: z.string() })).default([]),
  params: z.array(z.strictObject({ name: z.string().min(1), value: z.string() })).default([]),
  body: z.strictObject({ type: z.enum(['json', 'text']), data: z.string() }).optional(),
  auth: InlineAuthSchema.default({ type: 'inherit' }),
  /** Markdown shown on the request's Docs tab. */
  docs: z.string().optional(),
  /** Request-level (pre-request) variables — the Vars tab; usable as {{name}} in this request. */
  variables: z.array(z.strictObject({ name: IdentifierSchema, value: z.string() })).default([]),
  /** Script tab (Pre Request / Post Response) and Tests tab contents — Bruno's `bru`, `req`, `res`, `test`, `expect` API. */
  scripts: z.strictObject({ beforeRequest: z.string().optional(), afterResponse: z.string().optional(), tests: z.string().optional() }).optional(),
  /** Assert tab rows, e.g. `{ expression: res.status, operator: eq, value: "200" }`. */
  assertions: z.array(z.strictObject({ expression: z.string().min(1), operator: AssertionOperatorSchema.default('eq'), value: z.string().default('') })).default([]),
});

export const InlineEnvironmentSchema = z.strictObject({
  name: z.string().min(1).max(60).regex(/^[^/\\:*?"<>|]+$/),
  variables: z.array(z.strictObject({ name: IdentifierSchema, value: z.string() })).default([]),
});

export const InlineCollectionSchema = z.strictObject({
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  requests: z.array(InlineRequestSchema).min(1).max(30),
  environments: z.array(InlineEnvironmentSchema).max(10).default([]),
  /** Optional OpenAPI documents to stage next to the collection (`spec/<fileName>`), e.g. for OpenAPI Sync. */
  files: z.array(z.strictObject({ path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/, 'relative path without ..'), content: z.string() })).max(10).default([]),
}).superRefine((c, ctx) => {
  const names = c.requests.map((r) => r.name.toLowerCase());
  for (const [i, n] of names.entries()) if (names.indexOf(n) !== i) ctx.addIssue({ code: 'custom', path: ['requests', i, 'name'], message: `duplicate request name "${c.requests[i]!.name}"` });
  const envs = c.environments.map((e) => e.name.toLowerCase());
  for (const [i, n] of envs.entries()) if (envs.indexOf(n) !== i) ctx.addIssue({ code: 'custom', path: ['environments', i, 'name'], message: `duplicate environment name "${c.environments[i]!.name}"` });
});
export type InlineCollection = z.infer<typeof InlineCollectionSchema>;
export type InlineCollectionInput = z.input<typeof InlineCollectionSchema>;
export type InlineRequest = z.infer<typeof InlineRequestSchema>;
