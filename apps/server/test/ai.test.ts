import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, createContext } from '../src/index.js';

let root: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: '127.0.0.1:0' };
const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };

beforeAll(async () => {
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  root = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-ai-'));
  app = await buildApp(await createContext({ root }), { serveWeb: false });
  await app.ready();
});
afterAll(async () => {
  await app.close(); await rm(root, { recursive: true, force: true });
  if (saved.openai) process.env.OPENAI_API_KEY = saved.openai; if (saved.anthropic) process.env.ANTHROPIC_API_KEY = saved.anthropic;
});

describe('AI routes (no provider configured)', () => {
  it('POST /api/plan degrades to manual suggestions instead of failing (PRD §17)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/plan', headers: H, payload: { prompt: 'Create a GIF of the runner running a collection' } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toMatch(/provider_not_configured|no_provider/);
    expect(body.suggestions.map((w: { id: string }) => w.id)).toContain('runner-collection-run');
  });
  it('validates the plan body', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/plan', headers: H, payload: { prompt: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/plan', headers: H, payload: { prompt: 'long enough', output: 'mp4' } })).statusCode).toBe(400);
  });
  it('rejects unknown providers and short keys without touching the Keychain', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/ai/gemini/test', headers: H })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/ai/openai/key', headers: H, payload: { key: 'short' } })).statusCode).toBe(400);
    const t = await app.inject({ method: 'POST', url: '/api/ai/anthropic/test', headers: H });
    expect(t.statusCode).toBe(200); expect(t.json().ok).toBe(false); expect(t.json().message).toMatch(/Not configured/);
  });
  it('never returns key material from settings', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/settings', headers: H });
    expect(r.json().secrets.anthropic).toEqual({ keyPresent: false, source: null });
  });
});

describe('Phase 10 refine routes', () => {
  it('validates the body and reports unknown sources', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/refine', headers: H, payload: { feedback: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/refine', headers: H, payload: { feedback: 'dark theme please' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/refine', headers: H, payload: { feedback: 'dark theme please', workflowId: 'does-not-exist' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/refine/apply', headers: H, payload: { workflowId: 'x' } })).statusCode).toBe(400);
  });
  it('degrades without a provider instead of failing', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/refine', headers: H, payload: { feedback: 'dark theme please', workflowId: 'runner-collection-run' } });
    expect(r.statusCode).toBe(200); expect(r.json().ok).toBe(false); expect(r.json().error.code).toMatch(/provider_not_configured|no_provider/);
  });
});
