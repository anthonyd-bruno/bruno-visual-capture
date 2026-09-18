import { useEffect, useRef, useState } from 'react';
import type { Artifact, RunEvent, RunManifest, StepSummary } from '@bruno-capture/shared';
import { api, subscribeRun } from '../api';

interface StepState { step: StepSummary; status: 'active' | 'done' | 'failed'; message?: string }

export function ArtifactCard({ runId, a }: { runId: string; a: Artifact }) {
  const url = api.fileUrl(runId, a.relativePath);
  const copy = async () => { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); };
  return (
    <div className="panel artifact">
      {a.kind === 'video' ? <video controls src={url} /> : <img src={url} alt={a.fileName} />}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="mono">{a.fileName}{a.width ? ` · ${a.width}×${a.height}` : ''}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)}s` : ''} · {(a.bytes / 1024).toFixed(0)} KB</span>
        <span className="row">
          <a href={api.fileUrl(runId, a.relativePath, true)}><button>Download {a.kind === 'screenshot' ? 'PNG' : a.kind.toUpperCase()}</button></a>
          {a.kind === 'screenshot' && <button onClick={copy}>Copy</button>}
        </span>
      </div>
    </div>
  );
}

export function RunPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunManifest>();
  const [steps, setSteps] = useState<StepState[]>([]);
  const [total, setTotal] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [frame, setFrame] = useState<string>();
  const [status, setStatus] = useState<string>('');
  const [fatal, setFatal] = useState<{ message: string; hint?: string }>();
  const [logs, setLogs] = useState<string[]>([]);
  const live = useRef(true);

  useEffect(() => {
    api.run(runId).then((r) => { setRun(r.run); setStatus(r.run.status); setArtifacts(r.run.artifacts); }).catch(() => undefined);
    const onEvent = (e: RunEvent) => {
      switch (e.type) {
        case 'run.status': setStatus(e.status); break;
        case 'workflow.started': setTotal(e.stepCount); break;
        case 'workflow.step.started': setSteps((s) => [...s.filter((x) => x.step.index !== e.step.index), { step: e.step, status: 'active' }]); break;
        case 'workflow.step.completed': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'done' } : x)); break;
        case 'workflow.step.failed': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'failed', message: e.error.message + (e.error.hint ? ` — ${e.error.hint}` : '') } : x)); break;
        case 'preview.frame': if (live.current) setFrame(e.dataUrl); break;
        case 'artifact.created': setArtifacts((a) => [...a, e.artifact]); break;
        case 'run.failed': setFatal(e.error); break;
        case 'run.log': setLogs((l) => [...l.slice(-199), e.message]); break;
        case 'run.completed': case 'run.cancelled': live.current = false; api.run(runId).then((r) => setRun(r.run)).catch(() => undefined); break;
        default: break;
      }
    };
    return subscribeRun(runId, onEvent, () => { api.run(runId).then((r) => { setRun(r.run); setStatus(r.run.status); setArtifacts(r.run.artifacts); }).catch(() => undefined); });
  }, [runId]);

  const terminal = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status);
  const active = steps.find((s) => s.status === 'active');
  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{run?.workflow.name ?? 'Run'} <span className="badge">{status}</span></h1>
        <span className="row">
          {!terminal && <button onClick={() => api.cancelRun(runId)}>Cancel Run</button>}
          {terminal && run && <button onClick={() => api.regenerate(runId, 'latest').then((r) => { location.hash = `#/run/${r.run.runId}`; })}>Regenerate Latest</button>}
          <a href="#/library"><button>Library</button></a>
        </span>
      </div>
      <p className="muted mono">{runId}{run ? ` · ${run.capture.output} · ${run.capture.preset} · ${run.capture.width}×${run.capture.height ?? '?'} ${run.capture.theme} · Bruno ${run.bruno.version ?? '?'} (${run.bruno.profileMode} profile)` : ''}</p>
      {fatal && <div className="error"><strong>{fatal.message}</strong>{fatal.hint && <div>{fatal.hint}</div>}</div>}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="panel">
          {!terminal ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>{active ? `Running ${active.step.index + 1} of ${total}` : status}</strong><span className="muted">{active?.step.label}</span></div>
              {frame ? <img className="preview" src={frame} alt="Live Bruno preview" /> : <div className="preview" />}
            </>
          ) : artifacts.length === 0 ? <p className="muted">No artifacts.</p> : (
            <div className="grid" style={{ gridTemplateColumns: '1fr' }}>{artifacts.map((a) => <ArtifactCard key={a.id} runId={runId} a={a} />)}</div>
          )}
        </div>
        <div className="panel steps">
          <h2 style={{ marginTop: 0 }}>Steps</h2>
          <ul>{steps.sort((a, b) => a.step.index - b.step.index).map((s) => (
            <li key={s.step.index} className={s.status === 'done' ? 'step-done' : s.status === 'failed' ? 'step-failed' : 'step-active'}>
              <span>{s.status === 'done' ? '✔' : s.status === 'failed' ? '✖' : '▶'}</span><span>{s.step.index + 1}. {s.step.label}{s.message && <div className="muted">{s.message}</div>}</span>
            </li>
          ))}</ul>
          {!terminal && artifacts.length > 0 && <p className="muted">{artifacts.length} artifact(s) so far</p>}
          {logs.length > 0 && <details><summary className="muted">Debug log ({logs.length})</summary><pre>{logs.join('\n')}</pre></details>}
        </div>
      </div>
    </main>
  );
}
