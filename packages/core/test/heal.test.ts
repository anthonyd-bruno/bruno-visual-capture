import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry, defineAction, type BrunoSession, type CaptureAction } from '@bruno-capture/automation';
import { InlineCollectionSchema, WorkflowDefinitionSchema, type HealRequest, type Healer, type RunEvent, type Step } from '@bruno-capture/shared';
import { GeneratedWorkflowStore, RunArtifactStore, WorkflowRegistry, WorkflowStepFailure, describeBundledFixtures, executeWorkflow, writeInlineCollection, type CaptureController } from '../src/index.js';

vi.mock('@bruno-capture/automation', async (orig) => {
  const mod = await orig<typeof import('@bruno-capture/automation')>();
  return { ...mod, observePage: async () => ({ at: 'now', modalOpen: false, elements: [{ tag: 'button', testId: 'x' }], truncated: false, text: 'page' }) };
});

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fakeSession = { page: { isClosed: () => false, waitForTimeout: async () => undefined }, mode: 'electron' } as unknown as BrunoSession;
const fakeCapture = { screenshot: async () => PNG_1x1 } as unknown as CaptureController;
const cfg = { output: 'screenshots', preset: 'docs-screenshot', theme: 'light', framing: 'app-content', width: 1600, height: 1000, cursor: 'hidden', scale: 'css' } as const;

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bru-heal-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function registry(calls: string[]) {
  const make = (id: string, fails: boolean) => defineAction({ id, description: id, retryable: false, rung: 1, params: z.object({ name: z.string().optional() }), async execute(_c, p) { calls.push(`${id}${p.name ? ':' + p.name : ''}`); if (fails) throw Object.assign(new Error(`${id} boom`), { code: 'action_failed' }); } });
  return new ActionRegistry().register(make('ok.step', false) as CaptureAction<unknown>, make('bad.step', true) as CaptureAction<unknown>);
}
const def = (steps: unknown[]) => WorkflowDefinitionSchema.parse({ version: 1, id: 'wf', name: 'wf', description: 'demo', feature: 'runner', supportedOutputs: steps.some((x) => typeof x === 'object' && x !== null && 'capture' in x) ? ['screenshots'] : ['video'], steps });

