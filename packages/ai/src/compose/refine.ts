import { z } from 'zod';
import {
  BUILT_IN_PRESETS, CaptureOverridesSchema, DEFAULT_PRESET_FOR_OUTPUT, WorkflowDefinitionSchema, confidenceBand, formatObservation, selectorDebt,
  type Capabilities, type CaptureOverrides, type CapturePreset, type ConfidenceBand, type RunManifest, type Step, type WorkflowDefinition, type WorkflowDefinitionInput,
} from '@bruno-capture/shared';
import { PlanValidationError, type PlanIssue } from '../validate.js';
import { BRUNO_UI_GUIDE, compactStep, describeComposeCatalog } from './catalog.js';
import { RawStepSchema, type RawStep } from './schema.js';
import { parseInlineCollection, rawStepsToSteps, type ComposeCatalog } from './validate.js';

/**
 * Phase 10 — refine: adjust an existing workflow/capture from feedback ("don't obscure the token")
 * without replanning. The model returns the COMPLETE step list (unchanged steps copied verbatim) plus
 * optional capture-setting changes; null = unchanged. Small schema for the same grammar reasons as compose.
 */
const NullableString = z.string().nullable();
const NullableNumber = z.number().nullable();

export const RawRefineSchema = z.object({
  steps: z.array(RawStepSchema).describe('the COMPLETE updated step list; copy every step the feedback does not touch verbatim'),
  name: NullableString.describe('new workflow name, or null to keep'),
  description: NullableString,
  output: z.enum(['screenshots', 'video', 'gif']).nullable().describe('null = keep the current output type'),
  preset: NullableString.describe('a PRESETS id, or null to keep'),
  theme: z.enum(['light', 'dark']).nullable(),
  cursor: z.enum(['hidden', 'visible', 'smooth']).nullable(),
  width: NullableNumber.describe('window/content width in CSS px, or null'),
  height: NullableNumber,
  bundledFixturePath: NullableString.describe('switch to this bundled fixture, or null to keep the current fixture'),
  inlineCollectionJson: NullableString.describe('replace the inline collection (same JSON shape as when composing), or null to keep'),
  changes: z.array(z.string()).describe('one plain-language line per change made'),
  rationale: z.string(),
  confidence: z.number().describe('0–1 that the adjusted workflow does what the feedback asks'),
});
export type RawRefine = z.infer<typeof RawRefineSchema>;

