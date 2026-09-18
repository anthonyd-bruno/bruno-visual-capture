// Does Anthropic accept our structured-output grammars? Tiny calls (max_tokens 24) — the grammar is compiled before generation.
import { register } from 'tsx/esm/api'; register();
const Anthropic = (await import('../packages/ai/node_modules/@anthropic-ai/sdk/index.mjs')).default;
const { zodOutputFormat } = await import('../packages/ai/node_modules/@anthropic-ai/sdk/helpers/zod.mjs');
const { RawPlanSchema, RawComposedPlanSchema, RawHealSchema, resolveApiKey } = await import('../packages/ai/src/index.ts');
const { key } = await resolveApiKey('anthropic');
const client = new Anthropic({ apiKey: key, maxRetries: 0 });
for (const [name, schema] of [['RawPlanSchema', RawPlanSchema], ['RawComposedPlanSchema', RawComposedPlanSchema], ['RawHealSchema', RawHealSchema]]) {
  const size = JSON.stringify(zodOutputFormat(schema).schema).length;
  try {
    const r = await client.messages.parse({ model: 'claude-opus-5', max_tokens: 24, messages: [{ role: 'user', content: 'Return any valid object.' }], output_config: { format: zodOutputFormat(schema), effort: 'low' } });
    console.log(`${name}: grammar OK (schema ${size} chars, stop ${r.stop_reason})`);
  } catch (e) { console.log(`${name}: ${String(e.message).split('\n')[0].slice(0, 200)} (schema ${size} chars)`); }
}
