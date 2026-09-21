import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BUILT_IN_PRESETS, WorkflowDefinitionSchema, type Capabilities } from '@bruno-capture/shared';
import { CapturePlanner, PlanValidationError, ProviderError, RawRefineSchema, diffSteps, rawStepsToSteps, stepsToRaw, validateRefinement, type AIProvider, type ComposeCatalog, type RawRefine, type RefineCurrent } from '../src/index.js';
import { zodTextFormat } from 'openai/helpers/zod';

const ACTIONS = {
  'workspace.open': z.object({}),
  'collection.open': z.object({ name: z.string().min(1) }),
  'request.open': z.object({ name: z.string().min(1) }),
  'request.send': z.object({ timeoutMs: z.number().int().positive().optional() }),
  'request.setAuth': z.object({ mode: z.enum(['bearer', 'basic']), token: z.string().optional(), reveal: z.boolean().default(false) }),
  'request.revealSecret': z.object({}),
  'ui.click': z.object({ testId: z.string().optional(), css: z.string().optional(), index: z.number().int().default(0) }),
  'ui.type': z.object({ css: z.string().optional(), testId: z.string().optional(), value: z.string(), clear: z.boolean().default(false) }),
  'ui.press': z.object({ key: z.string(), target: z.object({ css: z.string().optional() }).optional() }),
  'ui.waitFor': z.object({ css: z.string().optional(), state: z.enum(['visible', 'hidden']).default('visible'), timeoutMs: z.number().int().positive().default(15000) }),
  'ui.waitForText': z.object({ text: z.string(), timeoutMs: z.number().int().positive().default(15000) }),
} as const;
const caps: Capabilities = {
  features: [], outputs: ['screenshot', 'screenshots', 'video', 'gif'], presets: [...BUILT_IN_PRESETS], workflows: [],
  actions: Object.entries(ACTIONS).map(([id, schema]) => ({ id, description: id, params: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>, retryable: true, rung: 1 })),
  regions: [{ id: 'app.shell', description: '' }, { id: 'request.editor', description: '' }, { id: 'response.body', description: '' }],
  states: [{ id: 'response.received', description: '' }, { id: 'request.open', description: '' }],
  fixtures: [{ path: 'request-execution/jsonplaceholder', description: '', collection: { name: 'JSONPlaceholder', requests: [], environments: [] }, files: [] }],
  testIds: ['secret-reveal-toggle'], bruno: {},
};
const catalog: ComposeCatalog = { capabilities: caps, validateActionParams: (id, params) => { const s = ACTIONS[id as keyof typeof ACTIONS]; if (!s) return [{ path: '', message: 'unknown' }]; const r = s.safeParse(params); return r.success ? undefined : r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })); } };

const definition = WorkflowDefinitionSchema.parse({
  version: 1, id: 'add-a-bearer-token-abc123', name: 'Add a bearer token', description: 'Bearer auth then send.', feature: 'request-execution', supportedOutputs: ['screenshots', 'video', 'gif'],
  fixture: { source: 'bundled', path: 'request-execution/jsonplaceholder' }, defaults: { preset: 'docs-gif' },
  steps: [
    { action: 'workspace.open' },
    { action: 'collection.open', params: { name: 'JSONPlaceholder' } },
    { action: 'request.open', params: { name: 'Get user' }, label: 'Open the request' },
    { startRecording: {} },
    { action: 'request.setAuth', params: { mode: 'bearer', token: 'tok-123' } },
    { pause: 500 },
    { capture: { id: 'auth-configured', name: 'Bearer token configured', framing: 'region', region: 'request.editor' } },
    { action: 'request.send', params: { timeoutMs: 20000 } },
    { waitFor: { state: 'response.received', timeoutMs: 30000 } },
    { waitFor: { text: { region: 'response.body', contains: '200' } } },
    { waitFor: { visible: { region: 'response.body' } } },
    { waitFor: { hidden: { locator: '.toast' }, timeoutMs: 5000 } },
    { selectorAction: { operation: 'click', locator: '#x' } },
    { selectorAction: { operation: 'fill', locator: '#y', value: 'hello' } },
    { capture: { id: 'response', name: 'Response' } },
    { stopRecording: {} },
  ],
});
const current: RefineCurrent = { definition, output: 'gif', preset: 'docs-gif', overrides: {}, prompt: 'Show how to add a bearer token to a request and send it', feedback: [] };

describe('stepsToRaw ⇄ rawStepsToSteps', () => {
  it('round-trips every representable step kind and maps the §38 escape hatch onto ui.* primitives', () => {
    const raw = stepsToRaw(definition.steps);
    const issues: Array<{ path: string; message: string }> = [];
    const back = rawStepsToSteps(raw, catalog, issues);
    expect(issues).toEqual([]);
    const again = WorkflowDefinitionSchema.parse({ ...definition, steps: back });
    // Unchanged kinds are identical; the two selectorAction steps became ui.click / ui.type, the locator wait became ui.waitFor.
    const strip = (s: unknown) => JSON.parse(JSON.stringify(s));
    expect(strip(again.steps.slice(0, 11))).toEqual(strip(definition.steps.slice(0, 11)));
    expect(again.steps[11]).toMatchObject({ action: 'ui.waitFor', params: { css: '.toast', state: 'hidden', timeoutMs: 5000 } });
    expect(again.steps[12]).toMatchObject({ action: 'ui.click', params: { css: '#x' } });
    expect(again.steps[13]).toMatchObject({ action: 'ui.type', params: { css: '#y', value: 'hello', clear: true } });
    expect(again.steps.slice(14)).toEqual(definition.steps.slice(14));
  });
});

