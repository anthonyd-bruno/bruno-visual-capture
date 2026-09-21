import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BUILT_IN_PRESETS, type Capabilities } from '@bruno-capture/shared';
import { z } from 'zod';
import {
  CapturePlanner, PlanValidationError, ProviderError, RawComposedPlanSchema, RawHealSchema, buildComposeMessage, buildHealMessage, coerceParams, rawStep, validateComposedPlan, validateHeal,
  type AIProvider, type ComposeCatalog, type RawComposedPlan,
} from '../src/index.js';
const S = rawStep;

const uiTarget = z.object({ testId: z.string().optional(), text: z.string().optional(), index: z.number().int().default(0) });
const ACTIONS = {
  'workspace.open': z.object({ collections: z.array(z.string()).optional() }),
  'collection.open': z.object({ name: z.string().min(1) }),
  'request.open': z.object({ name: z.string().min(1) }),
  'request.send': z.object({ timeoutMs: z.number().int().positive().optional() }),
  'request.setAuth': z.object({ mode: z.enum(['bearer', 'basic']), token: z.string().optional() }),
  'ui.click': uiTarget.extend({ button: z.enum(['left', 'right']).default('left') }),
  'ui.waitFor': uiTarget.extend({ state: z.enum(['visible', 'hidden']).default('visible') }),
} as const;

const caps: Capabilities = {
  features: [], outputs: ['screenshot', 'screenshots', 'video', 'gif'], presets: [...BUILT_IN_PRESETS],
  workflows: [{ id: 'request-send-response', name: 'Send a Request', description: 'sends', kind: 'workflow', feature: 'request-execution', tags: [], supportedOutputs: ['screenshots', 'video', 'gif'], parameters: { request: { type: 'select', options: ['Create post', 'Get user'], default: 'Create post', required: false } }, captureIds: ['response-displayed'], hasRecordingBounds: true, source: 'built-in', sourcePath: '/w', valid: true, selectorDebt: 0, steps: [{ action: 'workspace.open', params: {} }] }],
  actions: Object.entries(ACTIONS).map(([id, schema]) => ({ id, description: id, params: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>, retryable: true, rung: 1 })),
  regions: [{ id: 'app.shell', description: 'app' }, { id: 'response.body', description: 'response' }],
  states: [{ id: 'response.received', description: 'got response' }, { id: 'collection.open', description: 'open' }],
  fixtures: [{ path: 'request-execution/jsonplaceholder', description: 'demo', collection: { name: 'JSONPlaceholder', requests: [{ name: 'Get user', method: 'GET', url: '{{baseUrl}}/users/1' }], environments: [{ name: 'Demo', variables: ['baseUrl'] }] }, files: [] }],
  testIds: ['sidebar', 'request-pane', 'save-request-button'],
  bruno: { version: '4.1.0' },
};
const catalog: ComposeCatalog = {
  capabilities: caps,
  validateActionParams: (id, params) => { const s = ACTIONS[id as keyof typeof ACTIONS]; if (!s) return [{ path: '', message: 'unknown' }]; const r = s.safeParse(params); return r.success ? undefined : r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })); },
};

const composed: RawComposedPlan = {
  mode: 'compose', reuse: null, output: 'screenshots', preset: 'docs-screenshot', confidence: 0.9, rationale: 'Bearer auth on a request.',
  compose: {
    name: 'Add a bearer token', description: 'Sets bearer auth and sends.', feature: 'Request Execution', tags: ['auth'],
    fixtureKind: 'bundled', bundledFixturePath: 'request-execution/jsonplaceholder', inlineCollectionJson: null,
    steps: [
      S({ kind: 'action', action: 'workspace.open' }),
      S({ kind: 'action', action: 'collection.open', params: [{ name: 'name', value: 'JSONPlaceholder' }] }),
      S({ kind: 'action', action: 'request.open', params: [{ name: 'name', value: 'Get user' }], label: 'Open Get user' }),
      S({ kind: 'action', action: 'request.setAuth', params: [{ name: 'mode', value: 'bearer' }, { name: 'token', value: 'abc' }] }),
      S({ kind: 'pause', ms: 500 }),
      S({ kind: 'capture', id: 'Auth Configured', name: 'Bearer token set' }),
      S({ kind: 'action', action: 'request.send', params: [{ name: 'timeoutMs', value: '20000' }] }),
      S({ kind: 'waitForState', state: 'response.received' }),
      S({ kind: 'capture', id: 'response', name: 'Response', region: 'response.body' }),
    ],
  },
};

