import { readFile } from 'node:fs/promises';
import { RunValidationError } from '@bruno-capture/core';
import type { RefineCurrent } from '@bruno-capture/ai';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_FOR_OUTPUT, WorkflowDefinitionSchema, type AIAttribution, type CaptureOverrides, type RunManifest, type WorkflowDefinition, type WorkflowDefinitionInput } from '@bruno-capture/shared';
import { parse as parseYaml } from 'yaml';
import type { ServerContext } from './context.js';

/** Phase 10: what a refinement starts from — a finished run (preferred: its exact snapshot), a registered workflow, or an unsaved definition. */
export async function resolveRefineCurrent(ctx: ServerContext, from: { runId?: string; workflowId?: string; definition?: WorkflowDefinitionInput; output?: 'screenshots' | 'video' | 'gif'; preset?: string; overrides?: CaptureOverrides }): Promise<{ current: RefineCurrent; source: { workflowId: string; workflowSource: string; runId?: string } }> {
  if (from.runId) {
    const rec = ctx.engine.get(from.runId);
    if (!rec) throw new RunValidationError(`No run ${from.runId}`);
    const m = rec.manifest;
    let def: WorkflowDefinition | undefined;
    try { def = WorkflowDefinitionSchema.parse(parseYaml(await readFile(rec.artifacts.snapshotFile, 'utf8'))); } catch { def = ctx.registry.get(m.workflow.id)?.definition; }
    if (!def) throw new RunValidationError(`Run ${from.runId} has no usable workflow snapshot`);
    const output = (m.capture.output === 'screenshot' ? 'screenshots' : m.capture.output) as RefineCurrent['output'];
    const overrides: CaptureOverrides = { theme: m.capture.theme, cursor: m.capture.cursor, framing: m.capture.framing, region: m.capture.region, locator: m.capture.locator, fps: m.capture.fps };
    const preset = BUILT_IN_PRESETS.find((p) => p.id === m.capture.preset)?.outputs.includes(output) ? m.capture.preset : DEFAULT_PRESET_FOR_OUTPUT[output];
    return {
      current: { definition: def, output, preset, overrides, prompt: m.request.prompt, feedback: m.request.feedback, run: { status: m.status, steps: m.steps, errors: m.errors, artifacts: m.artifacts, healing: m.healing } },
      source: { workflowId: m.workflow.id, workflowSource: m.workflow.source, runId: from.runId },
    };
  }
  if (from.workflowId) {
    const lw = ctx.registry.get(from.workflowId);
    if (!lw?.definition) throw new RunValidationError(`Unknown or invalid workflow "${from.workflowId}"`);
    const d = lw.definition;
    const output = from.output ?? (d.supportedOutputs.find((o) => o !== 'screenshot') as RefineCurrent['output'] | undefined) ?? 'screenshots';
    return { current: { definition: d, output, preset: from.preset ?? d.defaults.preset ?? 'docs-screenshot', overrides: from.overrides ?? {} }, source: { workflowId: d.id, workflowSource: lw.source } };
  }
  if (from.definition) {
    const d = WorkflowDefinitionSchema.parse(from.definition);
    return { current: { definition: d, output: from.output ?? 'screenshots', preset: from.preset ?? d.defaults.preset ?? 'docs-screenshot', overrides: from.overrides ?? {} }, source: { workflowId: d.id, workflowSource: 'unsaved' } };
  }
  throw new RunValidationError('refine needs a runId, a workflowId or a definition');
}

export interface ApplyRefinementInput {
  workflowId: string;
  definition: WorkflowDefinitionInput;
  output: 'screenshots' | 'video' | 'gif';
  preset: string;
  overrides?: CaptureOverrides;
  prompt?: string;
  feedback: string[];
  refinedFrom?: string;
  ai?: AIAttribution;
  cancelActive?: boolean;
  allowRelaunch?: boolean;
}

/**
 * Save the refined definition — in place when the workflow is `generated`, otherwise as a new
 * generated workflow derived from the built-in/custom one (those files are never edited) — then run it.
 */
export async function applyRefinement(ctx: ServerContext, input: ApplyRefinementInput): Promise<{ run: RunManifest; workflowId: string; savedAs: 'updated' | 'created' }> {
  const lw = ctx.registry.get(input.workflowId);
  let workflowId = input.workflowId;
  let savedAs: 'updated' | 'created';
  const note = `Refined${input.refinedFrom ? ` from run ${input.refinedFrom}` : ''}: ${input.feedback.at(-1)?.replace(/\s+/g, ' ').slice(0, 200) ?? ''}`;
  if (lw?.source === 'generated' && lw.definition) {
    await ctx.generated.update(lw.file, WorkflowDefinitionSchema.parse({ ...input.definition, id: lw.definition.id }), note);
    savedAs = 'updated';
  } else {
    const saved = await ctx.generated.save({ ...input.definition, id: 'refined' }, { prompt: `${input.prompt ?? input.definition.name} — ${input.feedback.join(' / ')}`, provider: input.ai?.provider, model: input.ai?.model });
    workflowId = saved.id;
    savedAs = 'created';
  }
  await ctx.registry.refresh();
  const run = await ctx.engine.create({
    workflowId, output: input.output, preset: input.preset, parameters: {}, overrides: input.overrides ?? {},
    request: { prompt: input.prompt, feedback: input.feedback, refinedFrom: input.refinedFrom as `run_${string}` | undefined, ai: input.ai },
    cancelActive: input.cancelActive ?? false, allowRelaunch: input.allowRelaunch ?? false,
  });
  ctx.log(`refinement ${savedAs} ${workflowId} → run ${run.runId}`);
  return { run, workflowId, savedAs };
}
