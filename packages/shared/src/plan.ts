import { z } from 'zod';
import { AIProviderIdSchema, SlugSchema } from './common.js';

const planCommon = {
  parameters: z.record(z.string(), z.unknown()).default({}),
  preset: SlugSchema,
  /** 0–1; drives the §16 thresholds. */
  confidence: z.number().min(0).max(1),
  /** One or two sentences the UI shows next to the plan. */
  rationale: z.string().default(''),
};

/** The only thing AI may produce (PRD §14). Validated locally before anything runs (§15). */
export const CapturePlanSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('capture'), feature: SlugSchema, capture: SlugSchema, output: z.literal('screenshot'), ...planCommon }),
  z.strictObject({ type: z.literal('workflow'), workflow: SlugSchema, output: z.enum(['screenshots', 'video', 'gif']), ...planCommon }),
]);
export type CapturePlan = z.infer<typeof CapturePlanSchema>;

export const CONFIDENCE_READY = 0.8;
export const CONFIDENCE_REVIEW = 0.5;
export type ConfidenceBand = 'ready' | 'review' | 'low';
export function confidenceBand(c: number): ConfidenceBand {
  return c >= CONFIDENCE_READY ? 'ready' : c >= CONFIDENCE_REVIEW ? 'review' : 'low';
}

/** Which provider/model produced a plan, and whether §11 fallback happened. Never contains keys. */
export const AIAttributionSchema = z.strictObject({
  provider: AIProviderIdSchema,
  model: z.string().min(1),
  fallbackOccurred: z.boolean().default(false),
  fallbackFrom: AIProviderIdSchema.optional(),
  repaired: z.boolean().default(false),
});
export type AIAttribution = z.infer<typeof AIAttributionSchema>;

export function workflowIdOfPlan(plan: CapturePlan): string {
  return plan.type === 'capture' ? plan.capture : plan.workflow;
}
