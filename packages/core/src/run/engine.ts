import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { detectFFmpeg, encodeFramesToMp4, mp4ToGif, transcodeToMp4 } from '@bruno-capture/media';
import {
  BrunoAlreadyRunningError, CaptureHelper, CursorController, addCollectionToUserWorkspace, findRunningBruno, launchBruno, quitBrunoGracefully, seedCaptureProfile, setContentSize, setTheme,
  type ActionRegistry, type BrunoCandidate, type BrunoSession,
} from '@bruno-capture/automation';
import {
  BUILT_IN_PRESETS, DEFAULT_PRESET_FOR_OUTPUT, MANIFEST_SCHEMA_VERSION, WorkflowDefinitionSchema, resolveParameters,
  type CaptureConfig, type CapturePreset, type CreateRunRequest, type ResolvedParameters, type RunError, type RunEvent, type RunManifest, type RunStatus, type StepRecord, type WorkflowDefinition,
} from '@bruno-capture/shared';
import { parse as parseYaml } from 'yaml';
import { BRUNO_USER_DATA_DIR, type AppPaths } from '../paths.js';
import type { SettingsStore } from '../settings.js';
import type { LoadedWorkflow, WorkflowRegistry } from '../workflows/registry.js';
import { RunArtifactStore } from './artifacts.js';
import { CaptureController } from './capture.js';
import { RunEventBus } from './events.js';
import { executeWorkflow, RunCancelled, WorkflowStepFailure } from './executor.js';
import { stageFixture, type StagedFixture } from './fixtures.js';
import { RendererRecordingController } from './recording.js';
import { NativeRecordingController } from './native-recording.js';

export class RunConflictError extends Error {
  readonly code = 'run_conflict';
  constructor(public readonly activeRunId: string) { super('A capture is already running'); this.name = 'RunConflictError'; }
}
export class RunValidationError extends Error {
  readonly code = 'run_invalid';
  constructor(message: string, public readonly details?: Array<{ path: string; message: string }>) { super(message); this.name = 'RunValidationError'; }
}

export class RunNotFoundError extends Error {
  readonly code = 'run_not_found';
  constructor(public readonly runId: string) { super(`No run ${runId}`); this.name = 'RunNotFoundError'; }
}

/** What the Capture form needs to show when Regenerate Latest requires review (PRD §71). */
export interface RegeneratePrefill {
  workflowId: string;
  output: CreateRunRequest['output'];
  preset: string;
  parameters: Record<string, string | number | boolean>;
  overrides: CreateRunRequest['overrides'];
}
export type RegenerateResult =
  | { kind: 'started'; manifest: RunManifest }
  | { kind: 'review'; reason: string; issues: Array<{ path: string; message: string }>; prefill: RegeneratePrefill };

/**
 * PRD §71 Regenerate Latest: re-apply the saved parameters to the *current* definition. Anything that
 * no longer fits — removed/renamed parameter, type change, invalid value, new required parameter,
 * dropped output — means "show the form" rather than run.
 */
export function assessRegenerateLatest(manifest: RunManifest, definition: WorkflowDefinition): { ok: true; parameters: ResolvedParameters } | { ok: false; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  if (!definition.supportedOutputs.includes(manifest.capture.output)) issues.push({ path: 'output', message: `the workflow no longer supports "${manifest.capture.output}"` });
  const resolved = resolveParameters(definition.parameters, manifest.parameters);
  if (!resolved.ok) for (const e of resolved.errors) issues.push({ path: `parameters.${e.parameter}`, message: e.message });
  for (const [name, def] of Object.entries(definition.parameters)) {
    if (def.required && manifest.parameters[name] === undefined && (def as { default?: unknown }).default === undefined && !issues.some((i) => i.path === `parameters.${name}`))
      issues.push({ path: `parameters.${name}`, message: 'new required parameter' });
  }
  return issues.length || !resolved.ok ? { ok: false, issues } : { ok: true, parameters: resolved.values };
}

export interface RunRecord {
  manifest: RunManifest;
  bus: RunEventBus;
  artifacts: RunArtifactStore;
  staged?: StagedFixture;
}

