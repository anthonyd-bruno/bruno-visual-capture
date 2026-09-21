import { z } from 'zod';
import { CursorModeSchema, FramingSchema, IsoDateTimeSchema, OutputTypeSchema, RegionIdSchema, SlugSchema, ThemeSchema } from './common.js';
import { AIAttributionSchema, CapturePlanSchema } from './plan.js';

/** PRD §65. */
export const RunStatusSchema = z.enum([
  'created', 'validating', 'preparing', 'connecting', 'running', 'processing',
  'completed', 'completed_with_errors', 'failed', 'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;
export const TERMINAL_RUN_STATUSES = ['completed', 'completed_with_errors', 'failed', 'cancelled'] as const satisfies readonly RunStatus[];
export function isTerminalStatus(s: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(s);
}

export const RunIdSchema = z.string().regex(/^run_[0-9A-HJKMNP-TV-Z]{26}$/, 'run id is run_<ULID>');

/** Advanced-settings overrides on top of a preset (PRD §54, §85). */
export const CaptureOverridesSchema = z.strictObject({
  theme: ThemeSchema.optional(),
  width: z.number().int().min(320).max(7680).optional(),
  height: z.number().int().min(200).max(4320).optional(),
  cursor: CursorModeSchema.optional(),
  framing: FramingSchema.optional(),
  region: RegionIdSchema.optional(),
  locator: z.string().min(1).optional(),
  fps: z.number().int().min(5).max(60).optional(),
});
export type CaptureOverrides = z.infer<typeof CaptureOverridesSchema>;

/** Fully resolved capture configuration stored in the manifest (PRD §69 `capture`). */
export const CaptureConfigSchema = z.strictObject({
  output: OutputTypeSchema,
  preset: SlugSchema,
  theme: ThemeSchema,
  framing: FramingSchema,
  region: RegionIdSchema.optional(),
  locator: z.string().min(1).optional(),
  width: z.number().int().positive(),
  /** Absent for GIFs until derived from the capture aspect ratio. */
  height: z.number().int().positive().optional(),
  /** GIF only: final artifact width; the window is recorded at width×height and downscaled (PRD §54). */
  outputWidth: z.number().int().positive().optional(),
  fps: z.number().int().positive().optional(),
  cursor: CursorModeSchema,
  scale: z.enum(['css', 'device']),
});
export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;

/** POST /api/runs body (PRD §85). Backend validation is authoritative. */
export const CreateRunRequestSchema = z.strictObject({
  workflowId: SlugSchema,
  output: OutputTypeSchema,
  preset: SlugSchema.optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  overrides: CaptureOverridesSchema.prefault({}),
  /** Present when the run came from the Capture prompt. */
  request: z.strictObject({
    prompt: z.string().optional(),
    plan: CapturePlanSchema.optional(),
    /** Phase 10: natural-language adjustments applied to this workflow, oldest first. */
    feedback: z.array(z.string()).optional(),
    /** Phase 10: the run this one was refined from. */
    refinedFrom: RunIdSchema.optional(),
    ai: AIAttributionSchema.optional(),
  }).optional(),
  regenerateOf: z.strictObject({ runId: RunIdSchema, mode: z.enum(['exact', 'latest']) }).optional(),
  /** §63: cancel the active run instead of refusing. */
  cancelActive: z.boolean().default(false),
  /** §22: user confirmed "Relaunch Bruno & Continue" (user-profile mode only). */
  allowRelaunch: z.boolean().default(false),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type CreateRunRequestInput = z.input<typeof CreateRunRequestSchema>;

export const RunErrorSchema = z.strictObject({
  code: z.string().min(1),
  /** Answers "what failed?" in one sentence (PRD §94). */
  message: z.string().min(1),
  stepIndex: z.number().int().nonnegative().optional(),
  actionId: z.string().optional(),
  /** Answers "what can the user do next?" */
  hint: z.string().optional(),
  details: z.string().optional(),
});
export type RunError = z.infer<typeof RunErrorSchema>;

export const ArtifactKindSchema = z.enum(['screenshot', 'video', 'gif']);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactSchema = z.strictObject({
  id: z.string().min(1),
  kind: ArtifactKindSchema,
  /** The capture step id for screenshots; the workflow id for recordings. */
  captureId: SlugSchema.optional(),
  fileName: z.string().min(1),
  /** Relative to the run directory, e.g. `screenshots/runner-open.png`. */
  relativePath: z.string().min(1),
  mimeType: z.enum(['image/png', 'video/mp4', 'image/gif']),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  fps: z.number().positive().optional(),
  createdAt: IsoDateTimeSchema,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const StepSummarySchema = z.strictObject({
  index: z.number().int().nonnegative(),
  kind: z.enum(['action', 'capture', 'waitFor', 'pause', 'startRecording', 'stopRecording', 'selectorAction']),
  label: z.string(),
});
export type StepSummary = z.infer<typeof StepSummarySchema>;

const ev = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), runId: RunIdSchema, at: IsoDateTimeSchema, ...shape });

/** SSE payloads (PRD §66) plus `run.log` for the debug pane. */
export const RunEventSchema = z.discriminatedUnion('type', [
  ev('run.status', { status: RunStatusSchema }),
  ev('workflow.started', { workflowId: SlugSchema, stepCount: z.number().int().positive() }),
  ev('workflow.step.started', { step: StepSummarySchema, total: z.number().int().positive() }),
  ev('workflow.step.completed', { step: StepSummarySchema, durationMs: z.number().int().nonnegative(), retries: z.number().int().nonnegative().default(0) }),
  ev('workflow.step.failed', { step: StepSummarySchema, error: RunErrorSchema, continued: z.boolean() }),
  /** Phase 9 self-healing: a failed step is being diagnosed from the live UI … */
  ev('workflow.healing', { step: StepSummarySchema, error: RunErrorSchema, attempt: z.number().int().positive(), max: z.number().int().positive() }),
  /** … and was replaced by these steps (which now run in its place). `total` is the new step count. */
  ev('workflow.healed', { step: StepSummarySchema, replacement: z.array(StepSummarySchema), dropped: z.number().int().nonnegative(), total: z.number().int().positive(), rationale: z.string() }),
  ev('workflow.heal.failed', { step: StepSummarySchema, attempt: z.number().int().positive(), message: z.string() }),
  ev('preview.frame', { dataUrl: z.string().startsWith('data:image/'), width: z.number().int().positive(), height: z.number().int().positive() }),
  ev('artifact.created', { artifact: ArtifactSchema }),
  ev('recording.started', {}),
  ev('recording.stopped', { frames: z.number().int().nonnegative().optional() }),
  ev('processing.started', {}),
  ev('processing.completed', {}),
  ev('run.completed', { status: z.enum(['completed', 'completed_with_errors']) }),
  ev('run.failed', { error: RunErrorSchema }),
  ev('run.cancelled', {}),
  ev('run.log', { level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];
