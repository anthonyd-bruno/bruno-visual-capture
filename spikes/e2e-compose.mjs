// Phase 9 end-to-end with a scripted provider: compose → validate → save as generated → run against
// the real Bruno with a deliberately broken step → self-heal → learned write-back. No API key needed.
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const scratch = process.env.SCRATCH; const home = path.join(scratch, 'home-compose');
fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ schemaVersion: 1, capture: { profileMode: 'capture', previewEnabled: false }, ai: { compose: true, selfHeal: true, maxHeals: 3 } }, null, 2));
process.env.BRU_CAPTURE_HOME = home;
const { createContext } = await import('../apps/server/src/index.ts');
const { CapturePlanner, rawStep: S } = await import('../packages/ai/src/index.ts');
const ctx = await createContext({ log: (m) => console.log('  ·', m) });

const plan = {
  mode: 'compose', reuse: null, output: process.argv[2] === 'gif' ? 'gif' : 'screenshots', preset: process.argv[2] === 'gif' ? 'docs-gif' : 'docs-screenshot', confidence: 0.88, rationale: 'Bearer auth on an inline request, then send it.',
  compose: {
    name: 'Add a bearer token to a request', description: 'Opens a request, switches auth to Bearer Token, sends it and shows the response.', feature: 'request-execution', tags: ['auth', 'bearer'],
    fixtureKind: 'inline', bundledFixturePath: null,
    inlineCollectionJson: JSON.stringify({ name: 'Auth Demo', description: 'Composed for the bearer-token walkthrough',
      environments: [{ name: 'Demo', variables: [{ name: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' }] }],
      requests: [{ name: 'Get profile', method: 'GET', url: '{{baseUrl}}/users/1', headers: [{ name: 'Accept', value: 'application/json' }] }] }),
    steps: [
      S({ kind: 'action', action: 'workspace.open' }),
      S({ kind: 'action', action: 'collection.open', params: [{ name: 'name', value: 'Auth Demo' }] }),
      S({ kind: 'action', action: 'request.open', params: [{ name: 'name', value: 'Get profile' }] }),
      S({ kind: 'action', action: 'request.setAuth', params: [{ name: 'mode', value: 'bearer' }, { name: 'token', value: 'eyJhbGciOiJIUzI1NiJ9.demo-token' }], label: 'Switch to Bearer Token' }),
      S({ kind: 'pause', ms: 500 }),
      S({ kind: 'capture', id: 'auth-bearer-configured', name: 'Bearer token configured' }),
      // Deliberately wrong: there is no such test id. The self-healer must recover.
      S({ kind: 'action', action: 'ui.click', params: [{ name: 'testId', value: 'send-request-button' }], label: 'Send (wrong id on purpose)' }),
      S({ kind: 'waitForState', state: 'response.received', ms: 20000 }),
      S({ kind: 'pause', ms: 600 }),
      S({ kind: 'capture', id: 'response-with-auth', name: 'Response received' }),
    ],
  },
};
const provider = { id: 'anthropic', model: 'scripted', async planCapture() { throw new Error('n/a'); }, async composeWorkflow() { return plan; },
  // Heal script: the wrong click → use request.send instead and drop nothing.
  async healStep(req) { console.log('  ★ healer saw', req.heal.observation.elements.length, 'elements, modalOpen', req.heal.observation.modalOpen, '| failed:', JSON.stringify(req.heal.failed).slice(0, 120)); return { giveUp: false, reason: 'There is no send button test id in this build; Bruno sends with ⌘↩ via request.send.', replacement: [S({ kind: 'action', action: 'request.send' })], dropFollowing: 0 }; },
  async testConnection() { return { ok: true, provider: 'anthropic', model: 'scripted', message: 'ok' }; } };

const planner = new CapturePlanner({ preferred: 'anthropic', fallbackEnabled: false, providers: { anthropic: provider }, log: (m) => console.log('  ·', m) });
const outcome = await planner.compose('Show how to add a bearer token to a request and send it', await ctx.composeCatalog(), 'auto');
if (!outcome.ok) { console.error('compose failed', outcome.error); process.exit(1); }
const r = outcome.result; console.log(`composed: ${r.definition.name} · ${r.definition.steps.length} steps · fixture ${r.definition.fixture?.source} · band ${r.band} · primitives ${r.primitives} debt ${r.debt}`);
const saved = await ctx.generated.save(r.input, { prompt: 'Show how to add a bearer token to a request and send it', provider: 'anthropic', model: 'scripted' });
await ctx.registry.refresh();
console.log('saved', saved.id, '→', saved.file, '| registered as', ctx.registry.get(saved.id)?.source);

// Inject the scripted healer (the real one needs an API key).
const { AIHealer } = await import('../packages/ai/src/index.ts');
ctx.engine.deps.healer = async () => new AIHealer({ providers: { anthropic: provider }, preferred: 'anthropic', fallbackEnabled: false, catalog: await ctx.composeCatalog(), log: (m) => console.log('  ·', m) });

const t0 = Date.now();
const manifest = await ctx.engine.create({ workflowId: saved.id, output: r.output, preset: r.preset.id, parameters: {}, overrides: {}, cancelActive: false, allowRelaunch: false, request: { prompt: 'Show how to add a bearer token to a request and send it', plan: { ...r.plan, workflow: saved.id }, ai: outcome.attribution } });
for await (const e of ctx.engine.events(manifest.runId)) {
  if (e.type === 'preview.frame' || e.type === 'run.log') continue;
  const t = String(Date.now() - t0).padStart(6) + 'ms';
  if (e.type === 'workflow.step.started') console.log(`${t} ▶ ${e.step.index + 1}/${e.total} ${e.step.label}`);
  else if (e.type === 'workflow.step.completed') console.log(`${t} ✔ ${e.step.label}`);
  else if (e.type === 'workflow.step.failed') console.log(`${t} ✖ ${e.step.label}: ${e.error.message}`);
  else if (e.type === 'workflow.healing') console.log(`${t} ⟳ healing ${e.step.label} (${e.attempt}/${e.max}): ${e.error.message}`);
  else if (e.type === 'workflow.healed') console.log(`${t} ✚ healed → [${e.replacement.map((s) => s.label).join(', ')}] dropped ${e.dropped}, total ${e.total} — ${e.rationale}`);
  else if (e.type === 'workflow.heal.failed') console.log(`${t} ✖ heal failed: ${e.message}`);
  else if (e.type === 'artifact.created') console.log(`${t} ⬇ ${e.artifact.relativePath} ${e.artifact.width}×${e.artifact.height}${e.artifact.durationMs ? ` ${(e.artifact.durationMs / 1000).toFixed(1)}s` : ''}`);
  else if (e.type === 'run.failed') console.log(`${t} FAILED ${e.error.message} ${e.error.hint ?? ''}`);
  else if (e.type === 'run.completed') console.log(`${t} ${e.status.toUpperCase()}`);
}
const final = ctx.engine.get(manifest.runId).manifest;
console.log('status', final.status, '| healing', JSON.stringify(final.healing), '| artifacts', final.artifacts.map((a) => a.relativePath).join(', '));
console.log('run dir', ctx.engine.get(manifest.runId).artifacts.runDir);
const learned = fs.readFileSync(saved.file, 'utf8');
console.log('learned file mentions request.send:', learned.includes('request.send'), '| still has wrong click:', learned.includes('send-request-button'));
console.log(learned.split('\n').filter((l) => l.startsWith('#')).join('\n'));
await ctx.shutdown();
process.exit(final.status === 'completed' ? 0 : 1);
