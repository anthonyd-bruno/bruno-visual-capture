import { z } from 'zod';
import { IdentifierSchema } from './common.js';

const base = {
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  required: z.boolean().default(false),
};

/** Workflow parameter declarations (PRD §31, §32). */
export const ParameterSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('string'),
    ...base,
    default: z.string().optional(),
    pattern: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal('number'),
    ...base,
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().default(false),
  }),
  z.strictObject({ type: z.literal('boolean'), ...base, default: z.boolean().optional() }),
  z.strictObject({
    type: z.literal('select'),
    ...base,
    options: z.array(z.string().min(1)).min(1),
    default: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('file'),
    ...base,
    default: z.string().optional(),
    extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/i)).optional(),
  }),
  z.strictObject({ type: z.literal('directory'), ...base, default: z.string().optional() }),
]);
export type Parameter = z.infer<typeof ParameterSchema>;
export type ParameterType = Parameter['type'];

export const ParametersSchema = z.record(IdentifierSchema, ParameterSchema);
export type Parameters = z.infer<typeof ParametersSchema>;

export interface ParameterError {
  parameter: string;
  message: string;
}

export type ResolvedParameters = Record<string, string | number | boolean>;

export type ResolveParametersResult =
  | { ok: true; values: ResolvedParameters }
  | { ok: false; errors: ParameterError[] };

/**
 * Validate user/AI supplied values against a workflow's parameter declarations, apply defaults, and
 * coerce the string-ish values an HTML form or a CLI produces. Undeclared keys are rejected (PRD §31:
 * only declared parameters may be populated). Pure — safe to share between server, CLI and web.
 */
export function resolveParameters(defs: Parameters, values: Record<string, unknown>): ResolveParametersResult {
  const errors: ParameterError[] = [];
  const out: ResolvedParameters = {};

  for (const key of Object.keys(values)) {
    if (!(key in defs)) errors.push({ parameter: key, message: 'is not declared by this workflow' });
  }

  for (const [key, def] of Object.entries(defs)) {
    const raw = values[key] ?? def.default;
    if (raw === undefined || raw === null || raw === '') {
      if (def.required) errors.push({ parameter: key, message: 'is required' });
      continue;
    }
    const fail = (message: string) => errors.push({ parameter: key, message });

    switch (def.type) {
      case 'string':
      case 'file':
      case 'directory': {
        if (typeof raw !== 'string') { fail('must be a string'); break; }
        if (def.type === 'string') {
          if (def.minLength !== undefined && raw.length < def.minLength) fail(`must be at least ${def.minLength} characters`);
          if (def.maxLength !== undefined && raw.length > def.maxLength) fail(`must be at most ${def.maxLength} characters`);
          if (def.pattern !== undefined && !new RegExp(def.pattern).test(raw)) fail(`must match ${def.pattern}`);
        }
        out[key] = raw;
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) { fail('must be a number'); break; }
        if (def.integer && !Number.isInteger(n)) fail('must be an integer');
        if (def.min !== undefined && n < def.min) fail(`must be >= ${def.min}`);
        if (def.max !== undefined && n > def.max) fail(`must be <= ${def.max}`);
        out[key] = n;
        break;
      }
      case 'boolean': {
        const b = typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : undefined;
        if (b === undefined) { fail('must be true or false'); break; }
        out[key] = b;
        break;
      }
      case 'select': {
        if (typeof raw !== 'string' || !def.options.includes(raw)) { fail(`must be one of: ${def.options.join(', ')}`); break; }
        out[key] = raw;
        break;
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}
