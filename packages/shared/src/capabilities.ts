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
  /** Phase 9: the step list in compact form, so the planner can adapt existing workflows. */
  steps: z.array(z.unknown()).optional(),
  fixture: z.unknown().optional(),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

export const FeatureSummarySchema = z.strictObject({ id: SlugSchema, name: z.string(), workflowCount: z.number().int().nonnegative() });

/** Phase 9: one registered semantic action as the planner sees it — id, purpose, JSON-schema params. No selectors. */
export const ActionSummarySchema = z.strictObject({
  id: z.string(),
  description: z.string(),
  /** JSON Schema (draft 2020-12) of the params object. */
  params: z.record(z.string(), z.unknown()),
  retryable: z.boolean(),
  /** D11 locator ladder rung: 1 = test id … 6 = raw CSS. */
  rung: z.number().int().min(1).max(6),
});
export type ActionSummary = z.infer<typeof ActionSummarySchema>;

export const RegionSummarySchema = z.strictObject({ id: z.string(), description: z.string() });
export const StateSummarySchema = z.strictObject({ id: z.string(), description: z.string() });

/** Phase 9: a bundled fixture's contents, so the planner can pick one that already has what a prompt needs. */
export const FixtureSummarySchema = z.strictObject({
  path: z.string(),
  description: z.string(),
  collection: z.strictObject({
    name: z.string(),
    requests: z.array(z.strictObject({ name: z.string(), method: z.string(), url: z.string() })),
    environments: z.array(z.strictObject({ name: z.string(), variables: z.array(z.string()) })),
  }).optional(),
  /** Other files (relative to the fixture), e.g. spec/openapi.yaml. */
  files: z.array(z.string()),
});
export type FixtureSummary = z.infer<typeof FixtureSummarySchema>;

export const CapabilitiesSchema = z.strictObject({
  features: z.array(FeatureSummarySchema),
  workflows: z.array(WorkflowSummarySchema),
  presets: z.array(CapturePresetSchema),
  outputs: z.array(OutputTypeSchema),
  /** Phase 9 composition vocabulary. Empty arrays when the server was built without them (older clients). */
  actions: z.array(ActionSummarySchema).default([]),
  regions: z.array(RegionSummarySchema).default([]),
  states: z.array(StateSummarySchema).default([]),
  fixtures: z.array(FixtureSummarySchema).default([]),
  /** `data-testid` values shipped in the detected Bruno build (for `ui.*` primitives). */
  testIds: z.array(z.string()).default([]),
  bruno: z.strictObject({ version: z.string().optional() }).default({}),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
