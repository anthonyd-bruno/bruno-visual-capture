import {
  RunEngine, SettingsStore, WorkflowRegistry, WorkflowSourcesStore, WorkflowWatcher, appPaths, builtInWorkflowsDir, bundledFixturesDir, checkSystemStatus, resolveBruno, type AppPaths,
} from '@bruno-capture/core';
import { CaptureHelper, createDefaultActionRegistry } from '@bruno-capture/automation';
import type { SystemStatus } from '@bruno-capture/shared';

/** Everything routes need. One instance per server; the CLI builds the same thing (PRD §92). */
export interface ServerContext {
  paths: AppPaths;
  settings: SettingsStore;
  sources: WorkflowSourcesStore;
  registry: WorkflowRegistry;
  watcher?: WorkflowWatcher;
  engine: RunEngine;
  fixturesDir: string;
  systemStatus(): Promise<SystemStatus>;
  /** Key presence only — env vars now, Keychain in Phase 6. Values never leave the backend. */
  aiKeyPresence(): { openai: boolean; anthropic: boolean };
  log(message: string): void;
  shutdown(): Promise<void>;
}

export interface CreateContextOptions { root?: string; log?: (message: string) => void }

export async function createContext(opts: CreateContextOptions = {}): Promise<ServerContext> {
  const log = opts.log ?? (() => undefined);
  const paths = appPaths(opts.root);
  const settings = new SettingsStore(paths);
  const sources = new WorkflowSourcesStore(paths);
  await Promise.all([settings.load(), sources.load()]);
  const fixturesDir = bundledFixturesDir();
  const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), fixturesDir, sources: () => sources.get(), log });
  await registry.refresh();
  const engine = new RunEngine({ settings, paths, registry, actions: createDefaultActionRegistry(), resolveBruno: () => resolveBruno(settings.get()), fixturesDir, log });
  let watcher: WorkflowWatcher | undefined;
  if (settings.get().workflows.watch) {
    watcher = new WorkflowWatcher({ registry, builtInDir: builtInWorkflowsDir(), sources: () => sources.get(), log });
    await watcher.start();
  }
  const indexed = await engine.indexArtifactRoot();
  log(`library: ${indexed} runs indexed from ${settings.artifactRoot()}`);
  const aiKeyPresence = () => ({ openai: Boolean(process.env.OPENAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY) });
  return {
    paths, settings, sources, registry, watcher, engine, fixturesDir, aiKeyPresence, log,
    systemStatus: () => checkSystemStatus({
      settings: settings.get(), paths, aiKeys: aiKeyPresence(), workflowRegistry: registry.stats(),
      screenRecording: async () => { const h = await CaptureHelper.locate(paths.binDir); if (!h) return 'helper-missing'; return (await h.preflight().catch(() => false)) ? 'granted' : 'denied'; },
    }),
    shutdown: async () => { await watcher?.stop(); await engine.shutdown(); },
  };
}
