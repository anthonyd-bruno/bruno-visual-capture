import { parseArgs } from 'node:util';
import { appPaths, checkSystemStatus, RunConflictError, RunValidationError, SettingsStore } from '@bruno-capture/core';
import { createContext, startServer } from '@bruno-capture/server';
import { CaptureHelper } from '@bruno-capture/automation';
import type { ComponentStatus, OutputType, RunEvent } from '@bruno-capture/shared';

const USAGE = `bru-capture — visual capture automation for the Bruno desktop app

Usage:
  bru-capture                      start the local backend and open the UI
  bru-capture doctor               show system/dependency status
  bru-capture workflows list       list registered workflows
  bru-capture workflows validate   validate every registered workflow (exit 1 if any is invalid)
  bru-capture workflow add <yaml>  import a workflow file (kept in place)
  bru-capture helper request       ask macOS for Screen Recording permission (shows the system prompt)
  bru-capture run <workflowId> --output <screenshots|video|gif> [--preset <id>] [--param k=v ...]
                                   [--relaunch] run a workflow and stream progress
  bru-capture compose "<prompt>" [--output <auto|screenshots|video|gif>] [--save] [--run]
                                   ask the AI planner to reuse or compose a workflow for the prompt;
                                   --save writes it to the generated workflows directory, --run also runs it
  bru-capture refine <runId> "<feedback>" [--run]
                                   adjust that run's workflow/settings from feedback (e.g. "don't obscure the
                                   token entered"); prints the step diff; --run saves it and regenerates

Options:
  --port <n>      fixed port for the backend (default: free port)
  --no-open       do not open the browser
  --json          machine-readable output where supported
  --relaunch      allow quitting a running Bruno to relaunch it under automation (user-profile mode)
`;

const STATE_ICON: Record<ComponentStatus['state'], string> = {
  ready: '✔', 'not-configured': '○', 'action-required': '!', unavailable: '✖', error: '✖',
};

async function doctor(json: boolean): Promise<number> {
  const paths = appPaths();
  const settings = new SettingsStore(paths);
  await settings.load();
  const { resolveApiKey } = await import('@bruno-capture/ai');
  const [ok, ak] = await Promise.all([resolveApiKey('openai'), resolveApiKey('anthropic')]);
  const status = await checkSystemStatus({
    settings: settings.get(), paths,
    aiKeys: { openai: Boolean(ok.key), anthropic: Boolean(ak.key) },
    screenRecording: async () => { const h = await CaptureHelper.locate(paths.binDir); if (!h) return 'helper-missing'; return (await h.preflight().catch(() => false)) ? 'granted' : 'denied'; },
  });
  if (json) { console.log(JSON.stringify(status, null, 2)); return 0; }
  console.log(`Bruno Capture doctor — ${status.checkedAt}\n`);
  for (const c of status.components) {
    console.log(`${STATE_ICON[c.state]} ${c.label.padEnd(20)} ${c.state.padEnd(16)} ${c.detail ?? ''}`);
    if (c.remediation && c.state !== 'ready') console.log(`  ↳ ${c.remediation}`);
  }
  console.log('\nCapabilities:', Object.entries(status.capabilities).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join('  '));
  return 0;
}

