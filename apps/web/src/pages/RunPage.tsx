import { useEffect, useRef, useState } from 'react';
import type { Artifact, RunEvent, RunManifest, StepSummary } from '@bruno-capture/shared';
import { api, regenerateAndGo, subscribeRun } from '../api';
import { RefinePanel } from '../components/RefinePanel';
import { MediaPlayer } from '../components/MediaPlayer';

interface StepState { step: StepSummary; status: 'active' | 'done' | 'failed' | 'healing' | 'healed'; message?: string; inserted?: boolean }

export function ArtifactCard({ runId, a, selected, onSelect, onError, autoplay }: { runId: string; a: Artifact; selected?: boolean; onSelect?: (v: boolean) => void; onError: (m: string) => void; autoplay?: boolean }) {
  const url = api.fileUrl(runId, a.relativePath);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoplay) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [autoplay]);
  const copy = async () => { try { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); } catch (e) { onError(`Copy failed: ${(e as Error).message}`); } };
  return (
    <div className="panel artifact" ref={ref} id={`artifact-${a.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}>
      {a.kind === 'screenshot' ? <img src={url} alt={a.fileName} /> : <MediaPlayer kind={a.kind} src={url} name={a.fileName} autoplay={autoplay} durationMs={a.durationMs} />}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="mono">
          {onSelect && <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={Boolean(selected)} onChange={(e) => onSelect(e.target.checked)} />}
          {a.fileName}{a.width ? ` · ${a.width}×${a.height}` : ''}{a.fps ? ` · ${Math.round(a.fps)} fps` : ''}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)}s` : ''} · {(a.bytes / 1024).toFixed(0)} KB
        </span>
        <span className="row">
          <a href={api.fileUrl(runId, a.relativePath, true)}><button>Download {a.kind === 'screenshot' ? 'PNG' : a.kind.toUpperCase()}</button></a>
          {a.kind === 'screenshot' && <button onClick={copy}>Copy</button>}
          <button onClick={() => api.openFile(runId, a.relativePath).catch((e) => onError(e.message))}>Open File</button>
          <button onClick={() => api.reveal(runId, a.relativePath).catch((e) => onError(e.message))}>Reveal in Finder</button>
        </span>
      </div>
    </div>
  );
}

/** PRD §78 artifact detail. */
function RunDetails({ run }: { run: RunManifest }) {
  const rows: Array<[string, string | undefined]> = [
    ['Generated', new Date(run.createdAt).toLocaleString()],
    ['Workflow', `${run.workflow.name} (${run.workflow.id})`],
    ['Feature', run.workflow.feature],
    ['Output', run.capture.output],
    ['Preset', run.capture.preset],
    ['Dimensions', `${run.capture.width}×${run.capture.height ?? '?'} (${run.capture.framing}${run.capture.outputWidth ? `, output ${run.capture.outputWidth} px wide` : ''})`],
    ['Theme / cursor', `${run.capture.theme} / ${run.capture.cursor}`],
    ['Frame rate', run.capture.fps ? `${run.capture.fps} fps` : undefined],
    ['Bruno', `${run.bruno.version ?? '?'} · ${run.bruno.profileMode} profile · ${run.bruno.executablePath}`],
    ['AI', run.ai ? `${run.ai.provider} · ${run.ai.model}${run.ai.fallbackOccurred ? ` · fell back from ${run.ai.fallbackFrom}` : ''}${run.ai.repaired ? ' · repaired' : ''}` : undefined],
    ['Prompt', run.request.prompt],
    ['Parameters', Object.keys(run.parameters).length ? Object.entries(run.parameters).map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'defaults'],
    ['Source', `${run.workflow.source} · ${run.workflow.sourcePath}`],
    ['Regenerated from', run.regenerateOf ? `${run.regenerateOf.runId} (${run.regenerateOf.mode})` : undefined],
    ['Refined from', run.request.refinedFrom],
    ['Adjustments', run.request.feedback?.length ? run.request.feedback.map((f, i) => `${i + 1}. ${f}`).join('  ') : undefined],
    ['Self-healing', run.healing ? `${run.healing.healed} of ${run.healing.attempts} repair(s) succeeded${run.healing.retakes ? ` · ${run.healing.retakes} clean retake(s) so the fix is not in the recording` : ''}${run.healing.learned ? ' · workflow file updated with the healed steps' : ''}` : undefined],
    ['Errors', run.errors.length ? run.errors.map((e) => e.message).join('; ') : undefined],
  ];
  return <table><tbody>{rows.filter(([, v]) => v).map(([k, v]) => <tr key={k}><th style={{ width: 140 }}>{k}</th><td className={k === 'Source' || k === 'Bruno' ? 'mono' : ''}>{v}</td></tr>)}</tbody></table>;
}

