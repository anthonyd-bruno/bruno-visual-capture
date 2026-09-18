import { useEffect, useState } from 'react';
import { api, type WorkflowListItem } from '../api';

export function WorkflowsPage() {
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [q, setQ] = useState('');
  const [importPath, setImportPath] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [open, setOpen] = useState<(WorkflowListItem & { rawText: string }) | null>(null);
  const [error, setError] = useState<string>();
  const load = () => api.workflows().then((r) => setItems(r.workflows)).catch((e) => setError(String(e.message)));
  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  const act = (p: Promise<unknown>) => { setError(undefined); p.then(load).catch((e) => setError(String((e as Error).message))); };
  const shown = items.filter((w) => !q || `${w.id ?? ''} ${w.summary?.name ?? ''} ${w.summary?.feature ?? ''} ${w.file}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <main>
      <h1>Workflows</h1>
      {error && <div className="error">{error}</div>}
      <div className="panel row">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <button onClick={() => act(api.refreshWorkflows())}>Refresh Workflows</button>
        <span className="muted">{items.length} files, {items.filter((w) => !w.valid).length} invalid</span>
      </div>
      <div className="grid">
        {shown.map((w) => (
          <div key={w.file} className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{w.summary?.name ?? w.id ?? 'Invalid workflow'}</strong>
              <span className="badge">{w.source}</span>
            </div>
            <div className="muted mono">{w.id}</div>
            {w.summary && <div className="muted">{w.summary.feature} · {w.summary.supportedOutputs.join(', ')}{w.summary.selectorDebt ? ` · ${w.summary.selectorDebt} selector step(s)` : ''}</div>}
            {!w.valid && <div className="error" style={{ marginTop: 8 }}>{w.issues.map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`).join('\n')}</div>}
            <div className="row" style={{ marginTop: 10 }}>
              {w.valid && <a href={`#/capture?workflow=${w.id}`}><button className="primary">Run</button></a>}
              <button onClick={() => api.workflow(w.id ?? w.file).then(setOpen).catch((e) => setError(String(e.message)))}>View</button>
              {w.importId && <button onClick={() => act(api.removeImport(w.importId!))}>Remove Reference</button>}
            </div>
            <div className="muted mono" style={{ marginTop: 6 }}>{w.file}</div>
          </div>
        ))}
      </div>
      {open && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{open.summary?.name ?? open.file}</h2><button onClick={() => setOpen(null)}>Close</button></div>
          {open.summary && <p className="muted">{open.summary.description}</p>}
          {open.summary && Object.keys(open.summary.parameters).length > 0 && (
            <table><thead><tr><th>Parameter</th><th>Type</th><th>Default</th></tr></thead>
              <tbody>{Object.entries(open.summary.parameters).map(([k, p]) => <tr key={k}><td><code>{k}</code></td><td>{p.type}{p.type === 'select' ? ` (${p.options.join(', ')})` : ''}</td><td>{String((p as { default?: unknown }).default ?? '')}</td></tr>)}</tbody></table>
          )}
          <pre>{open.rawText}</pre>
        </div>
      )}
      <h2>Sources</h2>
      <div className="panel">
        <label>Import a workflow file (kept in place)</label>
        <div className="row"><input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="/path/to/workflow.yaml" style={{ maxWidth: 520 }} /><button onClick={() => { act(api.importWorkflow(importPath)); setImportPath(''); }} disabled={!importPath}>Import</button></div>
        <label style={{ marginTop: 12 }}>Add a custom workflow directory</label>
        <div className="row"><input value={dirPath} onChange={(e) => setDirPath(e.target.value)} placeholder="/path/to/workflows" style={{ maxWidth: 520 }} /><button onClick={() => { act(api.addDirectory(dirPath)); setDirPath(''); }} disabled={!dirPath}>Add</button></div>
      </div>
    </main>
  );
}