async function start(port: number | undefined, open: boolean): Promise<number> {
  const server = await startServer({ port, openBrowser: open, logger: false, log: (m) => console.log('  ·', m) });
  console.log(`Bruno Capture running at ${server.url}  (Ctrl+C to stop)`);
  await new Promise<void>((resolve) => {
    const stop = () => { void server.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function workflows(sub: string | undefined, json: boolean): Promise<number> {
  const ctx = await createContext();
  try {
    const list = ctx.registry.list();
    if (sub === 'validate') {
      let invalid = 0;
      for (const lw of list) {
        if (lw.definition) { console.log(`✔ ${lw.definition.id.padEnd(32)} ${lw.file}`); continue; }
        invalid++;
        console.log(`✖ ${(lw.id ?? '(no id)').padEnd(32)} ${lw.file}`);
        for (const i of lw.issues) console.log(`    ${i.path ? i.path + ': ' : ''}${i.message}`);
      }
      console.log(`\n${list.length - invalid} valid, ${invalid} invalid`);
      return invalid ? 1 : 0;
    }
    if (json) { console.log(JSON.stringify(ctx.registry.summaries(), null, 2)); return 0; }
    for (const lw of list) {
      const d = lw.definition;
      console.log(d
        ? `${d.id.padEnd(32)} ${d.feature.padEnd(14)} ${d.supportedOutputs.join(',').padEnd(24)} ${lw.source.padEnd(16)} ${d.name}`
        : `${(lw.id ?? '(invalid)').padEnd(32)} ${''.padEnd(14)} ${''.padEnd(24)} ${lw.source.padEnd(16)} INVALID: ${lw.issues[0]?.message ?? ''}`);
    }
    return 0;
  } finally { await ctx.shutdown(); }
}

async function workflowAdd(file: string | undefined): Promise<number> {
  if (!file) { console.error('usage: bru-capture workflow add <path/to/workflow.yaml>'); return 2; }
  const ctx = await createContext();
  try {
    const { randomUUID } = await import('node:crypto');
    const path = (await import('node:path')).resolve(file);
    const id = randomUUID();
    await ctx.sources.addImportedFile(id, path);
    await ctx.registry.refresh();
    const lw = ctx.registry.list().find((l) => l.importId === id);
    if (lw?.definition) { console.log(`✔ imported ${lw.definition.id} from ${path}`); return 0; }
    console.log(`✖ imported ${path} but it is invalid:`);
    for (const i of lw?.issues ?? []) console.log(`    ${i.path ? i.path + ': ' : ''}${i.message}`);
    return 1;
  } finally { await ctx.shutdown(); }
}

function formatEvent(e: RunEvent, t0: number): string | undefined {
  const t = String(Date.now() - t0).padStart(6) + 'ms';
  switch (e.type) {
    case 'run.status': return `${t}  ${e.status}`;
    case 'workflow.step.started': return `${t}  ▶ ${e.step.index + 1}/${e.total} ${e.step.label}`;
    case 'workflow.step.completed': return `${t}  ✔ ${e.step.label}${e.retries ? ' (retried)' : ''}`;
    case 'workflow.step.failed': return `${t}  ✖ ${e.step.label}: ${e.error.message}${e.error.hint ? `\n          ↳ ${e.error.hint}` : ''}${e.continued ? ' (continuing)' : ''}`;
    case 'artifact.created': return `${t}  ⬇ ${e.artifact.relativePath} (${e.artifact.width ?? '?'}×${e.artifact.height ?? '?'})`;
    case 'run.failed': return `${t}  FAILED: ${e.error.message}${e.error.hint ? `\n          ↳ ${e.error.hint}` : ''}`;
    case 'run.cancelled': return `${t}  CANCELLED`;
    case 'run.completed': return `${t}  ${e.status.toUpperCase()}`;
    default: return undefined;
  }
}

async function run(workflowId: string | undefined, v: { output?: string; preset?: string; param?: string[]; relaunch?: boolean; json?: boolean }): Promise<number> {
  if (!workflowId) { console.error('usage: bru-capture run <workflowId> --output <screenshots|video|gif>'); return 2; }
  if (!v.output) { console.error('--output is required'); return 2; }
  const parameters: Record<string, string> = {};
  for (const kv of v.param ?? []) { const i = kv.indexOf('='); if (i < 1) { console.error(`bad --param "${kv}" (want k=v)`); return 2; } parameters[kv.slice(0, i)] = kv.slice(i + 1); }
  const ctx = await createContext({ log: (m) => { if (!v.json) console.log('  ·', m); } });
  try {
    const t0 = Date.now();
    const manifest = await ctx.engine.create({ workflowId, output: v.output as OutputType, preset: v.preset, parameters, overrides: {}, cancelActive: false, allowRelaunch: Boolean(v.relaunch) });
    if (!v.json) console.log(`run ${manifest.runId}  ${manifest.workflow.name} → ${manifest.capture.output} (${manifest.capture.preset})`);
    const onSigint = () => { void ctx.engine.cancel(manifest.runId); };
    process.once('SIGINT', onSigint);
    for await (const e of ctx.engine.events(manifest.runId)!) {
      if (v.json) { if (e.type !== 'preview.frame') console.log(JSON.stringify(e)); continue; }
      const line = formatEvent(e, t0);
      if (line) console.log(line);
    }
    process.off('SIGINT', onSigint);
    const final = ctx.engine.get(manifest.runId)!.manifest;
    if (!v.json) console.log(`\n${final.status}  ${final.artifacts.length} artifact(s) in ${ctx.engine.get(manifest.runId)!.artifacts.runDir}`);
    return final.status === 'completed' ? 0 : final.status === 'completed_with_errors' ? 3 : 1;
  } catch (e) {
    if (e instanceof RunValidationError) { console.error(`invalid run: ${e.message}`); for (const d of e.details ?? []) console.error(`  ${d.path}: ${d.message}`); return 2; }
    if (e instanceof RunConflictError) { console.error('a capture is already running'); return 2; }
    throw e;
  } finally { await ctx.shutdown(); }
}

async function compose(prompt: string | undefined, v: { output?: string; save?: boolean; run?: boolean; preset?: string; json?: boolean; relaunch?: boolean }): Promise<number> {
  if (!prompt) { console.error('usage: bru-capture compose "<prompt>" [--output auto|screenshots|video|gif] [--save] [--run]'); return 2; }
  const ctx = await createContext({ log: (m) => { if (!v.json) console.log('  ·', m); } });
  try {
    const { CapturePlanner, buildProviders } = await import('@bruno-capture/ai');
    const { BUILT_IN_PRESETS } = await import('@bruno-capture/shared');
    const settings = ctx.settings.get();
    const { providers } = await buildProviders(settings);
    const planner = new CapturePlanner({ preferred: settings.ai.preferredProvider, fallbackEnabled: settings.ai.fallbackEnabled, providers, presets: BUILT_IN_PRESETS, log: (m) => { if (!v.json) console.log('  ·', m); } });
    const outcome = await planner.compose(prompt, await ctx.composeCatalog(), (v.output as OutputType | 'auto' | undefined) ?? 'auto');
    if (!outcome.ok) {
      console.error(`✖ ${outcome.error.message}${outcome.error.hint ? `\n  ↳ ${outcome.error.hint}` : ''}`);
      if (outcome.suggestions.length) console.error(`  closest registered workflows: ${outcome.suggestions.map((w) => w.id).join(', ')}`);
      return 1;
    }
    const r = outcome.result;
    if (r.kind === 'reuse') {
      const p = r.validated;
      if (v.json) console.log(JSON.stringify({ kind: 'reuse', plan: p.plan, parameters: p.parameters, attribution: outcome.attribution }, null, 2));
      else console.log(`reuse ${p.workflow.id} → ${p.plan.output} (${p.preset.id}) confidence ${r.confidence.toFixed(2)} [${outcome.attribution.provider} · ${outcome.attribution.model}]\n  ${r.rationale}`);
      if (v.run) return run(p.workflow.id, { output: p.plan.output, preset: p.preset.id, param: Object.entries(p.parameters).map(([k, x]) => `${k}=${String(x)}`), relaunch: v.relaunch, json: v.json });
      return 0;
    }
    const { definitionToYaml } = await import('@bruno-capture/core');
    const yaml = definitionToYaml(r.input);
    if (v.json) console.log(JSON.stringify({ kind: 'compose', definition: r.input, output: r.output, preset: r.preset.id, confidence: r.confidence, rationale: r.rationale, debt: r.debt, primitives: r.primitives, attribution: outcome.attribution }, null, 2));
    else {
      console.log(`composed "${r.definition.name}" → ${r.output} (${r.preset.id}) · ${r.definition.steps.length} steps · confidence ${r.confidence.toFixed(2)} · ${r.primitives} ui primitive(s), ${r.debt} css selector(s) [${outcome.attribution.provider} · ${outcome.attribution.model}]`);
      console.log(`  ${r.rationale}\n`);
      console.log(yaml);
    }
    if (v.save || v.run) {
      const saved = await ctx.generated.save(r.input, { prompt, provider: outcome.attribution.provider, model: outcome.attribution.model });
      await ctx.registry.refresh();
      if (!v.json) console.log(`saved as ${saved.id} → ${saved.file}`);
      if (v.run) {
        await ctx.shutdown();
        return run(saved.id, { output: r.output, preset: r.preset.id, relaunch: v.relaunch, json: v.json });
      }
    }
    return 0;
  } finally { await ctx.shutdown().catch(() => undefined); }
}

async function refine(runId: string | undefined, feedback: string | undefined, v: { run?: boolean; json?: boolean; relaunch?: boolean }): Promise<number> {
  if (!runId || !feedback) { console.error('usage: bru-capture refine <runId> "<feedback>" [--run]'); return 2; }
  const ctx = await createContext({ log: (m) => { if (!v.json) console.log('  ·', m); } });
  try {
    const { CapturePlanner, buildProviders } = await import('@bruno-capture/ai');
    const { BUILT_IN_PRESETS } = await import('@bruno-capture/shared');
    const { resolveRefineCurrent, applyRefinement } = await import('@bruno-capture/server');
    const resolved = await resolveRefineCurrent(ctx, { runId });
    const settings = ctx.settings.get();
    const { providers } = await buildProviders(settings);
    const planner = new CapturePlanner({ preferred: settings.ai.preferredProvider, fallbackEnabled: settings.ai.fallbackEnabled, providers, presets: BUILT_IN_PRESETS, log: (m) => { if (!v.json) console.log('  ·', m); } });
    const outcome = await planner.refine(feedback, await ctx.composeCatalog(), resolved.current);
    if (!outcome.ok) { console.error(`✖ ${outcome.error.message}${outcome.error.hint ? `\n  ↳ ${outcome.error.hint}` : ''}`); return 1; }
    const r = outcome.result;
    if (v.json) console.log(JSON.stringify({ definition: r.input, output: r.output, preset: r.preset.id, overrides: r.overrides, changes: r.changes, settingsChanged: r.settingsChanged, diff: r.diff, confidence: r.confidence, attribution: outcome.attribution }, null, 2));
    else {
      console.log(`refined "${r.definition.name}" · confidence ${r.confidence.toFixed(2)} [${outcome.attribution.provider} · ${outcome.attribution.model}]`);
      for (const c of r.changes) console.log(`  • ${c}`);
      for (const c of r.settingsChanged) console.log(`  • ${c}`);
      console.log(`  ${r.rationale}\n`);
      for (const d of r.diff) console.log(`${d.kind === 'added' ? '+' : d.kind === 'removed' ? '-' : ' '} ${d.line}`);
    }
    if (!v.run) return 0;
    const applied = await applyRefinement(ctx, { workflowId: resolved.source.workflowId, definition: r.input, output: r.output, preset: r.preset.id, overrides: r.overrides, prompt: resolved.current.prompt, feedback: [...(resolved.current.feedback ?? []), feedback], refinedFrom: runId, ai: outcome.attribution, allowRelaunch: Boolean(v.relaunch) });
    if (!v.json) console.log(`\n${applied.savedAs} ${applied.workflowId} → run ${applied.run.runId}`);
    const t0 = Date.now();
    for await (const e of ctx.engine.events(applied.run.runId)!) {
      if (v.json) { if (e.type !== 'preview.frame') console.log(JSON.stringify(e)); continue; }
      const line = formatEvent(e, t0);
      if (line) console.log(line);
    }
    const final = ctx.engine.get(applied.run.runId)!.manifest;
    if (!v.json) console.log(`\n${final.status}  ${final.artifacts.length} artifact(s) in ${ctx.engine.get(applied.run.runId)!.artifacts.runDir}`);
    return final.status === 'completed' ? 0 : final.status === 'completed_with_errors' ? 3 : 1;
  } catch (e) {
    if (e instanceof RunValidationError) { console.error(`✖ ${e.message}`); return 2; }
    throw e;
  } finally { await ctx.shutdown().catch(() => undefined); }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true, // `--no-open`, as the usage text promises
    options: {
      help: { type: 'boolean', short: 'h' },
      port: { type: 'string' },
      open: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
      output: { type: 'string' },
      preset: { type: 'string' },
      param: { type: 'string', multiple: true },
      relaunch: { type: 'boolean', default: false },
      save: { type: 'boolean', default: false },
      run: { type: 'boolean', default: false },
    },
  });
  if (values.help) { console.log(USAGE); return 0; }
  const [cmd, sub, third] = positionals;
  switch (cmd) {
    case undefined: return start(values.port ? Number(values.port) : undefined, values.open ?? true);
    case 'doctor': return doctor(values.json ?? false);
    case 'workflows': return workflows(sub, values.json ?? false);
    case 'workflow': return sub === 'add' ? workflowAdd(third) : (console.error(USAGE), 2);
    case 'run': return run(sub, values);
    case 'compose': return compose(sub, values);
    case 'refine': return refine(sub, third, values);
    case 'helper': {
      const h = await CaptureHelper.locate(appPaths().binDir);
      if (!h) { console.error('Native capture helper not installed. Build it with: pnpm helper:build -- --install'); return 2; }
      if (sub === 'request') { const granted = await h.requestAccess(); console.log(granted ? 'Screen Recording: granted' : 'Screen Recording: not granted yet — approve the prompt (or enable it in System Settings), then run `bru-capture doctor`.'); return granted ? 0 : 3; }
      console.log(`helper: ${h.binary}\npreflight: ${(await h.preflight()) ? 'granted' : 'not granted'}`); return 0;
    }
    default:
      console.error(`unknown command: ${cmd}\n`); console.log(USAGE); return 2;
  }
}

if (process.argv[1] && /packages\/cli\/src\/main\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
