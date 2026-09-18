import { register } from 'tsx/esm/api'; register();
const { buildProviders } = await import('../packages/ai/src/index.ts');
const { SettingsStore, appPaths } = await import('../packages/core/src/index.ts');
const settings = new SettingsStore(appPaths()); await settings.load();
const { providers, keySources } = await buildProviders(settings.get());
console.log('configured:', Object.keys(providers).join(', ') || 'none', '| key sources:', JSON.stringify(keySources));
for (const p of Object.values(providers)) { const r = await p.testConnection(); console.log(`${p.id} (${p.model}): ${r.ok ? 'OK' : 'FAIL'} — ${r.message} ${r.latencyMs ?? ''}ms`); }
