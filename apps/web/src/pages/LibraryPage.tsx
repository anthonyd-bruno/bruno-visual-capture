import { useEffect, useState } from 'react';
import type { RunManifest } from '@bruno-capture/shared';
import { api, regenerateAndGo } from '../api';

export function LibraryPage() {
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [output, setOutput] = useState('all');
  const [feature, setFeature] = useState('all');
  const [workflow, setWorkflow] = useState('all');
  const [error, setError] = useState<string>();
  const load = () => api.runs().then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const features = [...new Set(runs.map((r) => r.workflow.feature))];
  const workflows = [...new Set(runs.map((r) => r.workflow.id))];
  const shown = runs.filter((r) => (output === 'all' || r.capture.output === output) && (feature === 'all' || r.workflow.feature === feature) && (workflow === 'all' || r.workflow.id === workflow));
  return (
    <main>
      <h1>Library</h1>
      <div className="panel row">
        <select value={output} onChange={(e) => setOutput(e.target.value)} style={{ maxWidth: 180 }}><option value="all">All outputs</option><option value="screenshots">Screenshots</option><option value="video">Videos</option><option value="gif">GIFs</option></select>
        <select value={feature} onChange={(e) => setFeature(e.target.value)} style={{ maxWidth: 180 }}><option value="all">All features</option>{features.map((f) => <option key={f}>{f}</option>)}</select>
        <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} style={{ maxWidth: 220 }}><option value="all">All workflows</option>{workflows.map((w) => <option key={w}>{w}</option>)}</select>
        <span className="muted">{shown.length} run(s), newest first</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        {shown.map((r) => {
          const thumb = r.artifacts.find((a) => a.kind === 'screenshot') ?? r.artifacts.find((a) => a.kind === 'gif');
          const recording = r.artifacts.find((a) => a.kind === 'video' || a.kind === 'gif');
          return (
            <div key={r.runId} className="panel artifact">
              {thumb ? <img src={api.fileUrl(r.runId, thumb.relativePath)} alt="" /> : <div className="preview" style={{ aspectRatio: '16/10' }} />}
              <div style={{ marginTop: 8 }}><strong>{r.workflow.name}</strong> <span className="badge">{r.capture.output}</span> <span className="badge">{r.status}</span></div>
              <div className="muted">{r.workflow.feature} · {new Date(r.createdAt).toLocaleString()} · {r.artifacts.length} artifact(s)</div>
              <div className="row" style={{ marginTop: 8 }}>
                {recording && <a href={`#/run/${r.runId}?play=1`}><button className="primary">▶ Play {recording.kind === 'video' ? 'MP4' : 'GIF'}</button></a>}
                <a href={`#/run/${r.runId}`}><button className={recording ? '' : 'primary'}>Open</button></a>
                <button onClick={() => void regenerateAndGo(r.runId, 'exact', setError)}>Regenerate Exact</button>
                <button onClick={() => void regenerateAndGo(r.runId, 'latest', setError)}>Regenerate Latest</button>
                <button onClick={() => { if (confirm('Delete this capture and all its files?')) api.deleteRun(r.runId).then(load).catch((e) => alert(e.message)); }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
