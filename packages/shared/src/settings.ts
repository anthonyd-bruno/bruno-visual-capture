import { z } from 'zod';
import { AIProviderIdSchema, IsoDateTimeSchema, SlugSchema } from './common.js';

export const SETTINGS_SCHEMA_VERSION = 1;

/** `settings.json` (PRD §82, §98). Secrets are never here — they live in Keychain (§12). */
export const SettingsSchema = z.strictObject({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION).default(SETTINGS_SCHEMA_VERSION),
  bruno: z.strictObject({
    /** null → auto-detect at startup (PRD §21). */
    executablePath: z.string().nullable().default(null),
  }).prefault({}),
  capture: z.strictObject({
    defaultPreset: SlugSchema.default('docs-screenshot'),
    /** null → `~/Library/Application Support/Bruno Capture/artifacts`. */
    artifactRoot: z.string().nullable().default(null),
    previewEnabled: z.boolean().default(true),
    previewFps: z.number().min(0.5).max(2).default(1.5),
    /** D4: `capture` launches Bruno with a dedicated, seeded --user-data-dir. */
    profileMode: z.enum(['user', 'capture']).default('user'),
    /** Keep screencast frames / intermediate recordings after a successful run. */
    keepIntermediates: z.boolean().default(false),
  }).prefault({}),
  ai: z.strictObject({
    preferredProvider: AIProviderIdSchema.default('anthropic'),
    fallbackEnabled: z.boolean().default(true),
    openai: z.strictObject({ model: z.string().default('') }).prefault({}),
    anthropic: z.strictObject({ model: z.string().default('claude-opus-5') }).prefault({}),
  }).prefault({}),
  workflows: z.strictObject({
    watch: z.boolean().default(true),
  }).prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsInput = z.input<typeof SettingsSchema>;

/** `workflow-sources.json` (PRD §27, §28, §98). Imported files stay in place; only the path is stored. */
export const WorkflowSourcesSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  customDirectories: z.array(z.string().min(1)).default([]),
  importedFiles: z.array(z.strictObject({
    id: z.string().min(1),
    path: z.string().min(1),
    addedAt: IsoDateTimeSchema,
  })).default([]),
});
export type WorkflowSources = z.infer<typeof WorkflowSourcesSchema>;

/** PUT /api/settings accepts a partial, deep-merged on the server. */
export const SettingsPatchSchema = z.strictObject({
  bruno: SettingsSchema.shape.bruno.unwrap().partial().optional(),
  capture: SettingsSchema.shape.capture.unwrap().partial().optional(),
  ai: z.strictObject({
    preferredProvider: AIProviderIdSchema.optional(),
    fallbackEnabled: z.boolean().optional(),
    openai: z.strictObject({ model: z.string() }).partial().optional(),
    anthropic: z.strictObject({ model: z.string() }).partial().optional(),
  }).optional(),
  workflows: SettingsSchema.shape.workflows.unwrap().partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
