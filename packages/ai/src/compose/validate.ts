import {
  BUILT_IN_PRESETS, CapturePlanSchema, InlineCollectionSchema, WorkflowDefinitionSchema, confidenceBand, selectorDebt,
  type Capabilities, type CapturePlan, type CapturePreset, type ConfidenceBand, type Step, type WorkflowDefinition, type WorkflowDefinitionInput,
} from '@bruno-capture/shared';
import { PlanValidationError, validatePlan, type PlanIssue, type ValidatedPlan } from '../validate.js';
import { RawComposedPlanSchema, RawHealSchema, type RawComposedPlan, type RawHeal, type RawStep } from './schema.js';

/** What local validation needs beyond the capabilities: the real action param schemas (server supplies them from the registry). */
export interface ComposeCatalog {
  capabilities: Capabilities;
  /** Returns issues for an action's params, or undefined when they parse. */
  validateActionParams?: (actionId: string, params: Record<string, unknown>) => PlanIssue[] | undefined;
  presets?: readonly CapturePreset[];
}

export type ValidatedComposedPlan =
  | { kind: 'reuse'; validated: ValidatedPlan; confidence: number; rationale: string }
  | {
      kind: 'compose';
      /** Validated definition with a placeholder id; the store assigns the final id when saving. */
      definition: WorkflowDefinition;
      input: WorkflowDefinitionInput;
      output: 'screenshots' | 'video' | 'gif';
      preset: CapturePreset;
      band: ConfidenceBand;
      confidence: number;
      rationale: string;
      plan: CapturePlan;
      /** ui.* steps addressed by css + selectorAction steps. */
      debt: number;
      /** ui.* primitive steps (any handle) — the plan's "guessed UI path" count. */
      primitives: number;
    };

export const PLACEHOLDER_ID = 'composed-preview';

