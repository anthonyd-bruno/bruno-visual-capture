import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const { SettingsStore, WorkflowSourcesStore, WorkflowRegistry, RunEngine, appPaths, builtInWorkflowsDir, bundledFixturesDir, resolveBruno } = await import('../packages/core/src/index.ts');
const { createDefaultActionRegistry } = await import('../packages/automation/src/index.ts');
const paths = appPaths(process.env.HOME_DIR);
const settings = new SettingsStore(paths); await settings.load(); await settings.patch({ capture: { profileMode: 'capture' } });
const sources = new WorkflowSourcesStore(paths); await sources.load();
const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), fixturesDir: bundledFixturesDir(), sources: () => sources.get() }); await registry.refresh();
const engine = new RunEngine({ settings, paths, registry, actions: createDefaultActionRegistry(), resolveBruno: () => resolveBruno(settings.get()), fixturesDir: bundledFixturesDir(), log: (m) => { if (/native|transcod|helper|window|failed|error/i.test(m)) console.log('  ·', m.slice(0, 180)); } });
async function go(output, preset) {
  const t0 = Date.now();
  const m = await engine.create({ workflowId: 'runner-collection-run', output, preset, parameters: {}, overrides: { framing: 'full-window' }, cancelActive: false, allowRelaunch: false });
  for await (const e of engine.events(m.runId)) {
    if (e.type === 'artifact.created') console.log(`  ${String(Date.now() - t0).padStart(6)}ms ⬇ ${e.artifact.relativePath} ${e.artifact.width}×${e.artifact.height}${e.artifact.durationMs ? ` ${(e.artifact.durationMs / 1000).toFixed(1)}s` : ''}`);
    if (e.type === 'workflow.step.failed' || e.type === 'run.failed') console.log('  ✖', JSON.stringify(e.error));
  }
  const rec = engine.get(m.runId);
  console.log(`  → ${rec.manifest.status} in ${Date.now() - t0} ms; dir ${rec.artifacts.runDir}`);
  return rec;
}
console.log('=== Full App Window screenshots (docs-screenshot) ===');
const s = await go('screenshots', 'docs-screenshot');
console.log('=== Full App Window video (demo-video) ===');
const v = await go('video', 'demo-video');
await engine.shutdown();
const mp4 = path.join(v.artifacts.runDir, 'video', 'runner-collection-run.mp4');
if (fs.existsSync(mp4)) {
  console.log('probe:', execSync(`ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration,size -of default=nw=1 "${mp4}"`).toString().replace(/\n/g, ' '));
  execSync(`ffmpeg -v error -y -ss 0.8 -i "${mp4}" -frames:v 1 "${paths.root}/native-frame.png"`);
  console.log('frame →', `${paths.root}/native-frame.png`);
}
const png = path.join(s.artifacts.runDir, 'screenshots', 'runner-open.png');
if (fs.existsSync(png)) console.log('full-window screenshot:', png, execSync(`file "${png}"`).toString().trim().split(':')[1]);
console.log('user Bruno running?', execSync('pgrep -fl "MacOS/Bruno$" || echo none').toString().trim());
