import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, createContext } from '../src/index.js';

let root: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: '127.0.0.1:0' };

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-server-'));
  app = await buildApp(await createContext({ root }), { serveWeb: false });
  await app.ready();
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe('loopback guard (PRD §20)', () => {
  it('rejects a foreign Host header', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:0' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('forbidden_host');
  });
  it('rejects a foreign Origin and accepts its own', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { ...H, origin: 'http://evil.example' } })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/health', headers: { ...H, origin: 'http://127.0.0.1:0' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects non-loopback clients', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: H, remoteAddress: '10.0.0.7' });
    expect(r.statusCode).toBe(403);
  });
});

describe('settings routes', () => {
  it('never returns secret values, only presence', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/settings', headers: H });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.secrets).toEqual({ openai: { keyPresent: expect.any(Boolean) }, anthropic: { keyPresent: expect.any(Boolean) } });
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]/);
  });
  it('validates PUT bodies with field paths and rejects unknown keys', async () => {
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { capture: { previewFps: 50 }, evil: 1 } });
    expect(bad.statusCode).toBe(400);
    const paths = bad.json().error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('capture.previewFps');
    const ok = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { ai: { preferredProvider: 'openai' } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.ai.preferredProvider).toBe('openai');
  });
});

it('404s with the standard error shape', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/nope', headers: H });
  expect(r.statusCode).toBe(404);
  expect(r.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
});
