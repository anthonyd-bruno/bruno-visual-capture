import { z } from 'zod';

/** Output artifact kinds a workflow can produce (PRD §7.2, §26). */
export const OutputTypeSchema = z.enum(['screenshot', 'screenshots', 'video', 'gif']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

/** Capture framing (PRD §47). */
export const FramingSchema = z.enum(['app-content', 'full-window', 'region', 'locator']);
export type Framing = z.infer<typeof FramingSchema>;

export const ThemeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

export const CursorModeSchema = z.enum(['hidden', 'visible', 'smooth']);
export type CursorMode = z.infer<typeof CursorModeSchema>;

export const AIProviderIdSchema = z.enum(['openai', 'anthropic']);
export type AIProviderId = z.infer<typeof AIProviderIdSchema>;

export const WorkflowSourceKindSchema = z.enum(['built-in', 'custom-directory', 'imported']);
export type WorkflowSourceKind = z.infer<typeof WorkflowSourceKindSchema>;

/** `runner-collection-run`, `docs-screenshot`, … */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug (a-z, 0-9, single hyphens)');

/** Named semantic region such as `runner.panel` or `response.body` (PRD §47). */
export const RegionIdSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'must be a dotted region id such as runner.panel');

/** Semantic action id such as `runner.open` (PRD §36). */
export const ActionIdSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'must be a dotted action id such as runner.open');

/** Identifier used for workflow parameters and other object keys. */
export const IdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'must be an identifier (letters, digits, underscore; not starting with a digit)');

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** A step target: a named semantic region or a raw Playwright locator. Exactly one. */
export const TargetRefSchema = z.union([
  z.strictObject({ region: RegionIdSchema }),
  z.strictObject({ locator: z.string().min(1) }),
]);
export type TargetRef = z.infer<typeof TargetRefSchema>;
