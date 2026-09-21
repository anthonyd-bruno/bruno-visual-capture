import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, createContext } from '../src/index.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const RUN = 'run_01ARZ3NDEKTSV4RRFFQ69G5FAV';
let root: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: '127.0.0.1:0' };

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-lib-'));
  const dir = path.join(root, 'artifacts', RUN);
  await mkdir(path.join(dir, 'screenshots'), { recursive: true }); await mkdir(path.join(dir, 'debug'), { recursive: true });
  await writeFile(path.join(dir, 'screenshots', 'runner-open.png'), PNG_1x1);
  await writeFile(path.join(dir, 'screenshots', 'runner-complete.png'), PNG_1x1);
  await writeFile(path.join(dir, 'workflow.yaml'), 'version: 1\nid: runner-collection-run\nname: x\nfeature: runner\nsupportedOutputs: [screenshots]\nsteps:\n  - capture:\n      id: runner-open\n');
  const artifact = (f: string) => ({ id: `${RUN}:${f}`, kind: 'screenshot', captureId: f.replace('.png', ''), fileName: f, relativePath: `screenshots/${f}`, mimeType: 'image/png', bytes: PNG_1x1.length, width: 1, height: 1, createdAt: '2026-09-18T10:00:00.000Z' });
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, runId: RUN, status: 'completed', createdAt: '2026-09-18T10:00:00.000Z', completedAt: '2026-09-18T10:00:05.000Z', request: {},
    workflow: { id: 'runner-collection-run', name: 'Run a Collection', feature: 'runner', source: 'built-in', sourcePath: '/w', snapshot: 'workflow.yaml' },
    parameters: { environment: 'Demo' }, capture: { output: 'screenshots', preset: 'docs-screenshot', theme: 'light', framing: 'app-content', width: 1600, height: 1000, cursor: 'hidden', scale: 'css' },
    bruno: { executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', version: '4.1.0', mode: 'electron', profileMode: 'capture' },
    artifacts: [artifact('runner-open.png'), artifact('runner-complete.png')], steps: [], errors: [], debug: { log: 'debug/run.log', preservedWorkspace: false, intermediates: [] },
  }));
  app = await buildApp(await createContext({ root }), { serveWeb: false });
  await app.ready();
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe('library from disk (PRD §98) and archives (§74)', () => {
  it('indexes manifests at startup', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/runs', headers: H });
    expect(r.json().runs.map((x: { runId: string }) => x.runId)).toEqual([RUN]);
  });
  it('zips all artifacts plus the manifest', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/runs/${RUN}/archive`, headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toContain(`runner-collection-run-${RUN}.zip`);
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(r.rawPayload.toString('latin1')).toContain('screenshots/runner-complete.png');
    expect(r.rawPayload.toString('latin1')).toContain('manifest.json');
  });
  it('zips a selection and rejects unknown files', async () => {
    const ok = await app.inject({ method: 'POST', url: `/api/runs/${RUN}/archive`, headers: H, payload: { files: ['screenshots/runner-open.png'] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.toString('latin1')).not.toContain('runner-complete.png');
    const bad = await app.inject({ method: 'GET', url: `/api/runs/${RUN}/archive?files=../../settings.json`, headers: H });
    expect(bad.statusCode).toBe(400);
  });
  it('regenerate latest asks for review when the saved parameters no longer fit the current workflow', async () => {
    // The real built-in workflow only offers environment: Demo; the saved run used it, so latest can start —
    // but starting would launch Bruno. Exact needs no registry and would also launch. Cover the 404 path here.
    const r = await app.inject({ method: 'POST', url: `/api/runs/run_00000000000000000000000000/regenerate`, headers: H, payload: { mode: 'exact' } });
    expect(r.statusCode).toBe(404);
  });
  it('reveal/open refuse paths outside the run', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/runs/${RUN}/open`, headers: H, payload: { path: '../manifest.json' } });
    expect(r.statusCode).toBe(400);
  });
  it('accepts body-less requests that still carry a JSON content-type (the web client\'s DELETE/POST)', async () => {
    // Fastify's default JSON parser answers 400 "Body cannot be empty" here; that broke deleting library items.
    const J = { ...H, 'content-type': 'application/json' };
    expect((await app.inject({ method: 'POST', url: '/api/workflows/refresh', headers: J })).statusCode).toBe(200);
    const bad = await app.inject({ method: 'POST', url: `/api/runs/${RUN}/open`, headers: J, payload: '{not json' });
    expect(bad.statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: `/api/runs/${RUN}`, headers: J });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: RUN });
    expect((await app.inject({ method: 'GET', url: `/api/runs/${RUN}`, headers: H })).statusCode).toBe(404);
  });
});
