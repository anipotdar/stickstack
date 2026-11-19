// Voice-note format tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../extension/lib/voicecodec.js';

const V = globalThis.StickStackVoice;
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const png = () => new Uint8Array(readFileSync(join(FIX, 'tiny.png')));
const fakeAudio = (n = 3000) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
const meta = { mime: 'audio/webm;codecs=opus', durationMs: 4200, peaks: [0, 64, 255, 128] };

test('crc32 matches the standard check value', () => {
  assert.equal(V.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a voice note round-trips through a PNG', () => {
  const audio = fakeAudio();
  const out = V.embedVoice(png(), meta, audio);
  assert.ok(V.isPng(out));
  const v = V.extractVoice(out);
  assert.equal(v.mime, meta.mime);
  assert.equal(v.durationMs, 4200);
  assert.deepEqual(v.peaks, [0, 64, 255, 128]);
  assert.deepEqual([...v.audio], [...audio]);
});

test('the voice chunk sits right before IEND and the PNG stays well-formed', () => {
  const src = png();
  const out = V.embedVoice(src, meta, fakeAudio());
  const types = V.readChunks(out).map((c) => c.type);
  assert.equal(types.at(-1), 'IEND');
  assert.equal(types.at(-2), V.CHUNK_TYPE);
  assert.deepEqual(types.filter((t) => t !== V.CHUNK_TYPE), V.readChunks(src).map((c) => c.type));
  // Re-embedding replaces instead of stacking.
  const again = V.embedVoice(out, { ...meta, durationMs: 1000 }, fakeAudio(10));
  assert.equal(V.readChunks(again).filter((c) => c.type === V.CHUNK_TYPE).length, 1);
  assert.equal(V.extractVoice(again).durationMs, 1000);
});

test('ordinary and damaged images are not voice notes', () => {
  assert.equal(V.extractVoice(png()), null);
  assert.equal(V.extractVoice(new Uint8Array([1, 2, 3])), null);
  const out = V.embedVoice(png(), meta, fakeAudio());
  const flipped = out.slice();
  flipped[flipped.length - 40] ^= 0xff; // inside the audio → CRC mismatch
  assert.equal(V.extractVoice(flipped), null);
  assert.equal(V.extractVoice(out.slice(0, out.length - 20)), null); // truncated, no IEND
});

test('payload validation rejects hostile headers', () => {
  const enc = (obj, audio = [1, 2, 3]) => {
    const h = new TextEncoder().encode(JSON.stringify(obj));
    const b = new Uint8Array(5 + h.length + audio.length);
    b[0] = 1;
    new DataView(b.buffer).setUint32(1, h.length);
    b.set(h, 5);
    b.set(audio, 5 + h.length);
    return b;
  };
  assert.ok(V.decodePayload(enc({ v: 1, mime: 'audio/webm', ms: 1000 })));
  assert.equal(V.decodePayload(enc({ v: 1, mime: 'text/html', ms: 1000 })), null);
  assert.equal(V.decodePayload(enc({ v: 1, mime: 'audio/webm', ms: -5 })), null);
  assert.equal(V.decodePayload(enc({ v: 1, mime: 'audio/webm', ms: 99e9 })), null);
  assert.equal(V.decodePayload(enc({ v: 2, mime: 'audio/webm', ms: 1000 })), null);
  assert.equal(V.decodePayload(enc({ v: 1, mime: 'audio/webm', ms: 1000 }, [])), null);
  const peaks = V.decodePayload(enc({ v: 1, mime: 'audio/webm', ms: 1000, peaks: [999, -4, 'x', 12.6] })).peaks;
  assert.deepEqual(peaks, [255, 0, 0, 13]);
});

test('encoding refuses bad input', () => {
  assert.throws(() => V.embedVoice(png(), meta, new Uint8Array()), /No audio/);
  assert.throws(() => V.embedVoice(png(), { ...meta, mime: 'video/mp4' }, fakeAudio()), /format/);
  assert.throws(() => V.embedVoice(png(), { ...meta, durationMs: V.MAX_MS + 60000 }, fakeAudio()), /duration/);
  assert.throws(() => V.embedVoice(new Uint8Array(10), meta, fakeAudio()), /PNG/);
  assert.throws(() => V.embedVoice(png(), meta, new Uint8Array(V.MAX_AUDIO_BYTES + 1)), /too long/);
});

test('waveform downsampling', () => {
  const p = V.downsample([0, 0.1, 0.2, 0.4, 0.2, 0.1], 3);
  assert.equal(p.length, 3);
  assert.equal(Math.max(...p), 255);
  assert.ok(p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  assert.deepEqual(V.downsample([], 4), [0, 0, 0, 0]);
  assert.ok(Math.max(...V.downsample([0.001, 0.002], 2)) < 80, 'silence stays low');
  assert.equal(V.downsample(new Array(1000).fill(0.2), V.BARS).length, V.BARS);
});

test('formatDuration', () => {
  assert.equal(V.formatDuration(0), '0:00');
  assert.equal(V.formatDuration(4200), '0:04');
  assert.equal(V.formatDuration(65_000), '1:05');
  assert.equal(V.formatDuration(V.MAX_MS), '5:00');
});

test('original upload URL is recovered from Substack CDN URLs', () => {
  const orig = 'https://substack-post-media.s3.amazonaws.com/public/images/0a1b2c3d-1111-2222-3333-444455556666_800x200.png';
  const enc = encodeURIComponent(orig);
  assert.equal(V.originalImageUrl(orig), orig);
  assert.equal(V.originalImageUrl(`https://substackcdn.com/image/fetch/w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/${enc}`), orig);
  assert.equal(V.originalImageUrl(`https://substackcdn.com/image/fetch/$s_!abc!,w_424,c_limit,f_webp/${enc}`), orig);
  assert.equal(V.originalImageUrl(`https://substackcdn.com/image/fetch/f_auto/${orig}`), orig);
  // Anything else is refused, so the background fetch can't be pointed elsewhere.
  assert.equal(V.originalImageUrl('https://evil.example/x.png'), null);
  assert.equal(V.originalImageUrl(`https://substackcdn.com/image/fetch/f_auto/${encodeURIComponent('https://evil.example/x.png')}`), null);
  assert.equal(V.originalImageUrl('http://substack-post-media.s3.amazonaws.com/a.png'), null);
  assert.equal(V.originalImageUrl('https://substack-post-media.s3.amazonaws.com.evil.example/a.png'), null);
  assert.equal(V.originalImageUrl('https://user:pw@substack-post-media.s3.amazonaws.com/a.png'), null);
  assert.equal(V.originalImageUrl('blob:https://substack.com/123'), null);
  assert.equal(V.originalImageUrl(null), null);
});

test('card shape check', () => {
  assert.ok(V.looksLikeCard(800, 200));
  assert.ok(V.looksLikeCard(400, 100));
  assert.ok(V.looksLikeCard(1456, 364));
  assert.ok(!V.looksLikeCard(512, 512));
  assert.ok(!V.looksLikeCard(40, 10));
});