/** Definition steps → the flat AI shape, so the model can copy them verbatim. Inverse of rawStepsToSteps (modulo continueOnError). */
export function stepsToRaw(steps: Step[]): RawStep[] {
  const raw = (s: Partial<RawStep> & { kind: RawStep['kind'] }): RawStep => ({ kind: s.kind, action: s.action ?? null, params: s.params ?? [], label: s.label ?? null, id: s.id ?? null, name: s.name ?? null, region: s.region ?? null, state: s.state ?? null, text: s.text ?? null, ms: s.ms ?? null });
  const toParams = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([name, v]) => ({ name, value: typeof v === 'string' ? v : JSON.stringify(v) }));
  return steps.map((s): RawStep => {
    if ('action' in s) return raw({ kind: 'action', action: s.action, params: toParams(s.params as Record<string, unknown>), label: s.label ?? null });
    if ('capture' in s) return raw({ kind: 'capture', id: s.capture.id, name: s.capture.name ?? null, region: s.capture.region ?? null });
    if ('waitFor' in s) {
      const w = s.waitFor;
      const ms = w.timeoutMs !== 15_000 ? w.timeoutMs : null;
      if (w.state) return raw({ kind: 'waitForState', state: w.state, ms });
      if (w.text) {
        const t = w.text;
        if (t.locator) return raw({ kind: 'action', action: 'ui.waitForText', params: [{ name: 'text', value: t.contains ?? t.equals ?? '' }, ...(ms ? [{ name: 'timeoutMs', value: String(ms) }] : [])] });
        return raw({ kind: 'waitForText', text: t.contains ?? t.equals ?? '', region: t.region ?? null, ms });
      }
      for (const [k, state] of [['visible', 'visible'], ['attached', 'visible'], ['hidden', 'hidden'], ['detached', 'hidden']] as const) {
        const target = w[k];
        if (!target) continue;
        if (target.region) return raw({ kind: 'waitForRegion', region: target.region, state, ms });
        return raw({ kind: 'action', action: 'ui.waitFor', params: [{ name: 'css', value: target.locator! }, { name: 'state', value: state }, ...(ms ? [{ name: 'timeoutMs', value: String(ms) }] : [])] });
      }
      return raw({ kind: 'pause', ms: 1 });
    }
    if ('pause' in s) return raw({ kind: 'pause', ms: s.pause });
    if ('startRecording' in s) return raw({ kind: 'startRecording' });
    if ('stopRecording' in s) return raw({ kind: 'stopRecording' });
    // §38 escape hatch → the equivalent ui.* primitive addressed by CSS.
    const a = (s as Extract<Step, { selectorAction: unknown }>).selectorAction;
    switch (a.operation) {
      case 'click': return raw({ kind: 'action', action: 'ui.click', params: [{ name: 'css', value: a.locator }] });
      case 'hover': return raw({ kind: 'action', action: 'ui.hover', params: [{ name: 'css', value: a.locator }] });
      case 'fill': return raw({ kind: 'action', action: 'ui.type', params: [{ name: 'css', value: a.locator }, { name: 'value', value: a.value ?? '' }, { name: 'clear', value: 'true' }] });
      case 'press': return raw({ kind: 'action', action: 'ui.press', params: [{ name: 'key', value: a.value ?? '' }, { name: 'target', value: JSON.stringify({ css: a.locator }) }] });
      case 'selectOption': return raw({ kind: 'action', action: 'ui.selectOption', params: [{ name: 'css', value: a.locator }, { name: 'option', value: a.value ?? '' }] });
    }
  });
}

export interface RefineCurrent {
  definition: WorkflowDefinition;
  output: 'screenshots' | 'video' | 'gif';
  preset: string;
  overrides: CaptureOverrides;
  /** Original prompt and earlier adjustments, oldest first. */
  prompt?: string;
  feedback?: string[];
  /** Outcome of the run being adjusted, when there is one. */
  run?: Pick<RunManifest, 'status' | 'steps' | 'errors' | 'artifacts' | 'healing'>;
}

export interface RefineRequest { feedback: string; current: RefineCurrent; capabilities: Capabilities; repair?: { previous: unknown; issues: string[] } }

export const REFINE_SYSTEM_PROMPT = `You adjust an existing Bruno Capture workflow according to the user's feedback. The workflow drives the real Bruno desktop app with deterministic, validated steps to produce documentation screenshots, videos or GIFs.

Return the COMPLETE updated step list plus any capture-setting changes. Rules:
- Change only what the feedback requires. Every step the feedback does not touch must be copied verbatim (same action, params, ids, labels, pauses).
- Use only the ACTIONS, STATES, REGIONS and test ids listed; the step format is the same flat object the planner uses (kind + the fields that kind needs; unused fields null / []).
- Feedback about what is visible → add, remove, reorder or re-parameterise steps (e.g. masked secrets: request.setAuth with reveal "true", or a request.revealSecret step after the value is entered; a toast covering something: a longer pause before the capture; something not shown: add the action + a capture).
- Feedback about the output (GIF vs screenshots, dark theme, wider, hide/show the cursor, a docs preset) → set output / preset / theme / cursor / width / height; leave the others null.
- Feedback about the data (different token, URL, request name) → change the step params, and when the value lives in the inline collection, return the whole updated inlineCollectionJson.
- Keep capture ids stable unless the feedback renames them; new captures get new kebab-case ids.
- changes: one short line per change, in plain language. rationale: one or two sentences. confidence: 0.85+ when the change maps to a known action/param, lower when you had to guess a UI path.`;

