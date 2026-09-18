import { describe, expect, it } from 'vitest';
import { ParametersSchema, resolveParameters } from '../src/index.js';

const defs = ParametersSchema.parse({
  environment: { type: 'select', label: 'Environment', options: ['Development', 'Staging'], default: 'Development' },
  baseUrl: { type: 'string', label: 'Base URL', default: 'https://example.com', pattern: '^https?://' },
  iterations: { type: 'number', integer: true, min: 1, max: 10, required: true },
  verbose: { type: 'boolean', default: false },
  spec: { type: 'file', extensions: ['.yaml', '.json'] },
});

describe('resolveParameters', () => {
  it('applies defaults and coerces form-ish strings', () => {
    const r = resolveParameters(defs, { iterations: '3', verbose: 'true' });
    expect(r).toEqual({ ok: true, values: { environment: 'Development', baseUrl: 'https://example.com', iterations: 3, verbose: true } });
  });

  it('rejects undeclared, missing-required, out-of-range and off-enum values with per-parameter errors', () => {
    const r = resolveParameters(defs, { environment: 'Prod', baseUrl: 'ftp://x', iterations: 11.5, bogus: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const byParam = Object.fromEntries(r.errors.map((e) => [e.parameter + ':' + e.message, true]));
    expect(byParam['bogus:is not declared by this workflow']).toBe(true);
    expect(byParam['environment:must be one of: Development, Staging']).toBe(true);
    expect(byParam['baseUrl:must match ^https?://']).toBe(true);
    expect(byParam['iterations:must be an integer']).toBe(true);
    expect(byParam['iterations:must be <= 10']).toBe(true);
  });

  it('treats empty strings as absent so optional form fields do not fail', () => {
    const r = resolveParameters(defs, { iterations: 2, spec: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('spec' in r.values).toBe(false);
  });
});
