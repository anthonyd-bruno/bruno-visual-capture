import { SettingsPatchSchema } from '@bruno-capture/shared';
import type { FastifyInstance } from 'fastify';
import type { ServerContext } from '../context.js';
import { validationError } from '../errors.js';

/** PRD §84: settings are plain; secrets have their own handling and are never returned. */
export function registerSettingsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const view = async () => {
    const k = await ctx.aiKeyPresence();
    return { settings: ctx.settings.get(), secrets: { openai: { keyPresent: k.openai, source: k.sources.openai }, anthropic: { keyPresent: k.anthropic, source: k.sources.anthropic } }, paths: { root: ctx.paths.root, artifactRoot: ctx.settings.artifactRoot() } };
  };
  app.get('/api/settings', async () => view());
  app.put('/api/settings', async (req) => {
    const parsed = SettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) throw validationError('settings', parsed.error.issues);
    await ctx.settings.patch(parsed.data);
    return view();
  });
}
