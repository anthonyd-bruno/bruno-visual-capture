import { useEffect, useState, type ReactElement } from 'react';
import { Nav, type Section } from './components/Nav';
import { CapturePage } from './pages/CapturePage';
import { LibraryPage } from './pages/LibraryPage';
import { RunPage } from './pages/RunPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const f = () => setHash(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const segs = pathPart!.split('/').filter(Boolean);
  return { section: (segs[0] || 'capture') as Section, arg: segs[1], params: new URLSearchParams(query) };
}

export function App() {
  const { section, arg, params } = useHashRoute();
  let page: ReactElement;
  switch (section) {
    case 'workflows': page = <WorkflowsPage />; break;
    case 'library': page = <LibraryPage />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'run': page = arg ? <RunPage key={arg} runId={arg} /> : <LibraryPage />; break;
    default: page = <CapturePage key={params.get('workflow') ?? ''} initialWorkflow={params.get('workflow') ?? undefined} />;
  }
  return <div className="app"><Nav current={section} />{page}</div>;
}
