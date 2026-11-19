// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sniff, imageInfo, webpInfo, gifInfo, pngInfo } from '../extension/lib/sniff.js';
import { expandInputs, isJunk } from '../extension/lib/unpack.js';
import { normalizeSettings, renderKey } from '../extension/lib/settings.js';
import { cleanName, safeFileName, bytesToBase64, base64ToBytes, hexToRgb } from '../extension/lib/util.js';
import { layout } from '../extension/lib/render.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (n) => new Uint8Array(readFileSync(join(FIX, n)));

test('fixtures exist', () => {
  assert.ok(readdirSync(FIX).length >= 20, 'run: python3 scripts/make_fixtures.py test/fixtures');
});

test('sniff identifies formats by content, not extension', () => {
  assert.equal(sniff(read('static-lossless.webp')).type, 'webp');
  assert.equal(sniff(read('still.png')).type, 'png');
  assert.equal(sniff(read('animated.gif')).type, 'gif');
  assert.equal(sniff(read('photo.jpg')).type, 'jpeg');
  assert.equal(sniff(read('android-folder.zip')).type, 'zip');
  assert.equal(sniff(read('cats.wastickers')).type, 'zip');
  assert.equal(sniff(read('telegram.tgs')).type, 'gzip');
  assert.equal(sniff(read('video.webm')).type, 'webm');
  assert.equal(sniff(read('photo.heic')).type, 'heic');
  assert.equal(sniff(read('not-an-image.webp')).type, 'unknown');
  assert.equal(sniff(read('empty.webp')).type, 'empty');
  assert.equal(sniff(new Uint8Array([1])).type, 'unknown');
});

test('webp header parsing: static, animated, truncated', () => {
  const s = webpInfo(read('static-lossless.webp'));
  assert.deepEqual([s.width, s.height, s.animated, s.frames], [512, 512, false, 1]);
  const lossy = webpInfo(read('static-lossy.webp'));
  assert.deepEqual([lossy.width, lossy.height, lossy.animated], [512, 512, false]);
  const a = webpInfo(read('animated.webp'));
  assert.equal(a.animated, true);
  assert.equal(a.frames, 12);
  const t = webpInfo(read('truncated.webp'));
  assert.ok(!t || t.truncated, 'truncated file flagged');
});

test('png/apng and gif parsing', () => {
  assert.equal(pngInfo(read('still.png')).animated, false);
  const ap = pngInfo(read('animated.png'));
  assert.equal(ap.animated, true);
  assert.equal(ap.frames, 12);
  const g = gifInfo(read('animated.gif'));
  assert.equal(g.animated, true);
  assert.equal(g.frames, 12);
  assert.equal(imageInfo(read('wide-meme.png')).width, 1200);
});

test('expandInputs handles folders, .wastickers, nested zips, junk and broken archives', () => {
  const names = readdirSync(FIX);
  const inputs = names.map((n) => ({ name: n, path: n, bytes: read(n) }));
  const { items, skipped, packs } = expandInputs(inputs);
  const reasons = Object.fromEntries(skipped.map((s) => [s.name, s.reason]));

  assert.match(reasons['telegram.tgs'], /Telegram/);
  assert.match(reasons['video.webm'], /Video/);
  assert.match(reasons['photo.heic'], /HEIC/);
  assert.match(reasons['empty.webp'], /Empty/);
  assert.match(reasons['not-an-image.webp'], /Not a supported image/);
  assert.match(reasons['broken.zip'], /Couldn’t open/);

  // Android folder zip: 3 stickers, no junk, no readme complaint
  const android = items.filter((i) => i.path.startsWith('android-folder.zip'));
  assert.equal(android.length, 3);
  assert.ok(!skipped.some((s) => s.name.includes('readme.txt') || s.name.includes('__MACOSX') || s.name.includes('.nomedia')));

  // .wastickers: 3 webp stickers, tray png excluded, title used as pack name
  const cats = items.filter((i) => i.path.startsWith('cats.wastickers'));
  assert.equal(cats.length, 3);
  assert.equal(packs[cats[0].packKey].name, 'Desi Cats 😺');
  assert.equal(packs[cats[0].packKey].author, 'Anon');

  // nested.zip: inner wastickers (3) + two folders → two packs
  const nested = items.filter((i) => i.path.startsWith('nested.zip'));
  assert.equal(nested.length, 5);
  const nestedPackNames = new Set(nested.map((i) => packs[i.packKey].name));
  assert.ok(nestedPackNames.has('Funny') && nestedPackNames.has('Love') && nestedPackNames.has('Desi Cats 😺'));
});

test('junk detection', () => {
  for (const j of ['__MACOSX/x.webp', 'a/.DS_Store', '.nomedia', 'folder/._foo.webp', 'Thumbs.db']) assert.ok(isJunk(j), j);
  for (const ok of ['WhatsApp Stickers/STK-1.webp', 'a.b.webp']) assert.ok(!isJunk(ok), ok);
});

test('settings are normalized and keyed', () => {
  const s = normalizeSettings({ size: 9999, padding: 5, background: 'nope', gifMaxMB: 0, animatedFormat: 'mp4' });
  assert.equal(s.size, 512);
  assert.equal(s.padding, 0.3);
  assert.equal(s.background, 'transparent');
  assert.equal(s.animatedFormat, 'gif');
  assert.ok(s.gifMaxMB >= 1);
  assert.notEqual(renderKey({ size: 256 }), renderKey({ size: 512 }));
  assert.equal(renderKey({ background: 'white', customBg: '#123456' }), renderKey({ background: 'white', customBg: '#654321' }));
});

test('layout keeps aspect ratio and padding', () => {
  assert.deepEqual(layout(512, 512, 512, 0), { W: 512, H: 512, dx: 0, dy: 0, dw: 512, dh: 512 });
  const w = layout(1200, 400, 512, 0);
  assert.equal(w.W, 512);
  assert.equal(w.H, 171);
  const p = layout(512, 512, 512, 0.1);
  assert.equal(p.W, 512);
  assert.equal(p.dx, 51);
});

test('utils', () => {
  assert.equal(cleanName('STK-2024_01_01 .webp'), 'STK-2024 01 01');
  assert.equal(cleanName(''), 'Sticker');
  assert.equal(safeFileName('Héllo / wörld?', 'gif'), 'Hello-world.gif');
  const u8 = new Uint8Array(70000).map((_, i) => i % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(u8)), u8);
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('garbage'), { r: 255, g: 255, b: 255 });
});
