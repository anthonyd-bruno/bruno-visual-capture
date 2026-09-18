import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRegistry, WorkflowWatcher } from '../src/index.js';

const wf = (id: string, pause = 100) => `version: 1\nid: ${id}\nname: ${id}\nfeature: runner\nsupportedOutputs: [video]\nsteps:\n  - action: runner.open\n  - pause: ${pause}\n`;

let root: string; let watcher: WorkflowWatcher | undefined;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bru-watch-')); await mkdir(path.join(root, 'builtin'), { recursive: true }); await mkdir(path.join(root, 'custom'), { recursive: true }); });
afterEach(async () => { await watcher?.stop(); await rm(root, { recursive: true, force: true }); });

describe('WorkflowWatcher', () => {
  it('reloads on add, change (including going invalid) and unlink, debounced, without crashing', async () => {
    const registry = new WorkflowRegistry({ builtInDir: path.join(root, 'builtin'), fixturesDir: root, sources: () => ({ schemaVersion: 1, customDirectories: [path.join(root, 'custom')], importedFiles: [] }) });
    await registry.refresh();
    const refreshes: string[][] = [];
    watcher = new WorkflowWatcher({ registry, builtInDir: path.join(root, 'builtin'), sources: () => ({ schemaVersion: 1, customDirectories: [path.join(root, 'custom')], importedFiles: [] }), debounceMs: 100, onRefresh: (_s, changed) => refreshes.push(changed) });
    await watcher.start();
    await new Promise((r) => setTimeout(r, 200)); // let fsevents settle

    const file = path.join(root, 'custom', 'new.yaml');
    await writeFile(file, wf('new-one'));
    await vi.waitFor(() => expect(registry.get('new-one')).toBeDefined(), { timeout: 4000, interval: 50 });
    expect(refreshes.length).toBe(1);

    await writeFile(file, wf('new-one', -5));
    await vi.waitFor(() => expect(registry.get('new-one')).toBeUndefined(), { timeout: 4000, interval: 50 });
    expect(registry.list().find((l) => l.file === file)?.issues.some((i) => i.path === 'steps.1.pause')).toBe(true);

    await rm(file);
    await vi.waitFor(() => expect(registry.list().find((l) => l.file === file)).toBeUndefined(), { timeout: 4000, interval: 50 });
    expect(refreshes.length).toBeGreaterThanOrEqual(3);
  });
});
