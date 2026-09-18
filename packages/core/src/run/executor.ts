import type { ActionContext, ActionRegistry, BrunoSession } from '@bruno-capture/automation';
import { CursorController, observePage, resolveTarget, waitForState } from '@bruno-capture/automation';
import {
  stepKind, type CaptureConfig, type Healer, type ResolvedParameters, type RunError, type RunEvent, type Step, type StepRecord, type StepSummary, type WorkflowDefinition,
} from '@bruno-capture/shared';
import type { RunArtifactStore } from './artifacts.js';
import type { CaptureController } from './capture.js';

/** Phase 5 fills this in; until then recording steps are recorded as events and no frames are captured. */
export interface RecordingController {
  start(target: { framing: string; region?: string; locator?: string }): Promise<void>;
  stop(): Promise<{ frames: number }>;
}

export interface ExecutorDeps {
  runId: string;
  definition: WorkflowDefinition;
  parameters: ResolvedParameters;
  captureConfig: CaptureConfig;
  session: BrunoSession;
  actions: ActionRegistry;
  capture: CaptureController;
  recording?: RecordingController;
  artifacts: RunArtifactStore;
  emit(event: RunEvent): void;
  log(message: string, extra?: Record<string, unknown>): void;
  signal: AbortSignal;
  workspacePath?: string;
  stepTimeoutMs?: number;
  /** Called around artifact captures so the preview loop can pause (PRD §59). */
  suspendPreview?<T>(fn: () => Promise<T>): Promise<T>;
  /** PRD §50 default: record the entire workflow when it declares no startRecording/stopRecording. */
  autoRecord?: boolean;
  /** Synthetic cursor (PRD §58); a hidden controller is used when absent. */
  cursor?: CursorController;
  /** Phase 9 self-healing: consulted when a step fails (before continueOnError/abort handling). */
  healer?: Healer;
  maxHeals?: number;
  /** The user's goal, shown to the healer (the prompt when the run came from one). */
  goal?: string;
}

export interface ExecutionResult {
  steps: StepRecord[];
  errors: RunError[];
  status: 'completed' | 'completed_with_errors';
  /** The step list that actually ran (original steps with heals spliced in). Equals the definition's when nothing was healed. */
  finalSteps: Step[];
  heals: { attempts: number; healed: number };
}

export class WorkflowStepFailure extends Error {
  constructor(public readonly error: RunError, public readonly steps: StepRecord[], public readonly errors: RunError[], public readonly heals: { attempts: number; healed: number } = { attempts: 0, healed: 0 }) {
    super(error.message);
    this.name = 'WorkflowStepFailure';
  }
}

export class RunCancelled extends Error {
  constructor(public readonly steps: StepRecord[], public readonly errors: RunError[]) { super('Run cancelled'); this.name = 'RunCancelled'; }
}

const TEMPLATE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** `{{param}}` substitution in action params. A whole-string template keeps the parameter's type. */
export function templateValue(value: unknown, params: ResolvedParameters): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/.exec(value);
    if (whole) {
      const v = params[whole[1]!];
      if (v === undefined) throw new Error(`unknown parameter "${whole[1]}" in "${value}"`);
      return v;
    }
    return value.replace(TEMPLATE, (_, name: string) => {
      const v = params[name];
      if (v === undefined) throw new Error(`unknown parameter "${name}" in "${value}"`);
      return String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => templateValue(v, params));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, templateValue(v, params)]));
  return value;
}

export function stepLabel(step: Step, index: number): string {
  if (step.label) return step.label;
  if ('action' in step) return step.action;
  if ('capture' in step) return `capture ${step.capture.id}`;
  if ('waitFor' in step) { const w = step.waitFor; return `wait for ${w.state ?? (w.text ? 'text' : Object.keys(w).find((k) => k !== 'timeoutMs') ?? 'condition')}`; }
  if ('pause' in step) return `pause ${step.pause} ms`;
  if ('startRecording' in step) return 'start recording';
  if ('stopRecording' in step) return 'stop recording';
  if ('selectorAction' in step) return `${step.selectorAction.operation} ${step.selectorAction.locator}`;
  return `step ${index + 1}`;
}

