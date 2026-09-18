import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@bruno-capture/shared';
import { BUILT_IN_PRESETS } from '@bruno-capture/shared';
import { CapturePlanner, PlanValidationError, ProviderError, buildUserMessage, describeCapabilities, suggestWorkflows, validatePlan, type AIProvider, type RawPlan } from '../src/index.js';

const caps: Capabilities = {
  features: [{ id: 'runner', name: 'Runner', workflowCount: 1 }],
  workflows: [{
    id: 'runner-collection-run', name: 'Run a Collection', description: 'Runs the demo collection in the Runner.', kind: 'workflow', feature: 'runner', tags: ['runner'],
    supportedOutputs: ['screenshots', 'video', 'gif'], parameters: { environment: { type: 'select', options: ['Demo', 'Staging'], default: 'Demo', required: false } },
    captureIds: ['runner-open', 'runner-complete'], hasRecordingBounds: true, source: 'built-in', sourcePath: '/w', valid: true, selectorDebt: 0,
  }, {
    id: 'request-send', name: 'Send a Request', description: 'Opens a request and sends it.', kind: 'workflow', feature: 'request-execution', tags: [],
    supportedOutputs: ['screenshots', 'video'], parameters: {}, captureIds: ['response'], hasRecordingBounds: false, source: 'built-in', sourcePath: '/w2', valid: true, selectorDebt: 0,
  }],
  presets: [...BUILT_IN_PRESETS],
  outputs: ['screenshot', 'screenshots', 'video', 'gif'],
  actions: [], regions: [], states: [], fixtures: [], testIds: [], bruno: {},
};
const good: RawPlan = { type: 'workflow', workflowId: 'runner-collection-run', output: 'gif', preset: 'docs-gif', parameters: [{ name: 'environment', value: 'Demo' }], confidence: 0.93, rationale: 'Runner GIF.' };

function fake(id: 'openai' | 'anthropic', script: Array<RawPlan | Error | string>): AIProvider & { calls: number; repairs: number } {
  let i = 0;
  const p = {
    id, model: `${id}-model`, calls: 0, repairs: 0,
    async planCapture(req: { repair?: unknown }) {
      p.calls++; if (req.repair) p.repairs++;
      const step = script[Math.min(i++, script.length - 1)]!;
      if (step instanceof Error) throw step;
      if (typeof step === 'string') throw new ProviderError(id, 'malformed', step);
      return step;
    },
    async composeWorkflow() { throw new ProviderError(id, 'provider', 'not used here'); },
    async healStep() { throw new ProviderError(id, 'provider', 'not used here'); },
    async testConnection() { return { ok: true, provider: id, model: `${id}-model`, message: 'ok' }; },
  };
  return p;
}

describe('validatePlan (PRD §15 order)', () => {
  it('accepts a valid plan and resolves typed parameters + confidence band', () => {
    const v = validatePlan(good, caps);
    expect(v.plan).toMatchObject({ type: 'workflow', workflow: 'runner-collection-run', output: 'gif', preset: 'docs-gif' });
    expect(v.parameters).toEqual({ environment: 'Demo' });
    expect(v.band).toBe('ready');
  });
  it('rejects schema violations before anything else', () => {
    expect(() => validatePlan({ ...good, confidence: 7 }, caps)).toThrow(PlanValidationError);
    expect(() => validatePlan({ nope: true }, caps)).toThrow(PlanValidationError);
  });
  it('rejects unknown workflows with the valid ids in the message', () => {
    try { validatePlan({ ...good, workflowId: 'mock-server-start' }, caps); throw new Error('no'); }
    catch (e) { expect((e as PlanValidationError).issues[0]).toMatchObject({ path: 'workflowId' }); expect((e as PlanValidationError).issues[0]!.message).toContain('runner-collection-run'); }
  });
  it('rejects unsupported outputs, undeclared and off-enum parameters, and wrong presets together', () => {
    try { validatePlan({ ...good, workflowId: 'request-send', output: 'gif', preset: 'demo-video', parameters: [{ name: 'environment', value: 'Prod' }, { name: 'bogus', value: '1' }] }, caps); throw new Error('no'); }
    catch (e) {
      const paths = (e as PlanValidationError).issues.map((i) => i.path).sort();
      expect(paths).toEqual(['output', 'parameters.bogus', 'parameters.environment', 'preset']);
    }
  });
  it('maps kind:capture workflows to capture plans and enforces type', () => {
    const capCaps = { ...caps, workflows: [{ ...caps.workflows[0]!, id: 'runner-open', kind: 'capture' as const, supportedOutputs: ['screenshot' as const] }] };
    const v = validatePlan({ ...good, type: 'capture', workflowId: 'runner-open', output: 'screenshot', preset: 'docs-screenshot', parameters: [] }, capCaps);
    expect(v.plan).toMatchObject({ type: 'capture', feature: 'runner', capture: 'runner-open', output: 'screenshot' });
    expect(() => validatePlan({ ...good, type: 'capture' }, caps)).toThrow(/kind workflow/);
  });
});