describe('validateComposedPlan', () => {
  it('maps a composed plan to a valid workflow definition with coerced params and slugged ids', () => {
    const v = validateComposedPlan(composed, catalog);
    expect(v.kind).toBe('compose');
    if (v.kind !== 'compose') return;
    expect(v.definition.feature).toBe('request-execution');
    expect(v.definition.fixture).toEqual({ source: 'bundled', path: 'request-execution/jsonplaceholder' });
    expect(v.definition.steps).toHaveLength(9);
    const send = v.definition.steps[6]!;
    expect('action' in send && send.params).toEqual({ timeoutMs: 20000 });
    const cap = v.definition.steps[5]!;
    expect('capture' in cap && cap.capture.id).toBe('auth-configured');
    expect(v.definition.supportedOutputs).toEqual(['screenshots', 'video', 'gif']);
    expect(v.band).toBe('ready'); expect(v.debt).toBe(0); expect(v.primitives).toBe(0);
    expect(v.plan).toMatchObject({ type: 'composed', output: 'screenshots', preset: 'docs-screenshot' });
  });
  it('reports unknown actions, bad params, unknown states/regions/fixtures and wrong presets together', () => {
    const bad: RawComposedPlan = { ...composed, preset: 'demo-video', compose: { ...composed.compose!, bundledFixturePath: 'nope/none', steps: [
      S({ kind: 'action', action: 'runner.launch' }),
      S({ kind: 'action', action: 'request.setAuth', params: [{ name: 'mode', value: 'oauth' }] }),
      S({ kind: 'waitForState', state: 'runner.done' }),
      S({ kind: 'capture', id: 'x', name: 'x', region: 'nowhere' }),
    ] } };
    try { validateComposedPlan(bad, catalog); throw new Error('no'); }
    catch (e) {
      expect(e).toBeInstanceOf(PlanValidationError);
      const paths = (e as PlanValidationError).issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['preset', 'compose.bundledFixturePath', 'compose.steps[0].action', 'compose.steps[1].params.mode', 'compose.steps[2].state', 'compose.steps[3].region']));
    }
  });
  it('builds inline fixtures from the flat AI shape and counts ui primitives / css debt', () => {
    const inline: RawComposedPlan = { ...composed, output: 'gif', preset: 'docs-gif', compose: { ...composed.compose!, fixtureKind: 'inline', bundledFixturePath: null, inlineCollectionJson: JSON.stringify({
      name: 'Auth Demo', environments: [{ name: 'Demo', variables: [{ name: 'baseUrl', value: 'https://example.test' }] }],
      requests: [{ name: 'Secure call', url: '{{baseUrl}}/secure', headers: [{ name: 'Accept', value: 'application/json' }], auth: { type: 'bearer', token: 'tok' } }],
    }), steps: [
      S({ kind: 'action', action: 'workspace.open' }),
      S({ kind: 'action', action: 'ui.click', params: [{ name: 'testId', value: 'save-request-button' }] }),
      S({ kind: 'action', action: 'ui.waitFor', params: [{ name: 'text', value: 'Saved' }, { name: 'index', value: '1' }] }),
    ] } };
    const v = validateComposedPlan(inline, catalog);
    if (v.kind !== 'compose') throw new Error('expected compose');
    expect(v.definition.fixture?.source).toBe('inline');
    if (v.definition.fixture?.source !== 'inline') return;
    expect(v.definition.fixture.collection.requests[0]).toMatchObject({ name: 'Secure call', auth: { type: 'bearer', token: 'tok' }, headers: [{ name: 'Accept', value: 'application/json' }] });
    expect(v.definition.supportedOutputs).toEqual(['video', 'gif']);
    expect(v.primitives).toBe(2);
    const wait = v.definition.steps[2]!;
    expect('action' in wait && wait.params).toEqual({ text: 'Saved', index: 1 });
  });
  it('routes mode reuse through the §15 pick validator', () => {
    const v = validateComposedPlan({ ...composed, mode: 'reuse', compose: null, reuse: { workflowId: 'request-send-response', parameters: [{ name: 'request', value: 'Get user' }] }, output: 'gif', preset: 'docs-gif' }, catalog);
    expect(v.kind).toBe('reuse');
    if (v.kind === 'reuse') expect(v.validated.parameters).toEqual({ request: 'Get user' });
    expect(() => validateComposedPlan({ ...composed, mode: 'reuse', compose: null, reuse: { workflowId: 'ghost', parameters: [] } }, catalog)).toThrow(PlanValidationError);
  });
  it('coerces by declared JSON-schema type only', () => {
    const schema = z.toJSONSchema(z.object({ n: z.number(), b: z.boolean(), s: z.string(), o: z.object({ a: z.string() }).optional() }), { io: 'input' }) as Record<string, unknown>;
    expect(coerceParams(schema, [{ name: 'n', value: '12' }, { name: 'b', value: 'true' }, { name: 's', value: '12' }, { name: 'o', value: '{"a":"x"}' }])).toEqual({ n: 12, b: true, s: '12', o: { a: 'x' } });
  });
});

