import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowRegistry, loadWorkflowFile } from '../src/index.js';
import type { WorkflowSources } from '@bruno-capture/shared';

let root: string;
const wf = (id: string, extra = '') => `version: 1
id: ${id}
name: ${id}
feature: runner
supportedOutputs: [screenshots]
steps:
  - action: runner.open
  - capture:
      id: ${id}-open
${extra}`;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bru-registry-'));
  await mkdir(path.join(root, 'builtin/runner'), { recursive: true });
  await mkdir(path.join(root, 'custom'), { recursive: true });
  await mkdir(path.join(root, 'fixtures/runner/basic'), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const sources = (over: Partial<WorkflowSources> = {}) => (): WorkflowSources => ({ schemaVersion: 1, customDirectories: [], importedFiles: [], ...over });
const registry = (s: () => WorkflowSources) => new WorkflowRegistry({ builtInDir: path.join(root, 'builtin'), fixturesDir: path.join(root, 'fixtures'), sources: s });

describe('WorkflowRegistry', () => {
  it('loads built-ins recursively and labels sources', async () => {
    await writeFile(path.join(root, 'builtin/runner/a.yaml'), wf('runner-a'));
    await writeFile(path.join(root, 'custom/b.yml'), wf('custom-b'));
    await writeFile(path.join(root, 'imported.yaml'), wf('imported-c'));
    const reg = registry(sources({ customDirectories: [path.join(root, 'custom')], importedFiles: [{ id: 'imp1', path: path.join(root, 'imported.yaml'), addedAt: new Date().toISOString() }] }));
    const snap = await reg.refresh();
    expect(snap.total).toBe(3); expect(snap.invalid).toBe(0);
    expect(reg.summaries().map((s) => [s.id, s.source])).toEqual([['runner-a', 'built-in'], ['custom-b', 'custom-directory'], ['imported-c', 'imported']]);
    expect(reg.get('imported-c')?.importId).toBe('imp1');
    expect(reg.capabilities([]).features).toEqual([{ id: 'runner', name: 'Runner', workflowCount: 3 }]);
  });

  it('keeps invalid files listed with field-level issues and never hides built-ins', async () => {
    await writeFile(path.join(root, 'builtin/ok.yaml'), wf('ok'));
    await writeFile(path.join(root, 'custom/bad-pause.yaml'), wf('bad-pause', '  - pause: -5\n'));
    await writeFile(path.join(root, 'custom/bad-yaml.yaml'), 'version: 1\nid: [unclosed');
    const reg = registry(sources({ customDirectories: [path.join(root, 'custom')] }));
    const snap = await reg.refresh();
    expect(snap.total).toBe(3); expect(snap.invalid).toBe(2);
    expect(reg.get('ok')).toBeDefined();
    const bad = reg.list().find((l) => l.file.endsWith('bad-pause.yaml'))!;
    expect(bad.id).toBe('bad-pause');
    expect(bad.issues.some((i) => i.path === 'steps.2.pause')).toBe(true);
    const yaml = reg.list().find((l) => l.file.endsWith('bad-yaml.yaml'))!;
    expect(yaml.issues[0]!.message).toMatch(/Invalid YAML/);
  });

  it('reports a missing imported file as "Workflow file not found" (PRD §28)', async () => {
    const reg = registry(sources({ importedFiles: [{ id: 'gone', path: path.join(root, 'nope.yaml'), addedAt: new Date().toISOString() }] }));
    await reg.refresh();
    expect(reg.list()[0]!.issues).toEqual([{ path: '', message: 'Workflow file not found' }]);
  });

  it('marks duplicate ids invalid, first source wins', async () => {
    await writeFile(path.join(root, 'builtin/a.yaml'), wf('dupe'));
    await writeFile(path.join(root, 'custom/a.yaml'), wf('dupe'));
    const reg = registry(sources({ customDirectories: [path.join(root, 'custom')] }));
    await reg.refresh();
    expect(reg.get('dupe')?.source).toBe('built-in');
    expect(reg.list().find((l) => l.source === 'custom-directory')!.issues[0]!.message).toMatch(/Duplicate workflow id "dupe"/);
  });

  it('checks that bundled fixtures exist', async () => {
    const ok = await loadWorkflowFile(await write('f-ok.yaml', wf('f-ok', 'fixture:\n  source: bundled\n  path: runner/basic\n')), 'built-in', root, { fixturesDir: path.join(root, 'fixtures') });
    expect(ok.definition).toBeDefined();
    const missing = await loadWorkflowFile(await write('f-bad.yaml', wf('f-bad', 'fixture:\n  source: bundled\n  path: runner/nope\n')), 'built-in', root, { fixturesDir: path.join(root, 'fixtures') });
    expect(missing.issues[0]).toMatchObject({ path: 'fixture.path' });
  });
});

async function write(name: string, text: string): Promise<string> { const p = path.join(root, name); await writeFile(p, text); return p; }