/** Coerce the model's string values to what the action's JSON schema declares. */
export function coerceParams(schema: Record<string, unknown> | undefined, params: Array<{ name: string; value: string }>): Record<string, unknown> {
  const props = ((schema?.['properties'] ?? {}) as Record<string, Record<string, unknown>>);
  const out: Record<string, unknown> = {};
  for (const p of params) {
    const ps = props[p.name];
    const types = new Set<string>();
    const collect = (s: Record<string, unknown> | undefined) => {
      if (!s) return;
      if (typeof s['type'] === 'string') types.add(s['type'] as string);
      if (Array.isArray(s['type'])) for (const t of s['type'] as string[]) types.add(t);
      for (const alt of (s['anyOf'] as Array<Record<string, unknown>> | undefined) ?? []) collect(alt);
      for (const alt of (s['oneOf'] as Array<Record<string, unknown>> | undefined) ?? []) collect(alt);
    };
    collect(ps);
    const v = p.value;
    if ((types.has('number') || types.has('integer')) && /^-?\d+(\.\d+)?$/.test(v.trim())) out[p.name] = Number(v);
    else if (types.has('boolean') && /^(true|false)$/i.test(v.trim())) out[p.name] = v.trim().toLowerCase() === 'true';
    else if ((types.has('object') || types.has('array')) && /^[[{]/.test(v.trim())) { try { out[p.name] = JSON.parse(v); } catch { out[p.name] = v; } }
    else out[p.name] = v;
  }
  return out;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Raw AI steps → workflow input steps, validating ids against the catalog. Issues are collected, not thrown. */
export function rawStepsToSteps(raw: RawStep[], catalog: ComposeCatalog, issues: PlanIssue[], pathPrefix = 'steps'): WorkflowDefinitionInput['steps'] {
  const caps = catalog.capabilities;
  const actions = new Map(caps.actions.map((a) => [a.id, a]));
  const states = new Set(caps.states.map((s) => s.id));
  const regions = new Set(caps.regions.map((r) => r.id));
  const steps: Array<Record<string, unknown>> = [];
  const seenCaptures = new Set<string>();
  raw.forEach((s, i) => {
    const at = `${pathPrefix}[${i}]`;
    const timeout = s.ms ? { timeoutMs: clampTimeout(s.ms) } : {};
    switch (s.kind) {
      case 'action': {
        if (!s.action) { issues.push({ path: `${at}.action`, message: 'kind action needs an action id' }); return; }
        const a = actions.get(s.action);
        if (!a) { issues.push({ path: `${at}.action`, message: `"${s.action}" is not a registered action` }); return; }
        const dup = s.params.map((p) => p.name).filter((n, j, arr) => arr.indexOf(n) !== j);
        if (dup.length) issues.push({ path: `${at}.params`, message: `parameter given twice: ${dup.join(', ')}` });
        const params = coerceParams(a.params, s.params);
        const bad = catalog.validateActionParams?.(s.action, params);
        if (bad) for (const b of bad) issues.push({ path: `${at}.params${b.path ? '.' + b.path : ''}`, message: b.message });
        steps.push({ action: s.action, params, ...(s.label ? { label: s.label } : {}) });
        return;
      }
      case 'capture': {
        const rawId = s.id ?? '';
        const id = SLUG.test(rawId) ? rawId : toSlug(rawId);
        if (!id) { issues.push({ path: `${at}.id`, message: 'kind capture needs a kebab-case id' }); return; }
        if (seenCaptures.has(id)) issues.push({ path: `${at}.id`, message: `duplicate capture id "${id}"` });
        seenCaptures.add(id);
        if (s.region && !regions.has(s.region)) issues.push({ path: `${at}.region`, message: `"${s.region}" is not a region. Valid: ${[...regions].join(', ')}` });
        steps.push({ capture: { id, ...(s.name ? { name: s.name } : {}), ...(s.region ? { framing: 'region', region: s.region } : {}) } });
        return;
      }
      case 'waitForState': {
        if (!s.state || !states.has(s.state)) { issues.push({ path: `${at}.state`, message: `"${s.state ?? ''}" is not a state. Valid: ${[...states].join(', ')}` }); return; }
        steps.push({ waitFor: { state: s.state, ...timeout } });
        return;
      }
      case 'waitForText': {
        if (!s.text) { issues.push({ path: `${at}.text`, message: 'kind waitForText needs text' }); return; }
        const region = s.region ?? 'app.shell';
        if (!regions.has(region)) { issues.push({ path: `${at}.region`, message: `"${region}" is not a region` }); return; }
        steps.push({ waitFor: { text: { region, contains: s.text }, ...timeout } });
        return;
      }
      case 'waitForRegion': {
        if (!s.region || !regions.has(s.region)) { issues.push({ path: `${at}.region`, message: `"${s.region ?? ''}" is not a region` }); return; }
        const state = s.state === 'hidden' ? 'hidden' : 'visible';
        steps.push({ waitFor: { [state]: { region: s.region }, ...timeout } });
        return;
      }
      case 'pause': {
        const ms = Math.round(Number(s.ms));
        if (!Number.isFinite(ms) || ms <= 0) { issues.push({ path: `${at}.ms`, message: 'kind pause needs a positive ms' }); return; }
        steps.push({ pause: Math.min(ms, 10_000) });
        return;
      }
      case 'startRecording': steps.push({ startRecording: {} }); return;
      case 'stopRecording': steps.push({ stopRecording: {} }); return;
    }
  });
  return steps as WorkflowDefinitionInput['steps'];
}

const clampTimeout = (ms: number) => Math.max(1000, Math.min(Math.round(ms), 180_000));

/** The model writes the inline collection as JSON text; parse and validate it with the canonical schema. */
export function parseInlineCollection(json: string, issues: PlanIssue[], at = 'compose.inlineCollectionJson'): Record<string, unknown> | undefined {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch (e) { issues.push({ path: at, message: `not valid JSON: ${String((e as Error).message).split('\n')[0]}` }); return undefined; }
  const parsed = InlineCollectionSchema.safeParse(raw);
  if (!parsed.success) { for (const i of parsed.error.issues) issues.push({ path: `${at}.${i.path.map(String).join('.')}`, message: i.message }); return undefined; }
  return raw as Record<string, unknown>;
}

/** PRD §15 spirit for composed plans: schema → catalog ids → action params → workflow schema → preset/output. Throws PlanValidationError. */
export function validateComposedPlan(raw: unknown, catalog: ComposeCatalog): ValidatedComposedPlan {
  const presets = catalog.presets ?? BUILT_IN_PRESETS;
  const parsed = RawComposedPlanSchema.safeParse(raw);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })), raw);
  const r = parsed.data;
  const issues: PlanIssue[] = [];
  if (!(r.confidence >= 0 && r.confidence <= 1)) issues.push({ path: 'confidence', message: 'must be between 0 and 1' });

  if (r.mode === 'reuse') {
    if (!r.reuse) throw new PlanValidationError([{ path: 'reuse', message: 'mode is reuse but reuse is null' }], raw);
    const wf = catalog.capabilities.workflows.find((w) => w.id === r.reuse!.workflowId && w.valid);
    const validated = validatePlan({ type: wf?.kind === 'capture' ? 'capture' : 'workflow', workflowId: r.reuse.workflowId, output: r.output, preset: r.preset, parameters: r.reuse.parameters, confidence: Math.max(0, Math.min(1, r.confidence)), rationale: r.rationale }, catalog.capabilities, presets);
    if (issues.length) throw new PlanValidationError(issues, raw);
    return { kind: 'reuse', validated, confidence: r.confidence, rationale: r.rationale };
  }

  const c = r.compose;
  if (!c) throw new PlanValidationError([{ path: 'compose', message: 'mode is compose but compose is null' }], raw);
  if (r.output === 'screenshot') issues.push({ path: 'output', message: 'composed workflows use "screenshots", "video" or "gif"' });
  const output = (r.output === 'screenshot' ? 'screenshots' : r.output) as 'screenshots' | 'video' | 'gif';
  const preset = presets.find((p) => p.id === r.preset);
  if (!preset) issues.push({ path: 'preset', message: `"${r.preset}" is not a preset. Valid ids: ${presets.map((p) => p.id).join(', ')}` });
  else if (!preset.outputs.includes(output)) issues.push({ path: 'preset', message: `preset "${preset.id}" is for ${preset.outputs.join(', ')}, not "${output}"` });

  let fixture: Record<string, unknown> | undefined;
  if (c.fixtureKind === 'bundled') {
    const fx = catalog.capabilities.fixtures.find((f) => f.path === c.bundledFixturePath);
    if (!fx) issues.push({ path: 'compose.bundledFixturePath', message: `"${c.bundledFixturePath}" is not a bundled fixture. Valid: ${catalog.capabilities.fixtures.map((f) => f.path).join(', ')}` });
    else fixture = { source: 'bundled', path: fx.path };
  } else if (c.fixtureKind === 'inline') {
    if (!c.inlineCollectionJson) issues.push({ path: 'compose.inlineCollectionJson', message: 'fixtureKind is inline but inlineCollectionJson is null' });
    else { const col = parseInlineCollection(c.inlineCollectionJson, issues); if (col) fixture = { source: 'inline', collection: col }; }
  }

  const steps = rawStepsToSteps(c.steps, catalog, issues, 'compose.steps');
  const feature = SLUG.test(c.feature) ? c.feature : toSlug(c.feature) || 'general';
  const supportedOutputs = output === 'screenshots' ? ['screenshots', 'video', 'gif'] : steps.some((s) => 'capture' in (s as object)) ? ['screenshots', 'video', 'gif'] : ['video', 'gif'];
  const input: WorkflowDefinitionInput = {
    version: 1, id: PLACEHOLDER_ID, name: c.name.trim() || 'Composed workflow', description: c.description, kind: 'workflow', feature,
    tags: [...new Set(c.tags.map((t) => t.trim()).filter(Boolean))], supportedOutputs: supportedOutputs as WorkflowDefinitionInput['supportedOutputs'],
    parameters: {}, ...(fixture ? { fixture: fixture as WorkflowDefinitionInput['fixture'] } : {}), defaults: { preset: preset?.id },
    steps: steps.length ? steps : [{ pause: 1 }],
  };
  if (!steps.length) issues.push({ path: 'compose.steps', message: 'no valid steps' });
  const def = WorkflowDefinitionSchema.safeParse(input);
  if (!def.success) issues.push(...def.error.issues.map((i) => ({ path: `compose.${i.path.map(String).join('.')}`, message: i.message })));
  if (issues.length) throw new PlanValidationError(dedupe(issues), raw);
  const definition = def.data!;
  const primitives = definition.steps.filter((s) => 'action' in s && s.action.startsWith('ui.')).length;
  const confidence = Math.max(0, Math.min(1, r.confidence));
  const plan = CapturePlanSchema.parse({ type: 'composed', workflow: PLACEHOLDER_ID, output, preset: preset!.id, confidence, rationale: r.rationale, parameters: {} });
  return { kind: 'compose', definition, input, output, preset: preset!, band: confidenceBand(confidence), confidence, rationale: r.rationale, plan, debt: selectorDebt(definition), primitives };
}

