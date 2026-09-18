import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCollectionToUserWorkspace, seedCaptureProfile } from '../src/index.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bru-profile-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('seedCaptureProfile', () => {
  it('writes workspace.yml and ui-state-snapshot.json in the measured shapes', async () => {
    const dir = path.join(root, 'profile');
    const seeded = await seedCaptureProfile({ dir, collections: [{ name: 'Demo', path: '/tmp/ws/collection' }], sidebarWidth: 220 });
    const ws = parse(await readFile(seeded.workspaceFile, 'utf8'));
    expect(ws).toMatchObject({ opencollection: '1.0.0', info: { name: 'Bruno Capture', type: 'workspace' }, collections: [{ name: 'Demo', path: '/tmp/ws/collection' }] });
    const ui = JSON.parse(await readFile(seeded.uiStateFile, 'utf8'));
    expect(ui.activeWorkspacePath).toBe(path.join(dir, 'default-workspace'));
    expect(ui.workspaces[0].collections).toEqual(['/tmp/ws/collection']);
    expect(ui.extras.sidebar).toEqual({ collapsed: false, width: 220 });
  });
});

describe('addCollectionToUserWorkspace', () => {
  it('backs up, appends once, and follows activeWorkspacePath', async () => {
    const userData = path.join(root, 'bruno');
    const wsDir = path.join(userData, 'my-workspace');
    await mkdir(wsDir, { recursive: true });
    await writeFile(path.join(wsDir, 'workspace.yml'), 'opencollection: 1.0.0\ninfo:\n  name: "My Workspace"\n  type: workspace\ncollections:\n  - name: "Existing"\n    path: "/x/existing"\nspecs:\ndocs: \'\'\n');
    await writeFile(path.join(userData, 'ui-state-snapshot.json'), JSON.stringify({ activeWorkspacePath: wsDir }));
    const backupDir = path.join(root, 'backup');
    const r1 = await addCollectionToUserWorkspace({ userDataDir: userData, collection: { name: 'Demo', path: '/tmp/demo' }, backupDir });
    expect(r1.added).toBe(true);
    expect(r1.backedUpTo.map((f) => path.basename(f)).sort()).toEqual(['ui-state-snapshot.json', 'workspace.yml']);
    const r2 = await addCollectionToUserWorkspace({ userDataDir: userData, collection: { name: 'Demo', path: '/tmp/demo' }, backupDir });
    expect(r2.added).toBe(false);
    const ws = parse(await readFile(path.join(wsDir, 'workspace.yml'), 'utf8'));
    expect(ws.collections).toEqual([{ name: 'Existing', path: '/x/existing' }, { name: 'Demo', path: '/tmp/demo' }]);
    expect(ws.info.name).toBe('My Workspace');
  });
});
