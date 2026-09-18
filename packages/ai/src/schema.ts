import { z } from 'zod';

/**
 * AI-facing plan shape: flat, every field required, no records — the subset both OpenAI strict
 * JSON schema and Anthropic structured output accept. Mapped to the canonical CapturePlan afterwards.
 */
export const RawPlanSchema = z.object({
  type: z.enum(['capture', 'workflow']).describe('capture = a single screenshot definition; workflow = a multi-step workflow'),
  workflowId: z.string().describe('exactly one id from the provided workflow list'),
  output: z.enum(['screenshot', 'screenshots', 'video', 'gif']).describe('must be one of the chosen workflow\'s supportedOutputs'),
  preset: z.string().describe('exactly one preset id from the provided preset list, suitable for the output'),
  parameters: z.array(z.object({ name: z.string(), value: z.string() })).describe('only parameters the chosen workflow declares; omit to use defaults'),
  confidence: z.number().min(0).max(1).describe('0–1: how sure you are this workflow matches the request'),
  rationale: z.string().describe('one or two plain sentences for the user'),
});
export type RawPlanInput = z.infer<typeof RawPlanSchema>;
