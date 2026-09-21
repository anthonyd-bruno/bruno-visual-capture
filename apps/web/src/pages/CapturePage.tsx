import { useEffect, useMemo, useState } from 'react';
import type { Capabilities, OutputType, WorkflowSummary } from '@bruno-capture/shared';
import { api, ApiError, type ComposePlanResponse, type Issue, type PlanResponse, type RefineResponse, type ReusePlanResponse } from '../api';
import { RefinePanel } from '../components/RefinePanel';

export function ParamForm({ wf, values, onChange }: { wf: WorkflowSummary; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(wf.parameters);
  if (!entries.length) return <p className="muted">This workflow has no parameters.</p>;
  return (
    <div className="grid">
      {entries.map(([key, p]) => {
        const v = values[key] ?? String((p as { default?: unknown }).default ?? '');
        const set = (x: string) => onChange({ ...values, [key]: x });
        return (
          <div key={key}>
            <label>{p.label ?? key}{p.required && ' *'}{p.description && <span className="muted"> — {p.description}</span>}</label>
            {p.type === 'select' ? <select value={v} onChange={(e) => set(e.target.value)}>{p.options.map((o) => <option key={o}>{o}</option>)}</select>
              : p.type === 'boolean' ? <select value={v || 'false'} onChange={(e) => set(e.target.value)}><option value="true">true</option><option value="false">false</option></select>
              : <input type={p.type === 'number' ? 'number' : 'text'} value={v} onChange={(e) => set(e.target.value)} placeholder={p.type === 'file' || p.type === 'directory' ? '/absolute/path' : ''} />}
          </div>
        );
      })}
    </div>
  );
}

export interface CapturePrefill { workflow?: string; output?: OutputType; preset?: string; params?: Record<string, string>; review?: string }

const stepLine = (s: Record<string, unknown>): string => {
  if ('action' in s) { const p = (s['params'] ?? {}) as Record<string, unknown>; const ps = Object.entries(p).map(([k, v]) => `${k}=${typeof v === 'string' ? (v.length > 40 ? JSON.stringify(v.slice(0, 40) + '…') : JSON.stringify(v)) : JSON.stringify(v)}`).join(' '); return `${String(s['action'])}${ps ? ` ${ps}` : ''}`; }
  if ('capture' in s) { const c = s['capture'] as Record<string, unknown>; return `📷 capture ${String(c['id'])}${c['name'] ? ` — ${String(c['name'])}` : ''}`; }
  if ('waitFor' in s) { const w = s['waitFor'] as Record<string, unknown>; return `wait for ${w['state'] ? String(w['state']) : w['text'] ? `text "${String((w['text'] as Record<string, unknown>)['contains'] ?? '')}"` : Object.keys(w).filter((k) => k !== 'timeoutMs').join(' ')}`; }
  if ('pause' in s) return `pause ${String(s['pause'])} ms`;
  if ('startRecording' in s) return '⏺ start recording';
  if ('stopRecording' in s) return '⏹ stop recording';
  return JSON.stringify(s);
};

/** Phase 9: the composed-plan card — steps, fixture, confidence, an editable YAML view, Generate / Save. */
function ComposedPlanCard({ r, prompt, busy, onError, onBusy, onRefined }: { r: ComposePlanResponse; prompt: string; busy: boolean; onError: (m: string | undefined) => void; onBusy: (b: boolean) => void; onRefined: (r: ComposePlanResponse) => void }) {
  const [yaml, setYaml] = useState(r.yaml);
  const [editing, setEditing] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [validated, setValidated] = useState<{ stepCount: number; captureIds: string[] } | null>({ stepCount: r.stepCount, captureIds: r.captureIds });
  useEffect(() => { setYaml(r.yaml); setIssues([]); setValidated({ stepCount: r.stepCount, captureIds: r.captureIds }); }, [r]);
  const validate = async (text: string) => {
    try { const v = await api.validateWorkflow(text); setIssues(v.issues); setValidated(v.valid ? { stepCount: v.stepCount ?? 0, captureIds: v.captureIds ?? [] } : null); return v.valid; }
    catch (e) { onError((e as ApiError).message); return false; }
  };
  const save = async (): Promise<string | undefined> => {
    if (!(await validate(yaml))) return undefined;
    const saved = await api.saveGenerated({ yaml, prompt, provider: r.attribution.provider, model: r.attribution.model });
    if (!saved.valid) { setIssues(saved.issues); return undefined; }
    return saved.id;
  };
  const generate = async () => {
    onBusy(true); onError(undefined);
    try {
      const id = await save();
      if (!id) return;
      const run = await api.createRun({ workflowId: id, output: r.output, preset: r.preset.id, parameters: {}, request: { prompt, plan: { type: 'composed', workflow: id, output: r.output, preset: r.preset.id, confidence: r.confidence, rationale: r.rationale, parameters: {} }, ai: r.attribution } });
      location.hash = `#/run/${run.run.runId}`;
    } catch (e) { onError((e as ApiError).message); } finally { onBusy(false); }
  };
  const saveOnly = async () => {
    onBusy(true); onError(undefined);
    try { const id = await save(); if (id) location.hash = '#/workflows'; }
    catch (e) { onError((e as ApiError).message); } finally { onBusy(false); }
  };
  const steps = (r.definition.steps ?? []) as unknown as Array<Record<string, unknown>>;
  const fx = r.fixture;
  return (
    <div className="panel" style={{ marginTop: 12, borderColor: r.band === 'ready' ? 'var(--ok)' : r.band === 'review' ? 'var(--warn, orange)' : 'var(--bad)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{r.band === 'ready' ? 'Composed a new workflow' : r.band === 'review' ? 'Composed a new workflow — review before generating' : 'Composed a new workflow, but confidence is low'} <span className="badge">confidence {(r.confidence * 100).toFixed(0)}%</span></strong>
        <span className="badge">{r.attribution.provider} · {r.attribution.model}{r.attribution.fallbackOccurred ? ` · fell back from ${r.attribution.fallbackFrom}` : ''}{r.attribution.repaired ? ' · repaired' : ''}</span>
      </div>
      <table><tbody>
        <tr><th>Workflow</th><td>{r.definition.name} <span className="muted">— {r.definition.description}</span></td></tr>
        <tr><th>Feature</th><td>{r.definition.feature}</td></tr>
        <tr><th>Fixture</th><td>{fx.source === 'bundled' ? `bundled ${fx.path}` : fx.source === 'inline' ? `inline collection "${fx.collection}" (${fx.requests} request${fx.requests === 1 ? '' : 's'}, ${fx.environments} environment${fx.environments === 1 ? '' : 's'}) — written at run time` : 'none (empty workspace)'}</td></tr>
        <tr><th>Output</th><td>{r.output} · {r.preset.name} — {r.preset.height ? `${r.preset.width}×${r.preset.height}` : `${r.preset.width} px wide`}, {r.preset.theme}, cursor {r.preset.cursor}</td></tr>
        <tr><th>Steps</th><td>{validated ? `${validated.stepCount}` : '—'}{r.primitives ? ` · ${r.primitives} generic UI step${r.primitives === 1 ? '' : 's'} (guessed UI path)` : ''}{r.debt ? ` · ${r.debt} raw CSS selector${r.debt === 1 ? '' : 's'}` : ''}</td></tr>
        <tr><th>Captures</th><td>{validated?.captureIds.length ? validated.captureIds.join(', ') : r.output === 'screenshots' ? '—' : 'recording only'}</td></tr>
        <tr><th>Why</th><td className="muted">{r.rationale}</td></tr>
      </tbody></table>
      {!editing ? (
        <ol className="muted" style={{ margin: '8px 0 0', paddingLeft: 22, lineHeight: 1.6 }}>{steps.map((s, i) => <li key={i}><span className="mono">{stepLine(s)}</span></li>)}</ol>
      ) : (
        <div style={{ marginTop: 8 }}>
          <textarea className="mono" value={yaml} onChange={(e) => setYaml(e.target.value)} style={{ minHeight: 320, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
          <div className="row" style={{ marginTop: 6 }}><button onClick={() => void validate(yaml)}>Validate</button><span className="muted">{issues.length ? `${issues.length} issue(s)` : validated ? 'valid' : ''}</span></div>
        </div>
      )}
      {issues.length > 0 && <div className="error" style={{ marginTop: 8 }}>{issues.map((i, k) => <div key={k}><code>{i.path}</code> {i.message}</div>)}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy || issues.length > 0} onClick={() => void generate()}>{r.band === 'low' ? 'Generate anyway (self-healing on)' : 'Generate'}</button>
        <button disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? 'Show steps' : 'Edit YAML'}</button>
        <button disabled={busy || issues.length > 0} onClick={() => void saveOnly()}>Save to Workflows</button>
        <span className="muted">Generate saves this as a reusable workflow, then runs it. Failed steps are repaired from the live UI and written back.</span>
      </div>
      {r.band === 'low' && r.suggestions.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Registered workflows that may fit instead: {r.suggestions.map((w) => <a key={w.id} href={`#/capture?workflow=${w.id}`} style={{ marginRight: 8 }}>{w.name}</a>)}</p>}
      <RefinePanel title="Adjust the plan before generating" applyLabel="Apply to plan" from={{ definition: r.definition, output: r.output, preset: r.preset.id }} onPreview={(x: Extract<RefineResponse, { ok: true }>) => onRefined({ ...r, definition: x.definition, yaml: x.yaml, output: x.output, preset: x.preset, captureIds: x.captureIds, stepCount: x.stepCount, confidence: x.confidence, band: x.band, rationale: `${r.rationale} Adjusted: ${x.changes.join('; ')}`, debt: x.debt, primitives: (x.definition.steps as Array<Record<string, unknown>>).filter((s) => typeof s['action'] === 'string' && (s['action'] as string).startsWith('ui.')).length })} />
    </div>
  );
}

export function CapturePage({ initialWorkflow, prefill }: { initialWorkflow?: string; prefill?: CapturePrefill }) {
  const [caps, setCaps] = useState<Capabilities>();
  const [workflowId, setWorkflowId] = useState(prefill?.workflow ?? initialWorkflow ?? '');
  const [output, setOutput] = useState<OutputType>(prefill?.output ?? 'screenshots');
  const [preset, setPreset] = useState(prefill?.preset ?? '');
  const [params, setParams] = useState<Record<string, string>>(prefill?.params ?? {});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [relaunchNeeded, setRelaunchNeeded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptOutput, setPromptOutput] = useState<OutputType | 'auto'>('auto');
  const [planning, setPlanning] = useState(false);
  const [planRes, setPlanRes] = useState<PlanResponse>();
  useEffect(() => { api.capabilities().then(setCaps).catch((e) => setError(String(e.message))); }, []);

  const runPlan = async () => {
    setPlanning(true); setPlanRes(undefined); setError(undefined);
    try { setPlanRes(await api.plan(prompt, promptOutput)); }
    catch (e) { setError((e as ApiError).message); }
    finally { setPlanning(false); }
  };
  /** "Edit": move the plan into the manual form so changes need no second AI request (PRD §7.4). */
  const adoptPlan = (r: ReusePlanResponse) => {
    setWorkflowId(r.workflow.id); setOutput(r.plan.output); setPreset(r.plan.preset);
    setParams(Object.fromEntries(Object.entries(r.parameters).map(([k, v]) => [k, String(v)])));
  };
  const wf = useMemo(() => caps?.workflows.find((w) => w.id === workflowId), [caps, workflowId]);
  useEffect(() => { if (wf && !wf.supportedOutputs.includes(output)) setOutput(wf.supportedOutputs[0]!); }, [wf, output]);
  const presets = caps?.presets.filter((p) => p.outputs.includes(output)) ?? [];
  const effectivePreset = preset && presets.some((p) => p.id === preset) ? preset : presets[0]?.id ?? '';

  const start = async (extra: { cancelActive?: boolean; allowRelaunch?: boolean } = {}) => {
    if (!wf) return;
    setBusy(true); setError(undefined); setConflict(null); setRelaunchNeeded(false);
    try {
      const r = await api.createRun({ workflowId: wf.id, output, preset: effectivePreset || undefined, parameters: params, ...extra });
      location.hash = `#/run/${r.run.runId}`;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.code === 'run_conflict') setConflict((err.details as { activeRunId: string })?.activeRunId ?? '');
      else if (err.status === 409 && err.code === 'bruno_already_running') setRelaunchNeeded(true);
      else setError(err.details ? `${err.message}\n${(err.details as Array<{ path: string; message: string }>).map((d) => `${d.path}: ${d.message}`).join('\n')}` : err.message);
    } finally { setBusy(false); }
  };

  return (
    <main>
      <h1>Capture</h1>
      <div className="panel">
        <label>What do you want to create?</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe any Bruno workflow, e.g. “Show how to add a bearer token to a request and send it”, “GIF of creating a new collection and its first request”, “Screenshots of switching environments”" />
        <div className="row" style={{ marginTop: 8 }}>
          <select value={promptOutput} onChange={(e) => setPromptOutput(e.target.value as OutputType | 'auto')} style={{ maxWidth: 220 }}>
            <option value="auto">Output: let the planner decide</option><option value="screenshots">Screenshots</option><option value="video">Video (MP4)</option><option value="gif">GIF</option>
          </select>
          <button className="primary" disabled={planning || prompt.trim().length < 3} onClick={() => void runPlan()}>{planning ? 'Planning…' : 'Plan'}</button>
          <span className="muted">The planner reuses a registered workflow when one fits, otherwise it composes new steps from Bruno actions. Nothing runs until you click Generate.</span>
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        {planRes && !planRes.ok && (
          <div className="error" style={{ marginTop: 12 }}>
            <strong>{planRes.error.message}</strong>{planRes.error.hint && <div>{planRes.error.hint}</div>}
            {planRes.suggestions.length > 0 && <div className="row" style={{ marginTop: 8 }}><span className="muted">Closest registered workflows:</span>{planRes.suggestions.map((w) => <button key={w.id} onClick={() => { setWorkflowId(w.id); setParams({}); }}>{w.name}</button>)}</div>}
          </div>
        )}
        {planRes && planRes.ok && planRes.kind === 'compose' && <ComposedPlanCard r={planRes} prompt={prompt} busy={busy} onError={setError} onBusy={setBusy} onRefined={setPlanRes} />}
        {planRes && planRes.ok && planRes.kind === 'reuse' && (
          <div className="panel" style={{ marginTop: 12, borderColor: planRes.band === 'ready' ? 'var(--ok)' : planRes.band === 'review' ? 'var(--warn, orange)' : 'var(--bad)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{planRes.band === 'ready' ? 'Ready to generate' : planRes.band === 'review' ? 'Review the plan' : 'Low confidence'} <span className="badge">confidence {(planRes.plan.confidence * 100).toFixed(0)}%</span></strong>
              <span className="badge">{planRes.attribution.provider} · {planRes.attribution.model}{planRes.attribution.fallbackOccurred ? ` · fell back from ${planRes.attribution.fallbackFrom}` : ''}{planRes.attribution.repaired ? ' · repaired' : ''}</span>
            </div>
            <table><tbody>
              <tr><th>Feature</th><td>{planRes.workflow.feature}</td></tr>
              <tr><th>Workflow</th><td>{planRes.workflow.name} <code>{planRes.workflow.id}</code> <span className="badge">{planRes.workflow.source}</span></td></tr>
              <tr><th>Output</th><td>{planRes.plan.output}</td></tr>
              <tr><th>Preset</th><td>{planRes.preset.name} — {planRes.preset.height ? `${planRes.preset.width}×${planRes.preset.height}` : `${planRes.preset.width} px wide`}, {planRes.preset.theme}, cursor {planRes.preset.cursor}</td></tr>
              <tr><th>Parameters</th><td>{Object.keys(planRes.parameters).length ? Object.entries(planRes.parameters).map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'defaults'}</td></tr>
              <tr><th>Why</th><td className="muted">{planRes.plan.rationale}</td></tr>
            </tbody></table>
            {planRes.band === 'low' ? (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted">Not confident enough to run. Pick one:</span>
                {planRes.suggestions.map((w) => <button key={w.id} onClick={() => { setWorkflowId(w.id); setParams({}); }}>{w.name}</button>)}
                <button onClick={() => { void api.plan(prompt, promptOutput, 'compose').then(setPlanRes).catch((e) => setError((e as ApiError).message)); }}>Compose new steps instead</button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" disabled={busy} onClick={() => { adoptPlan(planRes); void api.createRun({ workflowId: planRes.workflow.id, output: planRes.plan.output, preset: planRes.plan.preset, parameters: Object.fromEntries(Object.entries(planRes.parameters).map(([k, v]) => [k, String(v)])), request: { prompt, plan: planRes.plan, ai: planRes.attribution } }).then((r) => { location.hash = `#/run/${r.run.runId}`; }).catch((e) => setError((e as ApiError).message)); }}>Generate</button>
                <button onClick={() => adoptPlan(planRes)}>Edit</button>
                <button onClick={() => { adoptPlan(planRes); setPlanRes(undefined); }}>Change Workflow</button>
              </div>
            )}
          </div>
        )}
        <p className="muted" style={{ marginTop: 8 }}>Or choose a workflow manually below — that path never depends on AI (PRD §17).</p>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Manual capture</h2>
        {prefill?.review && <div className="error"><strong>Review before generating.</strong> {prefill.review}</div>}
        {conflict !== null && <div className="error">A capture is already running.<div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => start({ cancelActive: true })}>Cancel Current &amp; Start New</button><button onClick={() => setConflict(null)}>Keep Current Run</button></div></div>}
        {relaunchNeeded && <div className="error">Bruno needs to be relaunched to enable capture automation.<div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => start({ allowRelaunch: true })}>Relaunch Bruno &amp; Continue</button><button onClick={() => setRelaunchNeeded(false)}>Cancel</button></div></div>}
        <div className="grid">
          <div><label>Workflow</label>
            <select value={workflowId} onChange={(e) => { setWorkflowId(e.target.value); setParams({}); }}>
              <option value="">Choose…</option>
              {caps?.workflows.filter((w) => w.valid).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.feature}{w.source === 'generated' ? ', generated' : ''})</option>)}
            </select></div>
          <div><label>Output</label>
            <select value={output} onChange={(e) => setOutput(e.target.value as OutputType)} disabled={!wf}>
              {(wf?.supportedOutputs ?? ['screenshots']).map((o) => <option key={o} value={o}>{o}</option>)}
            </select></div>
          <div><label>Preset</label>
            <select value={effectivePreset} onChange={(e) => setPreset(e.target.value)} disabled={!wf}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.height ? `${p.width}×${p.height}` : `${p.width} px wide (recorded at 1600×1000)`}, {p.theme}</option>)}
            </select></div>
        </div>
        {wf && <><h2>Parameters</h2><ParamForm wf={wf} values={params} onChange={setParams} /><p className="muted">{wf.description}</p></>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!wf || busy} onClick={() => start()}>Generate</button>
          {wf && <span className="muted">Captures: {wf.captureIds.join(', ') || '—'}</span>}
        </div>
      </div>
    </main>
  );
}
