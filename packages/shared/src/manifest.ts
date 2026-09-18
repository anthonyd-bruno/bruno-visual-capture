import { z } from 'zod';
import { IsoDateTimeSchema, SlugSchema, WorkflowSourceKindSchema } from './common.js';
import { AIAttributionSchema, CapturePlanSchema } from './plan.js';
import { ArtifactSchema, CaptureConfigSchema, RunErrorSchema, RunIdSchema, RunStatusSchema } from './run.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export const StepRecordSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  kind: z.string(),
  label: z.string(),
  /** `healed`: the step failed and the self-healer replaced it with steps that then ran (Phase 9). */
  status: z.enum(['completed', 'failed', 'skipped', 'healed']),
  startedAt: IsoDateTimeSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retries: z.number().int().nonnegative().default(0),
  error: RunErrorSchema.optional(),
  /** True for steps the self-healer inserted. */
  inserted: z.boolean().optional(),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

/** `manifest.json` — the authoritative record of a run (PRD §67–§70). Never contains API keys. */
export const RunManifestSchema = z.strictObject({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  runId: RunIdSchema,
  status: RunStatusSchema,
  createdAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
  request: z.strictObject({
    prompt: z.string().optional(),
    plan: CapturePlanSchema.optional(),
  }).prefault({}),
  workflow: z.strictObject({
    id: SlugSchema,
    name: z.string(),
    feature: SlugSchema,
    source: WorkflowSourceKindSchema,
    sourcePath: z.string(),
    /** Always `workflow.yaml`, the exact validated definition used (PRD §70). */
    snapshot: z.literal('workflow.yaml'),
  }),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  capture: CaptureConfigSchema,
  bruno: z.strictObject({
    executablePath: z.string(),
    version: z.string().optional(),
    mode: z.enum(['electron', 'cdp']),
    profileMode: z.enum(['user', 'capture']),
  }),
  ai: AIAttributionSchema.optional(),
  artifacts: z.array(ArtifactSchema),
  steps: z.array(StepRecordSchema),
  errors: z.array(RunErrorSchema),
  debug: z.strictObject({
    log: z.literal('debug/run.log'),
    preservedWorkspace: z.boolean(),
    intermediates: z.array(z.string()).default([]),
  }),
  regenerateOf: z.strictObject({ runId: RunIdSchema, mode: z.enum(['exact', 'latest']) }).optional(),
  /** Phase 9 self-healing summary; `learned` = the generated workflow file was rewritten with the healed steps. */
  healing: z.strictObject({ attempts: z.number().int().nonnegative(), healed: z.number().int().nonnegative(), learned: z.boolean() }).optional(),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;
