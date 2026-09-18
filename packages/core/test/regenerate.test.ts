import { describe, expect, it } from 'vitest';
import { WorkflowDefinitionSchema, type RunManifest } from '@bruno-capture/shared';
import { assessRegenerateLatest } from '../src/index.js';

const def = (params: Record<string, unknown>, outputs = ['screenshots']) => WorkflowDefinitionSchema.parse({ version: 1, id: 'wf', name: 'wf', feature: 'runner', supportedOutputs: outputs, parameters: params, steps: [{ action: 'runner.open' }, { capture: { id: 'a' } }] });
const manifest = (parameters: Record<string, string | number | boolean>, output = 'screenshots') => ({ parameters, capture: { output } } as unknown as RunManifest);

describe('assessRegenerateLatest (PRD §71)', () => {
  it('re-applies saved parameters when they still fit', () => {
    const r = assessRegenerateLatest(manifest({ environment: 'Demo' }), def({ environment: { type: 'select', options: ['Demo', 'Staging'] } }));
    expect(r).toEqual({ ok: true, parameters: { environment: 'Demo' } });
  });
  it('requires review when a parameter was removed, changed type, became invalid, or a new required one appeared', () => {
    expect(assessRegenerateLatest(manifest({ environment: 'Demo' }), def({})).ok).toBe(false);
    expect(assessRegenerateLatest(manifest({ iterations: 'three' }), def({ iterations: { type: 'number' } })).ok).toBe(false);
    expect(assessRegenerateLatest(manifest({ environment: 'Demo' }), def({ environment: { type: 'select', options: ['Staging'] } })).ok).toBe(false);
    const r = assessRegenerateLatest(manifest({}), def({ baseUrl: { type: 'string', required: true } }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues).toEqual([{ path: 'parameters.baseUrl', message: 'is required' }]);
  });
  it('requires review when the output is no longer supported', () => {
    const r = assessRegenerateLatest(manifest({}, 'gif'), def({}, ['screenshots']));
    expect(!r.ok && r.issues[0]).toMatchObject({ path: 'output' });
  });
});