const dedupe = (issues: PlanIssue[]) => issues.filter((x, i, arr) => arr.findIndex((y) => y.path === x.path && y.message === x.message) === i);

export interface ValidatedHeal { replacement: Step[]; dropFollowing: number; rationale: string; giveUp: boolean }

/** Heal answers reuse the step mapper; a definition wrapper gives us the full step schema for free. */
export function validateHeal(raw: unknown, catalog: ComposeCatalog, remainingCount: number): ValidatedHeal {
  const parsed = RawHealSchema.safeParse(raw);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })), raw);
  const h = parsed.data;
  if (h.giveUp) return { replacement: [], dropFollowing: 0, rationale: h.reason, giveUp: true };
  const issues: PlanIssue[] = [];
  const steps = rawStepsToSteps(h.replacement.filter((s) => s.kind !== 'startRecording' && s.kind !== 'stopRecording'), catalog, issues, 'replacement');
  if (h.replacement.length > 8) issues.push({ path: 'replacement', message: 'at most 8 replacement steps' });
  const drop = Math.max(0, Math.min(Math.round(Number(h.dropFollowing) || 0), remainingCount));
  let replacement: Step[] = [];
  if (steps.length) {
    const def = WorkflowDefinitionSchema.safeParse({ version: 1, id: 'heal', name: 'heal', feature: 'heal', supportedOutputs: ['video'], steps });
    if (!def.success) issues.push(...def.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
    else replacement = def.data.steps;
  }
  if (issues.length) throw new PlanValidationError(dedupe(issues), raw);
  return { replacement, dropFollowing: drop, rationale: h.reason, giveUp: false };
}
