import {
  BUILT_IN_PRESETS, CapturePlanSchema, confidenceBand, resolveParameters,
  type Capabilities, type CapturePlan, type CapturePreset, type ConfidenceBand, type WorkflowSummary,
} from '@bruno-capture/shared';
import { RawPlanSchema } from './schema.js';

export interface PlanIssue { path: string; message: string }

export interface ValidatedPlan {
  plan: CapturePlan;
  workflow: WorkflowSummary;
  preset: CapturePreset;
  band: ConfidenceBand;
  /** Resolved (typed, defaulted) parameter values the run will use. */
  parameters: Record<string, string | number | boolean>;
}

export class PlanValidationError extends Error {
  readonly code = 'plan_invalid';
  constructor(public readonly issues: PlanIssue[], public readonly raw: unknown) {
    super(`Plan failed validation: ${issues.map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`).join('; ')}`);
    this.name = 'PlanValidationError';
  }
}

/** PRD §15, in order. Local validation is the only gate before anything can run. */
export function validatePlan(raw: unknown, caps: Capabilities, presets: readonly CapturePreset[] = BUILT_IN_PRESETS): ValidatedPlan {
  const issues: PlanIssue[] = [];
  // 1–2. structured response → schema
  const parsed = RawPlanSchema.safeParse(raw);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })), raw);
  const r = parsed.data;

  // 3–4. feature / workflow id
  const workflow = caps.workflows.find((w) => w.id === r.workflowId && w.valid);
  if (!workflow) {
    throw new PlanValidationError([{ path: 'workflowId', message: `"${r.workflowId}" is not a registered workflow. Valid ids: ${caps.workflows.filter((w) => w.valid).map((w) => w.id).join(', ')}` }], raw);
  }
  if ((r.type === 'capture') !== (workflow.kind === 'capture')) issues.push({ path: 'type', message: `workflow "${workflow.id}" has kind ${workflow.kind}; type must be "${workflow.kind}"` });

  // 5. output support
  if (!workflow.supportedOutputs.includes(r.output)) issues.push({ path: 'output', message: `workflow "${workflow.id}" supports ${workflow.supportedOutputs.join(', ')}, not "${r.output}"` });

  // 6–7. declared parameters and their values
  const values: Record<string, unknown> = {};
  for (const p of r.parameters) {
    if (values[p.name] !== undefined) issues.push({ path: `parameters.${p.name}`, message: 'given twice' });
    values[p.name] = p.value;
  }
  const resolved = resolveParameters(workflow.parameters, values);
  if (!resolved.ok) for (const e of resolved.errors) issues.push({ path: `parameters.${e.parameter}`, message: e.message });

  // 8. preset
  const preset = presets.find((p) => p.id === r.preset);
  if (!preset) issues.push({ path: 'preset', message: `"${r.preset}" is not a preset. Valid ids: ${presets.map((p) => p.id).join(', ')}` });
  else if (!preset.outputs.includes(r.output)) issues.push({ path: 'preset', message: `preset "${preset.id}" is for ${preset.outputs.join(', ')}, not "${r.output}"` });

  if (issues.length) throw new PlanValidationError(issues, raw);

  const common = { parameters: Object.fromEntries(r.parameters.map((p) => [p.name, p.value])), preset: r.preset, confidence: r.confidence, rationale: r.rationale };
  const plan = CapturePlanSchema.parse(
    r.type === 'capture'
      ? { type: 'capture', feature: workflow.feature, capture: workflow.id, output: 'screenshot', ...common }
      : { type: 'workflow', workflow: workflow.id, output: r.output, ...common },
  );
  // 9. confidence
  return { plan, workflow, preset: preset!, band: confidenceBand(r.confidence), parameters: resolved.ok ? resolved.values : {} };
}

/** Cheap lexical fallback for PRD §16 (< 0.5): likely workflows for manual selection. */
/** Words that describe the *output* or are filler, not the Bruno feature being asked for. */
const SUGGEST_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'when', 'how', 'show', 'showing', 'shows', 'make', 'making', 'create', 'creating', 'capture', 'capturing', 'record', 'recording', 'gif', 'video', 'mp4', 'screenshot', 'screenshots', 'image', 'images', 'demo', 'docs', 'documentation', 'please', 'want', 'need', 'bruno']);

export function suggestWorkflows(prompt: string, caps: Capabilities, limit = 3): WorkflowSummary[] {
  const tokens = prompt.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !SUGGEST_STOPWORDS.has(t));
  // Hits in the id / name / feature / tags say what the workflow *is*; description hits are weaker evidence.
  const score = (w: WorkflowSummary) => {
    const strong = `${w.id} ${w.name} ${w.feature} ${w.tags.join(' ')}`.toLowerCase();
    const weak = w.description.toLowerCase();
    return tokens.reduce((n, t) => n + (strong.includes(t) ? 2 : weak.includes(t) ? 1 : 0), 0);
  };
  return caps.workflows.filter((w) => w.valid).map((w) => ({ w, s: score(w) })).sort((a, b) => b.s - a.s || a.w.id.localeCompare(b.w.id)).slice(0, limit).map((x) => x.w);
}
