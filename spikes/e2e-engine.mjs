// End-to-end through the real RunEngine: seeded capture profile → launch → runner workflow → screenshots → manifest.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { SettingsStore, WorkflowSourcesStore, WorkflowRegistry, RunEngine, appPaths, builtInWorkflowsDir, bundledFixturesDir, resolveBruno } = await import('../packages/core/src/index.ts');
const { createDefaultActionRegistry } = await import('../packages/automation/src/index.ts');
const paths = appPaths(process.env.HOME_DIR);
const settings = new SettingsStore(paths); await settings.load(); await settings.patch({ capture: { profileMode: 'capture', previewFps: 1 } });
const sources = new WorkflowSourcesStore(paths); await sources.load();
const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), fixturesDir: bundledFixturesDir(), sources: () => sources.get() });
const snap = await registry.refresh(); console.log('registry:', snap.total, 'workflows,', snap.invalid, 'invalid', registry.list().flatMap(l => l.issues.map(i => `${path.basename(l.file)} ${i.path}: ${i.message}`)));
const engine = new RunEngine({ settings, paths, registry, actions: createDefaultActionRegistry(), resolveBruno: () => resolveBruno(settings.get()), fixturesDir: bundledFixturesDir(), log: (m) => console.log('  ·', m.slice(0, 160)) });
const t0 = Date.now();
const manifest = await engine.create({ workflowId: 'runner-collection-run', output: 'screenshots', preset: 'docs-screenshot', parameters: {}, overrides: {}, cancelActive: false, allowRelaunch: false });
console.log('run created:', manifest.runId, manifest.capture);
let previews = 0;
for await (const e of engine.events(manifest.runId)) {
  if (e.type === 'preview.frame') { previews++; continue; }
  if (e.type === 'run.log') continue;
  const extra = e.type.startsWith('workflow.step') ? `${e.step.index + 1}/${e.total ?? ''} ${e.step.label}${e.error ? ' — ' + e.error.message : ''}` : e.type === 'artifact.created' ? e.artifact.relativePath + ` ${e.artifact.width}×${e.artifact.height}` : e.type === 'run.status' ? e.status : e.type === 'run.failed' ? JSON.stringify(e.error) : '';
  console.log(`  ${String(Date.now() - t0).padStart(6)}ms  ${e.type.padEnd(24)} ${extra}`);
}
const rec = engine.get(manifest.runId);
console.log('final status:', rec.manifest.status, '| previews:', previews, '| artifacts:', rec.manifest.artifacts.map(a => a.relativePath), '| errors:', rec.manifest.errors.length);
console.log('run dir:', fs.readdirSync(rec.artifacts.runDir), '| screenshots:', fs.existsSync(rec.artifacts.screenshotsDir) ? fs.readdirSync(rec.artifacts.screenshotsDir) : []);
console.log('manifest bruno:', JSON.stringify(rec.manifest.bruno), '| steps:', rec.manifest.steps.map(s => `${s.label}:${s.status}${s.retries ? '(retry)' : ''}`).join(', '));
console.log('log lines:', fs.readFileSync(rec.artifacts.logFile, 'utf8').trim().split('\n').length, '| tmp left:', fs.existsSync(path.join(paths.tmpDir, manifest.runId)));
await engine.shutdown();
console.log('user Bruno running?', (await import('node:child_process')).execSync('pgrep -fl "MacOS/Bruno$" || echo none').toString().trim());
