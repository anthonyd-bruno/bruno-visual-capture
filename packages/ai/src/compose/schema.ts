import { z } from 'zod';

/**
 * Phase 9 AI-facing composition schema. Kept deliberately SMALL: Anthropic compiles structured
 * output schemas into a grammar and rejects large ones ("compiled grammar is too large" — measured
 * live with an 8-variant step union). So: one flat step object with nullable fields instead of a
 * union, the inline collection as a JSON string (validated locally against InlineCollectionSchema),
 * every field required (nullable for optional), no records, no numeric/string constraints, and
 * param values always strings (coerced locally from the action's declared schema).
 */
const NullableString = z.string().nullable();
const NullableNumber = z.number().nullable();

export const RawParamSchema = z.object({
  name: z.string().describe('parameter name from the action\'s params schema'),
  value: z.string().describe('always a string; numbers, booleans and JSON objects/arrays are written as text'),
});

export const StepKindSchema = z.enum(['action', 'capture', 'waitForState', 'waitForText', 'waitForRegion', 'pause', 'startRecording', 'stopRecording']);

/** One flat step. Which fields matter depends on `kind`; unused fields are null / empty. */
export const RawStepSchema = z.object({
  kind: StepKindSchema,
  action: NullableString.describe('kind action: an ACTIONS id'),
  params: z.array(RawParamSchema).describe('kind action: its parameters (empty array otherwise)'),
  label: NullableString.describe('kind action: short human label, or null'),
  id: NullableString.describe('kind capture: kebab-case id unique in the workflow (becomes the PNG name)'),
  name: NullableString.describe('kind capture: what the screenshot shows'),
  region: NullableString.describe('capture/waitForRegion/waitForText: a REGIONS id (null = whole app / preset framing)'),
  state: NullableString.describe('kind waitForState: a STATES id; kind waitForRegion: "visible" or "hidden"'),
  text: NullableString.describe('kind waitForText: substring that must appear'),
  ms: NullableNumber.describe('kind pause: presentation pause 200–3000 ms; wait kinds: timeout in ms (null = default)'),
});
export type RawStep = z.infer<typeof RawStepSchema>;

export const RawComposeSchema = z.object({
  name: z.string().describe('short workflow title, e.g. "Add a bearer token to a request"'),
  description: z.string(),
  feature: z.string().describe('kebab-case feature area, e.g. request-execution, environments, collections, runner, openapi-sync, mock-server, settings'),
  tags: z.array(z.string()),
  fixtureKind: z.enum(['bundled', 'inline', 'none']).describe('bundled = one of FIXTURES; inline = a collection described in inlineCollectionJson; none = empty workspace'),
  bundledFixturePath: NullableString.describe('FIXTURES path when fixtureKind is bundled'),
  inlineCollectionJson: NullableString.describe('fixtureKind inline: JSON text of {name, description?, requests:[{name, method?, url, headers?:[{name,value}], params?:[{name,value}], body?:{type:"json"|"text", data}, auth?:{type:"inherit"|"none"} | {type:"bearer", token} | {type:"basic", username, password} | {type:"apikey", key, value, placement?:"header"|"queryparams"}, docs?}], environments?:[{name, variables:[{name,value}]}], files?:[{path, content}]}'),
  steps: z.array(RawStepSchema),
});

export const RawReuseSchema = z.object({
  workflowId: z.string().describe('a registered workflow id'),
  parameters: z.array(RawParamSchema).describe('only parameters that workflow declares'),
});

export const RawComposedPlanSchema = z.object({
  mode: z.enum(['reuse', 'compose']).describe('reuse a registered workflow that already does exactly this, or compose new steps'),
  reuse: RawReuseSchema.nullable().describe('required when mode is reuse'),
  compose: RawComposeSchema.nullable().describe('required when mode is compose'),
  output: z.enum(['screenshot', 'screenshots', 'video', 'gif']),
  preset: z.string().describe('a PRESETS id whose outputs include the output'),
  confidence: z.number().describe('0–1: how likely these exact steps succeed on the first run'),
  rationale: z.string().describe('one or two plain sentences for the user'),
});
export type RawComposedPlan = z.infer<typeof RawComposedPlanSchema>;

export const RawHealSchema = z.object({
  giveUp: z.boolean().describe('true when the goal cannot be reached from the observed state'),
  reason: z.string().describe('what went wrong and what you changed, one or two sentences'),
  replacement: z.array(RawStepSchema).describe('steps to run instead of the failed step (may be empty to skip it)'),
  dropFollowing: z.number().describe('how many of the following planned steps to drop (0 keeps them all)'),
});
export type RawHeal = z.infer<typeof RawHealSchema>;

/** Convenience for tests and scripted providers: build a flat step from the natural shape. */
export function rawStep(s: Partial<RawStep> & { kind: RawStep['kind'] }): RawStep {
  return { kind: s.kind, action: s.action ?? null, params: s.params ?? [], label: s.label ?? null, id: s.id ?? null, name: s.name ?? null, region: s.region ?? null, state: s.state ?? null, text: s.text ?? null, ms: s.ms ?? null };
}