export function buildRefineMessage(req: RefineRequest): string {
  const { current: c } = req;
  const parts: string[] = [];
  parts.push(BRUNO_UI_GUIDE);
  parts.push('');
  parts.push(describeComposeCatalog({ ...req.capabilities, workflows: [] }));
  parts.push('');
  parts.push(`CURRENT WORKFLOW: ${c.definition.name} — ${c.definition.description}`);
  parts.push(`fixture: ${c.definition.fixture ? (c.definition.fixture.source === 'inline' ? `inline collection ${JSON.stringify(c.definition.fixture.collection)}` : JSON.stringify(c.definition.fixture)) : 'none (empty workspace)'}`);
  parts.push(`current output: ${c.output}  preset: ${c.preset}  overrides: ${JSON.stringify(c.overrides)}`);
  parts.push('current steps (readable):');
  for (const s of c.definition.steps) parts.push(compactStep(s));
  parts.push('current steps (exact JSON to copy from):');
  parts.push(JSON.stringify(stepsToRaw(c.definition.steps)));
  if (c.prompt) { parts.push(''); parts.push(`ORIGINAL REQUEST: ${c.prompt}`); }
  if (c.feedback?.length) { parts.push('EARLIER ADJUSTMENTS (already applied):'); for (const f of c.feedback) parts.push(`- ${f}`); }
  if (c.run) {
    parts.push('');
    parts.push(`LAST RUN: ${c.run.status}${c.run.healing ? ` (${c.run.healing.healed} step(s) self-healed)` : ''}`);
    const failed = c.run.steps.filter((s) => s.status === 'failed');
    for (const f of failed) parts.push(`- failed step ${f.index + 1} "${f.label}": ${f.error?.message ?? ''}`);
    if (c.run.artifacts.length) parts.push(`artifacts: ${c.run.artifacts.map((a) => `${a.relativePath}${a.width ? ` ${a.width}×${a.height}` : ''}${a.durationMs ? ` ${(a.durationMs / 1000).toFixed(1)}s` : ''}`).join(', ')}`);
  }
  parts.push('');
  parts.push('FEEDBACK TO APPLY NOW:');
  parts.push(req.feedback.trim());
  if (req.repair) {
    parts.push('');
    parts.push('YOUR PREVIOUS ANSWER WAS REJECTED BY LOCAL VALIDATION. Previous answer:');
    parts.push(typeof req.repair.previous === 'string' ? req.repair.previous : JSON.stringify(req.repair.previous).slice(0, 12_000));
    parts.push('Problems:');
    for (const i of req.repair.issues) parts.push(`- ${i}`);
    parts.push('Return a corrected answer that fixes every problem and changes nothing else.');
  }
  return parts.join('\n');
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; line: string };

/** Line diff of the compact step renderings (LCS; step lists are short). */
export function diffSteps(before: Step[], after: Step[]): DiffLine[] {
  const a = before.map((s) => compactStep(s)), b = after.map((s) => compactStep(s));
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', line: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'removed', line: a[i]! }); i++; }
    else { out.push({ kind: 'added', line: b[j]! }); j++; }
  }
  while (i < n) out.push({ kind: 'removed', line: a[i++]! });
  while (j < m) out.push({ kind: 'added', line: b[j++]! });
  return out;
}

export interface ValidatedRefinement {
  definition: WorkflowDefinition;
  input: WorkflowDefinitionInput;
  output: 'screenshots' | 'video' | 'gif';
  preset: CapturePreset;
  overrides: CaptureOverrides;
  changes: string[];
  rationale: string;
  confidence: number;
  band: ConfidenceBand;
  diff: DiffLine[];
  settingsChanged: string[];
  debt: number;
}

