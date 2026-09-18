import { z } from 'zod';

/** PRD §83. */
export const ComponentStateSchema = z.enum(['ready', 'not-configured', 'action-required', 'unavailable', 'error']);
export type ComponentState = z.infer<typeof ComponentStateSchema>;

export const SYSTEM_COMPONENT_IDS = [
  'bruno', 'ffmpeg', 'screenRecording', 'artifactDirectory', 'display', 'openai', 'anthropic', 'workflowRegistry',
] as const;
export const SystemComponentIdSchema = z.enum(SYSTEM_COMPONENT_IDS);
export type SystemComponentId = z.infer<typeof SystemComponentIdSchema>;

export const ComponentStatusSchema = z.strictObject({
  id: SystemComponentIdSchema,
  label: z.string(),
  state: ComponentStateSchema,
  /** One line: version, path, count, … */
  detail: z.string().optional(),
  /** What the user can do about a non-ready state (PRD §95). */
  remediation: z.string().optional(),
  /** Deep link the UI can open, e.g. `x-apple.systempreferences:…` or a docs URL. */
  action: z.strictObject({ label: z.string(), url: z.string() }).optional(),
});
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

export const SystemStatusSchema = z.strictObject({
  checkedAt: z.string(),
  components: z.array(ComponentStatusSchema),
  /** Derived: which product capabilities are currently usable. */
  capabilities: z.strictObject({
    screenshots: z.boolean(),
    fullWindowCapture: z.boolean(),
    video: z.boolean(),
    gif: z.boolean(),
    aiPlanning: z.boolean(),
  }),
});
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
