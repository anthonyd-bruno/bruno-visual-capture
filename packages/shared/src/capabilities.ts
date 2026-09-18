import { z } from 'zod';
import { OutputTypeSchema, SlugSchema, WorkflowSourceKindSchema } from './common.js';
import { ParametersSchema } from './parameters.js';
import { CapturePresetSchema } from './presets.js';

/** What the UI lists and the only thing the AI planner is told about (PRD §13, §84 /api/capabilities). */
export const WorkflowSummarySchema = z.strictObject({
  id: SlugSchema,
  name: z.string(),
  description: z.string(),
  kind: z.enum(['workflow', 'capture']),
  feature: SlugSchema,
  tags: z.array(z.string()),
  supportedOutputs: z.array(OutputTypeSchema),
  parameters: ParametersSchema,
  /** Capture step ids, in order — lets the planner and UI describe what a run yields. */
  captureIds: z.array(SlugSchema),
  hasRecordingBounds: z.boolean(),
  source: WorkflowSourceKindSchema,
  sourcePath: z.string(),
  valid: z.boolean(),
  /** Number of §38 escape-hatch steps. */
  selectorDebt: z.number().int().nonnegative(),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

export const FeatureSummarySchema = z.strictObject({ id: SlugSchema, name: z.string(), workflowCount: z.number().int().nonnegative() });

export const CapabilitiesSchema = z.strictObject({
  features: z.array(FeatureSummarySchema),
  workflows: z.array(WorkflowSummarySchema),
  presets: z.array(CapturePresetSchema),
  outputs: z.array(OutputTypeSchema),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