describe('validateHeal', () => {
  it('maps replacement steps, clamps dropFollowing, and honours giveUp', () => {
    const h = validateHeal({ giveUp: false, reason: 'menu was closed', replacement: [S({ kind: 'action', action: 'ui.click', params: [{ name: 'testId', value: 'sidebar' }] }), S({ kind: 'waitForState', state: 'collection.open', ms: 5000 })], dropFollowing: 9 }, catalog, 2);
    expect(h.giveUp).toBe(false); expect(h.replacement).toHaveLength(2); expect(h.dropFollowing).toBe(2);
    expect(validateHeal({ giveUp: true, reason: 'impossible', replacement: [], dropFollowing: 0 }, catalog, 0)).toMatchObject({ giveUp: true, rationale: 'impossible' });
    expect(() => validateHeal({ giveUp: false, reason: '', replacement: [S({ kind: 'action', action: 'nope.x' })], dropFollowing: 0 }, catalog, 0)).toThrow(PlanValidationError);
    expect(() => validateComposedPlan({ ...composed, compose: { ...composed.compose!, fixtureKind: 'inline', inlineCollectionJson: '{"name": "x", "requests": []}' } }, catalog)).toThrow(/requests/);
  });
});

describe('AI-facing schemas stay strict-mode compatible for both providers', () => {
  const walk = (node: unknown, path: string, problems: string[]) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o['type'] === 'object' && o['properties']) {
      const keys = Object.keys(o['properties'] as object);
      const req = new Set((o['required'] as string[] | undefined) ?? []);
      for (const k of keys) if (!req.has(k)) problems.push(`${path}.${k} is optional`);
      if (o['additionalProperties'] !== false) problems.push(`${path} allows additional properties`);
      for (const [k, v] of Object.entries(o['properties'] as Record<string, unknown>)) walk(v, `${path}.${k}`, problems);
    }
    for (const key of ['items', 'anyOf', 'oneOf', 'allOf'] as const) {
      const v = o[key];
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${key}[${i}]`, problems));
      else if (v) walk(v, `${path}.${key}`, problems);
    }
    if (o['$defs']) for (const [k, v] of Object.entries(o['$defs'] as Record<string, unknown>)) walk(v, `${path}.$defs.${k}`, problems);
  };
  for (const [name, schema] of [['composed plan', RawComposedPlanSchema], ['heal', RawHealSchema]] as const) {
    it(`${name}: OpenAI strict format has every property required and no additional properties`, () => {
      const fmt = zodTextFormat(schema, 'x') as unknown as { schema: unknown; strict?: boolean };
      const problems: string[] = [];
      walk(fmt.schema, '$', problems);
      expect(problems).toEqual([]);
    });
    it(`${name}: Anthropic output format serialises`, () => {
      const fmt = zodOutputFormat(schema) as unknown as { schema: unknown };
      expect(JSON.stringify(fmt.schema).length).toBeGreaterThan(200);
    });
  }
});

describe('CapturePlanner.compose', () => {
  const fake = (id: 'openai' | 'anthropic', script: Array<RawComposedPlan | Error>) => {
    let i = 0; const p = { id, model: `${id}-m`, calls: 0, repairs: 0,
      async planCapture(): Promise<never> { throw new Error('not used'); },
      async composeWorkflow(req: { repair?: unknown }) { p.calls++; if (req.repair) p.repairs++; const s = script[Math.min(i++, script.length - 1)]!; if (s instanceof Error) throw s; return s; },
      async healStep(): Promise<never> { throw new Error('not used'); },
      async refineWorkflow(): Promise<never> { throw new Error('not used'); },
      async testConnection() { return { ok: true, provider: id, model: `${id}-m`, message: 'ok' }; } };
    return p as AIProvider & { calls: number; repairs: number };
  };
  it('valid composition on the preferred provider; invalid → one repair; provider error → fallback', async () => {
    const a = fake('anthropic', [composed]);
    const r1 = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: false, providers: { anthropic: a } }).compose('bearer token', catalog);
    expect(r1.ok && r1.result.kind).toBe('compose'); expect(a.calls).toBe(1);
    const b = fake('anthropic', [{ ...composed, preset: 'nope' }, composed]);
    const r2 = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: false, providers: { anthropic: b } }).compose('bearer token', catalog);
    expect(r2.ok && r2.attribution.repaired).toBe(true); expect(b.repairs).toBe(1);
    const down = fake('openai', [new ProviderError('openai', 'network', 'down')]); const c = fake('anthropic', [composed]);
    const r3 = await new CapturePlanner({ preferred: 'openai', fallbackEnabled: true, providers: { openai: down, anthropic: c } }).compose('bearer token', catalog);
    expect(r3.ok && r3.attribution).toMatchObject({ provider: 'anthropic', fallbackOccurred: true });
  });
  it('prompts carry the vocabulary but never selectors or source', () => {
    const text = buildComposeMessage({ prompt: 'x', capabilities: caps, preferredOutput: 'auto' });
    expect(text).toContain('request.setAuth'); expect(text).toContain('request-execution/jsonplaceholder'); expect(text).toContain('save-request-button');
    expect(text).not.toMatch(/\[data-testid=|page\.locator|\/Users\//);
    const heal = buildHealMessage({ heal: { goal: 'g', definition: { version: 1, id: 'w', name: 'w', description: '', kind: 'workflow', feature: 'f', tags: [], supportedOutputs: ['video'], parameters: {}, defaults: {}, steps: [{ pause: 1, continueOnError: false }] }, executed: [], failed: { pause: 1, continueOnError: false }, failedIndex: 0, error: { code: 'x', message: 'boom' }, remaining: [], observation: { at: 'now', modalOpen: true, elements: [{ tag: 'button', testId: 'modal-close-button' }], truncated: false, text: 'hello' }, attempt: 1, maxAttempts: 3 }, capabilities: caps });
    expect(heal).toContain('modalOpen: true'); expect(heal).toContain('testId=modal-close-button'); expect(heal).toContain('ERROR: boom');
  });
});
