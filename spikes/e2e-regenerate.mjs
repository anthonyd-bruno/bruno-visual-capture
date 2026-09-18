import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const { SettingsStore, WorkflowSourcesStore, WorkflowRegistry, RunEngine, appPaths, builtInWorkflowsDir, bundledFixturesDir, resolveBruno } = await import('../packages/core/src/index.ts');
const { createDefaultActionRegistry } = await import('../packages/automation/src/index.ts');
const paths = appPaths(process.env.HOME_DIR);
const settings = new SettingsStore(paths); await settings.load();
const sources = new WorkflowSourcesStore(paths); await sources.load();
const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), fixturesDir: bundledFixturesDir(), sources: () => sources.get() }); await registry.refresh();
const engine = new RunEngine({ settings, paths, registry, actions: createDefaultActionRegistry(), resolveBruno: () => resolveBruno(settings.get()), fixturesDir: bundledFixturesDir() });
const indexed = await engine.indexArtifactRoot();
const source = engine.list().filter((m) => m.status === 'completed' && m.capture.output === 'screenshots' && m.capture.framing === 'app-content').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
console.log(`indexed ${indexed} runs; regenerating exact from ${source.runId} (${source.capture.preset}, ${source.capture.width}×${source.capture.height})`);
const t0 = Date.now();
const r = await engine.regenerate(source.runId, 'exact');
if (r.kind !== 'started') { console.log('unexpected review:', r); process.exit(1); }
for await (const e of engine.events(r.manifest.runId)) { if (e.type === 'artifact.created') console.log(`  ⬇ ${e.artifact.relativePath} ${e.artifact.width}×${e.artifact.height}`); if (e.type === 'run.failed') console.log('  ✖', e.error); }
const m = engine.get(r.manifest.runId).manifest;
console.log(`→ ${m.status} in ${Date.now() - t0} ms; regenerateOf=${JSON.stringify(m.regenerateOf)}; capture=${m.capture.preset} ${m.capture.width}×${m.capture.height} ${m.capture.theme}; params=${JSON.stringify(m.parameters)}`);
const same = fs.readFileSync(path.join(paths.artifactsDir, source.runId, 'workflow.yaml'), 'utf8') === fs.readFileSync(path.join(paths.artifactsDir, m.runId, 'workflow.yaml'), 'utf8');
console.log('snapshot carried over byte-for-byte:', same);
const latest = await engine.regenerate(source.runId, 'latest');
console.log('latest →', latest.kind, latest.kind === 'started' ? latest.manifest.runId : latest.reason);
if (latest.kind === 'started') { for await (const e of engine.events(latest.manifest.runId)) { if (e.type === 'run.failed') console.log('  ✖', e.error); } console.log('  latest status:', engine.get(latest.manifest.runId).manifest.status); }
await engine.shutdown();
console.log('user Bruno running?', execSync('pgrep -fl "MacOS/Bruno$" || echo none').toString().trim());
