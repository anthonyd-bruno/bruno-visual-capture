import { z } from 'zod';
import { IdentifierSchema } from './common.js';

/**
 * Phase 9: a collection the planner describes declaratively; the run stages it as Bruno YAML
 * (opencollection 1.0.0, the format measured in S10 on Bruno 4.1.0). Deliberately small: the
 * request features documentation screenshots actually show.
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

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
  docs: z.string().optional(),
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