export interface RunEngineDeps {
  settings: SettingsStore;
  paths: AppPaths;
  registry: WorkflowRegistry;
  actions: ActionRegistry;
  resolveBruno(): Promise<{ candidate?: BrunoCandidate; error?: string }>;
  fixturesDir: string;
  presets?: readonly CapturePreset[];
  log?: (message: string) => void;
}

interface ActiveRun { runId: string; abort: AbortController; done: Promise<void> }

const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!;

/**
 * Owns the §65 state machine, the §63 one-run-at-a-time rule, cancellation (§64) and the Bruno
 * session. Everything the CLI and the server do with runs goes through here (PRD §92).
 */
export class RunEngine {
  private readonly runs = new Map<string, RunRecord>();
  private active?: ActiveRun;
  private session?: BrunoSession;
  private readonly presets: readonly CapturePreset[];

  constructor(private readonly deps: RunEngineDeps) {
    this.presets = deps.presets ?? BUILT_IN_PRESETS;
  }

  get activeRunId(): string | undefined { return this.active?.runId; }
  get(runId: string): RunRecord | undefined { return this.runs.get(runId); }
  list(): RunManifest[] { return [...this.runs.values()].map((r) => r.manifest); }
  events(runId: string, signal?: AbortSignal): AsyncGenerator<RunEvent> | undefined { return this.runs.get(runId)?.bus.iterate(signal); }

  private sessionAlive(): boolean {
    return Boolean(this.session && !this.session.page.isClosed());
  }

  /** Validate (PRD §85: backend is authoritative), claim the single slot, start the pipeline, return immediately. */
  async create(req: CreateRunRequest): Promise<RunManifest> {
    const lw = this.deps.registry.get(req.workflowId);
    if (!lw?.definition) throw new RunValidationError(`Unknown or invalid workflow "${req.workflowId}"`);
    return this.createWithWorkflow(req, lw);
  }