function toRunError(e: unknown, stepIndex: number, actionId?: string): RunError {
  const err = e as { code?: string; message?: string; hint?: string; cause?: unknown };
  const cause = err.cause ? String((err.cause as Error).message ?? err.cause).split('\n')[0] : undefined;
  return {
    code: err.code ?? (e instanceof Error && /Timeout/i.test(e.name) ? 'timeout' : 'step_failed'),
    message: String(err.message ?? e).split('\n')[0]!,
    stepIndex, actionId, hint: err.hint, details: cause,
  };
}

const isTransient = (e: unknown) => {
  const code = (e as { code?: string }).code;
  return code === 'action_failed' || code === 'timeout' || (e instanceof Error && /Timeout|detached|not attached|stale/i.test(e.message));
};

/**
 * Linear step executor (PRD §34–§43). One workflow model for every output: capture steps write
 * screenshots, recording steps bracket the recording controller, everything else is synchronisation
 * or presentation timing. Stops on the first failure unless the step says `continueOnError`.
 */
export async function executeWorkflow(deps: ExecutorDeps): Promise<ExecutionResult> {
  const { definition: def, session, signal } = deps;
  const page = session.page;
  const timeoutMs = deps.stepTimeoutMs ?? 15_000;
  const steps: StepRecord[] = [];
  const errors: RunError[] = [];
  let total = def.steps.length;
  const now = () => new Date().toISOString();

  deps.emit({ type: 'workflow.started', runId: deps.runId, at: now(), workflowId: def.id, stepCount: total });
  let recordingOpen = false;
  const hasBounds = def.steps.some((s) => 'startRecording' in s);
  if (deps.autoRecord && deps.recording && !hasBounds) {
    await deps.recording.start({ framing: deps.captureConfig.framing, region: deps.captureConfig.region, locator: deps.captureConfig.locator });
    recordingOpen = true;
    deps.emit({ type: 'recording.started', runId: deps.runId, at: now() });
    deps.log('recording the whole workflow (no explicit recording bounds)');
  }

  const cursor = deps.cursor ?? new CursorController(page, 'hidden');
  const actionCtx: ActionContext = {
    session, page, signal, parameters: deps.parameters, workspacePath: deps.workspacePath, timeoutMs, cursor,
    log: (m) => deps.log(m),
  };

  // Phase 9: the queue is mutable so the healer can splice replacement steps in at the failure point.
  const queue: Step[] = [...def.steps];
  const inserted = new Set<Step>();
  const heals = { attempts: 0, healed: 0 };
  const maxHeals = deps.healer ? deps.maxHeals ?? 4 : 0;
  const finalSteps: Step[] = [];
  const summaryOf = (s: Step, i: number): StepSummary => ({ index: i, kind: stepKind(s), label: stepLabel(s, i) });

  for (let index = 0; index < queue.length; index++) {
    const step = queue[index]!;
    total = queue.length;
    if (signal.aborted) throw new RunCancelled(steps, errors);
    const kind = stepKind(step);
    const label = stepLabel(step, index);
    const summary = { index, kind, label };
    const startedAt = now();
    const t0 = Date.now();
    let retries = 0;
    deps.emit({ type: 'workflow.step.started', runId: deps.runId, at: startedAt, step: summary, total });
    deps.log(`step ${index + 1}/${total} ${label}`, { stepIndex: index, kind });

    const run = async (): Promise<void> => {
      switch (kind) {
        case 'action': {
          const s = step as Extract<Step, { action: string }>;
          const action = deps.actions.get(s.action);
          const templated = templateValue(s.params, deps.parameters);
          const parsed = action.params.safeParse(templated);
          if (!parsed.success) {
            const e = new Error(`Invalid parameters for ${s.action}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'params'} ${i.message}`).join('; ')}`) as Error & { code: string; hint: string };
            e.code = 'invalid_action_params'; e.hint = 'Fix the step params in the workflow YAML.';
            throw e;
          }
          try {
            await action.execute(actionCtx, parsed.data);
          } catch (e) {
            if (!action.retryable || signal.aborted || !isTransient(e)) throw e;
            retries++;
            deps.log(`retrying ${s.action} once after: ${String((e as Error).message).split('\n')[0]}`, { stepIndex: index });
            await page.waitForTimeout(400);
            await action.execute(actionCtx, parsed.data);
          }
          return;
        }
        case 'capture': {
          const s = step as Extract<Step, { capture: unknown }>;
          const c = s.capture;
          const framing = c.framing ?? (c.region ? 'region' : c.locator ? 'locator' : deps.captureConfig.framing);
          const take = () => deps.capture.screenshot({ framing, region: c.region ?? deps.captureConfig.region, locator: c.locator ?? deps.captureConfig.locator, scale: deps.captureConfig.scale });
          const png = deps.suspendPreview ? await deps.suspendPreview(take) : await take();
          const artifact = await deps.artifacts.addScreenshot(c.id, png);
          deps.emit({ type: 'artifact.created', runId: deps.runId, at: now(), artifact });
          deps.log(`captured ${artifact.relativePath} ${artifact.width}×${artifact.height}`, { stepIndex: index });
          return;
        }
        case 'waitFor': {
          const w = (step as Extract<Step, { waitFor: unknown }>).waitFor;
          const t = w.timeoutMs;
          if (w.state) return waitForState(page, w.state, t);
          for (const [cond, state] of [['visible', 'visible'], ['hidden', 'hidden'], ['attached', 'attached'], ['detached', 'detached']] as const) {
            const target = w[cond];
            if (target) { await resolveTarget(page, target).waitFor({ state, timeout: t }); return; }
          }
          if (w.text) {
            const loc = resolveTarget(page, { region: w.text.region, locator: w.text.locator });
            const { equals, contains } = w.text;
            await loc.waitFor({ state: 'attached', timeout: t });
            const deadline = Date.now() + t;
            while (Date.now() < deadline) {
              const text = (await loc.innerText().catch(() => '')).trim();
              if (equals !== undefined ? text === equals : text.includes(contains!)) return;
              await page.waitForTimeout(150);
            }
            const e = new Error(`Text did not ${equals !== undefined ? `equal "${equals}"` : `contain "${contains}"`} within ${Math.round(t / 1000)} s`) as Error & { code: string };
            e.code = 'timeout'; throw e;
          }
          return;
        }
        case 'pause': {
          const ms = (step as Extract<Step, { pause: number }>).pause;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          return;
        }
        case 'startRecording': {
          const s = step as Extract<Step, { startRecording: unknown }>;
          const target = { framing: s.startRecording.framing ?? deps.captureConfig.framing, region: s.startRecording.region ?? deps.captureConfig.region, locator: s.startRecording.locator ?? deps.captureConfig.locator };
          if (deps.recording) await deps.recording.start(target);
          recordingOpen = true;
          deps.emit({ type: 'recording.started', runId: deps.runId, at: now() });
          return;
        }
        case 'stopRecording': {
          const r = deps.recording && recordingOpen ? await deps.recording.stop() : undefined;
          recordingOpen = false;
          deps.emit({ type: 'recording.stopped', runId: deps.runId, at: now(), frames: r?.frames });
          return;
        }
        case 'selectorAction': {
          const s = (step as Extract<Step, { selectorAction: unknown }>).selectorAction;
          const loc = page.locator(s.locator).first();
          await loc.waitFor({ state: 'visible', timeout: timeoutMs });
          switch (s.operation) {
            case 'click': return cursor.click(loc);
            case 'hover': return cursor.hover(loc);
            case 'fill': return loc.fill(s.value ?? '');
            case 'press': return loc.press(s.value ?? '');
            case 'selectOption': { await loc.selectOption(s.value ?? ''); return; }
          }
        }
      }
    };

    try {
      await run();
      const durationMs = Date.now() - t0;
      steps.push({ index, kind, label, status: 'completed', startedAt, durationMs, retries, ...(inserted.has(step) ? { inserted: true } : {}) });
      finalSteps.push(step);
      deps.emit({ type: 'workflow.step.completed', runId: deps.runId, at: now(), step: summary, durationMs, retries });
    } catch (e) {
      if (signal.aborted) throw new RunCancelled(steps, errors);
      const error = toRunError(e, index, 'action' in step ? step.action : undefined);

      // Phase 9: ask the healer for replacement steps before giving up on the run.
      if (deps.healer && heals.attempts < maxHeals && kind !== 'startRecording' && kind !== 'stopRecording') {
        heals.attempts++;
        deps.emit({ type: 'workflow.healing', runId: deps.runId, at: now(), step: summary, error, attempt: heals.attempts, max: maxHeals });
        deps.log(`step failed (${error.message}); asking the self-healer (attempt ${heals.attempts}/${maxHeals})`, { stepIndex: index, code: error.code });
        let outcome;
        try {
          const observation = await observePage(page);
          outcome = await deps.healer.heal({ goal: deps.goal ?? (def.description || def.name), definition: def, executed: [...finalSteps], failed: step, failedIndex: index, error, remaining: queue.slice(index + 1), observation, attempt: heals.attempts, maxAttempts: maxHeals, signal });
        } catch (he) {
          outcome = { giveUp: true as const, reason: `healer error: ${String((he as Error).message ?? he).split('\n')[0]}` };
        }
        if (signal.aborted) throw new RunCancelled(steps, errors);
        if ('giveUp' in outcome) {
          deps.emit({ type: 'workflow.heal.failed', runId: deps.runId, at: now(), step: summary, attempt: heals.attempts, message: outcome.reason });
          deps.log(`self-healer gave up: ${outcome.reason}`, { stepIndex: index });
        } else {
          heals.healed++;
          for (const r of outcome.replacement) inserted.add(r);
          queue.splice(index, 1 + outcome.dropFollowing, ...outcome.replacement);
          total = queue.length;
          steps.push({ index, kind, label, status: 'healed', startedAt, durationMs: Date.now() - t0, retries, error });
          deps.emit({ type: 'workflow.healed', runId: deps.runId, at: now(), step: summary, replacement: outcome.replacement.map((r, k) => summaryOf(r, index + k)), dropped: outcome.dropFollowing, total, rationale: outcome.rationale });
          deps.log(`healed: ${outcome.replacement.length} replacement step(s)${outcome.dropFollowing ? `, ${outcome.dropFollowing} dropped` : ''} — ${outcome.rationale}`, { stepIndex: index });
          index--; // re-enter the loop at the first replacement step
          continue;
        }
      }

      steps.push({ index, kind, label, status: 'failed', startedAt, durationMs: Date.now() - t0, retries, error, ...(inserted.has(step) ? { inserted: true } : {}) });
      errors.push(error);
      deps.emit({ type: 'workflow.step.failed', runId: deps.runId, at: now(), step: summary, error, continued: step.continueOnError });
      deps.log(`step failed: ${error.message}`, { stepIndex: index, code: error.code });
      if (!step.continueOnError) {
        for (let j = index + 1; j < queue.length; j++) steps.push({ index: j, kind: stepKind(queue[j]!), label: stepLabel(queue[j]!, j), status: 'skipped', retries: 0 });
        if (recordingOpen && deps.recording) await deps.recording.stop().catch(() => undefined);
        throw new WorkflowStepFailure(error, steps, errors, heals);
      }
      finalSteps.push(step);
    }
  }

  if (recordingOpen && deps.recording) {
    const r = await deps.recording.stop().catch(() => undefined);
    deps.emit({ type: 'recording.stopped', runId: deps.runId, at: now(), frames: r?.frames });
  }
  return { steps, errors, status: errors.length ? 'completed_with_errors' : 'completed', finalSteps, heals };
}
