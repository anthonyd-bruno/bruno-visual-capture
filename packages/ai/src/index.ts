export * from './types.js';
export * from './schema.js';
export * from './prompt.js';
export * from './validate.js';
export * from './keychain.js';
export * from './planner.js';
export * from './compose/schema.js';
export * from './compose/catalog.js';
export * from './compose/prompt.js';
export * from './compose/validate.js';
export * from './compose/heal.js';
export * from './compose/refine.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';

import type { AIProviderId, Settings } from '@bruno-capture/shared';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { Keychain, resolveApiKey } from './keychain.js';
import type { AIProvider } from './types.js';

/** Build the configured providers from settings + resolved keys (never returns the keys). */
export async function buildProviders(settings: Settings, keychain = new Keychain()): Promise<{ providers: Partial<Record<AIProviderId, AIProvider>>; keySources: Partial<Record<AIProviderId, 'env' | 'keychain'>> }> {
  const providers: Partial<Record<AIProviderId, AIProvider>> = {};
  const keySources: Partial<Record<AIProviderId, 'env' | 'keychain'>> = {};
  const a = await resolveApiKey('anthropic', keychain);
  if (a.key && settings.ai.anthropic.model) { providers.anthropic = new AnthropicProvider(a.key, settings.ai.anthropic.model); keySources.anthropic = a.source; }
  const o = await resolveApiKey('openai', keychain);
  if (o.key && settings.ai.openai.model) { providers.openai = new OpenAIProvider(o.key, settings.ai.openai.model); keySources.openai = o.source; }
  return { providers, keySources };
}
