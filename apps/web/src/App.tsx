import { useEffect, useState, type ReactElement } from 'react';
import { Nav, type Section } from './components/Nav';
import { CapturePage, type CapturePrefill } from './pages/CapturePage';
import { LibraryPage } from './pages/LibraryPage';
import { RunPage } from './pages/RunPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const f = () => setHash(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const segs = pathPart!.split('/').filter(Boolean);
  return { section: (segs[0] || 'capture') as Section, arg: segs[1], params: new URLSearchParams(query), hash };
}

export function App() {
  const { section, arg, params, hash } = useHashRoute();
  let page: ReactElement;
  switch (section) {
    case 'workflows': page = <WorkflowsPage />; break;
    case 'library': page = <LibraryPage />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'run': page = arg ? <RunPage key={arg} runId={arg} /> : <LibraryPage />; break;
    default: {
      let prefillParams: Record<string, string> | undefined;
      try { const raw = params.get('params'); if (raw) prefillParams = Object.fromEntries(Object.entries(JSON.parse(raw) as Record<string, unknown>).map(([k, v]) => [k, String(v)])); } catch { prefillParams = undefined; }
      const prefill: CapturePrefill = { workflow: params.get('workflow') ?? undefined, output: (params.get('output') as CapturePrefill['output']) ?? undefined, preset: params.get('preset') ?? undefined, params: prefillParams, review: params.get('review') ?? undefined };
      page = <CapturePage key={hash} initialWorkflow={prefill.workflow} prefill={prefill} />;
    }
  }
  return <div className="app"><Nav current={section} />{page}</div>;
}
