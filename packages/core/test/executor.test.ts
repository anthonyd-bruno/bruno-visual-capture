import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionRegistry, defineAction, type BrunoSession, type CaptureAction } from '@bruno-capture/automation';
import { WorkflowDefinitionSchema, type RunEvent } from '@bruno-capture/shared';
import { RunArtifactStore, RunCancelled, WorkflowStepFailure, executeWorkflow, stepLabel, templateValue, type CaptureController } from '../src/index.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fakeSession = { page: { isClosed: () => false, waitForTimeout: async () => undefined }, mode: 'electron' } as unknown as BrunoSession;
const fakeCapture = { screenshot: async () => PNG_1x1 } as unknown as CaptureController;
const cfg = { output: 'screenshots', preset: 'docs-screenshot', theme: 'light', framing: 'app-content', width: 1600, height: 1000, cursor: 'hidden', scale: 'css' } as const;

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bru-exec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function registry(calls: string[], opts: { failFirst?: string; failAlways?: string } = {}) {
  const attempts: Record<string, number> = {};
  const make = (id: string, retryable: boolean) => defineAction({
    id, description: id, retryable, rung: 1, params: z.object({ name: z.string().optional() }),
    async execute(_ctx, p) {
      attempts[id] = (attempts[id] ?? 0) + 1;
      calls.push(`${id}${p.name ? ':' + p.name : ''}`);
      const e = Object.assign(new Error(`${id} boom`), { code: 'action_failed' });
      if (opts.failAlways === id) throw e;
      if (opts.failFirst === id && attempts[id] === 1) throw e;
    },
  });
  return { reg: new ActionRegistry().register(make('safe.open', true) as CaptureAction<unknown>, make('risky.send', false) as CaptureAction<unknown>), attempts };
}

async function run(steps: unknown[], reg: ActionRegistry, opts: { signal?: AbortSignal; params?: Record<string, string | number | boolean> } = {}) {
  const hasCapture = steps.some((s) => typeof s === 'object' && s !== null && 'capture' in s);
  const def = WorkflowDefinitionSchema.parse({ version: 1, id: 'wf', name: 'wf', feature: 'runner', supportedOutputs: hasCapture ? ['screenshots'] : ['video'], parameters: { who: { type: 'string', default: 'x' } }, steps });
  const events: RunEvent[] = [];
  const artifacts = await RunArtifactStore.create(root, 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  const result = await executeWorkflow({ runId: 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV', definition: def, parameters: { who: 'Demo', ...opts.params }, captureConfig: cfg, session: fakeSession, actions: reg, capture: fakeCapture, artifacts, emit: (e) => events.push(e), log: () => undefined, signal: opts.signal ?? new AbortController().signal });
  return { result, events, artifacts };
}

describe('templateValue', () => {
  it('substitutes {{param}} and keeps types for whole-string templates', () => {
    const p = { env: 'Demo', n: 3, flag: true };
    expect(templateValue({ a: 'Env: {{env}}', b: '{{n}}', c: ['{{flag}}', 'x'] }, p)).toEqual({ a: 'Env: Demo', b: 3, c: [true, 'x'] });
    expect(() => templateValue('{{nope}}', p)).toThrow(/unknown parameter "nope"/);
  });
});

describe('executeWorkflow', () => {
  it('runs steps in order, templates params, writes capture artifacts and emits events', async () => {
    const calls: string[] = [];
    const { reg } = registry(calls);
    const { result, events, artifacts } = await run([{ action: 'safe.open', params: { name: '{{who}}' } }, { capture: { id: 'shot-one' } }, { pause: 5 }], reg);
    expect(result.status).toBe('completed');
    expect(calls).toEqual(['safe.open:Demo']);
    expect(artifacts.list().map((a) => a.relativePath)).toEqual(['screenshots/shot-one.png']);
    expect(events.map((e) => e.type)).toEqual(['workflow.started', 'workflow.step.started', 'workflow.step.completed', 'workflow.step.started', 'artifact.created', 'workflow.step.completed', 'workflow.step.started', 'workflow.step.completed']);
    expect(result.steps.map((s) => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(stepLabel(WorkflowDefinitionSchema.parse({ version: 1, id: 'w', name: 'w', feature: 'f', supportedOutputs: ['video'], steps: [{ waitFor: { state: 'runner.complete' } }] }).steps[0]!, 0)).toBe('wait for runner.complete');
  });

  it('retries a retryable action once and never retries side-effecting ones (PRD §42)', async () => {
    const calls: string[] = [];
    const { reg, attempts } = registry(calls, { failFirst: 'safe.open' });
    const { result } = await run([{ action: 'safe.open' }], reg);
    expect(result.status).toBe('completed');
    expect(attempts['safe.open']).toBe(2);
    expect(result.steps[0]!.retries).toBe(1);

    const c2: string[] = [];
    const r2 = registry(c2, { failFirst: 'risky.send' });
    await expect(run([{ action: 'risky.send' }], r2.reg)).rejects.toBeInstanceOf(WorkflowStepFailure);
    expect(r2.attempts['risky.send']).toBe(1);
  });

  it('stops on the first failure by default, marking the rest skipped with a §94-style error', async () => {
    const calls: string[] = [];
    const { reg } = registry(calls, { failAlways: 'risky.send' });
    const err = await run([{ action: 'safe.open' }, { action: 'risky.send' }, { capture: { id: 'never' } }], reg).catch((e) => e as WorkflowStepFailure);
    expect(err).toBeInstanceOf(WorkflowStepFailure);
    expect(err.error).toMatchObject({ code: 'action_failed', message: 'risky.send boom', stepIndex: 1, actionId: 'risky.send' });
    expect(err.steps.map((s) => s.status)).toEqual(['completed', 'failed', 'skipped']);
  });

  it('continueOnError records the error and finishes as completed_with_errors (PRD §43)', async () => {
    const calls: string[] = [];
    const { reg } = registry(calls, { failAlways: 'risky.send' });
    const { result, events } = await run([{ action: 'risky.send', continueOnError: true }, { capture: { id: 'after' } }], reg);
    expect(result.status).toBe('completed_with_errors');
    expect(result.errors).toHaveLength(1);
    expect(events.find((e) => e.type === 'workflow.step.failed')).toMatchObject({ continued: true });
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'completed']);
  });

  it('rejects invalid action params without calling the action', async () => {
    const calls: string[] = [];
    const { reg } = registry(calls);
    const err = await run([{ action: 'safe.open', params: { name: 42 } }], reg).catch((e) => e as WorkflowStepFailure);
    expect(err.error.code).toBe('invalid_action_params');
    expect(calls).toEqual([]);
  });

  it('cancellation during a pause surfaces as RunCancelled', async () => {
    const calls: string[] = [];
    const { reg } = registry(calls);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    await expect(run([{ pause: 5000 }, { action: 'safe.open' }], reg, { signal: ac.signal })).rejects.toBeInstanceOf(RunCancelled);
    expect(calls).toEqual([]);
  });
});

describe('RunArtifactStore', () => {
  it('never overwrites: duplicate capture ids get a numeric suffix', async () => {
    const store = await RunArtifactStore.create(root, 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const a = await store.addScreenshot('Runner Open!', PNG_1x1);
    const b = await store.addScreenshot('runner-open', PNG_1x1);
    expect([a.fileName, b.fileName]).toEqual(['runner-open.png', 'runner-open-2.png']);
    expect(a).toMatchObject({ width: 1, height: 1, mimeType: 'image/png', kind: 'screenshot' });
  });
});
