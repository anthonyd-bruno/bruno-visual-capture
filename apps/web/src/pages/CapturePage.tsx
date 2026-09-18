import { useEffect, useMemo, useState } from 'react';
import type { Capabilities, OutputType, WorkflowSummary } from '@bruno-capture/shared';
import { api, ApiError, type PlanResponse } from '../api';

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

export function CapturePage({ initialWorkflow }: { initialWorkflow?: string }) {
  const [caps, setCaps] = useState<Capabilities>();
  const [workflowId, setWorkflowId] = useState(initialWorkflow ?? '');
  const [output, setOutput] = useState<OutputType>('screenshots');
  const [preset, setPreset] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
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
  const adoptPlan = (r: Extract<PlanResponse, { ok: true }>) => {
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
      else setError(err.details ? `${err.message}\n${(err.details as Array<{ path: string; message: string }>).map((d) => `${d.path}: ${d.message}`).join('\n')}` : err.message);
    } finally { setBusy(false); }
  };

  return (
    <main>
      <h1>Capture</h1>
      <div className="panel">
        <label>What do you want to create?</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Create a GIF showing how to run a collection from the Bruno Runner" />
        <div className="row" style={{ marginTop: 8 }}>
          <select value={promptOutput} onChange={(e) => setPromptOutput(e.target.value as OutputType | 'auto')} style={{ maxWidth: 160 }}>
            <option value="auto">Auto</option><option value="screenshot">Screenshot</option><option value="screenshots">Screenshots</option><option value="video">Video</option><option value="gif">GIF</option>
          </select>
          <button className="primary" disabled={planning || prompt.trim().length < 3} onClick={() => void runPlan()}>{planning ? 'Planning…' : 'Plan'}</button>
          <span className="muted">The AI only picks from registered workflows; nothing runs until you press Generate.</span>
        </div>
        {planRes && !planRes.ok && (
          <div className="error" style={{ marginTop: 10 }}>
            <strong>{planRes.error.message}</strong>{planRes.error.hint && <div>{planRes.error.hint}</div>}
            {planRes.suggestions.length > 0 && <div style={{ marginTop: 6 }}>Likely workflows: {planRes.suggestions.map((w) => <button key={w.id} style={{ marginRight: 6 }} onClick={() => { setWorkflowId(w.id); setParams({}); }}>{w.name}</button>)}</div>}
          </div>
        )}
        {planRes && planRes.ok && (
          <div className="panel" style={{ marginTop: 10, background: 'var(--bg)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Capture plan</strong>
              <span>
                <span className="badge">{planRes.band === 'ready' ? `confidence ${Math.round(planRes.plan.confidence * 100)}%` : planRes.band === 'review' ? `Review recommended · ${Math.round(planRes.plan.confidence * 100)}%` : `Low confidence · ${Math.round(planRes.plan.confidence * 100)}%`}</span>{' '}
                <span className="badge">{planRes.attribution.provider} · {planRes.attribution.model}{planRes.attribution.fallbackOccurred ? ` · fell back from ${planRes.attribution.fallbackFrom}` : ''}{planRes.attribution.repaired ? ' · repaired' : ''}</span>
              </span>
            </div>
            <table><tbody>
              <tr><th>Feature</th><td>{planRes.workflow.feature}</td></tr>
              <tr><th>Workflow</th><td>{planRes.workflow.name} <code>{planRes.workflow.id}</code></td></tr>
              <tr><th>Output</th><td>{planRes.plan.output}</td></tr>
              <tr><th>Preset</th><td>{planRes.preset.name} — {planRes.preset.height ? `${planRes.preset.width}×${planRes.preset.height}` : `${planRes.preset.width} px wide`}, {planRes.preset.theme}, cursor {planRes.preset.cursor}</td></tr>
              <tr><th>Framing</th><td>{planRes.preset.framing}</td></tr>
              <tr><th>Parameters</th><td>{Object.keys(planRes.parameters).length ? Object.entries(planRes.parameters).map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'defaults'}</td></tr>
              <tr><th>Why</th><td className="muted">{planRes.plan.rationale}</td></tr>
            </tbody></table>
            {planRes.band === 'low' ? (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted">Not confident enough to run. Pick one:</span>
                {planRes.suggestions.map((w) => <button key={w.id} onClick={() => { setWorkflowId(w.id); setParams({}); }}>{w.name}</button>)}
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
        {error && <div className="error">{error}</div>}
        {conflict !== null && <div className="error">A capture is already running.<div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => start({ cancelActive: true })}>Cancel Current &amp; Start New</button><button onClick={() => setConflict(null)}>Keep Current Run</button></div></div>}
        {relaunchNeeded && <div className="error">Bruno needs to be relaunched to enable capture automation.<div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => start({ allowRelaunch: true })}>Relaunch Bruno &amp; Continue</button><button onClick={() => setRelaunchNeeded(false)}>Cancel</button></div></div>}
        <div className="grid">
          <div><label>Workflow</label>
            <select value={workflowId} onChange={(e) => { setWorkflowId(e.target.value); setParams({}); }}>
              <option value="">Choose…</option>
              {caps?.workflows.filter((w) => w.valid).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.feature})</option>)}
            </select></div>
          <div><label>Output</label>
            <select value={output} onChange={(e) => setOutput(e.target.value as OutputType)} disabled={!wf}>
              {(wf?.supportedOutputs ?? ['screenshots']).map((o) => <option key={o} value={o}>{o}{o === 'video' || o === 'gif' ? ' (Phase 5)' : ''}</option>)}
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