/** Recordings first: the GIF/MP4 is what a video/gif run is for, so it should not hide below the stills. */
const byKind = (a: Artifact, b: Artifact) => Number(a.kind === 'screenshot') - Number(b.kind === 'screenshot');

export function RunPage({ runId, play }: { runId: string; play?: boolean }) {
  const [run, setRun] = useState<RunManifest>();
  const [steps, setSteps] = useState<StepState[]>([]);
  const [total, setTotal] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [frame, setFrame] = useState<string>();
  const [status, setStatus] = useState<string>('');
  const [fatal, setFatal] = useState<{ message: string; hint?: string }>();
  const [logs, setLogs] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [uiError, setUiError] = useState<string>();
  const [retake, setRetake] = useState<{ take: number; reason: string }>();
  const live = useRef(true);

  useEffect(() => {
    api.run(runId).then((r) => { setRun(r.run); setStatus(r.run.status); setArtifacts(r.run.artifacts); }).catch(() => undefined);
    const onEvent = (e: RunEvent) => {
      switch (e.type) {
        case 'run.status': setStatus(e.status); break;
        case 'workflow.started': setTotal(e.stepCount); setSteps([]); break;
        // A heal happened while recording: that take is thrown away and the healed steps run again from the start.
        case 'recording.retake': setRetake({ take: e.take, reason: e.reason }); setSteps([]); setArtifacts([]); setTotal(0); break;
        case 'workflow.step.started': setSteps((s) => [...s.filter((x) => x.step.index !== e.step.index), { step: e.step, status: 'active' }]); break;
        case 'workflow.step.completed': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'done' } : x)); break;
        case 'workflow.step.failed': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'failed', message: e.error.message + (e.error.hint ? ` — ${e.error.hint}` : '') } : x)); break;
        case 'workflow.healing': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'healing', message: `${e.error.message} — asking the self-healer (${e.attempt}/${e.max})…` } : x)); break;
        case 'workflow.healed': {
          // The failed step is replaced in place: renumber what follows and insert the replacement steps as pending.
          setTotal(e.total);
          setSteps((s) => {
            const shift = e.replacement.length - 1 - e.dropped;
            const kept = s.filter((x) => x.step.index !== e.step.index && !(x.step.index > e.step.index && x.step.index <= e.step.index + e.dropped))
              .map((x) => x.step.index > e.step.index ? { ...x, step: { ...x.step, index: x.step.index + shift } } : x);
            const healed: StepState = { step: e.step, status: 'healed', message: `healed: ${e.rationale}` };
            const inserted: StepState[] = e.replacement.map((r) => ({ step: r, status: 'active' as const, inserted: true }));
            return [...kept, { ...healed, step: { ...healed.step, index: e.step.index - 0.5 } }, ...inserted];
          });
          break;
        }
        case 'workflow.heal.failed': setSteps((s) => s.map((x) => x.step.index === e.step.index ? { ...x, status: 'failed', message: `self-healer gave up: ${e.message}` } : x)); break;
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
          {terminal && run && <button onClick={() => void regenerateAndGo(runId, 'exact', setUiError)}>Regenerate Exact</button>}
          {terminal && run && <button onClick={() => void regenerateAndGo(runId, 'latest', setUiError)}>Regenerate Latest</button>}
          {terminal && <button onClick={() => api.reveal(runId).catch((e) => setUiError(e.message))}>Reveal in Finder</button>}
          {terminal && run && <button onClick={() => { if (confirm('Delete this capture and all its files?')) api.deleteRun(runId).then(() => { location.hash = '#/library'; }).catch((e) => setUiError(e.message)); }}>Delete</button>}
          <a href="#/library"><button>Library</button></a>
        </span>
      </div>
      <p className="muted mono">{runId}{run ? ` · ${run.capture.output} · ${run.capture.preset} · ${run.capture.width}×${run.capture.height ?? '?'} ${run.capture.theme} · Bruno ${run.bruno.version ?? '?'} (${run.bruno.profileMode} profile)` : ''}</p>
      {fatal && <div className="error"><strong>{fatal.message}</strong>{fatal.hint && <div>{fatal.hint}</div>}</div>}
      {uiError && <div className="error">{uiError}</div>}
      {retake && <div className="panel notice"><strong>Take {retake.take}.</strong> {retake.reason[0]!.toUpperCase()}{retake.reason.slice(1)}, so the healed workflow {terminal ? 'was re-run' : 'is re-running'} from the start in a fresh Bruno session. The recording {terminal ? 'contains' : 'will contain'} neither the failure nor the fix.</div>}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="panel">
          {!terminal ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>{active ? `Running ${active.step.index + 1} of ${total}` : status}</strong><span className="muted">{active?.step.label}</span></div>
              {frame ? <img className="preview" src={frame} alt="Live Bruno preview" /> : <div className="preview" />}
            </>
          ) : artifacts.length === 0 ? <p className="muted">No artifacts.</p> : (
            <>
              {artifacts.length > 1 && (
                <div className="row" style={{ marginBottom: 10 }}>
                  <a href={api.archiveUrl(runId)}><button className="primary">Download All (ZIP)</button></a>
                  {Object.values(selected).some(Boolean) && <a href={api.archiveUrl(runId, artifacts.filter((a) => selected[a.id]).map((a) => a.relativePath))}><button>Download Selected ({Object.values(selected).filter(Boolean).length})</button></a>}
                  <span className="muted">Tick screenshots to download a subset.</span>
                </div>
              )}
              <div className="grid" style={{ gridTemplateColumns: '1fr' }}>{[...artifacts].sort(byKind).map((a, i) => <ArtifactCard key={a.id} runId={runId} a={a} onError={setUiError} selected={selected[a.id]} onSelect={artifacts.length > 1 ? (v) => setSelected({ ...selected, [a.id]: v }) : undefined} autoplay={Boolean(play) && a.kind !== 'screenshot' && i === 0} />)}</div>
            </>
          )}
        </div>
        <div className="panel steps">
          <h2 style={{ marginTop: 0 }}>Steps</h2>
          <ul>{steps.sort((a, b) => a.step.index - b.step.index).map((s) => (
            <li key={s.step.index} className={s.status === 'done' ? 'step-done' : s.status === 'failed' ? 'step-failed' : s.status === 'healed' ? 'step-healed' : 'step-active'}>
              <span>{s.status === 'done' ? '✔' : s.status === 'failed' ? '✖' : s.status === 'healed' ? '⟳' : s.status === 'healing' ? '…' : '▶'}</span><span>{Number.isInteger(s.step.index) ? `${s.step.index + 1}. ` : ''}{s.step.label}{s.inserted && <span className="badge" style={{ marginLeft: 6 }}>healed in</span>}{s.message && <div className="muted">{s.message}</div>}</span>
            </li>
          ))}</ul>
          {!terminal && artifacts.length > 0 && <p className="muted">{artifacts.length} artifact(s) so far</p>}
          {logs.length > 0 && <details><summary className="muted">Debug log ({logs.length})</summary><pre>{logs.join('\n')}</pre></details>}
        </div>
      </div>
      {terminal && run && <RefinePanel from={{ runId }} onApplied={(id) => { location.hash = `#/run/${id}`; }} />}
      {terminal && run && <div className="panel"><h2 style={{ marginTop: 0 }}>Details</h2><RunDetails run={run} /></div>}
    </main>
  );
}
