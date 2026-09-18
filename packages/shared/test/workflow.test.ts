import { describe, expect, it } from 'vitest';
import { WorkflowDefinitionSchema, selectorDebt, stepKind } from '../src/index.js';

const prdExample = {
  version: 1,
  id: 'runner-collection-run',
  name: 'Run a Collection',
  description: 'Runs a collection through the Bruno Runner.',
  feature: 'runner',
  supportedOutputs: ['screenshots', 'video', 'gif'],
  parameters: { environment: { type: 'string', required: false } },
  fixture: { source: 'bundled', path: 'runner/basic-workspace' },
  defaults: { preset: 'demo-video' },
  steps: [
    { action: 'workspace.open' },
    { action: 'runner.open' },
    { capture: { id: 'runner-open' } },
    { startRecording: {} },
    { action: 'runner.runCollection' },
    { waitFor: { state: 'runner.complete' } },
    { pause: 800 },
    { capture: { id: 'runner-complete' } },
    { stopRecording: {} },
  ],
};

describe('WorkflowDefinitionSchema', () => {
  it('accepts the PRD §33 example and applies defaults', () => {
    const wf = WorkflowDefinitionSchema.parse(prdExample);
    expect(wf.kind).toBe('workflow');
    expect(wf.steps).toHaveLength(9);
    expect(wf.steps.map(stepKind)).toEqual(['action', 'action', 'capture', 'startRecording', 'action', 'waitFor', 'pause', 'capture', 'stopRecording']);
    const wait = wf.steps[5]!;
    expect('waitFor' in wait && wait.waitFor.timeoutMs).toBe(15_000);
    expect(selectorDebt(wf)).toBe(0);
  });

  it('reports a bad pause on the exact field (PRD §96)', () => {
    const res = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [...prdExample.steps.slice(0, 6), { pause: -5 }, ...prdExample.steps.slice(7)] });
    expect(res.success).toBe(false);
    const issue = res.error!.issues.find((i) => i.path.join('.') === 'steps.6.pause');
    expect(issue?.message).toMatch(/>0|greater|positive/i);
  });

  it('rejects a step with zero or multiple kinds', () => {
    const res = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [{ action: 'runner.open', pause: 100 }] });
    expect(res.success).toBe(false);
    expect(res.error!.issues[0]!.message).toMatch(/exactly one of/);
  });

  it('rejects unknown keys anywhere (no executable escape hatches)', () => {
    const res = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [{ action: 'runner.open', script: 'rm -rf /' }] });
    expect(res.success).toBe(false);
    expect(res.error!.issues.some((i) => i.code === 'unrecognized_keys' || /script/.test(i.message))).toBe(true);
  });

  it('requires balanced, ordered recording bounds', () => {
    const noStop = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: prdExample.steps.filter((s) => !('stopRecording' in s)) });
    expect(noStop.success).toBe(false);
    expect(noStop.error!.issues.map((i) => i.message).join('\n')).toMatch(/must appear together/);
  });

  it('rejects duplicate capture ids', () => {
    const res = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [{ capture: { id: 'x' } }, { capture: { id: 'x' } }] });
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.message).join('\n')).toMatch(/duplicate capture id "x"/);
  });

  it('models a capture definition as kind: capture with a single screenshot output', () => {
    const ok = WorkflowDefinitionSchema.safeParse({ version: 1, id: 'runner-open', name: 'Runner open', kind: 'capture', feature: 'runner', supportedOutputs: ['screenshot'], steps: [{ action: 'runner.open' }, { capture: { id: 'runner-open' } }] });
    expect(ok.success).toBe(true);
    const bad = WorkflowDefinitionSchema.safeParse({ version: 1, id: 'runner-open', name: 'Runner open', kind: 'capture', feature: 'runner', supportedOutputs: ['screenshots'], steps: [{ capture: { id: 'a' } }] });
    expect(bad.success).toBe(false);
  });

  it('constrains selectorAction to the allowlist and requires values where needed', () => {
    const bad = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [{ selectorAction: { operation: 'evaluate', locator: 'body' } }] });
    expect(bad.success).toBe(false);
    const noValue = WorkflowDefinitionSchema.safeParse({ ...prdExample, steps: [{ selectorAction: { operation: 'fill', locator: 'input' } }] });
    expect(noValue.success).toBe(false);
    const ok = WorkflowDefinitionSchema.parse({ ...prdExample, supportedOutputs: ['video'], steps: [{ selectorAction: { operation: 'click', locator: '[data-testid="runner-button"]' } }] });
    expect(selectorDebt(ok)).toBe(1);
  });
});
