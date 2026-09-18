import { z } from 'zod';
import {
  ActionIdSchema, CursorModeSchema, FramingSchema, IdentifierSchema, OutputTypeSchema, RegionIdSchema, SlugSchema,
  ThemeSchema,
} from './common.js';
import { InlineCollectionSchema } from './fixture-inline.js';
import { ParametersSchema } from './parameters.js';

/** Bundled fixtures are copied to a temp workspace; parameter fixtures are user paths (PRD §44). */
export const FixtureSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('bundled'),
    path: z.string().regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/, 'must be a relative fixture path like runner/basic-workspace'),
  }),
  z.strictObject({ source: z.literal('parameter'), parameter: IdentifierSchema, copy: z.boolean().default(false) }),
  /** Phase 9: the collection is described in the workflow itself and written as Bruno YAML at run time. */
  z.strictObject({ source: z.literal('inline'), collection: InlineCollectionSchema }),
]);
export type Fixture = z.infer<typeof FixtureSchema>;

/** Where a capture or recording is framed. Region/locator framings need their target (PRD §47, §57). */
export const CaptureTargetSchema = z
  .strictObject({
    framing: FramingSchema.optional(),
    region: RegionIdSchema.optional(),
    locator: z.string().min(1).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.region && t.locator) ctx.addIssue({ code: 'custom', message: 'use either region or locator, not both' });
    if (t.framing === 'region' && !t.region) ctx.addIssue({ code: 'custom', path: ['region'], message: 'framing "region" requires a region' });
    if (t.framing === 'locator' && !t.locator) ctx.addIssue({ code: 'custom', path: ['locator'], message: 'framing "locator" requires a locator' });
  });

const textCondition = z
  .strictObject({
    region: RegionIdSchema.optional(),
    locator: z.string().min(1).optional(),
    equals: z.string().optional(),
    contains: z.string().optional(),
  })
  .refine((c) => (c.region ? 1 : 0) + (c.locator ? 1 : 0) === 1, 'text condition needs exactly one of region or locator')
  .refine((c) => (c.equals !== undefined) !== (c.contains !== undefined), 'text condition needs exactly one of equals or contains');

const target = z.strictObject({ region: RegionIdSchema.optional(), locator: z.string().min(1).optional() })
  .refine((c) => (c.region ? 1 : 0) + (c.locator ? 1 : 0) === 1, 'needs exactly one of region or locator');

/** Synchronisation, not presentation timing (PRD §40). Exactly one condition per step. */
export const WaitForSchema = z
  .strictObject({
    visible: target.optional(),
    hidden: target.optional(),
    attached: target.optional(),
    detached: target.optional(),
    text: textCondition.optional(),
    /** Semantic state id owned by an action module, e.g. `runner.complete`. */
    state: ActionIdSchema.optional(),
    timeoutMs: z.number().int().positive().max(180_000).default(15_000),
  })
  .refine(
    (w) => ['visible', 'hidden', 'attached', 'detached', 'text', 'state'].filter((k) => (w as Record<string, unknown>)[k] !== undefined).length === 1,
    'waitFor needs exactly one condition (visible, hidden, attached, detached, text, or state)',
  );
export type WaitFor = z.infer<typeof WaitForSchema>;

export const SelectorOperationSchema = z.enum(['click', 'fill', 'press', 'hover', 'selectOption']);

const stepCommon = {
  /** Human label shown in the run UI and logs; defaults are derived from the step kind. */
  label: z.string().min(1).optional(),
  /** PRD §43: record the error, keep going, finish as completed_with_errors. */
  continueOnError: z.boolean().default(false),
};

export const ActionStepSchema = z.strictObject({
  action: ActionIdSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  ...stepCommon,
});
export const CaptureStepSchema = z.strictObject({
  capture: z
    .strictObject({
      id: SlugSchema,
      name: z.string().min(1).optional(),
      framing: FramingSchema.optional(),
      region: RegionIdSchema.optional(),
      locator: z.string().min(1).optional(),
    })
    .pipe(CaptureTargetSchema.and(z.object({ id: SlugSchema, name: z.string().optional() }))),
  ...stepCommon,
});
export const WaitForStepSchema = z.strictObject({ waitFor: WaitForSchema, ...stepCommon });
export const PauseStepSchema = z.strictObject({
  pause: z.number().int().positive().max(60_000, 'pauses over 60 s are almost certainly a synchronisation problem — use waitFor'),
  ...stepCommon,
});
export const StartRecordingStepSchema = z.strictObject({
  startRecording: z.strictObject({ framing: FramingSchema.optional(), region: RegionIdSchema.optional(), locator: z.string().min(1).optional() })
    .pipe(CaptureTargetSchema),
  ...stepCommon,
});
export const StopRecordingStepSchema = z.strictObject({ stopRecording: z.strictObject({}), ...stepCommon });
export const SelectorActionStepSchema = z.strictObject({
  selectorAction: z
    .strictObject({
      operation: SelectorOperationSchema,
      locator: z.string().min(1),
      value: z.string().optional(),
    })
    .refine((s) => !['fill', 'press', 'selectOption'].includes(s.operation) || s.value !== undefined, {
      path: ['value'],
      message: 'fill, press and selectOption require a value',
    }),
  ...stepCommon,
});

export const STEP_KEYS = ['action', 'capture', 'waitFor', 'pause', 'startRecording', 'stopRecording', 'selectorAction'] as const;
export type StepKind = (typeof STEP_KEYS)[number];

