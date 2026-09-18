import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PRESETS, CapturePlanSchema, CapturePresetSchema, CreateRunRequestSchema, RunEventSchema, SettingsSchema, confidenceBand,
} from '../src/index.js';

describe('presets', () => {
  it('built-in presets validate against their own schema', () => {
    for (const p of BUILT_IN_PRESETS) expect(() => CapturePresetSchema.parse(p)).not.toThrow();
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual(['docs-screenshot', 'docs-wide', 'demo-video', 'docs-gif']);
  });
});

describe('CapturePlanSchema', () => {
  it('accepts both plan shapes and rejects screenshot output on workflow plans', () => {
    expect(CapturePlanSchema.parse({ type: 'workflow', workflow: 'runner-collection-run', output: 'gif', preset: 'docs-gif', confidence: 0.92 }).parameters).toEqual({});
    expect(CapturePlanSchema.safeParse({ type: 'workflow', workflow: 'x', output: 'screenshot', preset: 'docs-gif', confidence: 0.9 }).success).toBe(false);
    expect(CapturePlanSchema.safeParse({ type: 'capture', feature: 'runner', capture: 'runner-open', output: 'screenshot', preset: 'docs-screenshot', confidence: 1.2 }).success).toBe(false);
  });
  it('bands confidence per PRD §16', () => {
    expect(confidenceBand(0.8)).toBe('ready');
    expect(confidenceBand(0.79)).toBe('review');
    expect(confidenceBand(0.49)).toBe('low');
  });
});

describe('CreateRunRequestSchema', () => {
  it('accepts the PRD §85 example', () => {
    const r = CreateRunRequestSchema.parse({ workflowId: 'runner-collection-run', output: 'video', preset: 'demo-video', parameters: { environment: 'Development' }, overrides: { theme: 'dark', width: 1920, height: 1080, cursor: 'smooth' } });
    expect(r.cancelActive).toBe(false);
  });
  it('rejects unknown top-level keys', () => {
    expect(CreateRunRequestSchema.safeParse({ workflowId: 'a', output: 'video', shell: 'rm' }).success).toBe(false);
  });
});

describe('SettingsSchema', () => {
  it('fills every default from an empty object', () => {
    const s = SettingsSchema.parse({});
    expect(s.capture.defaultPreset).toBe('docs-screenshot');
    expect(s.capture.profileMode).toBe('user');
    expect(s.ai.anthropic.model).toBe('claude-opus-5');
    expect(s.bruno.executablePath).toBeNull();
  });
});

describe('RunEventSchema', () => {
  it('validates a preview frame and rejects non-image data urls', () => {
    const base = { runId: 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV', at: new Date().toISOString() };
    expect(RunEventSchema.safeParse({ type: 'preview.frame', ...base, dataUrl: 'data:image/jpeg;base64,AAA', width: 1, height: 1 }).success).toBe(true);
    expect(RunEventSchema.safeParse({ type: 'preview.frame', ...base, dataUrl: 'data:text/html,x', width: 1, height: 1 }).success).toBe(false);
  });
});
