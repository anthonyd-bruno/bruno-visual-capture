import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore, WorkflowSourcesStore, appPaths, deepMerge } from '../src/index.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('SettingsStore', () => {
  it('creates a complete, valid settings.json on first load', async () => {
    const store = new SettingsStore(appPaths(root));
    const s = await store.load();
    expect(s.capture.defaultPreset).toBe('docs-screenshot');
    const onDisk = JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8'));
    expect(onDisk.ai.anthropic.model).toBe('claude-opus-5');
    expect(store.artifactRoot()).toBe(path.join(root, 'artifacts'));
  });

  it('patches deeply, persists, and re-validates', async () => {
    const store = new SettingsStore(appPaths(root));
    await store.load();
    const next = await store.patch({ ai: { preferredProvider: 'openai', openai: { model: 'gpt-x' } }, capture: { artifactRoot: '/tmp/x' } });
    expect(next.ai.preferredProvider).toBe('openai');
    expect(next.ai.anthropic.model).toBe('claude-opus-5');
    expect(next.capture.previewEnabled).toBe(true);
    expect(store.artifactRoot()).toBe('/tmp/x');
    const again = new SettingsStore(appPaths(root));
    expect((await again.load()).ai.openai.model).toBe('gpt-x');
  });

  it('rejects an invalid patch without writing', async () => {
    const store = new SettingsStore(appPaths(root));
    await store.load();
    await expect(store.patch({ capture: { previewFps: 99 } })).rejects.toThrow();
    expect(store.get().capture.previewFps).toBe(1.5);
  });

  it('surfaces a corrupt file with its path', async () => {
    const p = appPaths(root);
    await (await import('node:fs/promises')).mkdir(root, { recursive: true });
    await (await import('node:fs/promises')).writeFile(p.settingsFile, '{ nope', 'utf8');
    await expect(new SettingsStore(p).load()).rejects.toThrow(/settings\.json: not valid JSON/);
  });
});

describe('WorkflowSourcesStore', () => {
  it('adds/removes directories and imported references idempotently', async () => {
    const store = new WorkflowSourcesStore(appPaths(root));
    await store.load();
    await store.addDirectory('/w/a'); await store.addDirectory('/w/a');
    await store.addImportedFile('imp1', '/w/one.yaml');
    expect(store.get().customDirectories).toEqual(['/w/a']);
    expect(store.get().importedFiles.map((f) => f.path)).toEqual(['/w/one.yaml']);
    await store.removeImportedFile('imp1'); await store.removeDirectory('/w/a');
    expect(store.get()).toMatchObject({ customDirectories: [], importedFiles: [] });
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays', () => {
    expect(deepMerge({ a: { b: 1, c: [1] }, d: 2 }, { a: { c: [2, 3] }, d: undefined })).toEqual({ a: { b: 1, c: [2, 3] }, d: 2 });
  });
});
