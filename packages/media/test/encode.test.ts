import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildConcatList, detectFFmpeg, encodeFramesToMp4, generateTestFrames, mp4ToGif, probeMedia, timelineSeconds } from '../src/index.js';

const ff = await detectFFmpeg();
const have = ff.ffmpeg.available && ff.ffprobe.available;

describe('buildConcatList', () => {
  it('holds the first frame from startAt and the last frame until stopAt', () => {
    const list = buildConcatList([{ file: '/a.jpg', t: 10.5 }, { file: '/b.jpg', t: 11 }], 10, 13);
    expect(list.split('\n')).toEqual(["file '/a.jpg'", 'duration 1.000000', "file '/b.jpg'", 'duration 2.000000', "file '/b.jpg'", '']);
  });
  it('escapes quotes and enforces a minimum duration', () => {
    const list = buildConcatList([{ file: "/it's.jpg", t: 1 }, { file: '/b.jpg', t: 1 }], 1, 1);
    expect(list).toContain("file '/it'\\''s.jpg'");
    expect(list).toContain('duration 0.008333');
  });
  it('computes the timeline length from startAt to stopAt', () => {
    expect(timelineSeconds([{ file: '/a', t: 10.5 }, { file: '/b', t: 11 }], 10, 13)).toBe(3);
    expect(timelineSeconds([{ file: '/a', t: 10 }], 10, 10)).toBeCloseTo(1 / 120);
  });
  it('rejects an empty recording with a hint', () => {
    expect(() => buildConcatList([], 0, 1)).toThrow(/No frames were recorded/);
  });
});

describe.skipIf(!have)('FFmpeg pipeline (PRD §99 media tests)', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'bru-media-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('produces a constant 30 fps H.264 MP4 with even dimensions, no audio, and the held-frame duration', async () => {
    const files = await generateTestFrames(path.join(dir, 'frames'), 6, 321, 201);
    // 6 change frames over 1.0 s, then idle until 2.5 s → 2.5 s of video from 6 inputs
    const frames = files.map((file, i) => ({ file, t: 100 + i * 0.2 }));
    const r = await encodeFramesToMp4({ frames, startAt: 100, stopAt: 102.5, out: path.join(dir, 'out.mp4') });
    expect(r.probe.codec).toBe('h264');
    expect(r.probe.fps).toBe(30);
    expect(r.probe.width).toBe(320); expect(r.probe.height).toBe(200);
    expect(r.probe.hasAudio).toBe(false);
    expect(r.probe.durationMs).toBeGreaterThanOrEqual(2400); expect(r.probe.durationMs).toBeLessThanOrEqual(2600);
  });

  it('crops and scales when asked', async () => {
    const files = await generateTestFrames(path.join(dir, 'frames2'), 3, 400, 300);
    const r = await encodeFramesToMp4({ frames: files.map((file, i) => ({ file, t: i * 0.1 })), startAt: 0, stopAt: 0.5, out: path.join(dir, 'crop.mp4'), crop: { x: 10, y: 20, width: 200, height: 100 }, scale: { width: 400, height: 200 } });
    expect([r.probe.width, r.probe.height]).toEqual([400, 200]);
  });

  it('converts to a palette GIF at 15 fps and the requested width', async () => {
    const r = await mp4ToGif({ input: path.join(dir, 'out.mp4'), out: path.join(dir, 'out.gif'), fps: 15, width: 160 });
    expect(r.probe.format).toBe('gif');
    expect(r.probe.width).toBe(160); expect(r.probe.height).toBe(100);
    // GIF delays are whole centiseconds, so 15 fps lands on 6–7 cs (14.3–16.7 fps); exact rates are 10, 12.5, 20, 25, 50.
    expect(r.probe.fps).toBeGreaterThanOrEqual(14); expect(r.probe.fps).toBeLessThanOrEqual(17);
    expect(r.probe.bytes).toBeGreaterThan(1000);
    const again = await probeMedia(r.file);
    expect(again.hasAudio).toBe(false);
  });
});