describe('prompt', () => {
  it('lists only ids, descriptions, parameter schemas, presets and outputs', () => {
    const text = describeCapabilities(caps);
    expect(text).toContain('id: runner-collection-run');
    expect(text).toContain('environment: select, one of: Demo | Staging, default "Demo"');
    expect(text).not.toMatch(/data-testid|playwright|\/Users\//);
    expect(buildUserMessage({ prompt: 'x', capabilities: caps, preferredOutput: 'auto', repair: { previous: 'junk', issues: ['bad'] } })).toContain('PREVIOUS ANSWER WAS REJECTED');
  });
  it('suggests workflows lexically for low confidence', () => {
    expect(suggestWorkflows('show the runner running a collection', caps)[0]!.id).toBe('runner-collection-run');
  });
});

describe('CapturePlanner (PRD §11 contract)', () => {
  it('valid plan on the preferred provider: no repair, no fallback', async () => {
    const a = fake('anthropic', [good]); const o = fake('openai', [good]);
    const r = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: true, providers: { anthropic: a, openai: o } }).plan('runner gif', caps);
    expect(r.ok && r.attribution).toMatchObject({ provider: 'anthropic', fallbackOccurred: false, repaired: false });
    expect(a.calls).toBe(1); expect(o.calls).toBe(0);
  });
  it('invalid plan → one repair on the same provider', async () => {
    const a = fake('anthropic', [{ ...good, workflowId: 'nope' }, good]);
    const r = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: true, providers: { anthropic: a } }).plan('runner gif', caps);
    expect(r.ok && r.attribution.repaired).toBe(true);
    expect(a.calls).toBe(2); expect(a.repairs).toBe(1);
  });
  it('malformed JSON counts as invalid → repair', async () => {
    const a = fake('anthropic', ['not json', good]);
    const r = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: false, providers: { anthropic: a } }).plan('runner gif', caps);
    expect(r.ok).toBe(true); expect(a.repairs).toBe(1);
  });
  it('still invalid after repair → the other provider is attempted, and fallback is reported', async () => {
    const a = fake('anthropic', [{ ...good, workflowId: 'nope' }]); const o = fake('openai', [good]);
    const r = await new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: true, providers: { anthropic: a, openai: o } }).plan('runner gif', caps);
    expect(r.ok && r.attribution).toMatchObject({ provider: 'openai', fallbackOccurred: true, fallbackFrom: 'anthropic' });
    expect(a.calls).toBe(2); expect(o.calls).toBe(1);
  });
  it('network/timeout/quota errors fall back immediately; auth errors do not bounce', async () => {
    const down = fake('openai', [new ProviderError('openai', 'network', 'down')]); const a = fake('anthropic', [good]);
    const r1 = await new CapturePlanner({ preferred: 'openai', fallbackEnabled: true, providers: { openai: down, anthropic: a } }).plan('runner gif', caps);
    expect(r1.ok && r1.attribution).toMatchObject({ provider: 'anthropic', fallbackOccurred: true });
    const bad = fake('openai', [new ProviderError('openai', 'auth', 'bad key')]);
    const r2 = await new CapturePlanner({ preferred: 'openai', fallbackEnabled: true, providers: { openai: bad, anthropic: a } }).plan('runner gif', caps);
    expect(r2.ok).toBe(false); expect(!r2.ok && r2.error.code).toBe('provider_auth'); expect(a.calls).toBe(1);
  });
  it('no fallback when disabled; failure carries suggestions for manual selection', async () => {
    const down = fake('openai', [new ProviderError('openai', 'timeout', 'slow')]); const a = fake('anthropic', [good]);
    const r = await new CapturePlanner({ preferred: 'openai', fallbackEnabled: false, providers: { openai: down, anthropic: a } }).plan('run the collection', caps);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.suggestions[0]!.id).toBe('runner-collection-run');
    expect(a.calls).toBe(0);
  });
});
