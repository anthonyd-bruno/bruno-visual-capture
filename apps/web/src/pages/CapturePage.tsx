import { useEffect, useMemo, useState } from 'react';
import type { Capabilities, OutputType, WorkflowSummary } from '@bruno-capture/shared';
import { api, ApiError } from '../api';

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
  useEffect(() => { api.capabilities().then(setCaps).catch((e) => setError(String(e.message))); }, []);
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
        <textarea placeholder="e.g. Create a GIF showing how to run a collection from the Bruno Runner" disabled />
        <p className="muted">AI planning arrives in Phase 6. Choose a workflow manually below — this path never depends on AI (PRD §17).</p>
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
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.width}{p.height ? `×${p.height}` : ' wide'}, {p.theme}</option>)}
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
