import { useState } from 'react';
import { api, type ApiError, type RefineFrom, type RefineResponse } from '../api';

/**
 * Phase 10: "Adjust this capture" — natural-language feedback → the same workflow with only that change,
 * shown as a step diff + settings changes, then saved and regenerated in one click.
 */
export function RefinePanel({ from, title = 'Adjust this capture', onApplied, onPreview, applyLabel = 'Apply & Regenerate' }: {
  from: RefineFrom;
  title?: string;
  /** Called after the refinement was saved and a run started. */
  onApplied?: (runId: string) => void;
  /** When given, "Apply" hands the refined plan back instead of saving/running (pre-run adjustments on the Capture page). */
  onPreview?: (r: Extract<RefineResponse, { ok: true }>) => void;
  applyLabel?: string;
}) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RefineResponse>();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);

  const refine = async () => {
    setBusy(true); setError(undefined); setRes(undefined); setConflict(false);
    try { setRes(await api.refine(feedback, from)); }
    catch (e) { setError((e as ApiError).message); }
    finally { setBusy(false); }
  };
  const apply = async (extra: { cancelActive?: boolean } = {}) => {
    if (!res || !res.ok) return;
    if (onPreview) { onPreview(res); setRes(undefined); setFeedback(''); return; }
    setBusy(true); setError(undefined);
    try {
      const r = await api.applyRefine({ workflowId: res.source.workflowId, definition: res.definition, output: res.output, preset: res.preset.id, overrides: res.overrides, prompt: res.prompt, feedback: res.feedback, refinedFrom: res.source.runId, ai: res.attribution, ...extra });
      onApplied?.(r.run.runId);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) setConflict(true); else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted">Say what should change and only that is changed — the rest of the steps stay exactly as they are. Examples: “don't obscure the token entered”, “dark theme”, “make it a GIF”, “pause longer before the response screenshot”, “use a POST to /posts instead”.</p>
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should be different?" style={{ minHeight: 60 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy || feedback.trim().length < 3} onClick={() => void refine()}>{busy && !res ? 'Refining…' : 'Refine'}</button>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {res && !res.ok && <div className="error" style={{ marginTop: 8 }}><strong>{res.error.message}</strong>{res.error.hint && <div>{res.error.hint}</div>}</div>}
      {res && res.ok && (
        <div className="panel" style={{ marginTop: 12, borderColor: res.band === 'ready' ? 'var(--ok)' : res.band === 'review' ? 'var(--warn, orange)' : 'var(--bad)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Proposed changes <span className="badge">confidence {(res.confidence * 100).toFixed(0)}%</span></strong>
            <span className="badge">{res.attribution.provider} · {res.attribution.model}{res.attribution.repaired ? ' · repaired' : ''}</span>
          </div>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            {res.changes.map((c, i) => <li key={i}>{c}</li>)}
            {res.settingsChanged.map((c, i) => <li key={`s${i}`}><span className="mono">{c}</span></li>)}
          </ul>
          <p className="muted" style={{ margin: '4px 0' }}>{res.rationale}</p>
          <details open={res.diff.some((d) => d.kind !== 'same')}>
            <summary className="muted">Step diff ({res.diff.filter((d) => d.kind === 'added').length} added, {res.diff.filter((d) => d.kind === 'removed').length} removed, {res.stepCount} steps after)</summary>
            <pre style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5 }}>{res.diff.map((d, i) => <div key={i} style={{ color: d.kind === 'added' ? 'var(--ok)' : d.kind === 'removed' ? 'var(--bad)' : 'inherit', textDecoration: d.kind === 'removed' ? 'line-through' : 'none' }}>{d.kind === 'added' ? '+ ' : d.kind === 'removed' ? '− ' : '  '}{d.line}</div>)}</pre>
          </details>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={() => void apply()}>{applyLabel}</button>
            <button disabled={busy} onClick={() => setRes(undefined)}>Discard</button>
            <span className="muted">{res.source.workflowSource === 'generated' ? 'Updates the generated workflow in place.' : res.source.workflowSource === 'unsaved' ? 'Replaces the plan above.' : `Saves a new generated workflow derived from the ${res.source.workflowSource} one (built-ins are never edited).`}</span>
          </div>
          {conflict && <div className="error" style={{ marginTop: 8 }}>A capture is already running.<div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => void apply({ cancelActive: true })}>Cancel Current &amp; Start</button><button onClick={() => setConflict(false)}>Keep Current Run</button></div></div>}
        </div>
      )}
    </div>
  );
}
