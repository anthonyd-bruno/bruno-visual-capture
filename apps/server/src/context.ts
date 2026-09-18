import {
  GeneratedWorkflowStore, RunEngine, SettingsStore, WorkflowRegistry, WorkflowSourcesStore, WorkflowWatcher, appPaths, builtInWorkflowsDir, bundledFixturesDir, checkSystemStatus, describeBundledFixtures, resolveBruno, type AppPaths,
} from '@bruno-capture/core';
import { CaptureHelper, createDefaultActionRegistry, describeActions, describeRegions, describeStates, extractTestIds, type ActionRegistry } from '@bruno-capture/automation';
import { Keychain, buildHealer, buildProviders, resolveApiKey, type ComposeCatalog } from '@bruno-capture/ai';
import { BUILT_IN_PRESETS, type Capabilities, type SystemStatus } from '@bruno-capture/shared';

/** Everything routes need. One instance per server; the CLI builds the same thing (PRD §92). */
export interface ServerContext {
  paths: AppPaths;
  settings: SettingsStore;
  sources: WorkflowSourcesStore;
  registry: WorkflowRegistry;
  watcher?: WorkflowWatcher;
  engine: RunEngine;
  actions: ActionRegistry;
  generated: GeneratedWorkflowStore;
  fixturesDir: string;
  systemStatus(): Promise<SystemStatus>;
  /** Registry + Phase 9 composition vocabulary (actions, states, regions, fixtures, test ids). */
  capabilities(): Promise<Capabilities>;
  /** Capabilities plus the real action param validators — what the composer/healer validate against. */
  composeCatalog(): Promise<ComposeCatalog>;
  /** Key presence and source only (env var or Keychain). Values never leave the backend (PRD §12). */
  aiKeyPresence(): Promise<{ openai: boolean; anthropic: boolean; sources: { openai: 'env' | 'keychain' | null; anthropic: 'env' | 'keychain' | null } }>;
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
  const generated = new GeneratedWorkflowStore(paths.generatedWorkflowsDir);
  const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), generatedDir: paths.generatedWorkflowsDir, fixturesDir, sources: () => sources.get(), log });
  await registry.refresh();
  const actions = createDefaultActionRegistry();
  const keychain = new Keychain();

  // Composition vocabulary: cheap parts are computed once; test ids are scanned from the detected Bruno (cached per binary).
  const actionSummaries = describeActions(actions);
  const regions = describeRegions();
  const states = describeStates();
  let fixturesCache: Capabilities['fixtures'] | undefined;
  let testIdsCache: { key: string; ids: string[]; version?: string } | undefined;
  const capabilities = async (): Promise<Capabilities> => {
    fixturesCache ??= await describeBundledFixtures(fixturesDir);
    const bruno = await resolveBruno(settings.get()).catch(() => ({ candidate: undefined }));
    const key = bruno.candidate?.executablePath ?? 'fallback';
    if (!testIdsCache || testIdsCache.key !== key) {
      const r = bruno.candidate ? await extractTestIds(bruno.candidate.executablePath) : { testIds: [] as string[], source: 'fallback' as const };
      testIdsCache = { key, ids: r.testIds, version: bruno.candidate?.version };
      log(`test ids: ${r.testIds.length} from ${r.source}${bruno.candidate?.version ? ` (Bruno ${bruno.candidate.version})` : ''}`);
    }
    return registry.capabilities(BUILT_IN_PRESETS, { actions: actionSummaries, regions, states, fixtures: fixturesCache, testIds: testIdsCache.ids, brunoVersion: testIdsCache.version });
  };
  const validateActionParams = (id: string, params: Record<string, unknown>) => {
    if (!actions.has(id)) return [{ path: '', message: `unknown action ${id}` }];
    const r = actions.get(id).params.safeParse(params);
    return r.success ? undefined : r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  };
  const composeCatalog = async (): Promise<ComposeCatalog> => ({ capabilities: await capabilities(), validateActionParams, presets: BUILT_IN_PRESETS });

  const engine = new RunEngine({
    settings, paths, registry, actions, resolveBruno: () => resolveBruno(settings.get()), fixturesDir, log, generated,
    healer: async () => {
      const s = settings.get();
      const { providers } = await buildProviders(s, keychain);
      return buildHealer({ providers, preferred: s.ai.preferredProvider, fallbackEnabled: s.ai.fallbackEnabled, catalog: await composeCatalog(), log });
    },
  });
  let watcher: WorkflowWatcher | undefined;
  if (settings.get().workflows.watch) {
    watcher = new WorkflowWatcher({ registry, builtInDir: builtInWorkflowsDir(), generatedDir: paths.generatedWorkflowsDir, sources: () => sources.get(), log });
    await watcher.start();
  }
  const indexed = await engine.indexArtifactRoot();
  log(`library: ${indexed} runs indexed from ${settings.artifactRoot()}`);
  const aiKeyPresence = async () => {
    const [o, a] = await Promise.all([resolveApiKey('openai', keychain), resolveApiKey('anthropic', keychain)]);
    return { openai: Boolean(o.key), anthropic: Boolean(a.key), sources: { openai: o.source ?? null, anthropic: a.source ?? null } };
  };
  return {
    paths, settings, sources, registry, watcher, engine, actions, generated, fixturesDir, aiKeyPresence, capabilities, composeCatalog, log,
    systemStatus: async () => checkSystemStatus({
      settings: settings.get(), paths, aiKeys: await aiKeyPresence(), workflowRegistry: registry.stats(),
      screenRecording: async () => { const h = await CaptureHelper.locate(paths.binDir); if (!h) return 'helper-missing'; return (await h.preflight().catch(() => false)) ? 'granted' : 'denied'; },
    }),
    shutdown: async () => { await watcher?.stop(); await engine.shutdown(); },
  };
}
