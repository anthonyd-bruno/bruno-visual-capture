import { useEffect, useState } from 'react';
import type { Settings, SystemStatus } from '@bruno-capture/shared';
import { api, type SecretsView } from '../api';

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
  const [secrets, setSecrets] = useState<SecretsView>();
  const [keyDraft, setKeyDraft] = useState<{ openai: string; anthropic: string }>({ openai: '', anthropic: '' });
  const [testResult, setTestResult] = useState<Partial<Record<'openai' | 'anthropic', string>>>({});
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
          <label style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={s.ai.fallbackEnabled} onChange={(e) => save({ ai: { fallbackEnabled: e.target.checked } })} /> Fall back to the other provider on failure</label>
          <label style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={s.ai.compose} onChange={(e) => save({ ai: { compose: e.target.checked } })} /> Compose new workflows from prompts (off = only pick from registered workflows)</label>
          <label style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={s.ai.selfHeal} onChange={(e) => save({ ai: { selfHeal: e.target.checked } })} /> Self-heal failed steps from the live UI</label>
          <label style={{ marginTop: 10 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={s.ai.retakeAfterHeal} onChange={(e) => save({ ai: { retakeAfterHeal: e.target.checked } })} /> Re-record from the start after a repair during recording (the failure and the fix never appear in the video/GIF)</label>
          <label style={{ marginTop: 10 }}>Max repairs per run</label>
          <input type="number" min={0} max={10} defaultValue={s.ai.maxHeals} style={{ maxWidth: 120 }} onBlur={(e) => save({ ai: { maxHeals: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })} />
          {(['anthropic', 'openai'] as const).map((p) => {
            const sec = secrets?.[p];
            return (
              <div key={p} style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{p === 'anthropic' ? 'Anthropic' : 'OpenAI'}</strong>
                  <span className="badge">{sec?.keyPresent ? `key in ${sec.source}` : 'no key'}</span>
                </div>
                <label style={{ marginTop: 8 }}>Model</label>
                <input defaultValue={s.ai[p].model} placeholder={p === 'openai' ? 'e.g. the current flagship model id' : 'claude-opus-5'} onBlur={(e) => save({ ai: { [p]: { model: e.target.value } } })} />
                <label style={{ marginTop: 8 }}>API key {sec?.source === 'env' && <span className="muted">(environment variable overrides Keychain)</span>}</label>
                <div className="row">
                  <input type="password" autoComplete="off" value={keyDraft[p]} onChange={(e) => setKeyDraft({ ...keyDraft, [p]: e.target.value })} placeholder={sec?.keyPresent ? '•••••••• (stored — enter a new key to replace)' : 'paste key — stored in macOS Keychain'} style={{ maxWidth: 360 }} />
                  <button disabled={!keyDraft[p]} onClick={() => { api.setKey(p, keyDraft[p]).then(() => { setKeyDraft({ ...keyDraft, [p]: '' }); load(); }).catch((e) => setError(String(e.message))); }}>Save key</button>
                  {sec?.source === 'keychain' && <button onClick={() => api.deleteKey(p).then(load).catch((e) => setError(String(e.message)))}>Remove</button>}
                  <button onClick={() => { setTestResult({ ...testResult, [p]: 'testing…' }); api.testProvider(p).then((r) => setTestResult({ ...testResult, [p]: `${r.ok ? '✔' : '✖'} ${r.message}${r.latencyMs ? ` (${r.latencyMs} ms)` : ''}` })).catch((e) => setTestResult({ ...testResult, [p]: `✖ ${e.message}` })); }}>Test {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}</button>
                </div>
                {testResult[p] && <div className="muted" style={{ marginTop: 6 }}>{testResult[p]}</div>}
              </div>
            );
          })}
          <p className="muted" style={{ marginTop: 10 }}>Keys are stored in the macOS Keychain and only ever used by the local backend; <code>ANTHROPIC_API_KEY</code> / <code>OPENAI_API_KEY</code> override them.</p>
        </div>
      </div>
      {saving && <p className="muted">Saving…</p>}
    </main>
  );
}