  /**
   * PRD §71. `exact` runs the run's own `workflow.yaml` snapshot with its saved parameters and capture
   * configuration; `latest` re-applies them to the current definition and asks for review when they
   * no longer fit. Both create a *new* run (§68).
   */
  async regenerate(runId: string, mode: 'exact' | 'latest', opts: { cancelActive?: boolean; allowRelaunch?: boolean } = {}): Promise<RegenerateResult> {
    const rec = this.runs.get(runId);
    if (!rec) throw new RunNotFoundError(runId);
    const m = rec.manifest;
    const overrides: CreateRunRequest['overrides'] = { theme: m.capture.theme, width: m.capture.width, height: m.capture.height, cursor: m.capture.cursor, framing: m.capture.framing, region: m.capture.region, locator: m.capture.locator, fps: m.capture.fps };
    const base: Omit<CreateRunRequest, 'parameters'> = {
      workflowId: m.workflow.id, output: m.capture.output, preset: m.capture.preset, overrides,
      request: m.request.prompt || m.request.plan ? { prompt: m.request.prompt, plan: m.request.plan, ai: m.ai } : undefined,
      regenerateOf: { runId, mode }, cancelActive: opts.cancelActive ?? false, allowRelaunch: opts.allowRelaunch ?? false,
    };
    if (mode === 'exact') {
      let rawText: string;
      try { rawText = await readFile(rec.artifacts.snapshotFile, 'utf8'); }
      catch { throw new RunValidationError(`Run ${runId} has no workflow.yaml snapshot`); }
      const parsed = WorkflowDefinitionSchema.safeParse(parseYaml(rawText));
      if (!parsed.success) throw new RunValidationError('The saved workflow snapshot no longer validates against the current schema', parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
      const lw: LoadedWorkflow = { id: parsed.data.id, file: rec.artifacts.snapshotFile, source: m.workflow.source, sourcePath: m.workflow.sourcePath, definition: parsed.data, rawText, issues: [], loadedAt: new Date().toISOString() };
      return { kind: 'started', manifest: await this.createWithWorkflow({ ...base, parameters: m.parameters }, lw) };
    }
    const lw = this.deps.registry.get(m.workflow.id);
    const prefill: RegeneratePrefill = { workflowId: m.workflow.id, output: m.capture.output, preset: m.capture.preset, parameters: m.parameters, overrides };
    if (!lw?.definition) return { kind: 'review', reason: `Workflow "${m.workflow.id}" is no longer registered (or is invalid)`, issues: [{ path: 'workflowId', message: 'not found' }], prefill };
    const assessment = assessRegenerateLatest(m, lw.definition);
    if (!assessment.ok) return { kind: 'review', reason: 'The workflow changed since this run; review the parameters before generating', issues: assessment.issues, prefill };
    return { kind: 'started', manifest: await this.createWithWorkflow({ ...base, parameters: m.parameters }, lw) };
  }

  private async createWithWorkflow(req: CreateRunRequest, lw: LoadedWorkflow): Promise<RunManifest> {
    const def = lw.definition!;
    if (!def.supportedOutputs.includes(req.output)) throw new RunValidationError(`Workflow "${def.id}" does not support output "${req.output}" (supports ${def.supportedOutputs.join(', ')})`);
    if (req.output === 'video' || req.output === 'gif') {
      const ff = await detectFFmpeg();
      if (!ff.ffmpeg.available || !ff.ffprobe.available) throw new RunValidationError(`${req.output.toUpperCase()} output needs FFmpeg, which was not found. Screenshots still work. Install it with: brew install ffmpeg`);
    }
    const params = resolveParameters(def.parameters, req.parameters);
    if (!params.ok) throw new RunValidationError('Invalid parameters', params.errors.map((e) => ({ path: `parameters.${e.parameter}`, message: e.message })));
    const presetId = req.preset ?? def.defaults.preset ?? DEFAULT_PRESET_FOR_OUTPUT[req.output];
    const preset = this.presets.find((p) => p.id === presetId);
    if (!preset) throw new RunValidationError(`Unknown preset "${presetId}"`);
    const o = req.overrides;
    // A GIF preset without a height (Docs GIF) records the app at a comfortable size and downscales
    // the result to the preset width; the window is never squeezed to the GIF width.
    const gifDownscale = req.output === 'gif' && preset.height === undefined;
    const captureConfig: CaptureConfig = {
      output: req.output, preset: preset.id,
      theme: o.theme ?? def.defaults.theme ?? preset.theme,
      framing: o.framing ?? def.defaults.framing ?? preset.framing,
      region: o.region, locator: o.locator,
      width: o.width ?? (gifDownscale ? 1600 : preset.width), height: o.height ?? (gifDownscale ? 1000 : preset.height),
      outputWidth: gifDownscale ? preset.width : undefined,
      fps: o.fps ?? preset.fps, cursor: o.cursor ?? def.defaults.cursor ?? preset.cursor, scale: preset.scale,
    };
    if (captureConfig.framing === 'region' && !captureConfig.region) throw new RunValidationError('Framing "region" needs overrides.region');
    if (captureConfig.framing === 'locator' && !captureConfig.locator) throw new RunValidationError('Framing "locator" needs overrides.locator');

    if (this.active) {
      if (!req.cancelActive) throw new RunConflictError(this.active.runId);
      await this.cancel(this.active.runId);
    }

    const runId = `run_${ulid()}`;
    const artifacts = await RunArtifactStore.create(this.deps.settings.artifactRoot(), runId);
    const settings = this.deps.settings.get();
    const manifest: RunManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION, runId, status: 'created', createdAt: new Date().toISOString(),
      request: { prompt: req.request?.prompt, plan: req.request?.plan },
      workflow: { id: def.id, name: def.name, feature: def.feature, source: lw.source, sourcePath: lw.sourcePath, snapshot: 'workflow.yaml' },
      parameters: params.values, capture: captureConfig,
      bruno: { executablePath: '', version: undefined, mode: 'electron', profileMode: settings.capture.profileMode },
      ai: req.request?.ai, artifacts: [], steps: [], errors: [],
      debug: { log: 'debug/run.log', preservedWorkspace: false, intermediates: [] },
      regenerateOf: req.regenerateOf,
    };
    const rec: RunRecord = { manifest, bus: new RunEventBus(), artifacts };
    this.runs.set(runId, rec);
    const abort = new AbortController();
    const done = this.pipeline(rec, req, lw, def, params.values, captureConfig, abort.signal).catch((e) => this.deps.log?.(`pipeline crashed: ${firstLine(e)}`));
    this.active = { runId, abort, done };
    void done.finally(() => { if (this.active?.runId === runId) this.active = undefined; });
    return manifest;
  }

