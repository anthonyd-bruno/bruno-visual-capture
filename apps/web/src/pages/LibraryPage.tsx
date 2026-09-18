import { useEffect, useState } from 'react';
import type { RunManifest } from '@bruno-capture/shared';
import { api } from '../api';

export function LibraryPage() {
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [output, setOutput] = useState('all');
  const [feature, setFeature] = useState('all');
  const load = () => api.runs().then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const features = [...new Set(runs.map((r) => r.workflow.feature))];
  const shown = runs.filter((r) => (output === 'all' || r.capture.output === output) && (feature === 'all' || r.workflow.feature === feature));
  return (
    <main>
      <h1>Library</h1>
      <div className="panel row">
        <select value={output} onChange={(e) => setOutput(e.target.value)} style={{ maxWidth: 180 }}><option value="all">All outputs</option><option value="screenshots">Screenshots</option><option value="video">Videos</option><option value="gif">GIFs</option></select>
        <select value={feature} onChange={(e) => setFeature(e.target.value)} style={{ maxWidth: 180 }}><option value="all">All features</option>{features.map((f) => <option key={f}>{f}</option>)}</select>
        <span className="muted">{shown.length} run(s), newest first</span>
      </div>
      <div className="grid">
        {shown.map((r) => {
          const thumb = r.artifacts.find((a) => a.kind === 'screenshot' || a.kind === 'gif');
          return (
            <div key={r.runId} className="panel artifact">
              {thumb ? <img src={api.fileUrl(r.runId, thumb.relativePath)} alt="" /> : <div className="preview" style={{ aspectRatio: '16/10' }} />}
              <div style={{ marginTop: 8 }}><strong>{r.workflow.name}</strong> <span className="badge">{r.capture.output}</span> <span className="badge">{r.status}</span></div>
              <div className="muted">{r.workflow.feature} · {new Date(r.createdAt).toLocaleString()} · {r.artifacts.length} artifact(s)</div>
              <div className="row" style={{ marginTop: 8 }}>
                <a href={`#/run/${r.runId}`}><button className="primary">Open</button></a>
                <button onClick={() => api.regenerate(r.runId, 'latest').then((x) => { location.hash = `#/run/${x.run.runId}`; }).catch((e) => alert(e.message))}>Regenerate</button>
                <button onClick={() => { if (confirm('Delete this capture and all its files?')) api.deleteRun(r.runId).then(load).catch((e) => alert(e.message)); }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