async function run(steps: unknown[], healer: Healer | undefined, calls: string[], maxHeals = 3) {
  const events: RunEvent[] = [];
  const artifacts = await RunArtifactStore.create(root, 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  const result = await executeWorkflow({ runId: 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV', definition: def(steps), parameters: {}, captureConfig: cfg, session: fakeSession, actions: registry(calls), capture: fakeCapture, artifacts, emit: (e) => events.push(e), log: () => undefined, signal: new AbortController().signal, healer, maxHeals, goal: 'the goal' });
  return { result, events };
}

describe('self-healing executor (Phase 9)', () => {
  it('replaces a failed step with the healer\'s steps, continues, and reports the final step list', async () => {
    const calls: string[] = []; const seen: HealRequest[] = [];
    const healer: Healer = { async heal(req) { seen.push(req); return { replacement: [{ action: 'ok.step', params: { name: 'fixed' }, continueOnError: false }, { pause: 1, continueOnError: false }] as Step[], dropFollowing: 1, rationale: 'used the other button' }; } };
    const { result, events } = await run([{ action: 'ok.step' }, { action: 'bad.step' }, { pause: 1, label: 'redundant' }, { capture: { id: 'end' } }], healer, calls);
    expect(result.status).toBe('completed');
    expect(calls).toEqual(['ok.step', 'bad.step', 'ok.step:fixed']);
    expect(result.steps.map((s) => s.status)).toEqual(['completed', 'healed', 'completed', 'completed', 'completed']);
    expect(result.steps.filter((s) => s.inserted)).toHaveLength(2);
    expect(result.heals).toEqual({ attempts: 1, healed: 1, duringRecording: 0 });
    expect(result.finalSteps.map((s) => ('action' in s ? s.action : 'capture' in s ? 'capture' : 'pause'))).toEqual(['ok.step', 'ok.step', 'pause', 'capture']);
    expect(events.map((e) => e.type)).toContain('workflow.healing'); expect(events.map((e) => e.type)).toContain('workflow.healed');
    const healed = events.find((e) => e.type === 'workflow.healed') as Extract<RunEvent, { type: 'workflow.healed' }>;
    expect(healed.total).toBe(4); expect(healed.dropped).toBe(1); expect(healed.replacement).toHaveLength(2);
    expect(seen[0]).toMatchObject({ goal: 'the goal', failedIndex: 1, attempt: 1, maxAttempts: 3 });
    expect(seen[0]!.executed).toHaveLength(1); expect(seen[0]!.remaining).toHaveLength(2); expect(seen[0]!.observation.elements[0]).toEqual({ tag: 'button', testId: 'x' });
  });
  it('gives up → the step fails exactly as without a healer; heals are bounded by maxHeals', async () => {
    const calls: string[] = [];
    const giveUp: Healer = { async heal() { return { giveUp: true, reason: 'no such feature' }; } };
    await expect(run([{ action: 'bad.step' }, { capture: { id: 'never' } }], giveUp, calls)).rejects.toBeInstanceOf(WorkflowStepFailure);
    const loop: Healer = { async heal() { return { replacement: [{ action: 'bad.step', params: {}, continueOnError: false }] as Step[], dropFollowing: 0, rationale: 'try again' }; } };
    const c2: string[] = [];
    const err = await run([{ action: 'bad.step' }, { capture: { id: 'x' } }], loop, c2, 2).then(() => undefined, (e: unknown) => e as WorkflowStepFailure);
    expect(err).toBeInstanceOf(WorkflowStepFailure);
    expect(c2).toEqual(['bad.step', 'bad.step', 'bad.step']); // original + 2 heals
    expect(err!.steps.filter((s) => s.status === 'healed')).toHaveLength(2);
    expect(err!.steps.at(-2)).toMatchObject({ status: 'failed', inserted: true });
  });
  it('counts heals that happen while recording is open, so the engine can retake', async () => {
    const calls: string[] = [];
    const healer: Healer = { async heal() { return { replacement: [{ action: 'ok.step', params: { name: 'fixed' }, continueOnError: false }] as Step[], dropFollowing: 0, rationale: 'fixed' }; } };
    const { result, events } = await run([{ action: 'bad.step', params: { name: 'before' } }, { startRecording: {} }, { action: 'bad.step', params: { name: 'inside' } }, { stopRecording: {} }, { action: 'bad.step', params: { name: 'after' } }], healer, calls, 5);
    expect(result.status).toBe('completed');
    expect(result.heals).toEqual({ attempts: 3, healed: 3, duringRecording: 1 });
    expect(events.filter((e) => e.type === 'workflow.healed')).toHaveLength(3);
    // The learned step list has no bad steps left, so a retake of it runs clean.
    expect(result.finalSteps.filter((s) => 'action' in s).map((s) => (s as { action: string }).action)).toEqual(['ok.step', 'ok.step', 'ok.step']);
  });
  it('is inert without a healer', async () => {
    const calls: string[] = [];
    await expect(run([{ action: 'bad.step' }], undefined, calls)).rejects.toBeInstanceOf(WorkflowStepFailure);
    expect(calls).toEqual(['bad.step']);
  });
});

describe('inline fixtures, fixture catalog and the generated store', () => {
  it('writes an inline collection in the YAML shapes Bruno 4.1 writes itself (S10)', async () => {
    const dir = path.join(root, 'collection');
    const c = { name: 'Auth Demo', description: 'd', files: [{ path: 'spec/openapi.yaml', content: 'openapi: 3.0.0\n' }], environments: [{ name: 'Demo', variables: [{ name: 'baseUrl', value: 'https://x.test' }] }],
      requests: [
        { name: 'Secure', method: 'GET' as const, url: '{{baseUrl}}/s', headers: [{ name: 'Accept', value: 'application/json' }], params: [], auth: { type: 'bearer' as const, token: 'tok' } },
        { name: 'Login', method: 'POST' as const, url: '{{baseUrl}}/login', headers: [], params: [{ name: 'v', value: '2' }], body: { type: 'json' as const, data: '{"a":1}' }, auth: { type: 'apikey' as const, key: 'X-Key', value: 'k', placement: 'header' as const } },
      ] };
    await writeInlineCollection(dir, InlineCollectionSchema.parse(c));
    expect((await readdir(dir)).sort()).toEqual(['Login.yml', 'Secure.yml', 'environments', 'opencollection.yml']);
    const secure = await readFile(path.join(dir, 'Secure.yml'), 'utf8');
    expect(secure).toContain('type: bearer'); expect(secure).toContain('token: tok'); expect(secure).toContain('url: "{{baseUrl}}/s"'); expect(secure).toContain('seq: 1');
    const login = await readFile(path.join(dir, 'Login.yml'), 'utf8');
    expect(login).toContain('type: apikey'); expect(login).toContain('placement: header'); expect(login).toContain('type: json'); expect(login).toContain('method: POST');
    expect(await readFile(path.join(dir, 'environments', 'Demo.yml'), 'utf8')).toContain('name: baseUrl');
    expect(await readFile(path.join(root, 'spec', 'openapi.yaml'), 'utf8')).toContain('openapi');
  });
  it('describes the bundled fixtures for the planner', async () => {
    const fx = await describeBundledFixtures(path.resolve(import.meta.dirname, '../../../fixtures'));
    const jp = fx.find((f) => f.path === 'request-execution/jsonplaceholder');
    expect(jp?.collection?.name).toBe('JSONPlaceholder');
    expect(jp?.collection?.requests.map((r) => r.name).sort()).toEqual(['Create post', 'Get user']);
    expect(jp?.collection?.environments[0]).toEqual({ name: 'Demo', variables: ['baseUrl'] });
    expect(fx.find((f) => f.path === 'openapi-sync/petstore')?.files).toEqual(expect.arrayContaining(['spec/openapi.yaml', 'spec/openapi.v2.yaml']));
  });
  it('saves generated workflows with unique ids, registers them as source "generated", updates and deletes', async () => {
    const gen = new GeneratedWorkflowStore(path.join(root, 'generated'));
    const input = { version: 1 as const, id: 'placeholder', name: 'Add a bearer token', description: 'x', feature: 'request-execution', supportedOutputs: ['screenshots' as const], steps: [{ capture: { id: 'one' } }] };
    const a = await gen.save(input, { prompt: 'show bearer auth', provider: 'anthropic', model: 'm' });
    const b = await gen.save(input);
    expect(a.id).toMatch(/^add-a-bearer-token-[a-z0-9]{6}$/); expect(a.id).not.toBe(b.id);
    expect(a.yaml.startsWith('# Generated by Bruno Capture')).toBe(true); expect(a.yaml).toContain('show bearer auth');
    const reg = new WorkflowRegistry({ builtInDir: path.join(root, 'none'), generatedDir: gen.dir, sources: () => ({ schemaVersion: 1, customDirectories: [], importedFiles: [] }) });
    await reg.refresh();
    expect(reg.get(a.id)?.source).toBe('generated'); expect(reg.summaries().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    await gen.update(a.file, { ...a.definition, steps: [...a.definition.steps, { pause: 5, continueOnError: false }] }, 'healed once');
    const text = await readFile(a.file, 'utf8');
    expect(text).toContain('healed once'); expect(text).toContain('Generated by Bruno Capture'); expect(text).toContain('pause: 5');
    expect(await gen.delete(b.id)).toBe(true); expect(await gen.delete('../evil')).toBe(false);
    await reg.refresh(); expect(reg.get(b.id)).toBeUndefined();
  });
});

describe('artifact store discard (clean retakes)', () => {
  it('removes the files and entries of one kind and frees the names', async () => {
    const store = await RunArtifactStore.create(root, 'run_01ARZ3NDEKTSV4RRFFQ69G5FAW');
    const a = await store.addScreenshot('open', PNG_1x1); await store.addScreenshot('open', PNG_1x1);
    expect(store.list().map((x) => x.fileName)).toEqual(['open.png', 'open-2.png']);
    expect(await store.discard('screenshot')).toBe(2);
    expect(store.list()).toEqual([]);
    expect(await readdir(path.dirname(path.join(store.runDir, a.relativePath)))).toEqual([]);
    const again = await store.addScreenshot('open', PNG_1x1);
    expect(again.fileName).toBe('open.png'); // take 2 gets the plain names back
  });
});
