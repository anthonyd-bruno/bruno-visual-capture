import { useEffect, useState } from 'react';
import type { Settings, SystemStatus } from '@bruno-capture/shared';
import { api } from '../api';

const ICON: Record<string, string> = { ready: '✔', 'not-configured': '○', 'action-required': '!', unavailable: '✖', error: '✖' };

export function SystemStatusPanel({ status, onRecheck }: { status?: SystemStatus; onRecheck: () => void }) {
  return (
    <div className="panel status-list">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>System Status</h2><button onClick={onRecheck}>Recheck</button></div>
      {!status ? <p className="muted">Checking…</p> : (
        <ul>
          {status.components.map((c) => (
            <li key={c.id}>
              <span className={`state-${c.state}`}>{ICON[c.state]}</span>
              <span>{c.label}</span>
              <span className={`state-${c.state}`}>{c.state}</span>
              <span>
                <span className="mono">{c.detail}</span>
                {c.remediation && c.state !== 'ready' && <div className="muted">{c.remediation} {c.action && <a href={c.action.url} target="_blank" rel="noreferrer">{c.action.label}</a>}</div>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus>();
  const [settings, setSettings] = useState<Settings>();
  const [secrets, setSecrets] = useState<{ openai: { keyPresent: boolean }; anthropic: { keyPresent: boolean } }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const load = () => { api.systemStatus().then(setStatus).catch((e) => setError(String(e.message))); api.settings().then((r) => { setSettings(r.settings); setSecrets(r.secrets); }).catch((e) => setError(String(e.message))); };
  useEffect(load, []);

  const save = async (patch: Parameters<typeof api.patchSettings>[0]) => {
    setSaving(true); setError(undefined);
    try { const r = await api.patchSettings(patch); setSettings(r.settings); api.systemStatus().then(setStatus); }
    catch (e) { setError(String((e as Error).message)); } finally { setSaving(false); }
  };
  if (!settings) return <main><h1>Settings</h1><p className="muted">Loading…</p></main>;
  const s = settings;
  return (
    <main>
      <h1>Settings</h1>
      {error && <div className="error">{error}</div>}
      <SystemStatusPanel status={status} onRecheck={load} />
      <div className="grid">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Bruno</h2>
          <label>Application path (blank = auto-detect)</label>
          <input defaultValue={s.bruno.executablePath ?? ''} placeholder="/Applications/Bruno.app" onBlur={(e) => save({ bruno: { executablePath: e.target.value || null } })} />
          <label style={{ marginTop: 10 }}>Profile mode</label>
          <select value={s.capture.profileMode} onChange={(e) => save({ capture: { profileMode: e.target.value as 'user' | 'capture' } })}>
            <option value="user">user — the user's own Bruno profile (PRD default)</option>
            <option value="capture">capture — isolated, seeded profile; never touches the user's Bruno</option>
          </select>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Capture</h2>
          <label>Default preset</label>
          <select value={s.capture.defaultPreset} onChange={(e) => save({ capture: { defaultPreset: e.target.value } })}>
            {['docs-screenshot', 'docs-wide', 'demo-video', 'docs-gif'].map((p) => <option key={p}>{p}</option>)}
          </select>
          <label style={{ marginTop: 10 }}>Artifact root (blank = default)</label>
          <input defaultValue={s.capture.artifactRoot ?? ''} onBlur={(e) => save({ capture: { artifactRoot: e.target.value || null } })} />
          <label style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={s.capture.previewEnabled} onChange={(e) => save({ capture: { previewEnabled: e.target.checked } })} /> Live preview during runs</label>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>AI</h2>
          <label>Preferred provider</label>
          <select value={s.ai.preferredProvider} onChange={(e) => save({ ai: { preferredProvider: e.target.value as 'openai' | 'anthropic' } })}>
            <option value="anthropic">Anthropic</option><option value="openai">OpenAI</option>
          </select>
          <label style={{ marginTop: 10 }}>Anthropic model <span className="badge">{secrets?.anthropic.keyPresent ? 'key present' : 'no key'}</span></label>
          <input defaultValue={s.ai.anthropic.model} onBlur={(e) => save({ ai: { anthropic: { model: e.target.value } } })} />
          <label style={{ marginTop: 10 }}>OpenAI model <span className="badge">{secrets?.openai.keyPresent ? 'key present' : 'no key'}</span></label>
          <input defaultValue={s.ai.openai.model} placeholder="e.g. the current flagship" onBlur={(e) => save({ ai: { openai: { model: e.target.value } } })} />
          <p className="muted">Keys are read from <code>ANTHROPIC_API_KEY</code> / <code>OPENAI_API_KEY</code> until Keychain storage lands (Phase 6).</p>
        </div>
      </div>
      {saving && <p className="muted">Saving…</p>}
    </main>
  );
}
