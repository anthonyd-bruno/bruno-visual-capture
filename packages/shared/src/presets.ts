import { z } from 'zod';
import { CursorModeSchema, FramingSchema, OutputTypeSchema, SlugSchema, ThemeSchema } from './common.js';

/** Built-in and user presets (PRD §54–§56). Dimensions are CSS pixels of the app content area. */
export const CapturePresetSchema = z.strictObject({
  id: SlugSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  /** Which output types this preset is meant for; used to pick a default per output. */
  outputs: z.array(OutputTypeSchema).min(1),
  width: z.number().int().min(320).max(7680),
  /** Omitted for GIF presets: height is derived from the capture aspect ratio (PRD §54). */
  height: z.number().int().min(200).max(4320).optional(),
  theme: ThemeSchema,
  framing: FramingSchema,
  cursor: CursorModeSchema,
  /** Recording presets only. Final MP4 is always normalised to 30 (PRD §52); GIFs use their own. */
  fps: z.number().int().min(5).max(60).optional(),
  /** PNG pixel scale: `css` = exactly width×height px; `device` = multiplied by the display scale. */
  scale: z.enum(['css', 'device']).default('css'),
});
export type CapturePreset = z.infer<typeof CapturePresetSchema>;

export const BUILT_IN_PRESETS: readonly CapturePreset[] = [
  { id: 'docs-screenshot', name: 'Docs Screenshot', description: '1600 × 1000, light, app content, no cursor, PNG', outputs: ['screenshot', 'screenshots'], width: 1600, height: 1000, theme: 'light', framing: 'app-content', cursor: 'hidden', scale: 'css' },
  { id: 'docs-wide', name: 'Docs Wide', description: '1920 × 1080, light, app content, no cursor, PNG', outputs: ['screenshot', 'screenshots'], width: 1920, height: 1080, theme: 'light', framing: 'app-content', cursor: 'hidden', scale: 'css' },
  { id: 'demo-video', name: 'Demo Video', description: '1920 × 1080, dark, app content, smooth cursor, 30 fps MP4', outputs: ['video'], width: 1920, height: 1080, theme: 'dark', framing: 'app-content', cursor: 'smooth', fps: 30, scale: 'css' },
  { id: 'docs-gif', name: 'Docs GIF', description: '1000 px wide, light, app content, no cursor, 15 fps GIF', outputs: ['gif'], width: 1000, theme: 'light', framing: 'app-content', cursor: 'hidden', fps: 15, scale: 'css' },
];

export const DEFAULT_PRESET_FOR_OUTPUT: Readonly<Record<z.infer<typeof OutputTypeSchema>, string>> = {
  screenshot: 'docs-screenshot',
  screenshots: 'docs-screenshot',
  video: 'demo-video',
  gif: 'docs-gif',
};
