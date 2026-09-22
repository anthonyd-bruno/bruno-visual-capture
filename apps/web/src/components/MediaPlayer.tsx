import { useEffect, useRef, useState } from 'react';

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** MP4: the browser's own player, looping and muted so `autoplay` is allowed (recordings carry no audio). */
export function VideoPlayer({ src, autoplay, name }: { src: string; autoplay?: boolean; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (autoplay) ref.current?.play().catch(() => undefined); }, [autoplay, src]);
  return <video ref={ref} controls loop muted playsInline preload="metadata" src={src} aria-label={name} />;
}

interface GifDecoder { decoder: ImageDecoder; frameCount: number }

/**
 * GIF: a real player instead of an endlessly looping `<img>`. Frames are decoded with WebCodecs' `ImageDecoder` and
 * drawn to a canvas, which gives play/pause, restart, frame stepping, a scrubber and playback speed. Browsers without
 * `ImageDecoder` (Firefox) fall back to the plain image with a Restart button.
 */
export function GifPlayer({ src, autoplay = true, name, durationMs }: { src: string; autoplay?: boolean; name: string; durationMs?: number }) {
  const supported = typeof ImageDecoder !== 'undefined';
  return supported
    ? <DecodedGifPlayer src={src} autoplay={autoplay} name={name} durationMs={durationMs} />
    : <ImgGifPlayer src={src} name={name} />;
}

function ImgGifPlayer({ src, name }: { src: string; name: string }) {
  const [nonce, setNonce] = useState(0);
  return (
    <div className="player">
      <img src={nonce ? `${src}?restart=${nonce}` : src} alt={name} />
      <div className="row player-bar">
        <button onClick={() => setNonce((n) => n + 1)}>⟲ Restart</button>
        <span className="muted">This browser cannot pause or scrub GIFs; use Open File for a full player.</span>
      </div>
    </div>
  );
}

function DecodedGifPlayer({ src, autoplay, name, durationMs }: { src: string; autoplay: boolean; name: string; durationMs?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gif = useRef<GifDecoder | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playingRef = useRef(autoplay);
  const indexRef = useRef(0);
  const speedRef = useRef(1);
  const drawing = useRef<Promise<void>>(Promise.resolve());
  const [frameCount, setFrameCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  /** Decode one frame onto the canvas; returns its display duration in ms (GIF minimum 20 ms like browsers use). */
  const draw = (i: number): Promise<number> => {
    const g = gif.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return Promise.resolve(100);
    const p = drawing.current.then(async () => {
      const { image } = await g.decoder.decode({ frameIndex: i });
      if (canvas.width !== image.displayWidth || canvas.height !== image.displayHeight) { canvas.width = image.displayWidth; canvas.height = image.displayHeight; }
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      const ms = image.duration ? image.duration / 1000 : 100;
      image.close();
      return Math.max(20, ms);
    });
    drawing.current = p.then(() => undefined, () => undefined);
    return p;
  };

  const schedule = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void tick(), ms / speedRef.current);
  };
  const tick = async () => {
    const g = gif.current;
    if (!g || !playingRef.current) return;
    const next = (indexRef.current + 1) % g.frameCount;
    indexRef.current = next; setIndex(next);
    try { schedule(await draw(next)); } catch (e) { setError((e as Error).message); }
  };
  const show = async (i: number) => { indexRef.current = i; setIndex(i); try { await draw(i); } catch (e) { setError((e as Error).message); } };
  const setPlay = (on: boolean) => {
    playingRef.current = on; setPlaying(on);
    clearTimeout(timer.current);
    if (on) void tick();
  };

  useEffect(() => {
    let cancelled = false;
    let decoder: ImageDecoder | undefined;
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        decoder = new ImageDecoder({ data: res.body, type: 'image/gif' });
        await decoder.tracks.ready;
        await decoder.completed; // frameCount is only final once every byte has arrived
        if (cancelled) { decoder.close(); return; }
        const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
        if (!count) throw new Error('No frames');
        gif.current = { decoder, frameCount: count };
        setFrameCount(count); setLoading(false);
        indexRef.current = 0; setIndex(0);
        const ms = await draw(0);
        if (playingRef.current) schedule(ms);
      } catch (e) {
        if (!cancelled) { setError(`Could not decode the GIF in the browser (${(e as Error).message}); use Open File.`); setLoading(false); }
      }
    })();
    return () => { cancelled = true; clearTimeout(timer.current); gif.current = undefined; decoder?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const step = (delta: number) => { if (!gif.current) return; setPlay(false); void show((indexRef.current + delta + gif.current.frameCount) % gif.current.frameCount); };
  const elapsed = durationMs && frameCount ? fmt((index / frameCount) * durationMs) : `frame ${index + 1}`;

  if (error) return <div className="player"><img src={src} alt={name} /><div className="row player-bar"><span className="muted">{error}</span></div></div>;
  return (
    <div className="player">
      <canvas ref={canvasRef} aria-label={name} onClick={() => setPlay(!playingRef.current)} style={{ cursor: 'pointer' }} />
      <div className="row player-bar">
        <button className="primary" disabled={loading} onClick={() => setPlay(!playingRef.current)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button disabled={loading} onClick={() => { setPlay(false); void show(0).then(() => setPlay(true)); }}>⟲ Restart</button>
        <button disabled={loading} onClick={() => step(-1)} title="Previous frame" aria-label="Previous frame">‹</button>
        <button disabled={loading} onClick={() => step(1)} title="Next frame" aria-label="Next frame">›</button>
        <input type="range" min={0} max={Math.max(0, frameCount - 1)} value={index} disabled={loading} style={{ flex: 1, minWidth: 120 }}
          onChange={(e) => { setPlay(false); void show(Number(e.target.value)); }} aria-label="Scrub" />
        <span className="mono muted" style={{ minWidth: 120, textAlign: 'right' }}>{loading ? 'decoding…' : `${elapsed}${durationMs ? ` / ${fmt(durationMs)}` : ''} · ${index + 1}/${frameCount}`}</span>
        <select value={speed} disabled={loading} style={{ width: 'auto' }} onChange={(e) => { const s = Number(e.target.value); speedRef.current = s; setSpeed(s); }} aria-label="Speed">
          {[0.25, 0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
    </div>
  );
}

/** Picks the right player for a recording artifact. */
export function MediaPlayer({ kind, src, name, autoplay, durationMs }: { kind: 'video' | 'gif'; src: string; name: string; autoplay?: boolean; durationMs?: number }) {
  return kind === 'video' ? <VideoPlayer src={src} name={name} autoplay={autoplay} /> : <GifPlayer src={src} name={name} autoplay={autoplay ?? true} durationMs={durationMs} />;
}