const unchanged = (): RawRefine => ({ steps: stepsToRaw(definition.steps), name: null, description: null, output: null, preset: null, theme: null, cursor: null, width: null, height: null, bundledFixturePath: null, inlineCollectionJson: null, changes: [], rationale: 'no change', confidence: 0.9 });

describe('validateRefinement', () => {
  it('applies a one-param change and reports the diff, keeping the id and everything else', () => {
    const r = unchanged();
    const auth = r.steps.find((s) => s.action === 'request.setAuth')!;
    auth.params = [...auth.params, { name: 'reveal', value: 'true' }];
    r.changes = ['Reveal the token after entering it'];
    const v = validateRefinement(r, catalog, current);
    expect(v.definition.id).toBe(definition.id);
    expect(v.output).toBe('gif'); expect(v.preset.id).toBe('docs-gif'); expect(v.settingsChanged).toEqual([]);
    const setAuth = v.definition.steps[4]!;
    expect('action' in setAuth && setAuth.params).toEqual({ mode: 'bearer', token: 'tok-123', reveal: true });
    const added = v.diff.filter((d) => d.kind === 'added').map((d) => d.line);
    expect(added).toContain('- action request.setAuth {mode: bearer, token: tok-123, reveal: true}');
    // The three §38/locator steps are re-expressed as ui.* actions, so they show up as changed lines too.
    expect(added).toHaveLength(4); expect(v.diff.filter((d) => d.kind === 'removed')).toHaveLength(4);
    // selectorAction steps were re-expressed; they count as css debt but not as diff noise beyond their own lines.
    expect(v.debt).toBe(3);
  });
  it('changes output/preset/theme and validates them together; unknown presets and missing captures are rejected', () => {
    const r = { ...unchanged(), output: 'screenshots' as const, theme: 'dark' as const, width: 1920 };
    const v = validateRefinement(r, catalog, current);
    expect(v.output).toBe('screenshots'); expect(v.preset.id).toBe('docs-screenshot'); expect(v.overrides).toMatchObject({ theme: 'dark', width: 1920 });
    expect(v.settingsChanged).toEqual(['output gif → screenshots', 'preset docs-gif → docs-screenshot', 'theme → dark', 'width → 1920']);
    expect(() => validateRefinement({ ...unchanged(), preset: 'nope' }, catalog, current)).toThrow(PlanValidationError);
    expect(() => validateRefinement({ ...unchanged(), output: 'video' as const, preset: 'docs-screenshot' }, catalog, current)).toThrow(/preset "docs-screenshot" is for/);
    const noCaptures = { ...unchanged(), output: 'screenshots' as const, steps: stepsToRaw(definition.steps).filter((s) => s.kind !== 'capture') };
    expect(() => validateRefinement(noCaptures, catalog, current)).toThrow(/needs at least one capture/);
  });
  it('can swap the fixture and rename', () => {
    const v = validateRefinement({ ...unchanged(), name: 'Bearer token (revealed)', inlineCollectionJson: JSON.stringify({ name: 'Mine', requests: [{ name: 'Get user', url: 'https://x.test/u' }] }) }, catalog, current);
    expect(v.definition.name).toBe('Bearer token (revealed)');
    expect(v.definition.fixture).toMatchObject({ source: 'inline', collection: { name: 'Mine' } });
  });
  it('schema stays strict-compatible', () => {
    const fmt = zodTextFormat(RawRefineSchema, 'refine') as unknown as { schema: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } };
    expect(fmt.schema.additionalProperties).toBe(false);
    expect(fmt.schema.required.sort()).toEqual(Object.keys(fmt.schema.properties).sort());
  });
});

describe('diffSteps', () => {
  it('marks insertions and deletions, keeps common steps', () => {
    const a = definition.steps.slice(0, 4), b = [...definition.steps.slice(0, 2), definition.steps[4]!, ...definition.steps.slice(2, 4)];
    const d = diffSteps(a, b);
    expect(d.map((x) => x.kind)).toEqual(['same', 'same', 'added', 'same', 'same']);
  });
});

describe('CapturePlanner.refine', () => {
  it('drives the provider with repair on invalid answers', async () => {
    let calls = 0;
    const p: AIProvider = { id: 'anthropic', model: 'm',
      async planCapture() { throw new ProviderError('anthropic', 'provider', 'n/a'); }, async composeWorkflow() { throw new ProviderError('anthropic', 'provider', 'n/a'); }, async healStep() { throw new ProviderError('anthropic', 'provider', 'n/a'); },
      async refineWorkflow(req) { calls++; return req.repair ? { ...unchanged(), theme: 'dark' } : { ...unchanged(), preset: 'bogus' }; },
      async testConnection() { return { ok: true, provider: 'anthropic', model: 'm', message: 'ok' }; } };
    const r = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: false, providers: { anthropic: p } }).refine('dark theme', catalog, current);
    expect(r.ok && r.result.overrides.theme).toBe('dark'); expect(r.ok && r.attribution.repaired).toBe(true); expect(calls).toBe(2);
  });
});