export function validateRefinement(raw: unknown, catalog: ComposeCatalog, current: RefineCurrent): ValidatedRefinement {
  const presets = catalog.presets ?? BUILT_IN_PRESETS;
  const parsed = RawRefineSchema.safeParse(raw);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })), raw);
  const r = parsed.data;
  const issues: PlanIssue[] = [];
  const steps = rawStepsToSteps(r.steps, catalog, issues, 'steps');
  if (!r.steps.length) issues.push({ path: 'steps', message: 'the step list is empty' });

  const output = r.output ?? current.output;
  const presetId = r.preset ?? (r.output && r.output !== current.output ? DEFAULT_PRESET_FOR_OUTPUT[output] : current.preset);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) issues.push({ path: 'preset', message: `"${presetId}" is not a preset. Valid ids: ${presets.map((p) => p.id).join(', ')}` });
  else if (!preset.outputs.includes(output)) issues.push({ path: 'preset', message: `preset "${preset.id}" is for ${preset.outputs.join(', ')}, not "${output}"` });

  const overridesInput: Record<string, unknown> = { ...current.overrides };
  if (r.theme) overridesInput['theme'] = r.theme;
  if (r.cursor) overridesInput['cursor'] = r.cursor;
  if (r.width !== null) overridesInput['width'] = Math.round(r.width);
  if (r.height !== null) overridesInput['height'] = Math.round(r.height);
  const ov = CaptureOverridesSchema.safeParse(overridesInput);
  if (!ov.success) issues.push(...ov.error.issues.map((i) => ({ path: `overrides.${i.path.map(String).join('.')}`, message: i.message })));

  let fixture: unknown = current.definition.fixture;
  if (r.bundledFixturePath) {
    const fx = catalog.capabilities.fixtures.find((f) => f.path === r.bundledFixturePath);
    if (!fx) issues.push({ path: 'bundledFixturePath', message: `"${r.bundledFixturePath}" is not a bundled fixture` });
    else fixture = { source: 'bundled', path: fx.path };
  } else if (r.inlineCollectionJson) {
    const col = parseInlineCollection(r.inlineCollectionJson, issues, 'inlineCollectionJson');
    if (col) fixture = { source: 'inline', collection: col };
  }

  const hasCapture = steps.some((s) => 'capture' in (s as object));
  const supported = new Set<string>(current.definition.supportedOutputs);
  supported.add(output);
  if (!hasCapture) supported.delete('screenshots');
  if (output === 'screenshots' && !hasCapture) issues.push({ path: 'steps', message: 'output screenshots needs at least one capture step' });

  const d = current.definition;
  const input: WorkflowDefinitionInput = {
    version: 1, id: d.id, name: r.name?.trim() || d.name, description: r.description ?? d.description, kind: 'workflow', feature: d.feature, tags: d.tags,
    supportedOutputs: [...supported] as WorkflowDefinitionInput['supportedOutputs'], parameters: d.parameters,
    ...(fixture ? { fixture: fixture as WorkflowDefinitionInput['fixture'] } : {}),
    defaults: { ...d.defaults, preset: preset?.id },
    ...(d.recording ? { recording: d.recording } : {}),
    steps: steps.length ? steps : [{ pause: 1 }],
  };
  const def = WorkflowDefinitionSchema.safeParse(input);
  if (!def.success) issues.push(...def.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  if (issues.length) throw new PlanValidationError(issues.filter((x, i, arr) => arr.findIndex((y) => y.path === x.path && y.message === x.message) === i), raw);

  const definition = def.data!;
  const settingsChanged: string[] = [];
  if (output !== current.output) settingsChanged.push(`output ${current.output} → ${output}`);
  if (preset!.id !== current.preset) settingsChanged.push(`preset ${current.preset} → ${preset!.id}`);
  for (const k of ['theme', 'cursor', 'width', 'height'] as const) if (ov.data![k] !== undefined && ov.data![k] !== current.overrides[k]) settingsChanged.push(`${k} → ${String(ov.data![k])}`);
  const confidence = Math.max(0, Math.min(1, r.confidence));
  return { definition, input, output, preset: preset!, overrides: ov.data!, changes: r.changes, rationale: r.rationale, confidence, band: confidenceBand(confidence), diff: diffSteps(d.steps, definition.steps), settingsChanged, debt: selectorDebt(definition) };
}
export { formatObservation };