  async cancel(runId: string): Promise<void> {
    const a = this.active;
    if (!a || a.runId !== runId) return;
    a.abort.abort();
    await a.done;
  }

  private setStatus(rec: RunRecord, status: RunStatus): void {
    rec.manifest.status = status;
    rec.bus.emit({ type: 'run.status', runId: rec.manifest.runId, at: new Date().toISOString(), status });
    void rec.artifacts.log({ event: 'status', status });
  }

  private async pipeline(rec: RunRecord, req: CreateRunRequest, lw: LoadedWorkflow, def: WorkflowDefinition, params: ResolvedParameters, capture: CaptureConfig, signal: AbortSignal): Promise<void> {
    const { runId } = rec.manifest;
    const log = (message: string, extra: Record<string, unknown> = {}) => {
      this.deps.log?.(`[${runId}] ${message}`);
      void rec.artifacts.log({ level: 'info', message, ...extra });
      rec.bus.emit({ type: 'run.log', runId, at: new Date().toISOString(), level: 'info', message });
    };
    let stopPreview: (() => void) | undefined;
    const settings = this.deps.settings.get();
    const profileMode = settings.capture.profileMode;

    try {
      this.setStatus(rec, 'validating');
      await rec.artifacts.writeSnapshot(lw.rawText);

      this.setStatus(rec, 'preparing');
      signal.throwIfAborted();
      const targetDir = profileMode === 'capture'
        ? path.join(this.deps.paths.tmpDir, runId, 'workspace')
        : path.join(this.deps.paths.root, 'runtime-fixtures', def.fixture?.source === 'bundled' ? def.fixture.path : def.id);
      rec.staged = await stageFixture(def, { fixturesDir: this.deps.fixturesDir, targetDir, parameters: params, refreshInPlace: profileMode === 'user' });
      if (rec.staged) log(`fixture staged at ${rec.staged.workspacePath}${rec.staged.collectionName ? ` (collection "${rec.staged.collectionName}")` : ''}`);

      const bruno = await this.deps.resolveBruno();
      if (!bruno.candidate) {
        const e = new Error(bruno.error ?? 'Bruno was not found') as Error & { code: string; hint: string };
        e.code = 'bruno_not_found'; e.hint = 'Install Bruno or choose the application in Settings › Bruno.';
        throw e;
      }
      rec.manifest.bruno = { executablePath: bruno.candidate.executablePath, version: bruno.candidate.version, mode: 'electron', profileMode };

      const collection = rec.staged?.collectionPath ? { name: rec.staged.collectionName ?? path.basename(rec.staged.collectionPath), path: rec.staged.collectionPath } : undefined;
      const selectedEnvironment = typeof params['environment'] === 'string' ? params['environment'] : undefined;

      if (profileMode === 'capture') {
        // A fresh, seeded profile per run: the collection path changes per run, so the previous session cannot be reused.
        if (this.sessionAlive()) { await this.session!.close().catch(() => undefined); }
        this.session = undefined;
        const profileDir = path.join(this.deps.paths.profileDir, 'default');
        await rm(profileDir, { recursive: true, force: true });
        await seedCaptureProfile({ dir: profileDir, collections: collection ? [collection] : [], sidebarWidth: 220, selectedEnvironment, brunoVersion: bruno.candidate.version ?? '0.0.0' });
        log(`capture profile seeded at ${profileDir}`);
      } else {
        const running = await findRunningBruno();
        const reusable = this.sessionAlive() && this.session!.executablePath === bruno.candidate.executablePath && this.session!.profileMode === 'user';
        if (running.length && !reusable) {
          if (!req.allowRelaunch) throw new BrunoAlreadyRunningError(running);
          log('quitting the running Bruno to relaunch it under automation (user confirmed)');
          if (!(await quitBrunoGracefully(15_000))) { const e = new Error('Bruno did not quit within 15 s') as Error & { code: string }; e.code = 'bruno_quit_failed'; throw e; }
          this.session = undefined;
        }
        if (collection) {
          const r = await addCollectionToUserWorkspace({ userDataDir: BRUNO_USER_DATA_DIR, collection, backupDir: path.join(this.deps.paths.backupsDir, runId) });
          log(r.added ? `added "${collection.name}" to the user workspace (backup in backups/${runId})` : `"${collection.name}" already in the user workspace`);
        }
      }

      this.setStatus(rec, 'connecting');
      signal.throwIfAborted();
      if (!this.sessionAlive()) {
        this.session = await launchBruno({
          executablePath: bruno.candidate.executablePath, profileMode,
          captureProfileDir: profileMode === 'capture' ? path.join(this.deps.paths.profileDir, 'default') : undefined,
          existingInstance: 'fail', signal, log: (m) => log(m),
        });
      } else log('reusing the running Bruno session');
      const session = this.session!;
      rec.manifest.bruno.version = session.version ?? rec.manifest.bruno.version;
      await setContentSize(session, { width: capture.width, height: capture.height ?? Math.round((capture.width * 10) / 16) });
      await setTheme(session, capture.theme);
      const cursor = new CursorController(session.page, capture.cursor, { log });
      await cursor.install({ width: capture.width, height: capture.height ?? Math.round((capture.width * 10) / 16) });
      log(`Bruno ${session.version ?? '?'} ready: ${capture.width}×${capture.height ?? '?'} ${capture.theme}, cursor ${capture.cursor}`);

      this.setStatus(rec, 'running');
      const helper = await CaptureHelper.locate(this.deps.paths.binDir);
      const captureCtl = new CaptureController(session, helper);
      const isRecording = capture.output === 'video' || capture.output === 'gif';
      const framesRoot = path.join(this.deps.paths.tmpDir, runId, 'frames');
      let recording: RendererRecordingController | NativeRecordingController | undefined;
      if (isRecording && capture.framing === 'full-window') {
        if (!helper) { const e = new Error('Full App Window video needs the native capture helper, which is not installed') as Error & { code: string; hint: string }; e.code = 'helper_missing'; e.hint = 'Run `pnpm helper:build -- --install`, then allow Screen Recording when macOS asks.'; throw e; }
        if (!(await helper.preflight())) { const e = new Error('Screen Recording permission has not been granted') as Error & { code: string; hint: string }; e.code = 'permission_denied'; e.hint = 'Allow Screen Recording for the app running Bruno Capture in System Settings › Privacy & Security, then retry.'; throw e; }
        await mkdir(framesRoot, { recursive: true });
        recording = new NativeRecordingController(session, helper, { framesRoot, fps: 30, log });
      } else if (isRecording) {
        recording = new RendererRecordingController(session, { framesRoot, viewport: { width: capture.width, height: capture.height ?? Math.round((capture.width * 10) / 16) }, log });
      }
      let previewSuspended = 0;
      if (settings.capture.previewEnabled) {
        let inFlight = false;
        const timer = setInterval(async () => {
          if (inFlight || previewSuspended > 0 || session.page.isClosed()) return;
          inFlight = true;
          try {
            const jpg = await session.page.screenshot({ type: 'jpeg', quality: 55, scale: 'css' });
            rec.bus.emit({ type: 'preview.frame', runId, at: new Date().toISOString(), dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`, width: capture.width, height: capture.height ?? 0 });
          } catch { /* window mid-transition */ } finally { inFlight = false; }
        }, Math.round(1000 / settings.capture.previewFps));
        stopPreview = () => clearInterval(timer);
      }
      const result = await executeWorkflow({
        runId, definition: def, parameters: params, captureConfig: capture, session, actions: this.deps.actions, capture: captureCtl,
        recording, autoRecord: isRecording, cursor,
        artifacts: rec.artifacts, emit: (e) => rec.bus.emit(e), log, signal, workspacePath: rec.staged?.workspacePath,
        suspendPreview: async (fn) => { previewSuspended++; try { return await fn(); } finally { previewSuspended--; } },
      });

      this.setStatus(rec, 'processing');
      rec.bus.emit({ type: 'processing.started', runId, at: new Date().toISOString() });
      stopPreview?.(); stopPreview = undefined;
      if (recording) {
        signal.throwIfAborted();
        const work = path.join(this.deps.paths.tmpDir, runId, 'media');
        await mkdir(work, { recursive: true });
        let mp4;
        if (recording instanceof NativeRecordingController) {
          const seg = recording.segments()[0];
          if (!seg || seg.frames === 0) { const e = new Error('The native recording contains no frames') as Error & { code: string; hint: string }; e.code = 'recording_empty'; e.hint = 'Keep the Bruno window on screen while recording.'; throw e; }
          // Presets are CSS px: downscale retina captures to the window's CSS size unless the preset asks for device px.
          const cssHeight = capture.height ?? Math.round((seg.height * capture.width) / seg.width);
          const scale = capture.scale === 'css' ? { width: capture.width, height: cssHeight } : { width: seg.width, height: seg.height };
          mp4 = await transcodeToMp4({ input: seg.file, out: path.join(work, `${def.id}.mp4`), fps: 30, scale, signal });
          log(`transcoded native ${seg.width}×${seg.height} (${seg.frames} frames) → ${mp4.probe.width}×${mp4.probe.height} ${mp4.probe.fps} fps, ${((mp4.probe.durationMs ?? 0) / 1000).toFixed(1)} s`);
        } else {
          const seg = recording.segments()[0];
          if (!seg || seg.frames.length === 0) {
            const e = new Error('The recording contains no frames') as Error & { code: string; hint: string };
            e.code = 'recording_empty'; e.hint = 'Make sure something changes on screen between startRecording and stopRecording.'; throw e;
          }
          mp4 = await encodeFramesToMp4({ frames: seg.frames, startAt: seg.startedAt, stopAt: seg.stoppedAt, out: path.join(work, `${def.id}.mp4`), fps: 30, crop: seg.crop, signal });
          log(`encoded ${mp4.probe.width}×${mp4.probe.height} ${mp4.probe.fps} fps, ${((mp4.probe.durationMs ?? 0) / 1000).toFixed(1)} s from ${seg.frames.length} frames`);
        }
        if (capture.output === 'video') {
          const a = await rec.artifacts.addMedia('video', mp4.file, def.id, { width: mp4.probe.width, height: mp4.probe.height, durationMs: mp4.probe.durationMs, fps: mp4.probe.fps });
          rec.bus.emit({ type: 'artifact.created', runId, at: new Date().toISOString(), artifact: a });
        } else {
          const gif = await mp4ToGif({ input: mp4.file, out: path.join(work, `${def.id}.gif`), fps: capture.fps ?? 15, width: capture.outputWidth ?? capture.width, signal });
          const a = await rec.artifacts.addMedia('gif', gif.file, def.id, { width: gif.probe.width, height: gif.probe.height, durationMs: gif.probe.durationMs, fps: gif.probe.fps });
          rec.bus.emit({ type: 'artifact.created', runId, at: new Date().toISOString(), artifact: a });
          if (settings.capture.keepIntermediates) { await mkdir(rec.artifacts.debugDir, { recursive: true }); await rename(mp4.file, path.join(rec.artifacts.debugDir, path.basename(mp4.file))).catch(() => undefined); rec.manifest.debug.intermediates.push(`debug/${path.basename(mp4.file)}`); }
        }
        if (capture.height === undefined && mp4.probe.height) rec.manifest.capture.height = mp4.probe.height;
        if (settings.capture.keepIntermediates) { await rename(framesRoot, path.join(rec.artifacts.debugDir, 'frames')).then(() => rec.manifest.debug.intermediates.push('debug/frames')).catch(() => undefined); }
      }
      rec.bus.emit({ type: 'processing.completed', runId, at: new Date().toISOString() });
      await this.finalize(rec, result.status, result.steps, result.errors, undefined, stopPreview);
    } catch (e) {
      if (e instanceof RunCancelled || signal.aborted) {
        const c = e instanceof RunCancelled ? e : undefined;
        await this.finalize(rec, 'cancelled', c?.steps ?? [], c?.errors ?? [], undefined, stopPreview);
      } else if (e instanceof WorkflowStepFailure) {
        await this.finalize(rec, 'failed', e.steps, e.errors, e.error, stopPreview);
      } else {
        const err = e as { code?: string; hint?: string };
        const fatal: RunError = { code: err.code ?? 'run_failed', message: firstLine(e), hint: err.hint };
        await this.finalize(rec, 'failed', [], [fatal], fatal, stopPreview);
      }
    }
  }

  private async finalize(rec: RunRecord, status: RunStatus, steps: StepRecord[], errors: RunError[], fatal: RunError | undefined, stopPreview?: () => void): Promise<void> {
    stopPreview?.();
    const m = rec.manifest;
    const { runId } = m;
    m.steps = steps; m.errors = errors; m.artifacts = rec.artifacts.list(); m.completedAt = new Date().toISOString();
    const success = status === 'completed' || status === 'completed_with_errors';

    const framesRoot = path.join(this.deps.paths.tmpDir, runId, 'frames');
    if (!success) await rename(framesRoot, path.join(rec.artifacts.debugDir, 'frames')).then(() => { m.debug.intermediates.push('debug/frames'); }).catch(() => undefined);
    if (rec.staged?.temporary) {
      if (success) await rm(rec.staged.workspacePath, { recursive: true, force: true }).catch(() => undefined);
      else {
        await rename(rec.staged.workspacePath, rec.artifacts.debugWorkspaceDir).then(() => { m.debug.preservedWorkspace = true; }).catch(() => undefined);
      }
    }
    await rm(path.join(this.deps.paths.tmpDir, runId), { recursive: true, force: true }).catch(() => undefined);
    // Capture mode: we exclusively own that Bruno (PRD §64). User mode: Bruno stays in its final state (PRD §24).
    if (m.bruno.profileMode === 'capture' && this.sessionAlive()) {
      await this.session!.close().catch(() => undefined);
      this.session = undefined;
    }

    m.status = status;
    await rec.artifacts.writeManifest(m).catch((e) => this.deps.log?.(`manifest write failed: ${firstLine(e)}`));
    rec.bus.emit({ type: 'run.status', runId, at: m.completedAt, status });
    if (status === 'cancelled') rec.bus.emit({ type: 'run.cancelled', runId, at: m.completedAt });
    else if (status === 'failed') rec.bus.emit({ type: 'run.failed', runId, at: m.completedAt, error: fatal ?? errors[0] ?? { code: 'run_failed', message: 'Run failed' } });
    else rec.bus.emit({ type: 'run.completed', runId, at: m.completedAt, status: status as 'completed' | 'completed_with_errors' });
    void rec.artifacts.log({ event: 'finalized', status, artifacts: m.artifacts.length, errors: errors.length });
    rec.bus.close();
  }

  /** PRD §72: explicit deletion is the only thing that removes a run. Refuses while it is active. */
  async delete(runId: string): Promise<boolean> {
    if (this.active?.runId === runId) throw new RunConflictError(runId);
    const rec = this.runs.get(runId);
    const dir = rec?.artifacts.runDir ?? path.join(this.deps.settings.artifactRoot(), runId);
    if (!/^run_[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) return false;
    await rm(dir, { recursive: true, force: true });
    return this.runs.delete(runId) || true;
  }

  /** PRD §98: the Library indexes manifests from disk at startup; each becomes a closed run record. */
  async indexArtifactRoot(): Promise<number> {
    const root = this.deps.settings.artifactRoot();
    const { readdir, readFile } = await import('node:fs/promises');
    const { RunManifestSchema } = await import('@bruno-capture/shared');
    let count = 0;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith('run_') || this.runs.has(entry.name)) continue;
      try {
        const raw = JSON.parse(await readFile(path.join(root, entry.name, 'manifest.json'), 'utf8'));
        const parsed = RunManifestSchema.safeParse(raw);
        if (!parsed.success) { this.deps.log?.(`skipping ${entry.name}: manifest failed validation`); continue; }
        const bus = new RunEventBus(); bus.close();
        this.runs.set(entry.name, { manifest: parsed.data, bus, artifacts: await RunArtifactStore.create(root, entry.name) });
        count++;
      } catch (e) { this.deps.log?.(`skipping ${entry.name}: ${firstLine(e)}`); }
    }
    return count;
  }

  /** Close the cached Bruno session (server shutdown). */
  async shutdown(): Promise<void> {
    if (this.active) await this.cancel(this.active.runId);
    if (this.sessionAlive()) await this.session!.close().catch(() => undefined);
    this.session = undefined;
  }
}