const stepSchemas: Record<StepKind, z.ZodType> = {
  action: ActionStepSchema,
  capture: CaptureStepSchema,
  waitFor: WaitForStepSchema,
  pause: PauseStepSchema,
  startRecording: StartRecordingStepSchema,
  stopRecording: StopRecordingStepSchema,
  selectorAction: SelectorActionStepSchema,
};

export type Step =
  | z.infer<typeof ActionStepSchema>
  | z.infer<typeof CaptureStepSchema>
  | z.infer<typeof WaitForStepSchema>
  | z.infer<typeof PauseStepSchema>
  | z.infer<typeof StartRecordingStepSchema>
  | z.infer<typeof StopRecordingStepSchema>
  | z.infer<typeof SelectorActionStepSchema>;

export function stepKind(step: Step): StepKind {
  for (const k of STEP_KEYS) if (k in step) return k;
  /* c8 ignore next */
  throw new Error('unreachable: step without a kind');
}

/**
 * Steps are keyed by the single kind they contain, so a plain union would report "invalid union"
 * with seven branches of noise. Dispatch on the present key instead so errors land on the right
 * field (PRD §96 expects `steps[3].pause: Expected a positive number.`).
 */
export const StepSchema: z.ZodType<Step> = z.unknown().transform((raw, ctx): Step => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    ctx.addIssue({ code: 'custom', message: 'step must be a mapping' });
    return z.NEVER;
  }
  const present = STEP_KEYS.filter((k) => k in (raw as Record<string, unknown>));
  if (present.length !== 1) {
    ctx.addIssue({ code: 'custom', message: `step must contain exactly one of ${STEP_KEYS.join(', ')} (found: ${present.join(', ') || 'none'})` });
    return z.NEVER;
  }
  const kind = present[0]!;
  const result = stepSchemas[kind].safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: [...issue.path] } as never);
    return z.NEVER;
  }
  return result.data as Step;
});

export const WorkflowDefaultsSchema = z.strictObject({
  preset: SlugSchema.optional(),
  theme: ThemeSchema.optional(),
  framing: FramingSchema.optional(),
  cursor: CursorModeSchema.optional(),
});

/** One YAML file = one definition. `kind: capture` is the PRD's Capture Definition (§26). */
export const WorkflowDefinitionSchema = z
  .strictObject({
    version: z.literal(1),
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().default(''),
    kind: z.enum(['workflow', 'capture']).default('workflow'),
    feature: SlugSchema,
    tags: z.array(z.string().min(1)).default([]),
    supportedOutputs: z.array(OutputTypeSchema).min(1),
    parameters: ParametersSchema.default({}),
    fixture: FixtureSchema.optional(),
    defaults: WorkflowDefaultsSchema.prefault({}),
    /** Default target for whole-workflow recordings when no startRecording step exists (PRD §50). */
    recording: CaptureTargetSchema.optional(),
    steps: z.array(StepSchema).min(1),
  })
  .superRefine((wf, ctx) => {
    const captures = wf.steps.filter((s) => 'capture' in s);
    const ids = captures.map((s) => (s as z.infer<typeof CaptureStepSchema>).capture.id);
    for (const [i, id] of ids.entries()) {
      if (ids.indexOf(id) !== i) ctx.addIssue({ code: 'custom', path: ['steps'], message: `duplicate capture id "${id}"` });
    }
    if (wf.kind === 'capture') {
      if (wf.supportedOutputs.length !== 1 || wf.supportedOutputs[0] !== 'screenshot')
        ctx.addIssue({ code: 'custom', path: ['supportedOutputs'], message: 'a capture definition supports exactly ["screenshot"]' });
      if (captures.length !== 1) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'a capture definition has exactly one capture step' });
    } else if (wf.supportedOutputs.includes('screenshot')) {
      ctx.addIssue({ code: 'custom', path: ['supportedOutputs'], message: 'use "screenshots" for workflows; "screenshot" is for kind: capture' });
    }
    if (wf.supportedOutputs.includes('screenshots') && captures.length === 0)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'supportedOutputs includes screenshots but there are no capture steps' });
    const starts = wf.steps.map((s, i) => ('startRecording' in s ? i : -1)).filter((i) => i >= 0);
    const stops = wf.steps.map((s, i) => ('stopRecording' in s ? i : -1)).filter((i) => i >= 0);
    if (starts.length > 1 || stops.length > 1)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'at most one startRecording and one stopRecording step (MVP records one bounded section)' });
    if (starts.length !== stops.length)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'startRecording and stopRecording must appear together' });
    if (starts.length === 1 && stops.length === 1 && starts[0]! > stops[0]!)
      ctx.addIssue({ code: 'custom', path: ['steps', stops[0]!], message: 'stopRecording appears before startRecording' });
    for (const [i, s] of wf.steps.entries()) {
      if ('action' in s) continue;
      if ('selectorAction' in s) continue;
      if ('waitFor' in s && s.waitFor.state && !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+/.test(s.waitFor.state))
        ctx.addIssue({ code: 'custom', path: ['steps', i, 'waitFor', 'state'], message: 'semantic state must be namespaced, e.g. runner.complete' });
    }
  });

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;

/** Count of §38 escape-hatch steps (raw selectors, incl. `ui.*` primitives addressed by CSS) — reported as technical debt (D11). */
export function selectorDebt(wf: WorkflowDefinition): number {
  return wf.steps.filter((s) => 'selectorAction' in s || ('action' in s && s.action.startsWith('ui.') && typeof (s.params as Record<string, unknown>)['css'] === 'string')).length;
}
